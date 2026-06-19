import { Request, Response, NextFunction } from 'express';
import Review, { ReviewType, ReviewStatus } from '../models/review.model';
import Manuscript from '../../Manuscript_Submission/models/manuscript.model';
import { NotFoundError, BadRequestError } from '../../utils/customErrors';
import asyncHandler from '../../utils/asyncHandler';
import mongoose from 'mongoose';
import logger from '../../utils/logger';

interface IManuscriptReviewsResponse {
  success: boolean;
  count?: number;
  message?: string;
  data?: any;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

interface AuthenticatedRequest extends Request {
  user: {
    id: string;
    role: string;
  };
}

interface GetManuscriptReviewsRequest extends AuthenticatedRequest {
  query: {
    page?: string;
    limit?: string;
    status?: 'under_review' | 'reviewed' | 'reconciliation';
    faculty?: string;
    discrepancy?: 'true' | 'false';
  };
}

interface GetManuscriptReviewDetailsRequest extends AuthenticatedRequest {
  params: {
    manuscriptId: string;
  };
}

class ManuscriptReviewsController {
  getAllManuscriptReviews = asyncHandler(
    async (
      req: Request,
      res: Response<IManuscriptReviewsResponse>,
      next: NextFunction
    ): Promise<void> => {
      const user = (req as GetManuscriptReviewsRequest).user;

      const page = parseInt((req.query.page || '1').toString());
      const limit = parseInt((req.query.limit || '10').toString());
      const skip = (page - 1) * limit;
      const { status, faculty, discrepancy } = req.query;

      const pipeline: any[] = [
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
            'reviews.0': { $exists: true },
          },
        },
        {
          $lookup: {
            from: 'Users',
            localField: 'submitter',
            foreignField: '_id',
            as: 'submitterDetails',
          },
        },
        {
          $unwind: '$submitterDetails',
        },
        {
          $addFields: {
            totalReviews: { $size: '$reviews' },
            completedReviews: {
              $size: {
                $filter: {
                  input: '$reviews',
                  as: 'review',
                  cond: { $eq: ['$$review.status', 'completed'] },
                },
              },
            },
            hasDiscrepancy: {
              $let: {
                vars: {
                  completedHumanReviews: {
                    $filter: {
                      input: '$reviews',
                      as: 'review',
                      cond: {
                        $and: [
                          { $eq: ['$$review.status', 'completed'] },
                          { $eq: ['$$review.reviewType', 'human'] },
                        ],
                      },
                    },
                  },
                  completedReconciliationReviews: {
                    $filter: {
                      input: '$reviews',
                      as: 'review',
                      cond: {
                        $and: [
                          { $eq: ['$$review.status', 'completed'] },
                          { $eq: ['$$review.reviewType', 'reconciliation'] },
                        ],
                      },
                    },
                  },
                },
                in: {
                  $and: [
                    { $gte: [{ $size: '$$completedHumanReviews' }, 2] },
                    {
                      $ne: [
                        {
                          $arrayElemAt: [
                            '$$completedHumanReviews.reviewDecision',
                            0,
                          ],
                        },
                        {
                          $arrayElemAt: [
                            '$$completedHumanReviews.reviewDecision',
                            1,
                          ],
                        },
                      ],
                    },
                    { $eq: [{ $size: '$$completedReconciliationReviews' }, 0] },
                  ],
                },
              },
            },
          },
        },
      ];

      const matchConditions: any = {};

      if (status) {
        if (status === 'reviewed') {
          matchConditions.status = {
            $in: [
              'approved',
              'rejected',
              'minor_revision',
              'major_revision',
              'review_communicated',
            ],
          };
        } else {
          matchConditions.status = status;
        }
      }

      if (discrepancy === 'true') {
        matchConditions.hasDiscrepancy = true;
      } else if (discrepancy === 'false') {
        matchConditions.hasDiscrepancy = false;
      }

      if (Object.keys(matchConditions).length > 0) {
        pipeline.push({ $match: matchConditions });
      }

      pipeline.push({
        $project: {
          title: 1,
          status: 1,
          totalReviews: 1,
          completedReviews: 1,
          hasDiscrepancy: 1,
          createdAt: 1,
          updatedAt: 1,
          submitter: {
            name: '$submitterDetails.name',
            email: '$submitterDetails.email',
          },
          reviews: 1,
        },
      });

      pipeline.push({ $sort: { updatedAt: -1, createdAt: -1 } });

      const countPipeline = [...pipeline, { $count: 'total' }];
      const totalResult = await Manuscript.aggregate(countPipeline);
      const total = totalResult[0]?.total || 0;

      pipeline.push({ $skip: skip }, { $limit: limit });

      const manuscripts = await Manuscript.aggregate(pipeline);

      const totalPages = Math.ceil(total / limit);

      logger.info(
        `Admin ${user.id} retrieved manuscript reviews with pagination: page ${page}, limit ${limit}`
      );

      res.status(200).json({
        success: true,
        count: manuscripts.length,
        data: manuscripts,
        pagination: {
          page,
          limit,
          total,
          pages: totalPages,
        },
      });
    }
  );

  getManuscriptReviewDetails = asyncHandler(
    async (
      req: Request,
      res: Response<IManuscriptReviewsResponse>
    ): Promise<void> => {
      const user = (req as GetManuscriptReviewDetailsRequest).user;
      const { manuscriptId } = req.params;

      if (!mongoose.Types.ObjectId.isValid(manuscriptId)) {
        throw new BadRequestError('Invalid manuscript ID format');
      }

      const manuscript = await Manuscript.findById(manuscriptId)
        .populate({
          path: 'submitter',
          select: 'name email',
        })
        .select('title status createdAt updatedAt');

      if (!manuscript) {
        throw new NotFoundError('Manuscript not found');
      }

      const reviews = await Review.find({ manuscript: manuscriptId })
        .populate({
          path: 'reviewer',
          select: 'name email',
        })
        .sort({ createdAt: 1 });

      const humanReviews = reviews.filter(
        (r) => r.reviewType === ReviewType.HUMAN
      );
      const reconciliationReviews = reviews.filter(
        (r) => r.reviewType === ReviewType.RECONCILIATION
      );

      const responseData = {
        manuscript,
        reviewSummary: {
          totalReviews: reviews.length,
          completedReviews: reviews.filter(
            (r) => r.status === ReviewStatus.COMPLETED
          ).length,
          pendingReviews: reviews.filter(
            (r) => r.status === ReviewStatus.IN_PROGRESS
          ).length,
          hasHuman: humanReviews.length > 0,
          hasReconciliation: reconciliationReviews.length > 0,
        },
        reviews: {
          human: humanReviews.map(this.formatReviewData),
          reconciliation: reconciliationReviews.map(this.formatReviewData),
        },
      };

      logger.info(
        `Admin ${user.id} retrieved manuscript ${manuscriptId} review details`
      );

      res.status(200).json({
        success: true,
        data: responseData,
      });
    }
  );

  getStatistics = asyncHandler(
    async (
      req: Request,
      res: Response<IManuscriptReviewsResponse>
    ): Promise<void> => {
      const user = (req as AuthenticatedRequest).user;

      const manuscriptsWithReviews = await Manuscript.aggregate([
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
            'reviews.0': { $exists: true },
          },
        },
      ]);

      let totalWithReviews = 0;
      let underReview = 0;
      let reviewed = 0;
      let inReconciliation = 0;
      let withDiscrepancy = 0;
      let totalReviews = 0;
      let completedReviews = 0;

      for (const manuscript of manuscriptsWithReviews) {
        totalWithReviews++;
        if (manuscript.status === 'under_review') underReview++;
        if (
          [
            'approved',
            'rejected',
            'minor_revision',
            'major_revision',
            'review_communicated',
          ].includes(manuscript.status)
        )
          reviewed++;
        if (manuscript.status === 'in_reconciliation') inReconciliation++;

        const humanReviews = manuscript.reviews.filter(
          (r: any) => r.reviewType === 'human' && r.status === 'completed'
        );

        const reconciliationReviews = manuscript.reviews.filter(
          (r: any) =>
            r.reviewType === 'reconciliation' && r.status === 'completed'
        );

        if (humanReviews.length >= 2) {
          if (
            humanReviews[0].reviewDecision !== humanReviews[1].reviewDecision &&
            reconciliationReviews.length === 0
          ) {
            withDiscrepancy++;
          }
        }

        totalReviews += manuscript.reviews.length;
        completedReviews += manuscript.reviews.filter(
          (r: any) => r.status === 'completed'
        ).length;
      }

      const completionRate =
        totalReviews > 0 ? (completedReviews / totalReviews) * 100 : 0;

      logger.info(`Admin ${user.id} retrieved manuscript review statistics`);

      res.status(200).json({
        success: true,
        data: {
          totalWithReviews,
          underReview,
          reviewed,
          inReconciliation,
          withDiscrepancy,
          completionRate: parseFloat(completionRate.toFixed(2)),
        },
      });
    }
  );

  private formatReviewData = (review: any) => {
    return {
      id: review._id,
      reviewType: review.reviewType,
      status: review.status,
      reviewDecision: review.reviewDecision,
      scores: review.scores,
      totalScore: review.totalScore,
      comments: review.comments,
      dueDate: review.dueDate,
      completedAt: review.completedAt,
      createdAt: review.createdAt,
      reviewer: review.reviewer
        ? {
            name: review.reviewer.name,
            email: review.reviewer.email,
          }
        : null,
    };
  };
}

export default new ManuscriptReviewsController();
