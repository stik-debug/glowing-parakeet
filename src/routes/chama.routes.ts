import { Router, Response, NextFunction } from 'express';
import * as chamaService from '../services/chama.service.js';
import {
  requireAuth,
  requireChamaAccess,
  requireChamaRole,
  AuthedRequest,
} from '../middleware/auth.js';

const router = Router();

// Create Chama (authenticated user becomes CHAMA_ADMIN, starts on TRIAL)
router.post('/', requireAuth, (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const result = chamaService.createChama({
      name: req.body.name,
      description: req.body.description,
      location: req.body.location,
      createdBy: req.user!.userId,
      planCode: req.body.planCode,
    });
    // Note: client should refresh token /me to pick up new chamaId in JWT
    res.status(201).json({ success: true, data: result });
  } catch (e) {
    next(e);
  }
});

// Get chama details (tenant-scoped)
router.get(
  '/:chamaId',
  requireAuth,
  requireChamaAccess('chamaId'),
  (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const isSuper = req.user!.roles.includes('SUPER_ADMIN');
      const data = chamaService.getChama(req.params.chamaId, req.user!.userId, isSuper);
      res.json({ success: true, data });
    } catch (e) {
      next(e);
    }
  }
);

// List members
router.get(
  '/:chamaId/members',
  requireAuth,
  requireChamaAccess('chamaId'),
  (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const members = chamaService.listMembers(req.params.chamaId);
      res.json({ success: true, data: members });
    } catch (e) {
      next(e);
    }
  }
);

// Add member — enforces plan max_members server-side
router.post(
  '/:chamaId/members',
  requireAuth,
  requireChamaAccess('chamaId'),
  requireChamaRole('CHAMA_ADMIN', 'SECRETARY'),
  (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const result = chamaService.addMember({
        chamaId: req.params.chamaId,
        userId: req.body.userId,
        role: req.body.role || 'MEMBER',
        addedBy: req.user!.userId,
      });
      res.status(201).json({ success: true, data: result });
    } catch (e) {
      next(e);
    }
  }
);

// Remove member (soft) — preserves financial history
router.delete(
  '/:chamaId/members/:memberId',
  requireAuth,
  requireChamaAccess('chamaId'),
  requireChamaRole('CHAMA_ADMIN'),
  (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      chamaService.removeMember({
        chamaId: req.params.chamaId,
        memberId: req.params.memberId,
        removedBy: req.user!.userId,
      });
      res.json({ success: true });
    } catch (e) {
      next(e);
    }
  }
);

export default router;
