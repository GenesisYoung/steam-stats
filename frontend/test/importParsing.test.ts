import { describe, expect, it } from 'vitest';
import {
  TEMPLATE_CSV, buildTransactions, detectMapping, looksLikeHeader, parseAmount, parseCurrency, parseDate, parseType,
  splitItems, type ParseOptions, type Table,
} from '../src/lib/importParsing';
import Papa from 'papaparse';

const opts: ParseOptions = { hasHeader: true, dateFormat: 'auto', amountMode: 'item', defaultCurrency: 'USD' };

describe('parseDate', () => {
  it('reads common formats', () => {
    expect(parseDate('2024-06-27')).toBe('2024-06-27');
    expect(parseDate('2024/6/7')).toBe('2024-06-07');
    expect(parseDate('2024年6月7日')).toBe('2024-06-07');
    expect(parseDate('27 Oct, 2026')).toBe('2026-10-27');
    expect(parseDate('Oct 27, 2026')).toBe('2026-10-27');
    expect(parseDate('27/10/2026')).toBe('2026-10-27');
    expect(parseDate('10/27/2026')).toBe('2026-10-27');
    expect(parseDate(new Date(Date.UTC(2024, 1, 29)))).toBe('2024-02-29');
    expect(parseDate(45470)).toBe('2024-06-27');
  });

  it('uses the chosen order for ambiguous dates and rejects invalid ones', () => {
    expect(parseDate('03/04/2025', 'mdy')).toBe('2025-03-04');
    expect(parseDate('03/04/2025', 'dmy')).toBe('2025-04-03');
    expect(parseDate('2025-02-30')).toBeNull();
    expect(parseDate('yesterday')).toBeNull();
    expect(parseDate(12)).toBeNull();
  });
});

describe('parseAmount / parseCurrency', () => {
  it('handles symbols and separators', () => {
    expect(parseAmount('$59.99')).toBe(59.99);
    expect(parseAmount('1,234.56')).toBe(1234.56);
    expect(parseAmount('1.234,56 €')).toBe(1234.56);
    expect(parseAmount('59,99')).toBe(59.99);
    expect(parseAmount('¥1,280')).toBe(1280);
    expect(parseAmount('(10.00)')).toBe(-10);
    expect(parseAmount(19.5)).toBe(19.5);
    expect(parseAmount('free')).toBeNull();
  });

  it('detects currencies but not ambiguous symbols', () => {
    expect(parseCurrency('usd')).toBe('USD');
    expect(parseCurrency('59,99 €')).toBe('EUR');
    expect(parseCurrency('R$ 20')).toBe('BRL');
    expect(parseCurrency('¥1,280')).toBeNull();
    expect(parseCurrency('$5')).toBeNull();
  });
});

describe('column detection', () => {
  it('maps English and Chinese headers', () => {
    expect(detectMapping(['Date', 'Game', 'Price Paid', 'Currency', 'Order ID', 'Store', 'Notes'])).toEqual({
      date: 0, item: 1, amount: 2, currency: 3, order: 4, type: null, source: 5, notes: 6,
    });
    expect(detectMapping(['购买日期', '游戏', '金额', '币种', '订单号'])).toMatchObject({ date: 0, item: 1, amount: 2, currency: 3, order: 4 });
    expect(looksLikeHeader(['2024-01-01', 'Portal 2', 9.99])).toBe(false);
  });
});

describe('buildTransactions', () => {
  const table = Papa.parse<string[]>(TEMPLATE_CSV).data as Table;
  const mapping = detectMapping(table[0]!);

  it('groups the template into single purchases and bundles', () => {
    const { input } = buildTransactions(table, mapping, opts);
    expect(input.transactions).toHaveLength(3);
    const [single, orderBundle, cellBundle] = input.transactions;
    expect(single).toMatchObject({ date: '2024-06-27', total: 29.99, currency: 'USD', source: 'steam', items: [{ name: 'Cyberpunk 2077', amount: 29.99 }] });
    expect(orderBundle).toMatchObject({ total: 15, source: 'bundle', items: [{ name: 'Portal 2', amount: 6 }, { name: 'Half-Life 2', amount: 9 }] });
    expect(cellBundle).toMatchObject({ total: 25, items: [{ name: 'Hades', amount: null }, { name: 'Celeste', amount: null }] });
  });

  it('treats the amount as the order total when asked', () => {
    const t: Table = [['date', 'item', 'amount', 'order'], ['2024-01-01', 'A', '20', 'X'], ['2024-01-01', 'B', '20', 'X']];
    const { input } = buildTransactions(t, detectMapping(t[0]!), { ...opts, amountMode: 'transaction' });
    expect(input.transactions[0]).toMatchObject({ total: 20, items: [{ name: 'A', amount: null }, { name: 'B', amount: null }] });
  });

  it('marks negative amounts as refunds and skips rows without items', () => {
    const t: Table = [['date', 'item', 'amount', 'type'], ['2024-01-01', 'A', '-5', ''], ['2024-01-02', '', '3', ''], ['', '', '', '']];
    const r = buildTransactions(t, detectMapping(t[0]!), opts);
    expect(r.input.transactions).toEqual([expect.objectContaining({ type: 'refund', total: 5 })]);
    expect(r.skippedRows).toBe(1);
  });

  it('reads Steam history style rows with several items in one cell', () => {
    const t: Table = [['Date', 'Items', 'Type', 'Total'], ['27 Oct, 2026', 'Game One\nGame Two', 'Purchase', '€30,00'], ['26 Oct, 2026', 'Wallet Credit', 'Wallet', '€10,00']];
    const { input } = buildTransactions(t, detectMapping(t[0]!), opts);
    expect(input.transactions[0]).toMatchObject({ date: '2026-10-27', currency: 'EUR', total: 30, type: 'purchase', items: [{ name: 'Game One' }, { name: 'Game Two' }] });
    expect(input.transactions[1]).toMatchObject({ type: 'wallet_credit' });
  });

  it('splits item cells', () => {
    expect(splitItems('A; B ；C\nD|E')).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(parseType('Gift Purchase')).toBe('gift_purchase');
  });
});
