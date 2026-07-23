import nodemailer, { Transporter } from 'nodemailer';
import logger from '../utils/logger';
import validateEnv from '../utils/validateEnv';
import { ManuscriptStatus } from '../Manuscript_Submission/models/manuscript.model';
import {
  overdueReviewTemplate,
  reconciliationAssignmentTemplate,
  reviewAssignmentTemplate,
  manuscriptNotificationTemplate,
  submissionConfirmationTemplate,
  reviewerInvitationTemplate,
  reviewerCredentialsTemplate,
  manuscriptStatusUpdateTemplate,
  manuscriptArchiveNotificationTemplate,
  authorInvitationTemplate,
  authorCredentialsTemplate,
  subscriptionConfirmationTemplate,
  newArticleNotificationTemplate,
  reviewCommunicatedTemplate,
} from '../templates/emails';

validateEnv();

class EmailService {
  private transporter: Transporter;
  private frontendUrl: string;
  private emailFrom: string;

  constructor() {
    if (
      !process.env.SMTP_HOST ||
      !process.env.SMTP_USER ||
      !process.env.SMTP_PASS
    ) {
      throw new Error(
        'SMTP configuration must be defined in environment variables'
      );
    }

    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '465'),
      secure: true,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    this.frontendUrl = process.env.FRONTEND_URL || '';
    this.emailFrom = process.env.EMAIL_FROM || '';

    if (!this.frontendUrl || !this.emailFrom) {
      throw new Error(
        'FRONTEND_URL and EMAIL_FROM must be defined in environment variables'
      );
    }
  }

  private getManuscriptStatusUpdateSubject(
    status: ManuscriptStatus,
    manuscriptTitle: string
  ): string {
    if (status === ManuscriptStatus.APPROVED) {
      return `Congratulations! Your Manuscript "${manuscriptTitle}" Has Been Accepted`;
    } else if (status === ManuscriptStatus.REJECTED) {
      return `Update on Your Manuscript Submission: Decision Made for "${manuscriptTitle}"`;
    } else {
      return `Update on your Manuscript Submission: ${manuscriptTitle}`;
    }
  }

  async sendSubmissionConfirmationEmail(
    to: string,
    name: string,
    manuscriptTitle: string,
    isRevision = false
  ): Promise<void> {
    const subject = isRevision
      ? 'Confirmation of Manuscript Revision'
      : 'Confirmation of Manuscript Submission';
    const loginUrl = `${this.frontendUrl}/author/login`;

    try {
      await this.transporter.sendMail({
        from: this.emailFrom,
        to,
        subject,
        html: submissionConfirmationTemplate(
          name,
          manuscriptTitle,
          loginUrl,
          isRevision
        ),
      });
      logger.info(`Submission confirmation email sent to: ${to}`);
    } catch (error) {
      logger.error(
        'Failed to send submission confirmation email:',
        error instanceof Error ? error.message : 'Unknown error'
      );
      throw error; // Re-throw the error to be caught by the controller
    }
  }

  async sendManuscriptStatusUpdateEmail(
    to: string,
    name: string,
    projectTitle: string,
    status: ManuscriptStatus,
    feedbackComments?: string
  ): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: this.emailFrom,
        to: to,
        subject: this.getManuscriptStatusUpdateSubject(status, projectTitle),
        html: manuscriptStatusUpdateTemplate(
          name,
          projectTitle,
          status,
          undefined,
          feedbackComments
        ),
      });
      logger.info(
        `Manuscript status update email sent to: ${to} for manuscript ${projectTitle}`
      );
    } catch (error) {
      logger.error(
        `Failed to send manuscript status update email to ${to} for manuscript ${projectTitle}:`,
        error instanceof Error ? error.message : 'Unknown error'
      );
      throw error;
    }
  }

  async sendReviewAssignmentEmail(
    email: string,
    manuscriptTitle: string,
    authorName: string,
    dueDate: Date
  ): Promise<void> {
    const reviewUrl = `${this.frontendUrl}/reviewer/assignments`;

    try {
      await this.transporter.sendMail({
        from: this.emailFrom,
        to: email,
        subject: 'New Manuscript Assignment',
        html: reviewAssignmentTemplate(
          manuscriptTitle,
          authorName,
          reviewUrl,
          dueDate
        ),
      });
      logger.info(`Review assignment email sent to reviewer: ${email}`);
    } catch (error) {
      logger.error(
        'Failed to send review assignment email:',
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  async sendOverdueReviewNotification(
    email: string,
    reviewerName: string,
    manuscriptTitle: string,
    reminderType: '3_WEEKS' | '4_WEEKS' | '5_WEEKS'
  ): Promise<void> {
    const reviewUrl = `${this.frontendUrl}/reviewer/dashboard`;

    try {
      await this.transporter.sendMail({
        from: this.emailFrom,
        to: email,
        subject: 'OVERDUE: Manuscript Review',
        html: overdueReviewTemplate(
          reviewerName,
          manuscriptTitle,
          reviewUrl,
          reminderType
        ),
      });
      logger.info(`Overdue review notification sent to: ${email}`);
    } catch (error) {
      logger.error(
        'Failed to send overdue review notification:',
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  async sendReviewerInvitationEmail(
    email: string,
    token: string
  ): Promise<void> {
    const inviteUrl = `${this.frontendUrl}/accept-reviewer-invite/${token}`;

    try {
      await this.transporter.sendMail({
        from: this.emailFrom,
        to: email,
        subject: 'Invitation to Become a Reviewer',
        html: reviewerInvitationTemplate(inviteUrl),
      });
      logger.info(`Reviewer invitation email sent to: ${email}`);
    } catch (error) {
      logger.error(
        'Failed to send reviewer invitation email:',
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  async sendReviewerCredentialsEmail(
    email: string,
    name: string,
    password: string
  ): Promise<void> {
    const loginUrl = `${this.frontendUrl}/reviewer/login`;

    try {
      await this.transporter.sendMail({
        from: this.emailFrom,
        to: email,
        subject: 'Your UBJSTI Reviewer Account Credentials',
        html: reviewerCredentialsTemplate(name, email, password, loginUrl),
      });
      logger.info(`Reviewer credentials email sent to: ${email}`);
    } catch (error) {
      logger.error(
        'Failed to send reviewer credentials email:',
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  async sendAuthorInvitationEmail(email: string, token: string): Promise<void> {
    const inviteUrl = `${this.frontendUrl}/accept-author-invite/${token}`;

    try {
      await this.transporter.sendMail({
        from: this.emailFrom,
        to: email,
        subject: 'Invitation to Join as an Author',
        html: authorInvitationTemplate(inviteUrl),
      });
      logger.info(`Author invitation email sent to: ${email}`);
    } catch (error) {
      logger.error(
        'Failed to send author invitation email:',
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  async sendAuthorCredentialsEmail(
    email: string,
    name: string,
    password: string
  ): Promise<void> {
    const loginUrl = `${this.frontendUrl}/author/login`;

    try {
      await this.transporter.sendMail({
        from: this.emailFrom,
        to: email,
        subject: 'Your UBJSTI Author Account Credentials',
        html: authorCredentialsTemplate(name, email, password, loginUrl),
      });
      logger.info(`Author credentials email sent to: ${email}`);
    } catch (error) {
      logger.error(
        'Failed to send author credentials email:',
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  async sendReconciliationAssignmentEmail(
    email: string,
    reviewerName: string,
    manuscriptTitle: string,
    dueDate: Date
  ): Promise<void> {
    const reviewUrl = `${this.frontendUrl}/reviewer/dashboard`;

    try {
      await this.transporter.sendMail({
        from: this.emailFrom,
        to: email,
        subject: 'Reconciliation Review Assignment',
        html: reconciliationAssignmentTemplate(
          reviewerName,
          manuscriptTitle,
          reviewUrl,
          dueDate
        ),
      });
      logger.info(`Reconciliation assignment email sent to: ${email}`);
    } catch (error) {
      logger.error(
        'Failed to send reconciliation assignment email:',
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  async sendSubscriptionConfirmationEmail(
    email: string,
    unsubscribeToken: string
  ): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: this.emailFrom,
        to: email,
        subject: 'Welcome to UBJSTI Email Alerts',
        html: subscriptionConfirmationTemplate(email, unsubscribeToken),
      });
      logger.info(`Subscription confirmation email sent to: ${email}`);
    } catch (error) {
      logger.error(
        'Failed to send subscription confirmation email:',
        error instanceof Error ? error.message : 'Unknown error'
      );
      throw error;
    }
  }

  async sendNewArticleNotification(
    email: string,
    articleTitle: string,
    authorName: string,
    articleId: string,
    unsubscribeToken: string
  ): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: this.emailFrom,
        to: email,
        subject: `New Article Published: ${articleTitle}`,
        html: newArticleNotificationTemplate(
          articleTitle,
          authorName,
          articleId,
          unsubscribeToken
        ),
      });
      logger.info(`New article notification sent to: ${email}`);
    } catch (error) {
      logger.error(
        'Failed to send new article notification:',
        error instanceof Error ? error.message : 'Unknown error'
      );
      throw error;
    }
  }

  async sendManuscriptArchiveNotificationEmail(
    to: string,
    name: string,
    manuscriptTitle: string,
    isArchived: boolean,
    reason?: string
  ): Promise<void> {
    const subject = isArchived
      ? `Your Manuscript "${manuscriptTitle}" Has Been Archived`
      : `Your Manuscript "${manuscriptTitle}" Has Been Unarchived`;

    try {
      await this.transporter.sendMail({
        from: this.emailFrom,
        to,
        subject,
        html: manuscriptArchiveNotificationTemplate(
          name,
          manuscriptTitle,
          isArchived,
          reason
        ),
      });
      logger.info(
        `${isArchived ? 'Archive' : 'Unarchive'} notification email sent to: ${to} for manuscript ${manuscriptTitle}`
      );
    } catch (error) {
      logger.error(
        `Failed to send ${isArchived ? 'archive' : 'unarchive'} notification email to ${to} for manuscript ${manuscriptTitle}:`,
        error instanceof Error ? error.message : 'Unknown error'
      );
      throw error;
    }
  }

  // sendDynamicEmail method signature
  async sendDynamicEmail(
    to: string,
    subject: string,
    htmlContent: string,
    attachments?: Array<{ filename: string; path: string; contentType: string }>
  ): Promise<void> {
    try {
      const mailOptions: any = {
        from: this.emailFrom,
        to,
        subject,
        html: htmlContent,
      };

      // Add attachments if provided
      if (attachments && attachments.length > 0) {
        mailOptions.attachments = attachments.map((att) => ({
          filename: att.filename,
          path: att.path,
          contentType: att.contentType,
        }));
      }

      await this.transporter.sendMail(mailOptions);
      logger.info(
        `Dynamic email sent to: ${to}${attachments?.length ? ` with ${attachments.length} attachment(s)` : ''}`
      );
    } catch (error) {
      logger.error(
        'Failed to send dynamic email:',
        error instanceof Error ? error.message : 'Unknown error'
      );
      throw error;
    }
  }

  async sendReviewCommunicatedEmail(
    to: string,
    name: string,
    manuscriptTitle: string,
    allowRevision: boolean
  ): Promise<void> {
    const loginUrl = `${this.frontendUrl}/author/login`;
    try {
      await this.transporter.sendMail({
        from: this.emailFrom,
        to,
        subject: `Review Available for "${manuscriptTitle}"`,
        html: reviewCommunicatedTemplate(
          name,
          manuscriptTitle,
          loginUrl,
          allowRevision
        ),
      });
      logger.info(`Review communicated email sent to: ${to}`);
    } catch (error) {
      logger.error(
        'Failed to send review communicated email:',
        error instanceof Error ? error.message : 'Unknown error'
      );
      throw error;
    }
  }
}

export default new EmailService();
