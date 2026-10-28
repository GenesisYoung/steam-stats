/**
 * Purchase-history import from a screenshot.
 *
 * 1. A ScreenshotReader (Claude vision with structured output) extracts the
 *    rows: date, item names, transaction type, total and currency.
 * 2. Item names are matched to games in the user's synced library.
 * 3. Non-game items (DLC, soundtracks, software, wallet credit, market and
 *    in-game purchases, refunds) are classified so the UI can filter them out.
 *
 * Nothing is saved here: the user reviews the preview and commits it through
 * PurchaseService.commitImport. The image is never stored.
 */
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import {
  CURRENCIES, type CurrencyCode, type ImportItemDto, type ImportPreviewDto, type ImportTransactionDto,
  type ImportTransactionType,
} from '@steam-analytics/shared';
import { errors } from '../lib/errors';
import { logger } from '../lib/logger';
import type { PurchaseRepository } from '../repositories/purchaseRepository';
import type { LibraryEntry, LibraryService } from './libraryService';

export type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';

const TRANSACTION_TYPES = ['purchase', 'gift_purchase', 'refund', 'wallet_credit', 'market', 'in_game_purchase', 'other'] as const;

/** Shape Claude must return (enforced by structured outputs). */
export const extractedHistorySchema = z.object({
  is_purchase_history: z.boolean().describe('True if the image shows a list of purchases, orders or receipts'),
  rows: z.array(
    z.object({
      date: z.string().nullable().describe('Transaction date as YYYY-MM-DD, or null if not visible'),
      items: z.array(z.string()).describe('Each item name exactly as written, one entry per product'),
      type: z.enum(TRANSACTION_TYPES),
      total: z.number().nullable().describe('Amount paid in major currency units (e.g. 19.99), or null if not visible'),
      currency: z.string().nullable().describe('ISO 4217 code, or null if it cannot be determined with confidence'),
    }),
  ),
});
export type ExtractedHistory = z.infer<typeof extractedHistorySchema>;

export interface ScreenshotReader {
  read(image: Buffer, mediaType: ImageMediaType): Promise<ExtractedHistory>;
}

const SYSTEM_PROMPT = `You extract purchase records from screenshots of game store purchase histories, most often Steam's "Purchase History" page (columns: Date, Items, Type, Total, Wallet Change), but also order lists or receipts from other stores.

Return one row per transaction, top to bottom, exactly as shown:
- items: every product name listed in that transaction, copied verbatim (keep edition names, keep "Soundtrack", "DLC", "Season Pass" and similar words). A transaction that lists several games is still one row with several items.
- type: "purchase" for normal purchases, "gift_purchase" when it was bought as a gift, "refund" for refunds or reversed purchases, "wallet_credit" for adding funds or gift cards, "market" for Community Market activity, "in_game_purchase" for microtransactions, otherwise "other".
- total: the amount actually paid for that transaction as a plain number in major units. Use the "Total" column, not the wallet balance.
- currency: ISO 4217 code. Infer it from the symbol plus context (for example "€" -> EUR, "£" -> GBP, "₩" -> KRW, "R$" -> BRL). Use null when the symbol is ambiguous (such as "¥" or "$" with no other hint).
- date: convert to YYYY-MM-DD; null if not readable.

Only report what is visible. Never guess missing prices, dates or names. Rows cut off at the edge of the image should be skipped. If the image is not a purchase history at all, set is_purchase_history to false and return no rows.`;

export class ClaudeScreenshotReader implements ScreenshotReader {
  private readonly client: Anthropic;

  constructor(apiKey: string, private readonly model: string) {
    this.client = new Anthropic({ apiKey, maxRetries: 2, timeout: 120_000 });
  }

  async read(image: Buffer, mediaType: ImageMediaType): Promise<ExtractedHistory> {
    try {
      const response = await this.client.beta.messages.parse({
        model: this.model,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'medium', format: betaZodOutputFormat(extractedHistorySchema) },
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mediaType, data: image.toString('base64') } },
              { type: 'text', text: 'Extract the purchase records from this screenshot.' },
            ],
          },
        ],
      });
      if (response.stop_reason === 'refusal') throw errors.importFailed('The screenshot could not be processed');
      if (response.stop_reason === 'max_tokens') throw errors.importFailed('The screenshot has too many rows; try a smaller section');
      if (!response.parsed_output) throw errors.importFailed();
      return response.parsed_output;
    } catch (err) {
      if (err instanceof Anthropic.RateLimitError) throw errors.rateLimited('The import service is busy; try again shortly');
      if (err instanceof Anthropic.APIError) {
        logger.error('screenshot import failed', { status: err.status, error: err.message });
        throw errors.importFailed('The import service is temporarily unavailable');
      }
      throw err;
    }
  }
}

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
): ImportItemDto {
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

const VALID_DATE = /^\d{4}-\d{2}-\d{2}$/;
const toCurrency = (c: string | null): CurrencyCode | null => {
  const upper = c?.trim().toUpperCase();
  return upper && (CURRENCIES as readonly string[]).includes(upper) ? (upper as CurrencyCode) : null;
};

export class ImportService {
  constructor(
    private readonly reader: ScreenshotReader | null,
    private readonly library: LibraryService,
    private readonly purchases: PurchaseRepository,
  ) {}

  get available() {
    return this.reader !== null;
  }

  async preview(uid: string, image: Buffer, mediaType: ImageMediaType): Promise<ImportPreviewDto> {
    if (!this.reader) throw errors.importUnavailable();
    const lib = await this.library.load(uid);
    const extracted = await this.reader.read(image, mediaType);
    const matcher = new GameMatcher(lib.entries);
    const recorded = new Set((await this.purchases.list(uid)).map((p) => p.appId));

    const transactions: ImportTransactionDto[] = extracted.rows
      .filter((r) => r.items.some((i) => i.trim()))
      .map((r, index) => ({
        key: `t${index}`,
        date: r.date && VALID_DATE.test(r.date) && !Number.isNaN(Date.parse(r.date)) ? r.date : null,
        type: r.type,
        total: r.total !== null && Number.isFinite(r.total) && r.total >= 0 ? Math.round(r.total * 100) / 100 : null,
        currency: toCurrency(r.currency),
        items: r.items.filter((i) => i.trim()).map((name) => classifyItem(name.trim(), r.type, matcher, recorded)),
      }));
    return { recognized: extracted.is_purchase_history, transactions };
  }
}

/** Detect the real image type from its first bytes (never trust the client's Content-Type alone). */
export function sniffImageType(buf: Buffer): ImageMediaType | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.toString('ascii', 0, 4) === 'GIF8') return 'image/gif';
  return null;
}
