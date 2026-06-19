import { Request, Response } from 'express';
import crypto from 'crypto';
import User, { UserRole } from '../../model/user.model';
import Manuscript from '../../Manuscript_Submission/models/manuscript.model';
import Article from '../../Articles/model/article.model';
import {
  NotFoundError,
  UnauthorizedError,
  BadRequestError,
} from '../../utils/customErrors';
import asyncHandler from '../../utils/asyncHandler';
import logger from '../../utils/logger';
import emailService from '../../services/email.service';
import generateSecurePassword from '../../utils/passwordGenerator';
import { Types } from 'mongoose';

interface AuthorAuthenticatedRequest extends Request {
  user: {
    _id: string;
    role: string;
    email: string;
  };
}

interface IAuthorResponse {
  success: boolean;
  count?: number;
  totalPages?: number;
  currentPage?: number;
  message?: string;
  data?: any;
}

class AuthorController {
  // Get author dashboard data
  getAuthorDashboard = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const user = (req as AuthorAuthenticatedRequest).user;

      const userId = user._id;

      // Find the author
      const author = await User.findById(userId).select(
        '-password -refreshToken'
      );

      if (!author) {
        throw new NotFoundError('Author not found');
      }

      // Find all manuscripts by this author
      const manuscripts = await Manuscript.find({ submitter: userId })
        .sort({
          updatedAt: -1,
        })
        .populate('submitter', 'name email')
        .populate('incompleteCoAuthors', 'name email faculty affiliation orcid')
        .populate('revisedFrom', 'title status createdAt')
        .populate('supersededBy', 'title status createdAt')
        .lean();

      // Calculate statistics
      const totalManuscripts = manuscripts.length;
      const statusCounts: Record<string, number> = {
        submitted: 0,
        under_review: 0,
        in_reconciliation: 0,
        review_communicated: 0,
        approved: 0,
        rejected: 0,
        minor_revision: 0,
        major_revision: 0,
        revised: 0,
        superseded: 0,
      };

      // Count manuscripts by status
      manuscripts.forEach((manuscript) => {
        if (statusCounts[manuscript.status] !== undefined) {
          statusCounts[manuscript.status]++;
        }
      });

      // Get the most recent manuscript
      const recentManuscript = manuscripts[0] || null;

      logger.info(`Author ${userId} accessed dashboard`);

      res.status(200).json({
        success: true,
        data: {
          profile: author,
          manuscripts: manuscripts,
          stats: {
            totalManuscripts,
            statusCounts,
          },
          recentManuscript,
        },
      });
    }
  );

  // Get author's manuscript details
  getManuscriptDetails = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const user = (req as AuthorAuthenticatedRequest).user;

      const userId = user._id;
      const { manuscriptId } = req.params;

      // Find the manuscript and verify ownership
      const manuscript = await Manuscript.findById(manuscriptId)
        .populate('submitter coAuthors', 'name email affiliation orcid')
        .populate('incompleteCoAuthors', 'name email faculty affiliation orcid')
        .populate('revisedFrom', 'title status createdAt')
        .populate('supersededBy', 'title status createdAt')
        .lean();

      if (!manuscript) {
        throw new NotFoundError('Manuscript not found');
      }

      // Check if the author owns this manuscript
      if (manuscript.submitter._id.toString() !== userId.toString()) {
        throw new UnauthorizedError(
          'You do not have permission to view this manuscript'
        );
      }

      logger.info(`Author ${userId} accessed manuscript ${manuscriptId}`);

      res.status(200).json({
        success: true,
        data: manuscript,
      });
    }
  );

  // Invite an author by email
  inviteAuthor = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const { email } = req.body;

      logger.info(`Author invitation request received for email: ${email}`);

      const existingAuthor = await User.findOne({ email });
      if (existingAuthor) {
        logger.warn(`Attempt to invite already registered email: ${email}`);
        throw new BadRequestError('Email already registered');
      }

      // Generate invite token
      const inviteToken = crypto.randomBytes(32).toString('hex');
      const hashedToken = crypto
        .createHash('sha256')
        .update(inviteToken)
        .digest('hex');

      // Store invitation
      await User.create({
        email,
        inviteToken: hashedToken,
        inviteTokenExpires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
        role: UserRole.AUTHOR,
        invitationStatus: 'pending',
        isActive: false,
      });

      logger.info(`Created author invitation record for email: ${email}`);

      // Send invitation email
      await emailService.sendAuthorInvitationEmail(email, inviteToken);
      logger.info(`Author invitation email sent to: ${email}`);

      res.status(200).json({
        success: true,
        message: 'Author invitation sent successfully',
      });
    }
  );

  // Complete author profile from invitation
  completeAuthorProfile = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const { token } = req.params;
      const { name, faculty, affiliation, orcid } = req.body;

      logger.info(
        `Author profile completion attempt with token: ${token.substring(0, 8)}...`
      );

      const hashedToken = crypto
        .createHash('sha256')
        .update(token)
        .digest('hex');

      const author = await User.findOne({
        inviteToken: hashedToken,
        inviteTokenExpires: { $gt: Date.now() },
      });

      if (!author) {
        logger.warn(
          `Invalid or expired author invitation token: ${token.substring(0, 8)}...`
        );
        throw new BadRequestError('Invalid or expired invitation token');
      }

      // Generate a secure password for the author
      const generatedPassword = generateSecurePassword();

      // Update author profile
      author.name = name;
      author.faculty = faculty;
      author.affiliation = affiliation;
      author.orcid = orcid;
      author.password = generatedPassword;
      author.isActive = true;
      author.credentialsSent = true;
      author.credentialsSentAt = new Date();
      author.inviteToken = undefined;
      author.inviteTokenExpires = undefined;
      author.invitationStatus = 'accepted';

      await author.save();
      logger.info(`Author profile completed for: ${author.email}`);

      // Send login credentials to the author
      await emailService.sendAuthorCredentialsEmail(
        author.email,
        author.name,
        generatedPassword
      );
      logger.info(`Login credentials sent to author: ${author.email}`);

      res.status(200).json({
        success: true,
        message:
          'Profile completed successfully. Login credentials have been sent to your email.',
      });
    }
  );

  // Add an author profile manually (without invitation)
  addAuthorProfile = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const user = (req as AuthorAuthenticatedRequest).user;
      // Check if user is admin
      if (user.role !== 'admin') {
        throw new UnauthorizedError(
          'You do not have permission to access this resource'
        );
      }

      const { email, name, faculty, affiliation, orcid } = req.body;

      logger.info(`Manual author profile creation request for email: ${email}`);

      // Check if author already exists
      const existingAuthor = await User.findOne({ email });
      if (existingAuthor) {
        logger.warn(
          `Attempt to create profile for already registered email: ${email}`
        );
        throw new BadRequestError('Email already registered as an author');
      }

      // Generate a secure password for the author
      const generatedPassword = generateSecurePassword();

      // Create new author profile
      const newAuthor = await User.create({
        email,
        name,
        faculty,
        affiliation,
        orcid,
        password: generatedPassword,
        role: UserRole.AUTHOR,
        credentialsSent: true,
        credentialsSentAt: new Date(),
        isActive: true,
        invitationStatus: 'added',
      });

      logger.info(`Author profile manually created for: ${email}`);

      // Send login credentials to the author
      await emailService.sendAuthorCredentialsEmail(
        email,
        name,
        generatedPassword
      );
      logger.info(`Login credentials sent to author: ${email}`);

      res.status(201).json({
        success: true,
        message:
          'Author profile created successfully. Login credentials have been sent to their email.',
        data: {
          id: newAuthor._id,
          email: newAuthor.email,
          name: newAuthor.name,
          faculty: newAuthor.faculty,
          affiliation: newAuthor.affiliation,
          orcid: newAuthor.orcid,
        },
      });
    }
  );

  // Delete an author
  deleteAuthor = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const user = (req as AuthorAuthenticatedRequest).user;
      // Check if user is admin
      if (user.role !== 'admin') {
        throw new UnauthorizedError(
          'You do not have permission to access this resource'
        );
      }

      const { id } = req.params;

      // Validate ObjectId format
      if (!Types.ObjectId.isValid(id)) {
        throw new BadRequestError('Invalid author ID');
      }

      const author = await User.findById(id);
      if (!author) {
        throw new NotFoundError('Author not found');
      }

      // Check if author has published articles
      const publishedArticles = await Article.find({
        $or: [{ author: id }, { coAuthors: id }],
      });
      if (publishedArticles.length > 0) {
        throw new BadRequestError(
          'Cannot delete author with published articles.'
        );
      }

      await User.findByIdAndDelete(id);
      logger.info(`Admin ${user._id} deleted author ${id}`);

      res.status(200).json({
        success: true,
        message: 'Author deleted successfully',
      });
    }
  );

  // Get all author invitations
  getAuthorInvitations = asyncHandler(
    async (req: Request, res: Response<IAuthorResponse>): Promise<void> => {
      const user = (req as AuthorAuthenticatedRequest).user;
      // Check if user is admin
      if (user.role !== 'admin') {
        throw new UnauthorizedError(
          'You do not have permission to access this resource'
        );
      }

      // Update expired invitations
      await User.updateMany(
        {
          role: UserRole.AUTHOR,
          invitationStatus: 'pending',
          inviteTokenExpires: { $lt: new Date() },
        },
        { invitationStatus: 'expired' }
      );

      const invitations = await User.find({
        role: UserRole.AUTHOR,
        invitationStatus: { $in: ['pending', 'expired', 'accepted', 'added'] },
      }).select(
        '_id email assignedFaculty inviteTokenExpires createdAt invitationStatus'
      );

      const formattedInvitations = invitations.map((invitation) => ({
        id: invitation._id,
        email: invitation.email,
        status: invitation.invitationStatus,
        created: invitation.createdAt.toISOString().split('T')[0],
        assignedFaculty: invitation.assignedFaculty ?? null,
        expires: invitation.inviteTokenExpires
          ? invitation.inviteTokenExpires.toISOString().split('T')[0]
          : null,
      }));

      logger.info(`Admin ${user._id} retrieved author invitations list`);

      res.status(200).json({
        success: true,
        data: formattedInvitations,
      });
    }
  );

  // Resend invitation
  resendAuthorInvitation = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const user = (req as AuthorAuthenticatedRequest).user;
      // Check if user is admin
      if (user.role !== 'admin') {
        throw new UnauthorizedError(
          'You do not have permission to access this resource'
        );
      }

      const { id } = req.params;

      const author = await User.findById(id);
      if (!author) {
        throw new NotFoundError('Author not found');
      }

      if (author.invitationStatus !== 'pending') {
        throw new BadRequestError(
          'Can only resend invitations for pending authors'
        );
      }

      // Generate new invite token
      const inviteToken = crypto.randomBytes(32).toString('hex');
      const hashedToken = crypto
        .createHash('sha256')
        .update(inviteToken)
        .digest('hex');

      // Update author with new token
      author.inviteToken = hashedToken;
      author.inviteTokenExpires = new Date(
        Date.now() + 30 * 24 * 60 * 60 * 1000
      ); // 30 days

      await author.save();
      logger.info(`Author invitation resent for email: ${author.email}`);

      // Send invitation email
      await emailService.sendAuthorInvitationEmail(author.email, inviteToken);
      logger.info(`Author invitation email resent to: ${author.email}`);

      res.status(200).json({
        success: true,
        message: 'Author invitation resent successfully',
      });
    }
  );
}

export default new AuthorController();
