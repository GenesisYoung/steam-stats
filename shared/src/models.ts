/**
 * Firestore document models. Timestamps are `Date` in application code and
 * stored as Firestore `Timestamp` (converted in the backend repositories).
 */
import type {
  CurrencyCode, Language, PurchaseSource, SteamPersonaState, StoreRegion, Theme,
} from './constants';

export interface UserPreferences {
  currency: CurrencyCode;
  language: Language;
  storeRegion: StoreRegion;
  theme: Theme;
  autoSync: boolean;
}

/** users/{uid} */
export interface UserDoc {
  uid: string;
  email: string;
  displayName: string;
  createdAt: Date;
  lastLoginAt: Date;
  steamId: string | null;
  steamLinkedAt: Date | null;
  preferences: UserPreferences;
  /** Incremented whenever library or purchase data changes; used to invalidate server caches. */
  dataVersion: number;
  lastSuccessfulSyncAt: Date | null;
  activeSyncJobId: string | null;
  syncLockExpiresAt: Date | null;
}

export type CommunityVisibility = 'private' | 'friends_only' | 'public';

/** users/{uid}/steamProfile/current */
export interface SteamProfileDoc {
  steamId: string;
  personaName: string;
  avatarUrl: string;
  profileUrl: string;
  personaState: SteamPersonaState;
  communityVisibility: CommunityVisibility;
  /** Steam only returns the current game when the profile's game details are visible. */
  currentGame: { appId: number | null; name: string } | null;
  /** null = Steam did not return a level (e.g. private profile). */
  steamLevel: number | null;
  /** false = GetOwnedGames returned no data (game details private). null = not yet checked. */
  gameDetailsVisible: boolean | null;
  summaryFetchedAt: Date;
  levelFetchedAt: Date | null;
}

export type AchievementDataStatus =
  /** Not yet synchronised. */
  | 'unknown'
  /** Game exposes no achievements. */
  | 'none'
  /** Player achievement data synced. */
  | 'available'
  /** Steam refused player data (private profile / stats). */
  | 'private'
  /** Steam request failed; will be retried. */
  | 'error';

export interface GameAchievementSummary {
  status: AchievementDataStatus;
  total: number | null;
  unlocked: number | null;
  syncedAt: Date | null;
  /** playtime_forever at the time of sync; used to skip unchanged games. */
  syncedAtPlaytime: number | null;
}

/** users/{uid}/games/{appid} */
export interface OwnedGameDoc {
  appId: number;
  name: string;
  iconHash: string | null;
  playtimeForeverMinutes: number;
  /** Steam omits playtime_2weeks when it is zero, so 0 is the correct value then. */
  playtime2WeeksMinutes: number;
  /** null when Steam reports rtime_last_played = 0 / missing. */
  lastPlayedAt: Date | null;
  hasCommunityVisibleStats: boolean | null;
  achievements: GameAchievementSummary;
  updatedAt: Date;
}

/** users/{uid}/hiddenGames/{appid} — user choices kept separately from Steam sync data. */
export interface HiddenGameDoc {
  appId: number;
  excludeFromStats: boolean;
}

/** users/{uid}/games/{appid}/achievements/state */
export interface PlayerAchievementStateDoc {
  appId: number;
  /** apiName → unix seconds (0 when Steam reports unlocked without a timestamp). */
  unlocked: Record<string, number>;
  syncedAt: Date;
}

export type BundleAllocation = 'store_price' | 'even' | 'manual';
export type PurchaseOrigin = 'manual' | 'file_import';

/** Shared by every game bought together in one transaction. */
export interface PurchaseBundleRef {
  id: string;
  /** What was paid for the whole bundle; the games' `amount`s add up to this. */
  total: number;
  itemCount: number;
  allocation: BundleAllocation;
}

/**
 * users/{uid}/gamePurchases/{appid} — user-entered, never verified.
 * For a bundle, `amount` is this game's allocated share of `bundle.total`.
 */
export interface PurchaseDoc {
  appId: number;
  amount: number;
  currency: CurrencyCode;
  purchaseDate: string | null;
  source: PurchaseSource;
  notes: string;
  bundle?: PurchaseBundleRef | null;
  origin?: PurchaseOrigin;
  createdAt: Date;
  updatedAt: Date;
}

/** users/{uid}/playtimeSnapshots/{YYYY-MM-DD} */
export interface PlaytimeSnapshotDoc {
  date: string;
  capturedAt: Date;
  totalMinutes: number;
  /** appid → playtime_forever minutes (only games with playtime > 0). */
  games: Record<string, number>;
}

export type SyncScope = 'profile' | 'full';
export type SyncTrigger = 'manual' | 'link' | 'scheduled';
export type SyncStatus = 'running' | 'succeeded' | 'partial' | 'failed';
export type SyncStage = 'profile' | 'library' | 'achievements' | 'prices' | 'snapshot' | 'done';

/** users/{uid}/syncJobs/{jobId} */
export interface SyncJobDoc {
  id: string;
  scope: SyncScope;
  trigger: SyncTrigger;
  status: SyncStatus;
  stage: SyncStage;
  startedAt: Date;
  finishedAt: Date | null;
  stats: {
    gamesTotal: number;
    gamesWritten: number;
    achievementsSynced: number;
    achievementsRemaining: number;
    pricesUpdated: number;
    pricesRemaining: number;
  };
  error: { code: string; message: string } | null;
}

/** steamLinks/{steamId64} — enforces one platform account per SteamID. */
export interface SteamLinkDoc {
  steamId: string;
  uid: string;
  linkedAt: Date;
}

/** linkSessions/{sha256(state)} */
export interface LinkSessionDoc {
  uid: string;
  createdAt: Date;
  expiresAt: Date;
  used: boolean;
}

/** openidNonces/{sha256(nonce)} */
export interface OpenIdNonceDoc {
  steamId: string;
  expiresAt: Date;
}

/** steamApps/{appid} — shared, server-managed. */
export interface AppMetadataDoc {
  appId: number;
  /** Steam store type: game, dlc, demo, application, music, … null = unknown. */
  type: string | null;
  isFree: boolean | null;
  name: string | null;
  /** Store-provided cover URL, including the asset hash. Undefined on older cached documents. */
  headerImageUrl?: string | null;
  /** 'unavailable' = store returned success:false (delisted or region-locked). */
  storeStatus: 'ok' | 'unavailable';
  fetchedAt: Date;
}

/** Effective price status shown to users (combines store price + app metadata). */
export type PriceStatus = 'priced' | 'free' | 'unavailable';

/**
 * Raw result of the batched store price lookup:
 * - priced: price_overview present
 * - no_price: app exists but has no price_overview (free, or not sold) — resolved via AppMetadataDoc.isFree
 * - unavailable: store returned success:false (delisted / not available in region)
 */
export type StorePriceStatus = 'priced' | 'no_price' | 'unavailable';

/** steamApps/{appid}/prices/{cc} */
export interface AppPriceDoc {
  appId: number;
  region: string;
  status: StorePriceStatus;
  currency: string | null;
  initialMinor: number | null;
  finalMinor: number | null;
  discountPercent: number | null;
  fetchedAt: Date;
}

export interface AchievementDefinition {
  apiName: string;
  displayName: string;
  description: string | null;
  icon: string | null;
  iconGray: string | null;
  hidden: boolean;
}

/** steamApps/{appid}/schemas/{lang} */
export interface AchievementSchemaDoc {
  appId: number;
  language: string;
  achievements: AchievementDefinition[];
  /** apiName → global unlock percentage. null = Steam did not provide data. */
  globalPercentages: Record<string, number> | null;
  fetchedAt: Date;
}
