import { UpstreamError } from './errors';
import { logger } from './logger';
import { sleep } from './async';

export type FetchLike = typeof fetch;

/**
 * Token-bucket limiter. Requests wait for a token instead of failing,
 * keeping the process within upstream rate limits.
 */
export class TokenBucket {
  private tokens: number;
  private last = Date.now();
  private queue: (() => void)[] = [];
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
  ) {
    this.tokens = capacity;
  }

  take(): Promise<void> {
    return new Promise((resolve) => {
      this.queue.push(resolve);
      this.drain();
    });
  }

  private refill() {
    const now = Date.now();
    this.tokens = Math.min(this.capacity, this.tokens + ((now - this.last) / 1000) * this.refillPerSecond);
    this.last = now;
  }

  private drain() {
    this.refill();
    while (this.queue.length > 0 && this.tokens >= 1) {
      this.tokens -= 1;
      this.queue.shift()!();
    }
    if (this.queue.length > 0 && !this.timer) {
      const waitMs = Math.ceil(((1 - this.tokens) / this.refillPerSecond) * 1000);
      this.timer = setTimeout(() => {
        this.timer = null;
        this.drain();
      }, waitMs);
      this.timer.unref?.();
    }
  }

  /** Pause all requests (e.g. after HTTP 429). */
  penalize(seconds: number) {
    this.tokens = Math.min(this.tokens, -seconds * this.refillPerSecond);
  }
}

export interface RequestOptions {
  service: string;
  limiter?: TokenBucket;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  retries?: number;
  method?: 'GET' | 'POST';
  body?: string;
  headers?: Record<string, string>;
  /** HTTP statuses whose body should be returned to the caller instead of throwing. */
  passStatuses?: number[];
}

export interface HttpResult {
  status: number;
  text: string;
}

const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);

/**
 * HTTP request with timeout, exponential backoff with jitter, Retry-After
 * support and rate limiting. Errors never include the URL (it may contain keys).
 */
export async function request(url: string, opts: RequestOptions): Promise<HttpResult> {
  const { service, limiter, fetchImpl = fetch, timeoutMs = 10_000, retries = 3, passStatuses = [] } = opts;
  let attempt = 0;
  for (;;) {
    if (limiter) await limiter.take();
    let status: number | null = null;
    let retryAfter: number | null = null;
    try {
      const res = await fetchImpl(url, {
        method: opts.method ?? 'GET',
        body: opts.body,
        headers: { Accept: 'application/json', 'User-Agent': 'SteamAnalyticsDashboard/1.0', ...opts.headers },
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'error',
      });
      status = res.status;
      const text = await res.text();
      if (res.ok || passStatuses.includes(res.status)) return { status: res.status, text };
      if (!RETRYABLE.has(res.status)) throw new UpstreamError(service, res.status, `${service} responded with HTTP ${res.status}`);
      const ra = Number(res.headers.get('retry-after'));
      retryAfter = Number.isFinite(ra) && ra > 0 ? Math.min(ra, 60) : null;
      if (res.status === 429) limiter?.penalize(retryAfter ?? 10);
    } catch (err) {
      if (err instanceof UpstreamError && err.status !== null && !RETRYABLE.has(err.status)) throw err;
      if (!(err instanceof UpstreamError)) {
        const name = (err as Error).name;
        if (name !== 'TimeoutError' && name !== 'AbortError' && name !== 'TypeError') throw err;
      }
    }
    attempt += 1;
    if (attempt > retries) {
      throw new UpstreamError(service, status, status ? `${service} responded with HTTP ${status}` : `${service} request failed or timed out`);
    }
    const backoff = retryAfter !== null ? retryAfter * 1000 : Math.min(8000, 500 * 2 ** (attempt - 1)) * (0.5 + Math.random());
    logger.warn('upstream retry', { service, attempt, status, backoffMs: Math.round(backoff) });
    await sleep(backoff);
  }
}

export async function requestJson(url: string, opts: RequestOptions): Promise<{ status: number; json: unknown }> {
  const { status, text } = await request(url, opts);
  try {
    return { status, json: JSON.parse(text) };
  } catch {
    throw new UpstreamError(opts.service, status, `${opts.service} returned invalid JSON`);
  }
}
