/**
 * Client-side parsing of purchase-history spreadsheets (CSV / Excel).
 * The file never leaves the browser; only the parsed transactions are sent
 * to the server for matching against the user's library.
 */
import {
  CURRENCIES, IMPORT_TRANSACTION_TYPES,
  type CurrencyCode, type ImportPreviewInput, type ImportTransactionType, type PurchaseSource,
} from '@steam-analytics/shared';

export type Cell = string | number | boolean | Date | null;
export type Table = Cell[][];

export const IMPORT_FIELDS = ['date', 'item', 'amount', 'currency', 'order', 'type', 'source', 'notes'] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
export type ColumnMapping = Record<ImportField, number | null>;

export type DateFormat = 'auto' | 'ymd' | 'dmy' | 'mdy';
/** "item": each row's amount is that item's price. "transaction": the amount is the order total. */
export type AmountMode = 'item' | 'transaction';

export interface ParseOptions {
  hasHeader: boolean;
  dateFormat: DateFormat;
  amountMode: AmountMode;
  defaultCurrency: CurrencyCode;
}

export const MAX_FILE_BYTES = 10 * 1024 * 1024;

// ---------- Reading files ----------

export async function readTable(file: File): Promise<Table> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.xlsx')) {
    const { readSheet } = await import('read-excel-file/browser');
    const rows = await readSheet(file);
    return rows.map((r) => r.map((c) => (c instanceof Date ? c : (c as Cell))));
  }
  if (name.endsWith('.csv') || name.endsWith('.tsv') || name.endsWith('.txt') || file.type === 'text/csv') {
    const Papa = (await import('papaparse')).default;
    const text = await file.text();
    const result = Papa.parse<string[]>(text.replace(/^﻿/, ''), { skipEmptyLines: 'greedy' });
    return result.data;
  }
  throw new Error('unsupported');
}

// ---------- Column detection ----------

const SYNONYMS: Record<ImportField, string[]> = {
  date: ['date', 'purchase date', 'order date', 'purchased', 'bought', 'time', '日期', '购买日期', '下单日期', '时间'],
  item: ['item', 'items', 'game', 'games', 'title', 'name', 'product', 'app', '游戏', '名称', '商品', '项目', '物品'],
  amount: ['amount', 'price', 'total', 'cost', 'paid', 'price paid', 'subtotal', '金额', '价格', '总价', '实付', '花费', '支付'],
  currency: ['currency', 'curr', 'ccy', '货币', '币种'],
  order: ['order', 'order id', 'order number', 'transaction', 'transaction id', 'bundle', 'bundle id', 'receipt', 'invoice', '订单', '订单号', '交易', '交易号', '捆绑包'],
  type: ['type', 'transaction type', 'kind', '类型', '交易类型'],
  source: ['source', 'store', 'platform', 'shop', 'vendor', 'seller', '来源', '平台', '商店', '渠道'],
  notes: ['notes', 'note', 'comment', 'comments', 'memo', 'remarks', '备注', '说明'],
};

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ');

/** Guess which column holds which field from the header row. */
export function detectMapping(header: Cell[]): ColumnMapping {
  const mapping = Object.fromEntries(IMPORT_FIELDS.map((f) => [f, null])) as ColumnMapping;
  const used = new Set<number>();
  for (const field of IMPORT_FIELDS) {
    const names = SYNONYMS[field];
    let idx = header.findIndex((h, i) => !used.has(i) && names.includes(norm(h)));
    if (idx < 0) idx = header.findIndex((h, i) => !used.has(i) && names.some((n) => n.length > 3 && norm(h).includes(n)));
    if (idx >= 0) {
      mapping[field] = idx;
      used.add(idx);
    }
  }
  return mapping;
}

/** A first row is a header when it contains a recognisable column name. */
export function looksLikeHeader(row: Cell[]): boolean {
  return row.some((c) => typeof c === 'string' && IMPORT_FIELDS.some((f) => SYNONYMS[f].includes(norm(c))));
}

// ---------- Values ----------

const pad = (n: number) => String(n).padStart(2, '0');
const validYmd = (y: number, m: number, d: number) => {
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1 ? `${y}-${pad(m)}-${pad(d)}` : null;
};
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const monthIndex = (s: string) => MONTHS.indexOf(s.slice(0, 3).toLowerCase()) + 1;

/** Parse a date cell to YYYY-MM-DD. Numeric dates use `format` when the order is ambiguous. */
export function parseDate(cell: Cell, format: DateFormat = 'auto'): string | null {
  if (cell instanceof Date) {
    // Excel dates are read as UTC midnight.
    return Number.isNaN(cell.getTime()) ? null : validYmd(cell.getUTCFullYear(), cell.getUTCMonth() + 1, cell.getUTCDate());
  }
  if (typeof cell === 'number') {
    // Excel serial date (days since 1899-12-30) stored as a plain number.
    if (cell > 20000 && cell < 80000) {
      const d = new Date(Date.UTC(1899, 11, 30) + Math.round(cell) * 86_400_000);
      return validYmd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    }
    return null;
  }
  const s = String(cell ?? '').trim();
  if (!s) return null;
  let m = /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/.exec(s);
  if (m) return validYmd(+m[1]!, +m[2]!, +m[3]!);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/.exec(s);
  if (m) {
    const a = +m[1]!;
    const b = +m[2]!;
    const y = m[3]!.length === 2 ? 2000 + +m[3]! : +m[3]!;
    const order = format === 'dmy' || format === 'mdy' ? format : a > 12 ? 'dmy' : b > 12 ? 'mdy' : 'mdy';
    return order === 'dmy' ? validYmd(y, b, a) : validYmd(y, a, b);
  }
  // "27 Oct, 2026" (Steam) or "Oct 27, 2026"
  m = /^(\d{1,2})\s+([A-Za-z]{3,})\.?,?\s+(\d{4})/.exec(s);
  if (m && monthIndex(m[2]!) > 0) return validYmd(+m[3]!, monthIndex(m[2]!), +m[1]!);
  m = /^([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})/.exec(s);
  if (m && monthIndex(m[1]!) > 0) return validYmd(+m[3]!, monthIndex(m[1]!), +m[2]!);
  return null;
}

const CURRENCY_SYMBOLS: [RegExp, CurrencyCode][] = [
  [/R\$/, 'BRL'], [/HK\$/, 'HKD'], [/NT\$/, 'TWD'], [/A\$|AU\$/, 'AUD'], [/C\$|CA\$/, 'CAD'], [/NZ\$/, 'NZD'], [/S\$/, 'SGD'],
  [/MX\$/, 'MXN'], [/€/, 'EUR'], [/£/, 'GBP'], [/₩/, 'KRW'], [/₹/, 'INR'], [/₽/, 'RUB'], [/₺/, 'TRY'], [/₴/, 'UAH'], [/zł/i, 'PLN'],
  [/元|人民币|CN¥|RMB/i, 'CNY'], [/円|JP¥/, 'JPY'],
];

/** Currency written in a cell ("USD", "€", "R$"), or null. "$" and "¥" alone are ambiguous. */
export function parseCurrency(cell: Cell): CurrencyCode | null {
  const s = String(cell ?? '').trim();
  if (!s) return null;
  const code = /\b([A-Z]{3})\b/.exec(s.toUpperCase())?.[1];
  if (code && (CURRENCIES as readonly string[]).includes(code)) return code as CurrencyCode;
  return CURRENCY_SYMBOLS.find(([re]) => re.test(s))?.[1] ?? null;
}

/** Parse "1,234.56", "1.234,56", "$59.99", "59,99 €", "(10.00)" or a number. Returns null if not a number. */
export function parseAmount(cell: Cell): number | null {
  if (typeof cell === 'number') return Number.isFinite(cell) ? cell : null;
  let s = String(cell ?? '').trim();
  if (!s) return null;
  const negative = /^\(.*\)$/.test(s) || /^-|-$|−/.test(s);
  s = s.replace(/[^\d.,]/g, '');
  if (!/\d/.test(s)) return null;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma >= 0) {
    s = /,\d{1,2}$/.test(s) && s.split(',').length === 2 ? s.replace(',', '.') : s.replace(/,/g, '');
  } else if ((s.match(/\./g) ?? []).length > 1) {
    s = s.replace(/\./g, '');
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

/** Several items in one cell, separated by new lines or semicolons. */
export const splitItems = (cell: Cell) =>
  String(cell ?? '')
    .split(/\r?\n|;|；|\|/)
    .map((s) => s.trim())
    .filter(Boolean);

export function parseType(cell: Cell): ImportTransactionType | null {
  const s = norm(cell);
  if (!s) return null;
  if ((IMPORT_TRANSACTION_TYPES as readonly string[]).includes(s.replace(/ /g, '_'))) return s.replace(/ /g, '_') as ImportTransactionType;
  if (/refund|退款|退货/.test(s)) return 'refund';
  if (/gift|礼物/.test(s)) return 'gift_purchase';
  if (/wallet|充值|钱包|gift card/.test(s)) return 'wallet_credit';
  if (/market|市场/.test(s)) return 'market';
  if (/in game|in-game|microtransaction|游戏内/.test(s)) return 'in_game_purchase';
  if (/purchase|buy|bought|order|购买/.test(s)) return 'purchase';
  return null;
}

export function parseSource(cell: Cell): PurchaseSource | null {
  const s = norm(cell);
  if (!s) return null;
  if (/gift|礼物/.test(s)) return 'steam_gift';
  if (/humble|fanatical|indiegala|bundle|捆绑/.test(s)) return 'bundle';
  if (/key|g2a|cdkeys|eneba|kinguin|gamivo|激活码/.test(s)) return 'key_store';
  if (/game pass|subscription|ea play|ubisoft\+|订阅/.test(s)) return 'subscription';
  if (/free|giveaway|免费|赠送/.test(s)) return 'free';
  if (/retail|disc|physical|实体/.test(s)) return 'retail';
  if (/steam/.test(s)) return 'steam';
  return 'other';
}

// ---------- Rows -> transactions ----------

export interface ParseResult {
  input: ImportPreviewInput;
  /** Data rows skipped because they had no item name. */
  skippedRows: number;
  /** Rows whose date could not be read. */
  unreadableDates: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Group rows into transactions. Rows with the same order ID form one
 * transaction (a bundle when it has several games); a cell listing several
 * items also forms one transaction. Rows without an order ID stand alone.
 */
export function buildTransactions(table: Table, mapping: ColumnMapping, opts: ParseOptions): ParseResult {
  const rows = opts.hasHeader ? table.slice(1) : table;
  const get = (row: Cell[], f: ImportField) => (mapping[f] === null ? null : row[mapping[f]!] ?? null);
  const groups = new Map<string, Cell[][]>();
  let skippedRows = 0;
  let unreadableDates = 0;

  rows.forEach((row, i) => {
    if (splitItems(get(row, 'item')).length === 0) {
      if (row.some((c) => c !== null && String(c).trim() !== '')) skippedRows += 1;
      return;
    }
    const order = String(get(row, 'order') ?? '').trim();
    const key = order ? `o:${order}` : `r:${i}`;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  });

  const transactions: ImportPreviewInput['transactions'] = [];
  for (const groupRows of groups.values()) {
    const items: { name: string; amount: number | null }[] = [];
    let total = 0;
    let anyAmount = false;
    let negative = false;
    let date: string | null = null;
    let currency: CurrencyCode | null = null;
    let type: ImportTransactionType | null = null;
    let source: PurchaseSource | null = null;
    const notes: string[] = [];

    for (const row of groupRows) {
      const names = splitItems(get(row, 'item'));
      const rawAmount = get(row, 'amount');
      const amount = parseAmount(rawAmount);
      if (amount !== null && amount < 0) negative = true;
      const abs = amount === null ? null : Math.abs(amount);
      if (abs !== null) {
        if (opts.amountMode === 'item' || !anyAmount) total += abs;
        anyAmount = true;
      }
      // A per-item price is only known when the row names exactly one item.
      const perItem = opts.amountMode === 'item' && names.length === 1 ? abs : null;
      names.forEach((name) => items.push({ name: name.slice(0, 300), amount: perItem === null ? null : round2(perItem) }));

      const d = parseDate(get(row, 'date'), opts.dateFormat);
      if (!d && get(row, 'date') !== null && String(get(row, 'date')).trim()) unreadableDates += 1;
      date ??= d;
      currency ??= parseCurrency(get(row, 'currency')) ?? parseCurrency(rawAmount);
      type ??= parseType(get(row, 'type'));
      source ??= parseSource(get(row, 'source'));
      const note = String(get(row, 'notes') ?? '').trim();
      if (note && !notes.includes(note)) notes.push(note);
    }

    transactions.push({
      date,
      type: type ?? (negative ? 'refund' : 'purchase'),
      total: anyAmount ? Math.min(round2(total), 100_000) : null,
      currency: currency ?? (anyAmount ? opts.defaultCurrency : null),
      source: source ?? (type === 'gift_purchase' ? 'steam_gift' : null),
      notes: notes.join(' · ').slice(0, 500),
      items: items.slice(0, 100),
    });
  }
  return { input: { transactions }, skippedRows, unreadableDates };
}

// ---------- Template ----------

export const TEMPLATE_CSV = [
  'date,item,amount,currency,order_id,source,notes',
  '2024-06-27,Cyberpunk 2077,29.99,USD,,steam,Summer sale',
  '2024-11-28,Portal 2,6.00,USD,VALVE-PACK-1,bundle,Each game has its own price',
  '2024-11-28,Half-Life 2,9.00,USD,VALVE-PACK-1,bundle,Each game has its own price',
  '2025-01-15,"Hades; Celeste",25.00,USD,,steam,Two games in one cell: the total is split by store price',
].join('\n');
