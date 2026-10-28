/**
 * REST API contracts (JSON over HTTP). All timestamps are ISO-8601 strings.
 */
import type { CurrencyCode, ImportTransactionType, PurchaseSource, SteamPersonaState } from './constants';
import type {
  AchievementDataStatus, BundleAllocation, CommunityVisibility, PriceStatus, PurchaseBundleRef, PurchaseOrigin,
  SyncScope, SyncStage, SyncStatus, SyncTrigger, UserPreferences,
} from './models';

export interface ApiSuccess<T> {
  data: T;
  meta?: ApiMeta;
}

export interface ApiMeta {
  /** Time the underlying data was fetched from Steam (cached data is never "real-time"). */
  dataAsOf?: string | null;
  source?: 'live' | 'cache';
  page?: number;
  pageSize?: number;
  total?: number;
}

export type ErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'EMAIL_NOT_VERIFIED'
  | 'RECENT_LOGIN_REQUIRED'
  | 'VALIDATION_FAILED'
  | 'NOT_FOUND'
  | 'STEAM_NOT_LINKED'
  | 'STEAM_ALREADY_LINKED'
  | 'STEAM_PROFILE_PRIVATE'
  | 'STEAM_UNAVAILABLE'
  | 'SYNC_IN_PROGRESS'
  | 'RATE_LIMITED'
  | 'PURCHASE_CONFLICT'
  | 'INTERNAL';

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string; details?: unknown };
}

export interface Money {
  /** Major units (e.g. 59.99). */
  amount: number;
  currency: string;
}

// ---------- Account ----------

export interface MeDto {
  uid: string;
  email: string;
  emailVerified: boolean;
  displayName: string;
  createdAt: string;
  lastLoginAt: string;
  steamId: string | null;
  steamLinkedAt: string | null;
  preferences: UserPreferences;
  lastSuccessfulSyncAt: string | null;
}

// ---------- Steam ----------

export interface SteamAuthStartDto {
  redirectUrl: string;
}

export interface SteamProfileDto {
  steamId: string;
  personaName: string;
  avatarUrl: string;
  profileUrl: string;
  personaState: SteamPersonaState;
  communityVisibility: CommunityVisibility;
  currentGame: { appId: number | null; name: string } | null;
  steamLevel: number | null;
  gameDetailsVisible: boolean | null;
  /** Fetched at; online status is refreshed at most every 60s. */
  summaryFetchedAt: string;
  levelFetchedAt: string | null;
  library: {
    /** null = library unavailable (private / not synced). */
    totalGames: number | null;
    totalPlaytimeMinutes: number | null;
    totalAchievementsUnlocked: number | null;
    gamesWithAchievementData: number;
    estimatedValue: CurrencyTotal[] | null;
    recentGames: RecentGameDto[];
  };
}

export interface RecentGameDto {
  appId: number;
  name: string;
  coverUrl: string;
  playtime2WeeksMinutes: number;
  playtimeForeverMinutes: number;
}

export interface PriceDto {
  status: PriceStatus | 'unknown';
  price: Money | null;
  initialPrice: Money | null;
  discountPercent: number | null;
  region: string;
  fetchedAt: string | null;
}

export type CostPerHourDto =
  | { status: 'ok'; value: Money }
  | { status: 'not_played' }
  | { status: 'free' }
  | { status: 'no_price' };

export interface GameAchievementSummaryDto {
  status: AchievementDataStatus;
  total: number | null;
  unlocked: number | null;
  /** 0–100, null when unknown. */
  percent: number | null;
}

export interface PurchaseDto {
  appId: number;
  /** Game name from the synced library (null if the game is no longer in it). */
  gameName: string | null;
  amount: number;
  currency: CurrencyCode;
  purchaseDate: string | null;
  source: PurchaseSource;
  notes: string;
  bundle: PurchaseBundleRef | null;
  origin: PurchaseOrigin;
  createdAt: string;
  updatedAt: string;
  /** Always true: purchases are entered by the user and are not verified. */
  userEntered: true;
}

export interface BundleDto {
  id: string;
  total: number;
  currency: CurrencyCode;
  purchaseDate: string | null;
  source: PurchaseSource;
  notes: string;
  allocation: BundleAllocation;
  origin: PurchaseOrigin;
  items: { appId: number; name: string; amount: number }[];
}

// ---------- Spreadsheet (CSV / Excel) import ----------

export type ImportItemKind = 'game' | 'non_game' | 'unmatched';

export interface ImportItemDto {
  /** Item name as written in the file. */
  name: string;
  /** This item's own price when the file gives one per item (bundles with known shares). */
  amount: number | null;
  /** Owned game this item was matched to (by name). */
  appId: number | null;
  matchedName: string | null;
  kind: ImportItemKind;
  /** Why a non-game item was filtered (dlc, soundtrack, software, wallet_credit, refund, …). */
  reason: string | null;
  /** The matched game already has a purchase record. */
  alreadyRecorded: boolean;
}

export interface ImportTransactionDto {
  key: string;
  date: string | null;
  type: ImportTransactionType;
  total: number | null;
  /** null when the currency could not be read or is not supported. */
  currency: CurrencyCode | null;
  source: PurchaseSource | null;
  notes: string;
  items: ImportItemDto[];
}

export interface ImportPreviewDto {
  transactions: ImportTransactionDto[];
}

export interface ImportCommitResultDto {
  created: number;
  bundlesCreated: number;
  skipped: number;
}

export interface GameListItemDto {
  appId: number;
  hidden: boolean;
  excludedFromStats: boolean;
  name: string;
  coverUrl: string;
  iconUrl: string | null;
  playtimeForeverMinutes: number;
  playtimeHours: number;
  playtime2WeeksMinutes: number;
  lastPlayedAt: string | null;
  achievements: GameAchievementSummaryDto;
  price: PriceDto;
  estimatedCostPerHour: CostPerHourDto;
  purchase: Pick<PurchaseDto, 'amount' | 'currency'> | null;
  actualCostPerHour: CostPerHourDto | null;
}

export interface GameDetailDto extends GameListItemDto {
  storeType: string | null;
  purchaseRecord: PurchaseDto | null;
  storeUrl: string;
}

export interface AchievementDto {
  apiName: string;
  displayName: string;
  description: string | null;
  iconUrl: string | null;
  hidden: boolean;
  unlocked: boolean;
  /** null when locked or Steam did not provide a timestamp. */
  unlockedAt: string | null;
  /** Global unlock percentage across all Steam players. */
  globalPercent: number | null;
}

export interface GameAchievementsDto {
  appId: number;
  status: AchievementDataStatus;
  total: number;
  unlocked: number;
  percent: number | null;
  achievements: AchievementDto[];
  syncedAt: string | null;
}

export interface SyncJobDto {
  id: string;
  scope: SyncScope;
  trigger: SyncTrigger;
  status: SyncStatus;
  stage: SyncStage;
  startedAt: string;
  finishedAt: string | null;
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

export interface SyncStatusDto {
  active: SyncJobDto | null;
  latest: SyncJobDto | null;
  lastSuccessfulSyncAt: string | null;
}

// ---------- Analytics ----------

export interface CurrencyTotal {
  currency: string;
  amount: number;
  count: number;
}

export interface TopGameDto {
  appId: number;
  name: string;
  playtimeMinutes: number;
  /** Percentage of total library playtime (0–100). */
  share: number;
}

export interface OverviewDto {
  totalGames: number;
  playedGames: number;
  unplayedGames: number;
  totalPlaytimeMinutes: number;
  averagePlaytimePerPlayedGameMinutes: number | null;
  mostPlayed: TopGameDto | null;
  achievements: AchievementTotalsDto;
  libraryValue: LibraryValueSummary;
  recordedSpending: CurrencyTotal[];
  averageEstimatedCostPerHour: Money[];
  averageActualCostPerHour: Money[];
  mostExpensive: GameValueDto[];
  bestValue: GameValueDto[];
}

export interface AchievementTotalsDto {
  totalUnlocked: number;
  totalAvailable: number;
  /** Based only on games with known achievement data. null if none. */
  completionRate: number | null;
  gamesWithData: number;
  gamesWithoutAchievements: number;
  gamesPendingSync: number;
  gamesPrivateOrError: number;
  perfectGames: number;
}

export interface PlaytimeAnalyticsDto {
  totalPlaytimeMinutes: number;
  totalPlaytimeHours: number;
  playedGames: number;
  unplayedGames: number;
  averagePlaytimePerPlayedGameMinutes: number | null;
  mostPlayed: TopGameDto | null;
  top10: TopGameDto[];
  distribution: { bucket: string; minHours: number; maxHours: number | null; count: number }[];
  /** Differences between consecutive stored snapshots (tracking start onwards only). */
  trend: {
    trackingStartedAt: string | null;
    daily: { date: string; minutes: number }[];
    monthly: { month: string; minutes: number }[];
  };
}

export interface AchievementAnalyticsDto extends AchievementTotalsDto {
  byGame: { appId: number; name: string; unlocked: number; total: number; percent: number }[];
}

export interface LibraryValueSummary {
  region: string;
  totals: CurrencyTotal[];
  pricedGames: number;
  freeGames: number;
  unavailableGames: number;
  unknownGames: number;
  /** Owned apps whose store type is not "game" (software, tools, demos); excluded from totals. */
  excludedNonGames: number;
  lastPriceUpdateAt: string | null;
}

export interface GameValueDto {
  appId: number;
  name: string;
  price: Money;
  playtimeMinutes: number;
  costPerHour: CostPerHourDto;
}

export interface LibraryValueDto {
  estimated: LibraryValueSummary;
  recorded: {
    totals: CurrencyTotal[];
    /** Transactions: a bundle counts once. */
    purchaseCount: number;
    bundleCount: number;
    /** Purchases are user-entered and not verified. */
    disclaimer: 'user_entered_unverified';
  };
  mostExpensive: GameValueDto[];
}

export interface CostEfficiencyItemDto {
  appId: number;
  name: string;
  playtimeMinutes: number;
  estimated: CostPerHourDto;
  estimatedPrice: Money | null;
  actual: CostPerHourDto | null;
  actualPrice: Money | null;
}

export interface CostEfficiencyDto {
  basis: 'estimated' | 'actual';
  items: CostEfficiencyItemDto[];
  lowest: CostEfficiencyItemDto[];
  highest: CostEfficiencyItemDto[];
  averages: { estimated: Money[]; actual: Money[] };
  notPlayedCount: number;
  noPriceCount: number;
}
