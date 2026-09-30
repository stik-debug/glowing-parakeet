/**
 * Subscription payments — server-side verification, idempotent webhooks.
 */
import { getDb, generateId, nowIso, withTransaction } from '../db/index.js';
import { ValidationError, NotFoundError, PaymentError, ConflictError } from '../utils/errors.js';
import { getPaymentProvider } from '../providers/payment.provider.js';
import { toKesInteger } from '../utils/money.js';

export async function initiateSubscriptionPayment(input: {
  chamaId: string;
  phone: string;
  userId: string;
}) {
  const db = getDb();
  const sub = db
    .prepare(
      `SELECT s.*, p.price_kes, p.code as plan_code FROM subscriptions s
       JOIN subscription_plans p ON p.id = s.plan_id WHERE s.chama_id = ?`
    )
    .get(input.chamaId) as any;
  if (!sub) throw new NotFoundError('Subscription not found');

  const amount = toKesInteger(sub.price_kes);
  const provider = getPaymentProvider();
  const idempotencyKey = generateId();
  const paymentId = generateId();
  const now = nowIso();

  const init = await provider.initiate({
    amountKes: amount,
    phone: input.phone,
    accountRef: input.chamaId.slice(0, 12),
    description: `ChamaPay ${sub.plan_code}`,
  });

  db.prepare(
    `INSERT INTO payments (id, chama_id, subscription_id, amount_kes, currency, status, provider, provider_ref, phone, idempotency_key, metadata, is_test_data, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'KES', 'PENDING', ?, ?, ?, ?, ?, 0, ?, ?)`
  ).run(
    paymentId,
    input.chamaId,
    sub.id,
    amount,
    provider.name,
    init.providerRef,
    input.phone,
    idempotencyKey,
    JSON.stringify({ plan: sub.plan_code }),
    now,
    now
  );

  return {
    paymentId,
    providerRef: init.providerRef,
    amountKes: amount,
    status: 'PENDING',
    provider: provider.name,
    // For TestPaymentProvider: client can call simulate callback
    testCallbackHint:
      provider.name === 'test'
        ? { path: '/api/payments/callback', body: { providerRef: init.providerRef, amountKes: amount, result: 'SUCCESS' } }
        : undefined,
  };
}

/**
 * Process provider callback. Idempotent on provider_ref.
 */
export function processPaymentCallback(payload: Record<string, unknown>) {
  return withTransaction((tx) => {
    // Sync verify via provider (test is deterministic)
    // We re-import inside for simplicity
  });
}

export async function handleCallback(payload: Record<string, unknown>) {
  const provider = getPaymentProvider();
  const verified = await provider.verifyCallback(payload);
  if (!verified.valid || !verified.providerRef) {
    throw new PaymentError('Invalid payment callback', 'INVALID_CALLBACK');
  }

  return withTransaction((tx) => {
    // Idempotency: webhook table
    const existingWh = tx
      .prepare(`SELECT id, processed FROM payment_webhooks WHERE provider = ? AND provider_ref = ?`)
      .get(provider.name, verified.providerRef) as any;

    if (existingWh?.processed) {
      return { duplicate: true, message: 'Already processed' };
    }

    const whId = existingWh?.id || generateId();
    if (!existingWh) {
      tx.prepare(
        `INSERT INTO payment_webhooks (id, provider, provider_ref, payload, processed, created_at)
         VALUES (?, ?, ?, ?, 0, ?)`
      ).run(whId, provider.name, verified.providerRef, JSON.stringify(payload), nowIso());
    }

    const payment = tx
      .prepare(`SELECT * FROM payments WHERE provider = ? AND provider_ref = ?`)
      .get(provider.name, verified.providerRef) as any;

    if (!payment) {
      tx.prepare(`UPDATE payment_webhooks SET processed = 1, processing_result = ? WHERE id = ?`).run(
        'PAYMENT_NOT_FOUND',
        whId
      );
      throw new NotFoundError('Payment not found for provider ref');
    }

    if (payment.status === 'SUCCESS') {
      tx.prepare(`UPDATE payment_webhooks SET processed = 1, processing_result = ? WHERE id = ?`).run(
        'ALREADY_SUCCESS',
        whId
      );
      return { duplicate: true, paymentId: payment.id, status: 'SUCCESS' };
    }

    if (verified.status !== 'SUCCESS') {
      tx.prepare(`UPDATE payments SET status = ?, updated_at = ? WHERE id = ?`).run(
        verified.status,
        nowIso(),
        payment.id
      );
      tx.prepare(`UPDATE payment_webhooks SET processed = 1, processing_result = ? WHERE id = ?`).run(
        verified.status,
        whId
      );
      return { paymentId: payment.id, status: verified.status };
    }

    // Amount check
    if (Number(verified.amountKes) !== Number(payment.amount_kes)) {
      tx.prepare(`UPDATE payment_webhooks SET processed = 1, processing_result = ? WHERE id = ?`).run(
        'AMOUNT_MISMATCH',
        whId
      );
      throw new PaymentError('Amount mismatch', 'AMOUNT_MISMATCH');
    }

    const now = nowIso();
    tx.prepare(
      `UPDATE payments SET status = 'SUCCESS', verified_at = ?, updated_at = ? WHERE id = ?`
    ).run(now, now, payment.id);

    // Extend / activate subscription
    const sub = tx.prepare(`SELECT * FROM subscriptions WHERE id = ?`).get(payment.subscription_id) as any;
    if (sub) {
      const periodEnd = new Date();
      periodEnd.setDate(periodEnd.getDate() + 30);
      const endStr = periodEnd.toISOString().replace('T', ' ').substring(0, 19);
      tx.prepare(
        `UPDATE subscriptions SET status = 'ACTIVE', current_period_start = ?, current_period_end = ?,
         grace_ends_at = NULL, suspended_at = NULL, suspension_reason = NULL, updated_at = ?
         WHERE id = ?`
      ).run(now, endStr, now, sub.id);
    }

    tx.prepare(
      `INSERT INTO ledger_transactions (id, chama_id, type, amount_kes, reference_type, reference_id, description, created_by, is_test_data, created_at)
       VALUES (?, ?, 'SUBSCRIPTION_PAYMENT', ?, 'payment', ?, ?, NULL, 0, ?)`
    ).run(generateId(), payment.chama_id, payment.amount_kes, payment.id, 'Subscription payment', now);

    tx.prepare(
      `INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, chama_id, metadata, created_at)
       VALUES (?, NULL, 'PAYMENT_SUCCESS', 'payment', ?, ?, ?, ?)`
    ).run(generateId(), payment.id, payment.chama_id, JSON.stringify({ amount: payment.amount_kes }), now);

    tx.prepare(`UPDATE payment_webhooks SET processed = 1, processing_result = ? WHERE id = ?`).run(
      'SUCCESS',
      whId
    );

    return { paymentId: payment.id, status: 'SUCCESS', duplicate: false };
  });
}

export function revenueTotal(): number {
  const db = getDb();
  const row = db
    .prepare(`SELECT COALESCE(SUM(amount_kes), 0) as t FROM payments WHERE status = 'SUCCESS'`)
    .get() as { t: number };
  return Number(row.t) || 0;
}
