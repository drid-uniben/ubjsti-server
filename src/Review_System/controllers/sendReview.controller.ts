import { Request, Response } from 'express';
import { Types } from 'mongoose';
import Manuscript, {
  ManuscriptStatus,
} from '../../Manuscript_Submission/models/manuscript.model';
import Review, { ReviewStatus, ReviewType } from '../models/review.model';
import { IUser } from '../../model/user.model';
import {
  NotFoundError,
  BadRequestError,
  UnauthorizedError,
} from '../../utils/customErrors';
import asyncHandler from '../../utils/asyncHandler';
import logger from '../../utils/logger';
import emailService from '../../services/email.service';
import generateSecurePassword from '../../utils/passwordGenerator';

class SendReviewController {
  sendReviewToAuthor = asyncHandler(
    async (
      req: Request<{ manuscriptId: string }>,
      res: Response
    ): Promise<void> => {
      const user = (req as any).user;
      if (user.role !== 'admin') {
        throw new UnauthorizedError(
          'You do not have permission to perform this action'
        );
      }

      const { manuscriptId } = req.params;
      const { allowRevision, commentsForAuthor, reviewerIds } = req.body as {
        allowRevision: boolean;
        commentsForAuthor?: string;
        reviewerIds?: string[];
      };

      const manuscript =
        await Manuscript.findById(manuscriptId).populate('submitter');
      if (!manuscript) throw new NotFoundError('Manuscript not found');
      if (manuscript.isArchived) {
        throw new BadRequestError(
          'Cannot send a review for an archived manuscript.'
        );
      }

      const completedReviews = await Review.find({
        manuscript: manuscriptId,
        status: ReviewStatus.COMPLETED,
        reviewType: { $in: [ReviewType.HUMAN, ReviewType.RECONCILIATION] },
      });

      if (completedReviews.length === 0) {
        throw new BadRequestError(
          'At least one completed review is required before sending a review to the author.'
        );
      }

      let finalReviewerIds: Types.ObjectId[];
      if (completedReviews.length > 1) {
        if (!reviewerIds || reviewerIds.length === 0) {
          throw new BadRequestError(
            'Select which reviewer(s) should receive the revision.'
          );
        }
        const validIds = completedReviews.map((r) => r.reviewer.toString());
        if (!reviewerIds.every((id) => validIds.includes(id))) {
          throw new BadRequestError(
            'One or more selected reviewers did not review this manuscript.'
          );
        }
        finalReviewerIds = reviewerIds.map((id) => new Types.ObjectId(id));
      } else {
        finalReviewerIds = [completedReviews[0].reviewer as Types.ObjectId];
      }

      let finalComments: string;
      if (completedReviews.length > 1) {
        if (!commentsForAuthor || !commentsForAuthor.trim()) {
          throw new BadRequestError(
            'A summary comment for the author is required when there is more than one review.'
          );
        }
        finalComments = commentsForAuthor;
      } else {
        finalComments = completedReviews[0].comments?.commentsForAuthor || '';
      }

      const submitter = manuscript.submitter as unknown as IUser;

      // Credentials first, then the review notification (per spec)
      if (!submitter.credentialsSent) {
        const generatedPassword = generateSecurePassword();
        submitter.password = generatedPassword;
        submitter.isActive = true;
        submitter.credentialsSent = true;
        submitter.credentialsSentAt = new Date();
        await submitter.save();

        try {
          await emailService.sendAuthorCredentialsEmail(
            submitter.email,
            submitter.name,
            generatedPassword
          );
        } catch (error) {
          logger.error(
            'Failed to send author credentials before review notification:',
            error
          );
        }
      }

      manuscript.status = ManuscriptStatus.REVIEW_COMMUNICATED;
      manuscript.revisionAllowed = !!allowRevision;
      manuscript.reviewersForRevision = finalReviewerIds;
      manuscript.reviewComments = {
        ...(manuscript.reviewComments || {}),
        commentsForAuthor: finalComments,
      };
      manuscript.reviewedAt = new Date();
      await manuscript.save();

      try {
        await emailService.sendReviewCommunicatedEmail(
          submitter.email,
          submitter.name,
          manuscript.title,
          !!allowRevision
        );
      } catch (error) {
        logger.error('Failed to send review communicated email:', error);
      }

      logger.info(
        `Admin ${user.id} sent review for manuscript ${manuscriptId} (allowRevision=${allowRevision})`
      );

      res.status(200).json({
        success: true,
        message: 'Review sent to author successfully.',
        data: manuscript,
      });
    }
  );
}

export default new SendReviewController();
