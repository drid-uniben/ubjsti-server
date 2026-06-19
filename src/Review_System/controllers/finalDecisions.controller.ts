import { Request, Response } from 'express';
import Manuscript, {
  ManuscriptStatus,
  ReviewDecision,
} from '../../Manuscript_Submission/models/manuscript.model';
import Review, { ReviewStatus, ReviewType } from '../models/review.model';
import Article from '../../Articles/model/article.model';
import {
  NotFoundError,
  UnauthorizedError,
  BadRequestError,
} from '../../utils/customErrors';
import asyncHandler from '../../utils/asyncHandler';
import logger from '../../utils/logger';
import emailService from '../../services/email.service';
import { IUser } from '../../model/user.model';

interface IAdminResponse {
  success: boolean;
  message?: string;
  data?: any;
  count?: number;
}

interface AdminAuthenticatedRequest extends Request {
  user: {
    id: string;
    role: string;
  };
}

class DecisionsController {
  getManuscriptsForDecision = asyncHandler(
    async (req: Request, res: Response<IAdminResponse>): Promise<void> => {
      const user = (req as AdminAuthenticatedRequest).user;
      if (user.role !== 'admin') {
        throw new UnauthorizedError(
          'You do not have permission to access this resource'
        );
      }

      const manuscripts = await Manuscript.aggregate([
        { $match: { isArchived: false } },
        {
          $lookup: {
            from: 'Reviews',
            localField: '_id',
            foreignField: 'manuscript',
            as: 'reviews',
          },
        },
        {
          $match: {
            $or: [
              // NEW: review already communicated — admin can finalize regardless of revision status
              { status: ManuscriptStatus.REVIEW_COMMUNICATED },

              // Manuscripts with a completed reconciliation review
              {
                status: ManuscriptStatus.UNDER_REVIEW,
                reviews: {
                  $elemMatch: {
                    reviewType: ReviewType.RECONCILIATION,
                    status: ReviewStatus.COMPLETED,
                  },
                },
              },
              // Manuscripts with 2 completed human reviews (no discrepancy)
              {
                status: ManuscriptStatus.UNDER_REVIEW,
                $and: [
                  { 'reviews.1': { $exists: true } }, // Ensures at least 2 reviews
                  {
                    $expr: {
                      $let: {
                        vars: {
                          humanReviews: {
                            $filter: {
                              input: '$reviews',
                              as: 'review',
                              cond: {
                                $and: [
                                  { $eq: ['$$review.reviewType', 'human'] },
                                  { $eq: ['$$review.status', 'completed'] },
                                ],
                              },
                            },
                          },
                        },
                        in: {
                          $and: [
                            { $eq: [{ $size: '$$humanReviews' }, 2] }, // Exactly 2 completed human reviews
                            {
                              $eq: [
                                {
                                  $arrayElemAt: [
                                    '$$humanReviews.reviewDecision',
                                    0,
                                  ],
                                },
                                {
                                  $arrayElemAt: [
                                    '$$humanReviews.reviewDecision',
                                    1,
                                  ],
                                },
                              ],
                            },
                          ],
                        },
                      },
                    },
                  },
                ],
              },
            ],
          },
          // ... rest of aggregation
        },
      ]);

      res.status(200).json({
        success: true,
        count: manuscripts.length,
        data: manuscripts,
      });
    }
  );

  updateManuscriptStatus = asyncHandler(
    async (req: Request, res: Response<IAdminResponse>): Promise<void> => {
      const user = (req as AdminAuthenticatedRequest).user;
      if (user.role !== 'admin') {
        throw new UnauthorizedError(
          'You do not have permission to access this resource'
        );
      }

      const { manuscriptId } = req.params;
      const { status, feedbackComments } = req.body;

      // Validate status is a final decision status
      const validStatuses = [
        ManuscriptStatus.APPROVED,
        ManuscriptStatus.REJECTED,
        ManuscriptStatus.MINOR_REVISION,
        ManuscriptStatus.MAJOR_REVISION,
      ];

      if (!validStatuses.includes(status)) {
        res.status(400).json({
          success: false,
          message:
            'Invalid status. Must be approved, rejected, minor_revision, or major_revision',
        });
        return;
      }

      const manuscript = await Manuscript.findById(manuscriptId).populate(
        'submitter coAuthors'
      );

      if (!manuscript) {
        throw new NotFoundError('Manuscript not found');
      }

      if (manuscript.isArchived) {
        throw new BadRequestError(
          'Cannot update status of an archived manuscript.'
        );
      }

      // For major revisions, store the reviewer who recommended it
      if (status === ManuscriptStatus.MAJOR_REVISION) {
        const majorRevisionReview = await Review.findOne({
          manuscript: manuscriptId,
          reviewDecision: ReviewDecision.PUBLISHABLE_WITH_MAJOR_REVISION,
          status: ReviewStatus.COMPLETED,
        }).sort({ completedAt: -1 });

        if (majorRevisionReview) {
          manuscript.originalReviewer = majorRevisionReview.reviewer;
          manuscript.revisionType = 'major';
        }
      } else if (status === ManuscriptStatus.MINOR_REVISION) {
        manuscript.revisionType = 'minor';
      }

      manuscript.status = status;
      if (feedbackComments) {
        manuscript.reviewComments = {
          ...(manuscript.reviewComments || {}),
          commentsForAuthor: feedbackComments,
        };
      }

      if (status === ManuscriptStatus.APPROVED) {
        // Check if article already exists to prevent duplicates
        const existingArticle = await Article.findOne({
          manuscriptId: manuscript._id,
        });

        if (!existingArticle) {
          const newArticle = new Article({
            title: manuscript.title,
            abstract: manuscript.abstract,
            keywords: manuscript.keywords,
            pdfFile: manuscript.revisedPdfFile || manuscript.pdfFile,
            author: manuscript.submitter,
            coAuthors: manuscript.coAuthors,
            manuscriptId: manuscript._id,
            // Set default publication options (all disabled until admin selects)
            publicationOptions: {
              doiEnabled: false,
              internetArchiveEnabled: false,
              emailNotificationEnabled: false,
            },
          });

          try {
            await newArticle.save();
            logger.info(`New article created from manuscript ${manuscriptId}`);
          } catch (saveError: any) {
            // Handle duplicate key error gracefully if article created in parallel request
            if (saveError.code === 11000) {
              logger.warn(
                `Article already exists for manuscript ${manuscriptId}, skipping duplicate creation`
              );
            } else {
              throw saveError;
            }
          }
        } else {
          logger.warn(
            `Article already exists for manuscript ${manuscriptId}, skipping creation`
          );
        }
      }

      await manuscript.save();

      const submitter = manuscript.submitter as any as IUser;

      try {
        await emailService.sendManuscriptStatusUpdateEmail(
          submitter.email,
          submitter.name,
          manuscript.title,
          manuscript.status
        );
      } catch (error) {
        logger.error(
          'Failed to send status update email:',
          error instanceof Error ? error.message : 'Unknown error'
        );
      }

      logger.info(
        `Admin ${user.id} updated status for manuscript ${manuscriptId} to ${status}`
      );

      res.status(200).json({
        success: true,
        message: 'Manuscript status updated successfully',
        data: manuscript,
      });
    }
  );
}

export default new DecisionsController();
