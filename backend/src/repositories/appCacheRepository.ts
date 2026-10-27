import type { AchievementSchemaDoc, AppMetadataDoc, AppPriceDoc } from '@steam-analytics/shared';
import { chunk } from '../lib/async';
import { LruCache } from '../lib/lru';
import type { Refs } from './refs';

const MEMORY_TTL_MS = 2 * 60 * 1000;

/**
 * Shared, server-managed Steam app data (metadata, regional prices and
 * achievement schemas). An in-process LRU avoids re-reading the same shared
 * documents for every user request.
 */
export class AppCacheRepository {
  private metaCache = new LruCache<number, AppMetadataDoc | null>(20_000, MEMORY_TTL_MS);
  private priceCache = new LruCache<string, AppPriceDoc | null>(50_000, MEMORY_TTL_MS);
  private schemaCache = new LruCache<string, AchievementSchemaDoc>(2_000, MEMORY_TTL_MS);

  constructor(private readonly refs: Refs) {}

  async getMetadata(appIds: number[]): Promise<Map<number, AppMetadataDoc>> {
    const result = new Map<number, AppMetadataDoc>();
    const missing: number[] = [];
    for (const id of appIds) {
      const cached = this.metaCache.get(id);
      if (cached === undefined) missing.push(id);
      else if (cached) result.set(id, cached);
    }
    for (const part of chunk(missing, 300)) {
      const snaps = await this.refs.db.getAll(...part.map((id) => this.refs.appMeta(id)));
      snaps.forEach((s, i) => {
        const doc = s.exists ? (s.data() as AppMetadataDoc) : null;
        this.metaCache.set(part[i]!, doc);
        if (doc) result.set(part[i]!, doc);
      });
    }
    return result;
  }

  async getPrices(appIds: number[], region: string): Promise<Map<number, AppPriceDoc>> {
    const result = new Map<number, AppPriceDoc>();
    const missing: number[] = [];
    for (const id of appIds) {
      const cached = this.priceCache.get(`${id}:${region}`);
      if (cached === undefined) missing.push(id);
      else if (cached) result.set(id, cached);
    }
    for (const part of chunk(missing, 300)) {
      const snaps = await this.refs.db.getAll(...part.map((id) => this.refs.appPrice(id, region)));
      snaps.forEach((s, i) => {
        const doc = s.exists ? (s.data() as AppPriceDoc) : null;
        this.priceCache.set(`${part[i]}:${region}`, doc);
        if (doc) result.set(part[i]!, doc);
      });
    }
    return result;
  }

  async setMetadata(docs: AppMetadataDoc[]): Promise<void> {
    for (const part of chunk(docs, 400)) {
      const batch = this.refs.db.batch();
      for (const d of part) {
        batch.set(this.refs.appMeta(d.appId), d);
        this.metaCache.set(d.appId, d);
      }
      await batch.commit();
    }
  }

  async setPrices(docs: AppPriceDoc[]): Promise<void> {
    for (const part of chunk(docs, 400)) {
      const batch = this.refs.db.batch();
      for (const d of part) {
        batch.set(this.refs.appPrice(d.appId, d.region), d);
        this.priceCache.set(`${d.appId}:${d.region}`, d);
      }
      await batch.commit();
    }
  }

  async getSchema(appId: number, lang: string): Promise<AchievementSchemaDoc | null> {
    const key = `${appId}:${lang}`;
    const cached = this.schemaCache.get(key);
    if (cached) return cached;
    const snap = await this.refs.appSchema(appId, lang).get();
    if (!snap.exists) return null;
    const doc = snap.data()!;
    this.schemaCache.set(key, doc);
    return doc;
  }

  async setSchema(doc: AchievementSchemaDoc): Promise<void> {
    await this.refs.appSchema(doc.appId, doc.language).set(doc);
    this.schemaCache.set(`${doc.appId}:${doc.language}`, doc);
  }

  clearMemory(): void {
    this.metaCache.clear();
    this.priceCache.clear();
    this.schemaCache.clear();
  }
}
