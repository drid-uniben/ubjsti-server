import { Router } from 'express';
import volumeController from '../controllers/volume.controller';
import issueController from '../controllers/issue.controller';
import publicationController from '../controllers/publication.controller';
import emailSubscriptionController from '../controllers/emailSubscription.controller';
import failedJobsController from '../controllers/failedJobs.controller';
import citationController from '../controllers/citation.controller';
import articleAnalyticsRoutes from '../../Articles/routes/articleAnalytics.routes';
import {
  authenticateAdminToken,
  rateLimiter,
} from '../../middleware/auth.middleware';
import multer from 'multer';
import path from 'path';

const router = Router();

const getVolumeCoverUploadPath = (): string => {
  if (process.env.NODE_ENV === 'production') {
    return path.join(__dirname, '..', '..', 'uploads', 'volume_covers');
  } else {
    return path.join(process.cwd(), 'src', 'uploads', 'volume_covers');
  }
};

const getArticlePdfUploadPath = (): string => {
  if (process.env.NODE_ENV === 'production') {
    return path.join(__dirname, '..', '..', 'uploads', 'manual_articles');
  } else {
    return path.join(process.cwd(), 'src', 'uploads', 'manual_articles');
  }
};

// Multer configuration for volume covers
const volumeCoverStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, getVolumeCoverUploadPath());
  },
  filename: function (req, file, cb) {
    cb(null, `${Date.now()}-${path.basename(file.originalname)}`);
  },
});

const uploadVolumeCover = multer({
  storage: volumeCoverStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG allowed.'));
    }
  },
});

// Multer configuration for manual article PDFs
const articlePdfStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, getArticlePdfUploadPath());
  },
  filename: function (req, file, cb) {
    cb(null, `${Date.now()}-${path.basename(file.originalname)}`);
  },
});

const uploadArticlePdf = multer({
  storage: articlePdfStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF allowed.'));
    }
  },
});

const uploadVolumeCoverFields = uploadVolumeCover.fields([
  { name: 'coverImage', maxCount: 1 },
  { name: 'coverImageIssue2', maxCount: 1 },
]);

const adminRateLimiter = rateLimiter(5000, 60 * 60 * 1000);
const publicRateLimiter = rateLimiter(100, 60 * 60 * 1000);

// ==================== ADMIN ROUTES ====================

// Volume Management
router.post(
  '/volumes',
  authenticateAdminToken,
  adminRateLimiter,
  uploadVolumeCoverFields,
  volumeController.createVolume
);

router.get(
  '/volumes',
  authenticateAdminToken,
  adminRateLimiter,
  volumeController.getVolumes
);

router.get(
  '/volumes/:id',
  authenticateAdminToken,
  adminRateLimiter,
  volumeController.getVolumeById
);

router.put(
  '/volumes/:id',
  authenticateAdminToken,
  adminRateLimiter,
  uploadVolumeCoverFields,
  volumeController.updateVolume
);

router.delete(
  '/volumes/:id',
  authenticateAdminToken,
  adminRateLimiter,
  volumeController.deleteVolume
);

// Issue Management
router.post(
  '/issues',
  authenticateAdminToken,
  adminRateLimiter,
  issueController.createIssue
);

router.get(
  '/issues',
  authenticateAdminToken,
  adminRateLimiter,
  issueController.getIssues
);

router.get(
  '/issues/:id',
  //authenticateAdminToken,
  adminRateLimiter,
  issueController.getIssueById
);

router.get(
  '/volumes/:volumeId/issues',
  authenticateAdminToken,
  adminRateLimiter,
  issueController.getIssuesByVolume
);

router.put(
  '/issues/:id',
  authenticateAdminToken,
  adminRateLimiter,
  issueController.updateIssue
);

router.delete(
  '/issues/:id',
  authenticateAdminToken,
  adminRateLimiter,
  issueController.deleteIssue
);

// Publication Management
router.get(
  '/publications/pending',
  authenticateAdminToken,
  adminRateLimiter,
  publicationController.getManuscriptsForPublication
);

router.post(
  '/publications/:articleId/publish',
  authenticateAdminToken,
  adminRateLimiter,
  publicationController.publishArticle
);

router.post(
  '/publications/manual',
  authenticateAdminToken,
  adminRateLimiter,
  uploadArticlePdf.single('pdfFile'),
  publicationController.createAndPublishManualArticle
);

// Failed Jobs Management
// NOTE: Specific routes MUST come before /:id route to avoid param matching
router.get(
  '/failed-jobs',
  authenticateAdminToken,
  adminRateLimiter,
  failedJobsController.getFailedJobs
);

// Specific routes before /:id
router.get(
  '/failed-jobs/statistics',
  authenticateAdminToken,
  adminRateLimiter,
  failedJobsController.getStatistics
);

router.post(
  '/failed-jobs/retry-all',
  authenticateAdminToken,
  adminRateLimiter,
  failedJobsController.retryAllFailedJobs
);

router.delete(
  '/failed-jobs/resolved',
  authenticateAdminToken,
  adminRateLimiter,
  failedJobsController.deleteResolvedJobs
);

// Generic /:id routes AFTER specific routes
router.get(
  '/failed-jobs/:id',
  authenticateAdminToken,
  adminRateLimiter,
  failedJobsController.getFailedJobById
);

router.post(
  '/failed-jobs/:id/retry',
  authenticateAdminToken,
  adminRateLimiter,
  failedJobsController.retryFailedJob
);

router.patch(
  '/failed-jobs/:id/resolve',
  authenticateAdminToken,
  adminRateLimiter,
  failedJobsController.markAsResolved
);

// Email Subscriber Management
router.get(
  '/subscribers',
  authenticateAdminToken,
  adminRateLimiter,
  emailSubscriptionController.getSubscribers
);

router.get(
  '/subscribers/statistics',
  authenticateAdminToken,
  adminRateLimiter,
  emailSubscriptionController.getStatistics
);

// ==================== PUBLIC ROUTES ====================

// Published Articles
router.get(
  '/articles/search',
  publicRateLimiter,
  publicationController.searchArticles
);

router.get(
  '/articles',
  publicRateLimiter,
  publicationController.getPublishedArticles
);

router.get(
  '/articles/:id',
  publicRateLimiter,
  publicationController.getPublishedArticleById
);

router.get(
  '/volumes/:volumeId/issues/:issueId/articles',
  publicRateLimiter,
  publicationController.getArticlesByVolumeAndIssue
);

router.get(
  '/current-issue',
  publicRateLimiter,
  publicationController.getCurrentIssue
);

router.get('/archives', publicRateLimiter, publicationController.getArchives);

// Public Volumes and Issues
router.get('/public/volumes', publicRateLimiter, volumeController.getVolumes);

router.get(
  '/public/volumes/:id',
  publicRateLimiter,
  volumeController.getVolumeById
);

router.get('/public/issues', publicRateLimiter, issueController.getIssues);

// Email Subscription (Public)
router.post(
  '/subscribe',
  publicRateLimiter,
  emailSubscriptionController.subscribe
);

router.get(
  '/unsubscribe/:token',
  publicRateLimiter,
  emailSubscriptionController.unsubscribe
);

// Citations (Public)
router.get(
  '/articles/:id/citation',
  publicRateLimiter,
  citationController.getCitation
);

router.get(
  '/articles/:id/citation/download',
  publicRateLimiter,
  citationController.downloadCitation
);

router.get(
  '/articles/:id/citations',
  publicRateLimiter,
  citationController.getAllCitations
);

router.get(
  '/articles/:id/metadata',
  publicRateLimiter,
  citationController.getIndexingMetadata
);

router.use('/article-analytics', articleAnalyticsRoutes);

router.get(
  '/admin/articles',
  authenticateAdminToken,
  adminRateLimiter,
  publicationController.getManualArticles
);
router.patch(
  '/admin/articles/:id',
  authenticateAdminToken,
  adminRateLimiter,
  uploadArticlePdf.single('pdfFile'),
  publicationController.updateManualArticle
);
router.delete(
  '/admin/articles/:id',
  authenticateAdminToken,
  adminRateLimiter,
  publicationController.deleteManualArticle
);

export default router;
