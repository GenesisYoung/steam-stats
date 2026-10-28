import type { ApiErrorBody, ApiMeta, ApiSuccess, ErrorCode } from '@steam-analytics/shared';
import { auth } from './firebase';

const BASE = import.meta.env.VITE_API_BASE ?? '/api';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | 'NETWORK',
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

type Query = Record<string, string | number | boolean | undefined | null>;

async function call<T>(method: string, path: string, opts: { query?: Query; body?: unknown; retryAuth?: boolean } = {}): Promise<ApiSuccess<T>> {
  const url = new URL(BASE + path, window.location.origin);
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));

  const user = auth.currentUser;
  const headers: Record<string, string> = {};
  if (user) headers.Authorization = `Bearer ${await user.getIdToken(opts.retryAuth === false)}`;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  const payload = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;

  let res: Response;
  try {
    res = await fetch(url, { method, headers, body: payload, credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Network error');
  }
  // Token may have been revoked or expired between refreshes: force-refresh once.
  if (res.status === 401 && user && opts.retryAuth !== false) return call<T>(method, path, { ...opts, retryAuth: false });
  if (res.status === 204) return { data: undefined as T };

  const body = (await res.json().catch(() => null)) as ApiSuccess<T> | ApiErrorBody | null;
  if (!res.ok || !body || 'error' in body) {
    const err = body && 'error' in body ? body.error : { code: 'INTERNAL' as const, message: res.statusText };
    throw new ApiError(res.status, err.code, err.message, err.details);
  }
  return body;
}

export const api = {
  get: <T>(path: string, query?: Query) => call<T>('GET', path, { query }),
  post: <T>(path: string, body?: unknown) => call<T>('POST', path, { body: body ?? {} }),
  put: <T>(path: string, body: unknown) => call<T>('PUT', path, { body }),
  patch: <T>(path: string, body: unknown) => call<T>('PATCH', path, { body }),
  delete: <T = void>(path: string) => call<T>('DELETE', path),
};

export type { ApiMeta };
