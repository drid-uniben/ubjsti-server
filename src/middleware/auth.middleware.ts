import { Request, Response, NextFunction } from 'express';
import {
  UnauthorizedError,
  ForbiddenError,
  RateLimitError,
} from '../utils/customErrors';
import tokenService from '../services/token.service';
import User, { UserRole } from '../model/user.model';

interface UserPayload {
  userId: string;
}

interface AuthRequest extends Request {
  user?: any;
}

// Authenticate admin access token
const authenticateAdminToken = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.split(' ')[1];

    if (!token) {
      throw new UnauthorizedError('Access token required');
    }

    const payload = (await tokenService.verifyAccessToken(
      token
    )) as UserPayload;
    const user = await User.findById(payload.userId);

    if (!user) {
      throw new UnauthorizedError('User not found');
    }

    if (user.role !== 'admin') {
      throw new ForbiddenError('Access denied: Admin privileges required');
    }

    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
};

// Authenticate author access token
const authenticateAuthorToken = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.split(' ')[1];

    if (!token) {
      throw new UnauthorizedError('Access token required');
    }

    const payload = (await tokenService.verifyAccessToken(
      token
    )) as UserPayload;
    const user = await User.findById(payload.userId);

    if (!user) {
      throw new UnauthorizedError('User not found');
    }

    if (user.role !== UserRole.AUTHOR) {
      throw new ForbiddenError('Access denied: Author privileges required');
    }

    if (!user.isActive) {
      throw new UnauthorizedError('Your account is not active');
    }

    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
};

// Authenticate reviewer access token
const authenticateReviewerToken = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.split(' ')[1];

    if (!token) {
      throw new UnauthorizedError('Access token required');
    }

    const payload = (await tokenService.verifyAccessToken(
      token
    )) as UserPayload;
    const user = await User.findById(payload.userId);

    if (!user) {
      throw new UnauthorizedError('User not found');
    }

    if (user.role !== UserRole.REVIEWER) {
      throw new ForbiddenError('Access denied: Reviewer privileges required');
    }

    if (!user.isActive) {
      throw new UnauthorizedError('Your account is not active');
    }

    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
};

// Authenticate any valid user (admin or researcher)
const authenticateToken = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.split(' ')[1];

    if (!token) {
      throw new UnauthorizedError('Access token required');
    }

    const payload = (await tokenService.verifyAccessToken(
      token
    )) as UserPayload;
    const user = await User.findById(payload.userId);

    if (!user) {
      throw new UnauthorizedError('User not found');
    }

    if (!['admin', 'author', 'reviewer'].includes(user.role)) {
      throw new ForbiddenError('Invalid user role');
    }

    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
};

// Check article moderation permissions
const authorizeModeration = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user || req.user.role !== 'admin') {
      throw new ForbiddenError('Access denied: Admin privileges required');
    }

    next();
  } catch (error) {
    next(error);
  }
};

// Rate limiting middleware for public endpoints
const rateLimiter = (limit: number, windowMs: number) => {
  const requests = new Map<string, number[]>();

  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const ip = req.ip as string;
      const now = Date.now();

      // Clean old requests
      if (requests.has(ip)) {
        const userRequests = requests.get(ip) || [];
        const validRequests = userRequests.filter(
          (timestamp) => now - timestamp < windowMs
        );

        if (validRequests.length >= limit) {
          // 429, not 401: clients treat a 401 as an expired token and start a
          // refresh, so a rate limit must never look like an auth failure.
          throw new RateLimitError('Rate limit exceeded');
        }

        requests.set(ip, [...validRequests, now]);
      } else {
        requests.set(ip, [now]);
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};

export {
  authenticateAdminToken,
  authenticateAuthorToken,
  authenticateReviewerToken,
  authenticateToken,
  authorizeModeration,
  rateLimiter,
};
