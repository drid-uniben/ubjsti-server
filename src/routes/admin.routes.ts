import express, { Request } from 'express';
import adminController from '../controllers/admin.controller';
import { parseManuscriptRequest } from '../middleware/parseManuscriptRequest';
import {
  authenticateAdminToken,
  rateLimiter,
} from '../middleware/auth.middleware';
import authorManagementRoutes from '../authors/routes/author-management.routes';
import assignReviewRoutes from '../Review_System/routes/assignReview.routes';
import reassignReviewRoutes from '../Review_System/routes/reAssignReviewers.routes';
import manuscriptReviewsRoutes from '../Review_System/routes/manuscriptReviews.routes';
import finalDecisionsRoutes from '../Review_System/routes/finalDecisions.routes';
import adminReviewRoutes from '../Review_System/routes/adminReview.routes';
import multer, { FileFilterCallback } from 'multer';
import path from 'path';
import fs from 'fs';
import dynamicEmailController from '../controllers/admin/dynamicEmail.controller';

const router = express.Router();

const getUploadsPath = (): string => {
  if (process.env.NODE_ENV === 'production') {
    // In production, save to dist/uploads/documents
    return path.join(__dirname, '..', 'uploads', 'documents');
  } else {
    // In development, use the existing path
    return path.join(process.cwd(), 'src', 'uploads', 'documents');
  }
};

// Configure multer for single file uploads
const storage = multer.diskStorage({
  destination: function (
    _req: Request,
    _file: Express.Multer.File,
    cb: (error: Error | null, destination: string) => void
  ) {
    const dest = getUploadsPath();
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    cb(null, dest);
  },
  filename: function (
    _req: Request,
    file: Express.Multer.File,
    cb: (error: Error | null, filename: string) => void
  ) {
    // Create a unique filename to prevent overwrites
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const extension = path.extname(file.originalname);
    cb(
      null,
      `${path.basename(file.originalname, extension)}-${uniqueSuffix}${extension}`
    );
  },
});

// Filter for DOCX files only
const fileFilter = (
  _req: Request,
  file: Express.Multer.File,
  cb: FileFilterCallback
) => {
  if (
    file.mimetype ===
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only DOCX files are allowed.'));
  }
};

// Initialize multer with the storage, file filter, and size limits
const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit for manuscripts
});

// Middleware for handling the single manuscript file upload
const manuscriptUpload = upload.single('file');

const getEmailAttachmentsPath = (): string => {
  if (process.env.NODE_ENV === 'production') {
    // Relative to dist/routes/
    return path.join(__dirname, '..', 'uploads', 'email-attachments');
  } else {
    // Relative to project root
    return path.join(process.cwd(), 'src', 'uploads', 'email-attachments');
  }
};

// Add multer configuration for email attachments
const emailAttachmentStorage = multer.diskStorage({
  destination: function (_req, _file, cb) {
    const uploadPath = getEmailAttachmentsPath();
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: function (_req, file, cb) {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const extension = path.extname(file.originalname);
    cb(null, `attachment-${uniqueSuffix}${extension}`);
  },
});

const emailAttachmentFilter = (
  _req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) => {
  // Allow images, PDFs, and DOCX
  const allowedMimes = [
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/gif',
    'image/webp',
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ];

  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(
      new Error(
        'Invalid file type. Only images, PDFs, and DOCX files are allowed.'
      )
    );
  }
};

const emailAttachmentUpload = multer({
  storage: emailAttachmentStorage,
  fileFilter: emailAttachmentFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit per file
    files: 5, // Maximum 5 files
  },
});

const adminRateLimiter = rateLimiter(5000, 60 * 60 * 1000);

router.get(
  '/manuscripts',
  authenticateAdminToken,
  adminRateLimiter,
  adminController.getAllManuscripts
);

router.get(
  '/manuscripts/search',
  authenticateAdminToken,
  adminRateLimiter,
  adminController.searchManuscripts
);

router.get(
  '/manuscripts/:id',
  authenticateAdminToken,
  adminRateLimiter,
  adminController.getManuscriptById
);

router.get(
  '/statistics',
  authenticateAdminToken,
  adminRateLimiter,
  adminController.getManuscriptStatistics
);

router.get(
  '/faculties-with-manuscripts',
  authenticateAdminToken,
  adminRateLimiter,
  adminController.getFacultiesWithManuscripts
);

router.get(
  '/faculties/data',
  authenticateAdminToken,
  adminRateLimiter,
  adminController.getFacultyData
);

router.post(
  '/faculties/assign',
  authenticateAdminToken,
  adminRateLimiter,
  adminController.assignFaculty
);

router.put(
  '/manuscripts/:id/edit',
  authenticateAdminToken,
  adminRateLimiter,
  manuscriptUpload,
  adminController.editManuscript
);

router.put(
  '/manuscripts/:id/edit-revised',
  authenticateAdminToken,
  adminRateLimiter,
  manuscriptUpload,
  adminController.editRevisedManuscript
);

router.patch(
  '/manuscripts/:id/archive',
  authenticateAdminToken,
  adminRateLimiter,
  adminController.toggleManuscriptArchiveStatus
);

router.use('/author-management', authorManagementRoutes);
router.use('/assign-review', assignReviewRoutes);
router.use('/reassign-review', reassignReviewRoutes);
router.use('/manuscript-reviews', manuscriptReviewsRoutes);
router.use('/decisions', finalDecisionsRoutes);
router.use('/', adminReviewRoutes);

router.get(
  '/campaign/recipients',
  authenticateAdminToken,
  adminRateLimiter,
  dynamicEmailController.getRecipients
);

router.post(
  '/campaign/preview',
  authenticateAdminToken,
  adminRateLimiter,
  emailAttachmentUpload.array('attachments', 5),
  dynamicEmailController.previewEmail
);

router.post(
  '/campaign/send',
  authenticateAdminToken,
  adminRateLimiter,
  emailAttachmentUpload.array('attachments', 5),
  dynamicEmailController.sendCampaign
);

export default router;
