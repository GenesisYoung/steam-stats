import type { Auth } from 'firebase-admin/auth';
import type { RequestHandler } from 'express';
import { errors } from '../lib/errors';

/** Verifies the Firebase ID token (including revocation) and attaches req.user. */
export function authenticate(auth: Auth): RequestHandler {
  return async (req, _res, next) => {
    const header = req.headers.authorization ?? '';
    const match = /^Bearer\s+([A-Za-z0-9._-]+)$/.exec(header);
    if (!match) return next(errors.unauthenticated());
    try {
      const decoded = await auth.verifyIdToken(match[1]!, true);
      if (!decoded.email) return next(errors.forbidden('An email address is required'));
      req.user = {
        uid: decoded.uid,
        email: decoded.email,
        emailVerified: decoded.email_verified === true,
        name: typeof decoded.name === 'string' ? decoded.name : undefined,
        authTime: decoded.auth_time,
      };
      next();
    } catch {
      next(errors.unauthenticated('Invalid or expired session'));
    }
  };
}

export function requireVerifiedEmail(enabled: boolean): RequestHandler {
  return (req, _res, next) => {
    if (enabled && !req.user?.emailVerified) return next(errors.emailNotVerified());
    next();
  };
}

/** Narrow req.user for handlers mounted behind authenticate(). */
export function currentUser(req: Express.Request) {
  if (!req.user) throw errors.unauthenticated();
  return req.user;
}
