import { Request, Response, NextFunction } from 'express';
import Review, { ReviewStatus, ReviewType } from '../models/review.model';
import Manuscript, {
  ManuscriptStatus,
} from '../../Manuscript_Submission/models/manuscript.model';
import { NotFoundError } from '../../utils/customErrors';
import asyncHandler from '../../utils/asyncHandler';
import reconciliationController from './reconciliation.controller';

interface IReviewResponse {
  success: boolean;
  count?: number;
  message?: string;
  data?: any;
}

interface AuthenticatedRequest extends Request {
  user: {
    id: string;
    role: string;
  };
}

class AdminReviewController {
  // Method to get all reviews assigned to the admin
  getAdminAssignments = asyncHandler(
    async (req: Request, res: Response<IReviewResponse>): Promise<void> => {
      const user = (req as AuthenticatedRequest).user;
      const adminId = user.id;

      const reviews = await Review.find({ reviewer: adminId })
        .populate({
          path: 'manuscript',
          select: 'title status createdAt',
        })
        .sort({ dueDate: 1 });

      res.status(200).json({
        success: true,
        count: reviews.length,
        data: reviews,
      });
    }
  );

  // Method to get a single review by ID, ensuring it's assigned to the admin
  getReviewById = asyncHandler(
    async (req: Request, res: Response<IReviewResponse>): Promise<void> => {
      const user = (req as AuthenticatedRequest).user;
      const { id } = req.params;
      const adminId = user.id;

      const review = await Review.findOne({
        _id: id,
        reviewer: adminId,
      }).populate({
        path: 'manuscript',
        select:
          'title abstract keywords pdfFile revisedPdfFile revisionType revisedFrom',
      });

      if (!review) {
        throw new NotFoundError(
          'Review not found or not assigned to this admin'
        );
      }

      res.status(200).json({
        success: true,
        data: review,
      });
    }
  );

  // Method for admin to submit a completed review
  submitReview = asyncHandler(
    async (
      req: Request,
      res: Response<IReviewResponse>,
      next: NextFunction
    ): Promise<void> => {
      const user = (req as AuthenticatedRequest).user;
      const { id } = req.params;
      const adminId = user.id;
      const { reviewDecision, comments, scores } = req.body;

      const review = await Review.findOne({
        _id: id,
        reviewer: adminId,
        status: { $ne: ReviewStatus.COMPLETED },
      });

      if (!review) {
        throw new NotFoundError(
          'Review not found, not assigned to admin, or already completed'
        );
      }

      review.reviewDecision = reviewDecision;
      review.comments = comments;
      review.scores = scores;
      review.status = ReviewStatus.COMPLETED;
      review.completedAt = new Date();

      await review.save();

      if (review.reviewType === ReviewType.RECONCILIATION) {
        const manuscript = await Manuscript.findById(review.manuscript);
        if (manuscript) {
          manuscript.status = ManuscriptStatus.UNDER_REVIEW;
          await manuscript.save();
        }
        res.status(200).json({
          success: true,
          message: 'Reconciliation review submitted successfully',
          data: review,
        });
        return;
      }

      // Check for discrepancy if this is the second human review
      const humanReviews = await Review.find({
        manuscript: review.manuscript,
        reviewType: ReviewType.HUMAN,
        status: ReviewStatus.COMPLETED,
      });

      if (humanReviews.length === 2) {
        req.params.manuscriptId = review.manuscript.toString();
        reconciliationController.handleDiscrepancy(req, res, next);
      } else {
        res.status(200).json({
          success: true,
          message: 'Review submitted successfully by admin',
          data: review,
        });
      }
    }
  );

  // Method for admin to save review progress
  saveReviewProgress = asyncHandler(
    async (req: Request, res: Response<IReviewResponse>): Promise<void> => {
      const user = (req as AuthenticatedRequest).user;
      const { id } = req.params;
      const adminId = user.id;
      const { reviewDecision, comments, scores } = req.body;

      const review = await Review.findOne({
        _id: id,
        reviewer: adminId,
        status: ReviewStatus.IN_PROGRESS,
      });

      if (!review) {
        throw new NotFoundError('Review not found or cannot be updated');
      }

      if (reviewDecision) {
        review.reviewDecision = reviewDecision;
      }

      if (comments) {
        review.comments = { ...review.comments, ...comments };
      }

      if (scores) {
        review.scores = { ...review.scores, ...scores };
      }

      await review.save();

      res.status(200).json({
        success: true,
        message: 'Admin review progress saved',
        data: review,
      });
    }
  );

  getReviewWithHistory = asyncHandler(
    async (req: Request, res: Response<IReviewResponse>): Promise<void> => {
      const user = (req as AuthenticatedRequest).user;
      const { id } = req.params;
      const reviewerId = user.id;

      const review = await Review.findOne({
        _id: id,
        reviewer: reviewerId,
      }).populate({
        path: 'manuscript',
        select:
          'title abstract keywords pdfFile revisedPdfFile revisionType revisedFrom',
      });

      if (!review) {
        throw new NotFoundError('Review not found or unauthorized');
      }

      const manuscript = review.manuscript as any;

      if (manuscript.isArchived) {
        throw new NotFoundError('Manuscript not found or is archived');
      }

      const isRevised = !!manuscript.revisedPdfFile || !!manuscript.revisedFrom;
      let previousReview = null;

      // If this is a revised manuscript, get the reviewer's previous review
      if (manuscript.revisedFrom) {
        // new flow: previous review lives on the original manuscript record
        previousReview = await Review.findOne({
          manuscript: manuscript.revisedFrom,
          reviewer: reviewerId,
          status: ReviewStatus.COMPLETED,
        }).select('scores totalScore comments reviewDecision completedAt');
      } else if (manuscript.revisedPdfFile) {
        // legacy in-place revision flow
        previousReview = await Review.findOne({
          manuscript: manuscript._id,
          reviewer: reviewerId,
          status: ReviewStatus.COMPLETED,
          createdAt: { $lt: review.createdAt }, // Get previous review
        }).select('scores totalScore comments reviewDecision completedAt');
      }

      res.status(200).json({
        success: true,
        data: {
          review,
          previousReview,
          isRevised,
          revisionType: manuscript.revisionType,
        },
      });
    }
  );

  getReconciliationData = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const user = (req as AuthenticatedRequest).user;
      const { id } = req.params;
      const reviewerId = user.id;

      const review = await Review.findOne({
        _id: id,
        reviewer: reviewerId,
        reviewType: ReviewType.RECONCILIATION,
      }).populate('manuscript');

      if (!review) {
        throw new NotFoundError('Reconciliation review not found');
      }

      // Get the two conflicting reviews
      const conflictingReviews = await Review.find({
        manuscript: review.manuscript,
        reviewType: ReviewType.HUMAN,
        status: ReviewStatus.COMPLETED,
      })
        .populate('reviewer', 'name')
        .select('reviewDecision totalScore createdAt reviewer');

      if (conflictingReviews.length < 2) {
        throw new Error('Conflicting reviews not found');
      }

      const [review1, review2] = conflictingReviews;

      res.status(200).json({
        success: true,
        data: {
          review,
          conflictingReviews: [
            {
              reviewerName: (review1.reviewer as any).name,
              reviewDecision: review1.reviewDecision,
              totalScore: review1.totalScore,
              completedAt: review1.createdAt,
            },
            {
              reviewerName: (review2.reviewer as any).name,
              reviewDecision: review2.reviewDecision,
              totalScore: review2.totalScore,
              completedAt: review2.createdAt,
            },
          ],
        },
      });
    }
  );

  // Method to get review statistics for the admin
  getAdminReviewerStatistics = asyncHandler(
    async (req: Request, res: Response<IReviewResponse>): Promise<void> => {
      const user = (req as AuthenticatedRequest).user;
      const adminId = user.id;

      const [totalAssigned, completed, pending, overdue] = await Promise.all([
        Review.countDocuments({ reviewer: adminId }),
        Review.countDocuments({
          reviewer: adminId,
          status: ReviewStatus.COMPLETED,
        }),
        Review.countDocuments({
          reviewer: adminId,
          status: ReviewStatus.IN_PROGRESS,
          dueDate: { $gt: new Date() },
        }),
        Review.countDocuments({
          reviewer: adminId,
          status: ReviewStatus.IN_PROGRESS,
          dueDate: { $lte: new Date() },
        }),
      ]);

      const recentActivity = await Review.find({ reviewer: adminId })
        .sort({ updatedAt: -1 })
        .limit(5)
        .populate('manuscript', 'title');

      res.status(200).json({
        success: true,
        data: {
          statistics: {
            totalAssigned,
            completed,
            pending,
            overdue,
          },
          recentActivity,
        },
      });
    }
  );
}

export default new AdminReviewController();
