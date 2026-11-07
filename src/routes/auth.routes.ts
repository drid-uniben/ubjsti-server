import { Router } from 'express';
import authController from '../controllers/auth.controller';
import { rateLimiter, authenticateToken } from '../middleware/auth.middleware';

const router = Router();

// Separate buckets: refreshing a session must not use up the login allowance.
const loginLimit = rateLimiter(20, 60 * 60 * 1000);
const refreshLimit = rateLimiter(300, 60 * 60 * 1000);

router.post('/admin-login', loginLimit, authController.adminLogin);
router.post('/author-login', loginLimit, authController.authorLogin);
router.post('/reviewer-login', loginLimit, authController.reviewerLogin);
router.post('/refresh-token', refreshLimit, authController.refreshToken);
router.post('/logout', authController.logout);

// Token verification route - protected by auth middleware
router.get('/verify-token', authenticateToken, authController.verifyToken);

export default router;
