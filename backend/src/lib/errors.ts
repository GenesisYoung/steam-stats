import type { ErrorCode } from '@steam-analytics/shared';

export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const errors = {
  unauthenticated: (msg = 'Authentication required') => new AppError(401, 'UNAUTHENTICATED', msg),
  forbidden: (msg = 'Not allowed') => new AppError(403, 'FORBIDDEN', msg),
  emailNotVerified: () => new AppError(403, 'EMAIL_NOT_VERIFIED', 'Verify your email address first'),
  recentLoginRequired: () =>
    new AppError(401, 'RECENT_LOGIN_REQUIRED', 'Please sign in again to confirm this action'),
  notFound: (msg = 'Not found') => new AppError(404, 'NOT_FOUND', msg),
  steamNotLinked: () => new AppError(409, 'STEAM_NOT_LINKED', 'No Steam account is linked'),
  steamAlreadyLinked: (msg = 'This Steam account is already linked') =>
    new AppError(409, 'STEAM_ALREADY_LINKED', msg),
  steamPrivate: (msg = 'Steam profile or game details are private') =>
    new AppError(403, 'STEAM_PROFILE_PRIVATE', msg),
  steamUnavailable: (msg = 'Steam is temporarily unavailable') => new AppError(502, 'STEAM_UNAVAILABLE', msg),
  syncInProgress: (jobId: string) =>
    new AppError(409, 'SYNC_IN_PROGRESS', 'A synchronization is already running', { jobId }),
  purchaseConflict: (msg: string, appIds: number[]) => new AppError(409, 'PURCHASE_CONFLICT', msg, { appIds }),
  importUnavailable: () =>
    new AppError(503, 'IMPORT_UNAVAILABLE', 'Screenshot import is not configured on this server'),
  importFailed: (msg = 'The screenshot could not be read') => new AppError(422, 'IMPORT_FAILED', msg),
  rateLimited: (msg = 'Too many requests', retryAfterSeconds?: number) =>
    new AppError(429, 'RATE_LIMITED', msg, retryAfterSeconds ? { retryAfterSeconds } : undefined),
};

/** Error raised by upstream HTTP calls (Steam). Never contains the request URL (it holds the API key). */
export class UpstreamError extends Error {
  constructor(
    readonly service: string,
    readonly status: number | null,
    message: string,
  ) {
    super(message);
    this.name = 'UpstreamError';
  }
}
