import { Router } from 'express';
import overrideDecisionController from '../controllers/overrideDecision.controller';
import {
  authenticateAdminToken,
  rateLimiter,
} from '../middleware/auth.middleware';

const router = Router();

const adminRateLimiter = rateLimiter(5000, 60 * 60 * 1000); // Stricter rate limit for sensitive operations

// Override manuscript status (admin only)
router.post(
  '/:manuscriptId/override',
  authenticateAdminToken,
  adminRateLimiter,
  overrideDecisionController.overrideStatus
);

// Get override history for a manuscript (admin only)
router.get(
  '/:manuscriptId/override-history',
  authenticateAdminToken,
  adminRateLimiter,
  overrideDecisionController.getOverrideHistory
);

export default router;
