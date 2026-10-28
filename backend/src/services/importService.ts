/**
 * Purchase-history import from a spreadsheet (CSV / Excel).
 *
 * The browser parses the file and sends transactions (date, items, amounts,
 * currency). Here item names are matched to games in the user's synced
 * library, and non-game items (DLC, soundtracks, software, wallet credit,
 * market and in-game purchases, refunds) are classified so the UI can filter
 * them out. Nothing is saved: the user reviews the preview and commits it
 * through PurchaseService.commitImport.
 */
import type {
  ImportItemDto, ImportPreviewDto, ImportPreviewInput, ImportTransactionType,
} from '@steam-analytics/shared';
import type { PurchaseRepository } from '../repositories/purchaseRepository';
import type { LibraryEntry, LibraryService } from './libraryService';

// ---------- Name matching ----------

const EDITION_SUFFIX =
  /\s*[-:–]?\s*\b(standard|deluxe|digital deluxe|gold|ultimate|complete|definitive|premium|collector'?s|enhanced|special|anniversary|game of the year|goty|director'?s cut|remastered)\b(\s+(edition|version|cut))?\s*$/i;

/** Lowercase, drop ™®©, punctuation and repeated whitespace. */
export function normalizeTitle(name: string): string {
  return name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[™®©]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

const NON_GAME_PATTERNS: [RegExp, string][] = [
  [/\b(soundtrack|ost|original score|artbook|art book)\b/i, 'soundtrack'],
  [/\b(season pass|expansion pass|dlc|expansion|add-?on|character pack|costume|skin|bundle pack|upgrade|currency|coins|gems|points|booster)\b/i, 'dlc'],
  [/\b(wallet|gift card|steam card|funds)\b/i, 'wallet_credit'],
  [/\b(demo|playtest|dedicated server|sdk|editor)\b/i, 'software'],
];

const NON_GAME_TYPES: Partial<Record<ImportTransactionType, string>> = {
  refund: 'refund',
  wallet_credit: 'wallet_credit',
  market: 'market',
  in_game_purchase: 'in_game_purchase',
};

export class GameMatcher {
  private exact = new Map<string, LibraryEntry>();
  private loose = new Map<string, LibraryEntry>();

  constructor(entries: LibraryEntry[]) {
    for (const e of entries) {
      const norm = normalizeTitle(e.game.name);
      if (!norm) continue;
      this.exact.set(norm, e);
      const stripped = normalizeTitle(e.game.name.replace(EDITION_SUFFIX, ''));
      if (stripped && !this.loose.has(stripped)) this.loose.set(stripped, e);
    }
  }

  match(name: string): LibraryEntry | null {
    const norm = normalizeTitle(name);
    if (!norm) return null;
    const hit = this.exact.get(norm) ?? this.loose.get(normalizeTitle(name.replace(EDITION_SUFFIX, '')));
    return hit ?? null;
  }
}

export function classifyItem(
  name: string,
  type: ImportTransactionType,
  matcher: GameMatcher,
  recorded: Set<number>,
): Omit<ImportItemDto, 'amount'> {
  const typeReason = NON_GAME_TYPES[type];
  const entry = typeReason ? null : matcher.match(name);
  if (entry) {
    const storeType = entry.meta?.type;
    const isGame = !storeType || storeType === 'game';
    return {
      name,
      appId: entry.game.appId,
      matchedName: entry.game.name,
      kind: isGame ? 'game' : 'non_game',
      reason: isGame ? null : 'software',
      alreadyRecorded: recorded.has(entry.game.appId),
    };
  }
  const patternReason = NON_GAME_PATTERNS.find(([re]) => re.test(name))?.[1];
  const reason = typeReason ?? patternReason ?? null;
  return { name, appId: null, matchedName: null, kind: reason ? 'non_game' : 'unmatched', reason, alreadyRecorded: false };
}

export class ImportService {
  constructor(
    private readonly library: LibraryService,
    private readonly purchases: PurchaseRepository,
  ) {}

  async preview(uid: string, input: ImportPreviewInput): Promise<ImportPreviewDto> {
    const lib = await this.library.load(uid);
    const matcher = new GameMatcher(lib.entries);
    const recorded = new Set((await this.purchases.list(uid)).map((p) => p.appId));
    return {
      transactions: input.transactions.map((t, index) => ({
        key: `t${index}`,
        date: t.date,
        type: t.type,
        total: t.total,
        currency: t.currency,
        source: t.source,
        notes: t.notes,
        items: t.items.map((item) => ({ ...classifyItem(item.name, t.type, matcher, recorded), amount: item.amount })),
      })),
    };
  }
}
