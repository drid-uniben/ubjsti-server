import { Router } from 'express';
import manuscriptReviewsController from '../controllers/manuscriptReviews.controller';
import {
  authenticateAdminToken,
  rateLimiter,
} from '../../middleware/auth.middleware';
import validateRequest from '../../middleware/validateRequest';
import { z } from 'zod';

const router = Router();

const adminRateLimiter = rateLimiter(5000, 60 * 60 * 1000);

const manuscriptReviewsQuerySchema = z.object({
  query: z.object({
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().optional(),
    status: z.enum(['under_review', 'reviewed', 'reconciliation']).optional(),
    discrepancy: z
      .enum(['true', 'false'])
      .transform((val) => val === 'true')
      .optional(),
  }),
});

const manuscriptIdSchema = z.object({
  params: z.object({
    manuscriptId: z
      .string()
      .regex(
        /^[0-9a-fA-F]{24}$/,
        'Invalid manuscript ID format. Manuscript ID must be a 24-character hexadecimal string.'
      ),
  }),
});

router.get(
  '/',
  authenticateAdminToken,
  adminRateLimiter,
  validateRequest(manuscriptReviewsQuerySchema),
  manuscriptReviewsController.getAllManuscriptReviews
);

router.get(
  '/statistics',
  authenticateAdminToken,
  adminRateLimiter,
  manuscriptReviewsController.getStatistics
);

router.get(
  '/:manuscriptId',
  authenticateAdminToken,
  adminRateLimiter,
  validateRequest(manuscriptIdSchema),
  manuscriptReviewsController.getManuscriptReviewDetails
);

export default router;
