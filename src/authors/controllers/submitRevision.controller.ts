import { Request, Response } from 'express';
import { Types } from 'mongoose';
import Manuscript, {
  ManuscriptStatus,
} from '../../Manuscript_Submission/models/manuscript.model';
import Review, {
  ReviewStatus,
  ReviewType,
} from '../../Review_System/models/review.model';
import User from '../../model/user.model';
import {
  NotFoundError,
  BadRequestError,
  UnauthorizedError,
} from '../../utils/customErrors';
import asyncHandler from '../../utils/asyncHandler';
import logger from '../../utils/logger';
import emailService from '../../services/email.service';

class SubmitRevisionController {
  submitPostReviewRevision = asyncHandler(
    async (req: Request<{ id: string }>, res: Response): Promise<void> => {
      const { id } = req.params;
      const userId = (req as any).user.id;
      const { title, abstract, keywords } = req.body;

      if (!req.file) {
        res.status(400).json({
          success: false,
          message: 'Revised manuscript PDF file is required.',
        });
        return;
      }

      const original = await Manuscript.findById(id).populate('submitter');
      if (!original) throw new NotFoundError('Manuscript not found');

      if (original.submitter._id.toString() !== userId) {
        throw new UnauthorizedError(
          'You are not authorized to revise this manuscript.'
        );
      }

      if (
        original.status !== ManuscriptStatus.REVIEW_COMMUNICATED ||
        !original.revisionAllowed
      ) {
        throw new BadRequestError(
          'This manuscript is not currently open for revision.'
        );
      }

      const pdfFile = `${
        process.env.API_URL || 'http://localhost:3000'
      }/uploads/documents/${req.file.filename}`;

      const newManuscript = new Manuscript({
        title: title || original.title,
        abstract: abstract || original.abstract,
        keywords: keywords || original.keywords,
        submitter: original.submitter._id,
        coAuthors: original.coAuthors,
        incompleteCoAuthors: original.incompleteCoAuthors,
        pdfFile,
        originalFilename: req.file.originalname,
        fileSize: req.file.size,
        fileType: req.file.mimetype,
        revisedFrom: original._id as Types.ObjectId,
        status: ManuscriptStatus.UNDER_REVIEW,
      });
      await newManuscript.save();

      original.status = ManuscriptStatus.SUPERSEDED;
      original.supersededBy = newManuscript._id as Types.ObjectId;
      await original.save();

      // Re-assign straight to the reviewer(s) chosen when the review was sent —
      // no manual "Assign Reviewer" step needed for this path.
      const reviewerIds = original.reviewersForRevision || [];
      const dueDate = new Date(Date.now() + 21 * 24 * 60 * 60 * 1000);

      for (const reviewerId of reviewerIds) {
        const review = new Review({
          manuscript: newManuscript._id,
          reviewer: reviewerId,
          reviewType: ReviewType.HUMAN,
          status: ReviewStatus.IN_PROGRESS,
          dueDate,
        });
        await review.save();

        const reviewer = await User.findById(reviewerId);
        if (reviewer) {
          reviewer.assignedReviews = reviewer.assignedReviews || [];
          reviewer.assignedReviews.push(newManuscript._id as Types.ObjectId);
          await reviewer.save();

          try {
            await emailService.sendReviewAssignmentEmail(
              reviewer.email,
              newManuscript.title,
              (original.submitter as any).name,
              dueDate
            );
          } catch (error) {
            logger.error(
              'Failed to send revision review assignment email:',
              error
            );
          }
        }
      }

      try {
        await emailService.sendSubmissionConfirmationEmail(
          (original.submitter as any).email,
          (original.submitter as any).name,
          newManuscript.title,
          true
        );
      } catch (error) {
        logger.error('Failed to send revision confirmation email:', error);
      }

      logger.info(
        `Author ${userId} submitted a post-review revision for ${id} -> ${newManuscript._id}`
      );

      res.status(201).json({
        success: true,
        message: 'Revision submitted successfully and sent for re-review.',
        data: {
          manuscriptId: (newManuscript._id as Types.ObjectId).toString(),
        },
      });
    }
  );
}

export default new SubmitRevisionController();
