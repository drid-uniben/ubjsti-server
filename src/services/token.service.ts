import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { CookieOptions, Response } from 'express';
import { UnauthorizedError } from '../utils/customErrors';
import validateEnv from '../utils/validateEnv';
import logger from '../utils/logger';

validateEnv();

interface BlacklistedTokenDocument extends mongoose.Document {
  token: string;
  expiresAt: Date;
  // Only set when the token was retired by rotation (logout leaves them empty).
  rotatedAt?: Date;
  replacedBy?: string;
}

const BlacklistedTokenSchema = new mongoose.Schema<BlacklistedTokenDocument>({
  token: {
    type: String,
    required: true,
    unique: true,
  },
  expiresAt: {
    type: Date,
    required: true,
    expires: 0,
  },
  rotatedAt: {
    type: Date,
  },
  replacedBy: {
    type: String,
  },
});

const BlacklistedToken = mongoose.model<BlacklistedTokenDocument>(
  'BlacklistedToken',
  BlacklistedTokenSchema,
  'BlacklistedTokens'
);

// A refresh token that was just rotated stays usable for a short window. Two
// requests (or two browser tabs) that send the same cookie at the same moment
// then both succeed, instead of the slower one being logged out. Tokens retired
// by logout have no `replacedBy`, so they are never covered by the grace window.
// Override the default of 30 seconds with REFRESH_GRACE_SECONDS.
const ROTATION_GRACE_MS =
  (Number(process.env.REFRESH_GRACE_SECONDS) || 30) * 1000;

const isWithinGrace = (entry: {
  rotatedAt?: Date;
  replacedBy?: string;
}): boolean =>
  !!entry.replacedBy &&
  !!entry.rotatedAt &&
  Date.now() - entry.rotatedAt.getTime() < ROTATION_GRACE_MS;

export interface TokenPayload {
  userId: string;
  email: string;
  iat?: number;
  exp?: number;
  [key: string]: any;
}

interface GeneratedTokens {
  accessToken: string;
  refreshToken: string;
}

class TokenService {
  private readonly accessTokenSecret: string;
  private readonly refreshTokenSecret: string;

  constructor() {
    this.accessTokenSecret = process.env.JWT_ACCESS_SECRET as string;
    this.refreshTokenSecret = process.env.JWT_REFRESH_SECRET as string;

    if (!this.accessTokenSecret || !this.refreshTokenSecret) {
      throw new Error('JWT secrets must be defined in environment variables');
    }
  }

  generateTokens(payload: TokenPayload): GeneratedTokens {
    const now = Math.floor(Date.now() / 1000);

    const accessToken = jwt.sign(
      {
        ...payload,
        iat: now,
        exp: now + 15 * 60, // 15 minutes
      },
      this.accessTokenSecret
    );

    const refreshToken = jwt.sign(
      {
        ...payload,
        // Unique per token. Without it, two tokens minted in the same second
        // are identical strings, and rotating one would blacklist the other.
        jti: randomUUID(),
        iat: now,
        exp: now + 7 * 24 * 60 * 60, // 7 days
      },
      this.refreshTokenSecret
    );

    return { accessToken, refreshToken };
  }

  async verifyAccessToken(token: string): Promise<TokenPayload> {
    try {
      return jwt.verify(token, this.accessTokenSecret) as TokenPayload;
    } catch (error) {
      logger.error('Error verifying access token:', error);
      throw new UnauthorizedError('Invalid access token');
    }
  }

  async verifyRefreshToken(token: string): Promise<TokenPayload> {
    try {
      logger.info('Verifying refresh token:', `${token.substring(0, 8)}...`);
      const revoked = await BlacklistedToken.findOne({ token })
        .select('rotatedAt replacedBy')
        .lean();
      if (revoked && !isWithinGrace(revoked)) {
        logger.error('Token is blacklisted');
        throw new UnauthorizedError('Token has been revoked');
      }

      const decoded = jwt.verify(
        token,
        this.refreshTokenSecret
      ) as TokenPayload;
      logger.info('Token verified successfully for user:', decoded);
      return decoded;
    } catch (error) {
      logger.error(
        'Token verification failed:',
        error instanceof Error ? error.message : 'Unknown error'
      );
      throw new UnauthorizedError('Invalid refresh token');
    }
  }

  async blacklistToken(token: string, expiresAt: Date): Promise<void> {
    await BlacklistedToken.create({
      token,
      expiresAt,
    });
  }

  async rotateRefreshToken(
    oldToken: string,
    payload: TokenPayload
  ): Promise<GeneratedTokens> {
    const tokens = this.generateTokens(payload);

    const decoded = jwt.decode(oldToken) as TokenPayload | null;
    if (!decoded?.exp) {
      return tokens;
    }

    // Claim the old token atomically. Only the first caller inserts the row.
    // A concurrent caller gets that row back (or a duplicate-key error when both
    // upserts raced) and shares the first caller's new refresh token.
    type RotationEntry = { rotatedAt?: Date; replacedBy?: string };
    let existing: RotationEntry | null;
    try {
      existing = (await BlacklistedToken.findOneAndUpdate(
        { token: oldToken },
        {
          $setOnInsert: {
            expiresAt: new Date(decoded.exp * 1000),
            rotatedAt: new Date(),
            replacedBy: tokens.refreshToken,
          },
        },
        { upsert: true, new: false }
      ).lean()) as RotationEntry | null;
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) {
        throw error;
      }
      existing = (await BlacklistedToken.findOne({
        token: oldToken,
      }).lean()) as RotationEntry | null;
    }

    if (!existing) {
      return tokens; // this call won the race
    }

    if (isWithinGrace(existing)) {
      // Already rotated a moment ago: hand back the same new refresh token and
      // only mint a fresh access token.
      return {
        accessToken: tokens.accessToken,
        refreshToken: existing.replacedBy as string,
      };
    }

    throw new UnauthorizedError('Token has been revoked');
  }

  // Host-only by default: the cookie is scoped to this API's own host, which is
  // the only host that ever reads it. Set COOKIE_DOMAIN only when the API and
  // frontend are subdomains of one parent you own (e.g. 'ubjsti.ng').
  private refreshCookieOptions(): CookieOptions {
    const isProduction = process.env.NODE_ENV === 'production';
    const cookieDomain = process.env.COOKIE_DOMAIN;

    return {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      path: '/',
      ...(cookieDomain ? { domain: cookieDomain } : {}),
    };
  }

  setRefreshTokenCookie(res: Response, token: string): void {
    res.cookie('refreshToken', token, {
      ...this.refreshCookieOptions(),
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });
  }

  clearRefreshTokenCookie(res: Response): void {
    // Attributes must mirror the set call, or the browser rejects the deletion.
    res.clearCookie('refreshToken', this.refreshCookieOptions());
  }
}

export default new TokenService();
