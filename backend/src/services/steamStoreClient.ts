/**
 * Steam Store public data (store.steampowered.com/api/appdetails).
 *
 * This endpoint is not part of the documented Steamworks Web API; it is the
 * public endpoint used by the Steam store itself. Its results are therefore
 * labelled as estimates, parsed defensively, cached and heavily rate limited
 * (~200 requests / 5 minutes).
 */
import { z } from 'zod';
import type { StorePriceStatus } from '@steam-analytics/shared';
import { UpstreamError } from '../lib/errors';
import { requestJson, TokenBucket, type FetchLike } from '../lib/http';

const BASE = 'https://store.steampowered.com/api/appdetails';
/** appdetails accepts several appids only with filters=price_overview. */
export const PRICE_BATCH_SIZE = 50;

const priceOverviewSchema = z.object({
  currency: z.string().length(3),
  initial: z.number().int().min(0),
  final: z.number().int().min(0),
  discount_percent: z.number().int().min(0).max(100).optional(),
});

const entrySchema = z.object({ success: z.boolean(), data: z.unknown().optional() });
const responseSchema = z.record(z.string(), entrySchema);

const basicDataSchema = z.object({
  type: z.string().optional(),
  name: z.string().optional(),
  is_free: z.boolean().optional(),
});

export interface StorePrice {
  appId: number;
  status: StorePriceStatus;
  currency: string | null;
  /** Steam returns amounts in hundredths of the currency unit for every currency. */
  initialMinor: number | null;
  finalMinor: number | null;
  discountPercent: number | null;
}

export interface StoreAppBasics {
  appId: number;
  available: boolean;
  type: string | null;
  name: string | null;
  isFree: boolean | null;
}

export class SteamStoreClient {
  private readonly limiter: TokenBucket;

  constructor(private readonly opts: { fetchImpl?: FetchLike; limiter?: TokenBucket; retries?: number } = {}) {
    // 200 requests / 300 s ≈ 0.66/s; keep a little headroom.
    this.limiter = opts.limiter ?? new TokenBucket(5, 0.6);
  }

  private async fetch(params: URLSearchParams) {
    const { json } = await requestJson(`${BASE}?${params}`, {
      service: 'steam-store',
      limiter: this.limiter,
      fetchImpl: this.opts.fetchImpl,
      retries: this.opts.retries ?? 4,
      timeoutMs: 15_000,
    });
    // Steam answers `null` for some invalid requests.
    if (json === null) return {};
    const parsed = responseSchema.safeParse(json);
    if (!parsed.success) throw new UpstreamError('steam-store', 200, 'Unexpected appdetails response');
    return parsed.data;
  }

  /** Batched current prices for up to PRICE_BATCH_SIZE apps in one region. */
  async getPrices(appIds: number[], region: string): Promise<StorePrice[]> {
    if (appIds.length === 0) return [];
    if (appIds.length > PRICE_BATCH_SIZE) throw new Error('Too many appids for one request');
    const data = await this.fetch(new URLSearchParams({ appids: appIds.join(','), cc: region, filters: 'price_overview' }));
    return appIds.map((appId) => {
      const entry = data[String(appId)];
      const empty = { appId, currency: null, initialMinor: null, finalMinor: null, discountPercent: null };
      if (!entry || !entry.success) return { ...empty, status: 'unavailable' as const };
      const overview = priceOverviewSchema.safeParse((entry.data as { price_overview?: unknown } | undefined)?.price_overview);
      if (!overview.success) return { ...empty, status: 'no_price' as const };
      return {
        appId,
        status: 'priced' as const,
        currency: overview.data.currency.toUpperCase(),
        initialMinor: overview.data.initial,
        finalMinor: overview.data.final,
        discountPercent: overview.data.discount_percent ?? 0,
      };
    });
  }

  /** Store type / free flag for one app (used to classify games vs software and free titles). */
  async getAppBasics(appId: number, region: string): Promise<StoreAppBasics> {
    const data = await this.fetch(new URLSearchParams({ appids: String(appId), cc: region, filters: 'basic', l: 'english' }));
    const entry = data[String(appId)];
    if (!entry || !entry.success) return { appId, available: false, type: null, name: null, isFree: null };
    const basic = basicDataSchema.safeParse(entry.data);
    if (!basic.success) return { appId, available: true, type: null, name: null, isFree: null };
    return { appId, available: true, type: basic.data.type ?? null, name: basic.data.name ?? null, isFree: basic.data.is_free ?? null };
  }
}
