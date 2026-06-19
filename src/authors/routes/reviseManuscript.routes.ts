import { Router, Request } from 'express';
import reviseController from '../controllers/reviseManuscript.controller';
import submitRevisionController from '../controllers/submitRevision.controller';
import { authenticateAuthorToken } from '../../middleware/auth.middleware';
import multer, { FileFilterCallback } from 'multer';
import path from 'path';
import { z } from 'zod';
import validateRequest from '../../middleware/validateRequest';

const getUploadsPath = (): string => {
  if (process.env.NODE_ENV === 'production') {
    // Go up to dist/ and then to uploads/documents
    return path.join(__dirname, '..', '..', 'uploads', 'documents');
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
    cb(null, getUploadsPath());
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

const router = Router();

const reviseManuscriptSchema = z.object({
  body: z.object({
    title: z.string().min(1, 'Title is required'),
    abstract: z.string().min(1, 'Abstract is required'),
    keywords: z.array(z.string()).min(1, 'Keywords are required'),
    submitter: z.object({
      name: z.string().min(1, 'Submitter name is required'),
      email: z.string().email('Invalid submitter email'),
      faculty: z.string().min(1, 'Submitter faculty is required'),
      affiliation: z.string().min(1, 'Submitter affiliation is required'),
      orcid: z.string().optional(),
    }),
    coAuthors: z
      .array(
        z.object({
          name: z.string().min(1, 'Co-author name is required'),
          email: z.string().email('Invalid co-author email'),
          faculty: z.string().min(1, 'Co-author faculty is required'),
          affiliation: z.string().min(1, 'Co-author affiliation is required'),
          orcid: z.string().optional(),
        })
      )
      .optional(),
  }),
});

import { parseManuscriptRequest } from '../../middleware/parseManuscriptRequest';

router.post(
  '/:id/revise',
  upload.single('pdf'),
  parseManuscriptRequest,
  validateRequest(reviseManuscriptSchema),
  reviseController.reviseManuscript
);

router.post(
  '/:id/submit-revision',
  authenticateAuthorToken,
  upload.single('manuscriptFile'),
  submitRevisionController.submitPostReviewRevision
);

export default router;
