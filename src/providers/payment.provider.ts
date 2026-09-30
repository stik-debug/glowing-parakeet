/**
 * Payment provider abstraction.
 * TestPaymentProvider for dev/staging. MpesaPaymentProvider scaffold for production credentials.
 * Never treat unverified payments as success.
 */

export type ProviderResult = {
  status: 'PENDING' | 'SUCCESS' | 'FAILED' | 'CANCELLED' | 'TIMEOUT';
  providerRef: string;
  raw?: unknown;
};

export interface PaymentProvider {
  name: string;
  initiate(input: {
    amountKes: number;
    phone: string;
    accountRef: string;
    description: string;
  }): Promise<ProviderResult>;
  /** Simulate or process callback verification */
  verifyCallback(payload: Record<string, unknown>): Promise<{
    valid: boolean;
    providerRef: string;
    amountKes: number;
    status: ProviderResult['status'];
  }>;
}

export class TestPaymentProvider implements PaymentProvider {
  name = 'test';

  async initiate(input: {
    amountKes: number;
    phone: string;
    accountRef: string;
    description: string;
  }): Promise<ProviderResult> {
    const ref = `TEST-PAYMENT-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    // Immediately "pending" — success only via verified callback path
    return { status: 'PENDING', providerRef: ref, raw: { phone: input.phone, amount: input.amountKes } };
  }

  async verifyCallback(payload: Record<string, unknown>) {
    const providerRef = String(payload.providerRef || payload.CheckoutRequestID || '');
    const amountKes = Number(payload.amountKes || payload.amount || 0);
    const force = String(payload.result || 'SUCCESS').toUpperCase();
    if (!providerRef) return { valid: false, providerRef: '', amountKes: 0, status: 'FAILED' as const };
    if (force === 'FAILED') return { valid: true, providerRef, amountKes, status: 'FAILED' };
    if (force === 'TIMEOUT') return { valid: true, providerRef, amountKes, status: 'TIMEOUT' };
    if (force === 'CANCELLED') return { valid: true, providerRef, amountKes, status: 'CANCELLED' };
    return { valid: true, providerRef, amountKes, status: 'SUCCESS' };
  }
}

/** Scaffold — requires real Safaricom Daraja credentials. Does not fake success. */
export class MpesaPaymentProvider implements PaymentProvider {
  name = 'mpesa';
  async initiate(): Promise<ProviderResult> {
    if (!process.env.MPESA_CONSUMER_KEY) {
      throw new Error('M-Pesa credentials not configured');
    }
    // Real STK push would go here
    throw new Error('M-Pesa live integration requires Safaricom credentials — use TestPaymentProvider in this environment');
  }
  async verifyCallback() {
    return { valid: false, providerRef: '', amountKes: 0, status: 'FAILED' as const };
  }
}

export function getPaymentProvider(): PaymentProvider {
  const mode = (process.env.PAYMENT_PROVIDER || 'test').toLowerCase();
  if (mode === 'mpesa') return new MpesaPaymentProvider();
  return new TestPaymentProvider();
}
