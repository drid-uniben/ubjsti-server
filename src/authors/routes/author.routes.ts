import express from 'express';
import authorController from '../controllers/author.controller';
import {
  rateLimiter,
  authenticateAuthorToken,
  authenticateAdminToken,
} from '../../middleware/auth.middleware';
import validateRequest from '../../middleware/validateRequest';
import { z } from 'zod';

const router = express.Router();

// Validation schemas
const inviteAuthorSchema = z.object({
  body: z.object({
    email: z.string().email('Please provide a valid email address'),
  }),
});

const completeProfileSchema = z.object({
  body: z.object({
    name: z.string().min(2, 'Name must be at least 2 characters'),
    faculty: z.string().min(1, 'Faculty is required'),
    affiliation: z.string().min(1, 'Affiliation is required'),
    orcid: z.string().optional(),
  }),
  params: z.object({
    token: z.string().min(1, 'Token is required'),
  }),
});

const addAuthorSchema = z.object({
  body: z.object({
    email: z.string().email('Please provide a valid email address'),
    name: z.string().min(2, 'Name must be at least 2 characters'),
    faculty: z.string().min(1, 'Faculty is required'),
    affiliation: z.string().min(1, 'Affiliation is required'),
    orcid: z.string().optional(),
  }),
});

// Apply rate limiting to all admin endpoints
const adminRateLimiter = rateLimiter(5000, 60 * 60 * 1000); // 100 requests per hour

// Admin routes for author management
router.post(
  '/invite',
  authenticateAdminToken,
  adminRateLimiter,
  validateRequest(inviteAuthorSchema),
  authorController.inviteAuthor
);

router.post(
  '/add',
  authenticateAdminToken,
  adminRateLimiter,
  validateRequest(addAuthorSchema),
  authorController.addAuthorProfile
);

router.get(
  '/invitations',
  authenticateAdminToken,
  adminRateLimiter,
  authorController.getAuthorInvitations
);

router.delete(
  '/:id',
  authenticateAdminToken,
  adminRateLimiter,
  authorController.deleteAuthor
);

router.post(
  '/:id/resend-invitation',
  authenticateAdminToken,
  adminRateLimiter,
  authorController.resendAuthorInvitation
);

// Public route for profile completion
router.post(
  '/complete-profile/:token',
  validateRequest(completeProfileSchema),
  authorController.completeAuthorProfile
);

// Dashboard route
const researcherRateLimiter = rateLimiter(50, 60 * 60 * 1000); // 50 requests per hour
router.get(
  '/dashboard',
  authenticateAuthorToken,
  researcherRateLimiter,
  authorController.getAuthorDashboard
);

// Get specific manuscript details
router.get(
  '/manuscripts/:manuscriptId',
  authenticateAuthorToken,
  researcherRateLimiter,
  authorController.getManuscriptDetails
);

export default router;
