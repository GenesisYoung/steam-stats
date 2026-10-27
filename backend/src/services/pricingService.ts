import type { AppMetadataDoc, AppPriceDoc, PriceDto, PriceStatus } from '@steam-analytics/shared';
import { chunk } from '../lib/async';
import { toIso } from '../lib/firestore';
import { logger } from '../lib/logger';
import type { AppCacheRepository } from '../repositories/appCacheRepository';
import { PRICE_BATCH_SIZE, type SteamStoreClient } from './steamStoreClient';

export const PRICE_TTL_MS = 24 * 60 * 60 * 1000;
export const METADATA_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface EffectivePrice {
  status: PriceStatus | 'unknown';
  amount: number | null;
  currency: string | null;
  initialAmount: number | null;
  discountPercent: number | null;
  fetchedAt: Date | null;
}

/** Combine the raw store price with app metadata into a user-facing price status. */
export function effectivePrice(meta: AppMetadataDoc | undefined, price: AppPriceDoc | undefined): EffectivePrice {
  const base = { amount: null, currency: null, initialAmount: null, discountPercent: null, fetchedAt: price?.fetchedAt ?? null };
  if (meta?.isFree === true) return { ...base, status: 'free' };
  if (!price) return { ...base, status: 'unknown' };
  if (price.status === 'priced' && price.finalMinor !== null && price.currency) {
    return {
      status: 'priced',
      amount: price.finalMinor / 100,
      currency: price.currency,
      initialAmount: price.initialMinor !== null ? price.initialMinor / 100 : null,
      discountPercent: price.discountPercent,
      fetchedAt: price.fetchedAt,
    };
  }
  if (price.status === 'unavailable') return { ...base, status: 'unavailable' };
  // no_price: free or not sold — only metadata can tell.
  if (meta?.isFree === false || meta?.storeStatus === 'unavailable') return { ...base, status: 'unavailable' };
  return { ...base, status: 'unknown' };
}

export function toPriceDto(p: EffectivePrice, region: string): PriceDto {
  return {
    status: p.status,
    price: p.amount !== null && p.currency ? { amount: p.amount, currency: p.currency } : null,
    initialPrice: p.initialAmount !== null && p.currency ? { amount: p.initialAmount, currency: p.currency } : null,
    discountPercent: p.discountPercent,
    region,
    fetchedAt: toIso(p.fetchedAt),
  };
}

export class PricingService {
  constructor(
    private readonly store: SteamStoreClient,
    private readonly cache: AppCacheRepository,
  ) {}

  /**
   * Refresh stale prices (batched) and fetch missing metadata within a budget.
   * Apps whose price could not be resolved are prioritised for metadata.
   */
  async refresh(appIds: number[], region: string, metadataBudget: number, now = new Date()) {
    const prices = await this.cache.getPrices(appIds, region);
    const stalePrices = appIds.filter((id) => {
      const p = prices.get(id);
      return !p || now.getTime() - p.fetchedAt.getTime() > PRICE_TTL_MS;
    });

    let pricesUpdated = 0;
    let priceFailures = 0;
    for (const batch of chunk(stalePrices, PRICE_BATCH_SIZE)) {
      try {
        const results = await this.store.getPrices(batch, region);
        const docs: AppPriceDoc[] = results.map((r) => ({ ...r, region, fetchedAt: now }));
        await this.cache.setPrices(docs);
        docs.forEach((d) => prices.set(d.appId, d));
        pricesUpdated += docs.length;
      } catch (err) {
        priceFailures += batch.length;
        logger.warn('price batch failed', { region, size: batch.length, error: (err as Error).message });
      }
    }

    const meta = await this.cache.getMetadata(appIds);
    const needsMeta = appIds
      .filter((id) => {
        const m = meta.get(id);
        // Backfill pre-cover metadata on the next sync instead of waiting up to 30 days.
        // An explicit null means Steam supplied no usable cover; do not retry every sync.
        return !m || m.headerImageUrl === undefined || now.getTime() - m.fetchedAt.getTime() > METADATA_TTL_MS;
      })
      .sort((a, b) => Number(prices.get(b)?.status !== 'priced') - Number(prices.get(a)?.status !== 'priced'));

    const metaBatch = needsMeta.slice(0, metadataBudget);
    const metaDocs: AppMetadataDoc[] = [];
    for (const appId of metaBatch) {
      try {
        const b = await this.store.getAppBasics(appId, region);
        metaDocs.push({ appId, type: b.type, isFree: b.isFree, name: b.name, headerImageUrl: b.headerImageUrl, storeStatus: b.available ? 'ok' : 'unavailable', fetchedAt: now });
      } catch (err) {
        logger.warn('app metadata failed', { appId, error: (err as Error).message });
        break; // store is struggling; resume next sync
      }
    }
    await this.cache.setMetadata(metaDocs);

    return {
      pricesUpdated,
      pricesRemaining: priceFailures + (needsMeta.length - metaDocs.length),
    };
  }
}
