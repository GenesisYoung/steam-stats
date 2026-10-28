import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import type { Env } from './config/env';
import type { FetchLike } from './lib/http';
import { createRefs } from './repositories/refs';
import { UserRepository } from './repositories/userRepository';
import { SteamDataRepository } from './repositories/steamDataRepository';
import { PurchaseRepository } from './repositories/purchaseRepository';
import { HiddenGameRepository } from './repositories/hiddenGameRepository';
import { AppCacheRepository } from './repositories/appCacheRepository';
import { SyncJobRepository } from './repositories/syncJobRepository';
import { SteamApiClient } from './services/steamApiClient';
import { SteamStoreClient } from './services/steamStoreClient';
import { LibraryService } from './services/libraryService';
import { SteamProfileService } from './services/steamProfileService';
import { SteamLinkService } from './services/steamLinkService';
import { AchievementService } from './services/achievementService';
import { PricingService } from './services/pricingService';
import { SyncService } from './services/syncService';
import { AnalyticsService } from './services/analyticsService';
import { AccountService } from './services/accountService';
import { PurchaseService } from './services/purchaseService';
import { ImportService } from './services/importService';
import type { TokenBucket } from './lib/http';

export interface ContainerDeps {
  env: Env;
  db: Firestore;
  auth: Auth;
  /** Injected in tests to mock every Steam HTTP call. */
  fetchImpl?: FetchLike;
  limiters?: { web?: TokenBucket; store?: TokenBucket };
  retries?: number;
}

export function createContainer({ env, db, auth, fetchImpl, limiters, retries }: ContainerDeps) {
  const refs = createRefs(db);
  const users = new UserRepository(refs);
  const steamData = new SteamDataRepository(refs);
  const purchases = new PurchaseRepository(refs);
  const hiddenGames = new HiddenGameRepository(refs);
  const appCache = new AppCacheRepository(refs);
  const jobs = new SyncJobRepository(refs);

  const steam = new SteamApiClient({ apiKey: env.STEAM_API_KEY, fetchImpl, limiter: limiters?.web, retries });
  const store = new SteamStoreClient({ fetchImpl, limiter: limiters?.store, retries });

  const library = new LibraryService(users, steamData, purchases, appCache, hiddenGames);
  const profiles = new SteamProfileService(steam, steamData, library);
  const links = new SteamLinkService(refs, steamData, { publicApiUrl: env.PUBLIC_API_URL, fetchImpl });
  const achievements = new AchievementService(steam, appCache, steamData);
  const pricing = new PricingService(store, appCache);
  const sync = new SyncService(refs, users, jobs, steamData, steam, profiles, achievements, pricing, library, {
    achievementBatch: env.SYNC_ACHIEVEMENT_BATCH,
    metadataBatch: env.SYNC_METADATA_BATCH,
  });
  const analytics = new AnalyticsService(library, steamData);
  const account = new AccountService(refs, users, auth);
  const purchaseService = new PurchaseService(purchases, library, users);
  const imports = new ImportService(library, purchases);

  return { env, auth, refs, users, steamData, purchases, hiddenGames, appCache, library, profiles, links, achievements, pricing, sync, analytics, account, purchaseService, imports };
}

export type Container = ReturnType<typeof createContainer>;
