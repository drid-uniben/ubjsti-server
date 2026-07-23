import express from 'express';
import authorManagementController from '../controllers/author-management.controller';
import {
  authenticateAdminToken,
  rateLimiter,
} from '../../middleware/auth.middleware';

const router = express.Router();

// Apply rate limiting to all admin endpoints
const adminRateLimiter = rateLimiter(5000, 60 * 60 * 1000); // 100 requests per hour

// Protect all routes with admin authentication
router.use(authenticateAdminToken);
router.use(adminRateLimiter);

// Get all authors
router.get('/authors', authorManagementController.getAuthors);

// Get author details with manuscripts
router.get('/authors/:authorId', authorManagementController.getAuthorDetails);

// Send login credentials to author
router.post(
  '/authors/:authorId/send-credentials',
  authorManagementController.sendAuthorCredentials
);

// Resend login credentials to author
router.post(
  '/authors/:authorId/resend-credentials',
  authorManagementController.resendAuthorCredentials
);

export default router;
