import { describe, expect, it } from 'vitest';
import { allocateBundle, bundleInputSchema, importCommitSchema } from '../src';

const sum = (a: number[]) => Math.round(a.reduce((x, y) => x + y, 0) * 100) / 100;

describe('allocateBundle', () => {
  it('splits by store price and adds up exactly', () => {
    const r = allocateBundle(30, [59.99, 19.99, 9.99]);
    expect(r.method).toBe('store_price');
    expect(r.amounts).toEqual([20, 6.67, 3.33]);
    expect(sum(r.amounts)).toBe(30);
  });

  it('falls back to an even split when a price is unknown', () => {
    const r = allocateBundle(10, [59.99, null, 5]);
    expect(r.method).toBe('even');
    expect(r.amounts).toEqual([3.34, 3.33, 3.33]);
    expect(sum(r.amounts)).toBe(10);
  });

  it('handles zero totals and single items', () => {
    expect(allocateBundle(0, [1, 2]).amounts).toEqual([0, 0]);
    expect(allocateBundle(4.99, [10]).amounts).toEqual([4.99]);
  });

  it('never loses a cent over many items', () => {
    const r = allocateBundle(1, Array.from({ length: 7 }, () => 1));
    expect(sum(r.amounts)).toBe(1);
    expect(Math.max(...r.amounts) - Math.min(...r.amounts)).toBeLessThanOrEqual(0.01 + 1e-9);
  });
});

describe('bundleInputSchema', () => {
  const base = { appIds: [10, 20], total: 30, currency: 'USD' };

  it('applies defaults', () => {
    expect(bundleInputSchema.parse(base)).toMatchObject({ allocation: 'store_price', source: 'bundle', replaceExisting: false });
  });

  it('rejects single-game and duplicate bundles', () => {
    expect(bundleInputSchema.safeParse({ ...base, appIds: [10] }).success).toBe(false);
    expect(bundleInputSchema.safeParse({ ...base, appIds: [10, 10] }).success).toBe(false);
  });

  it('requires manual shares that match the games and add up to the total', () => {
    const manual = { ...base, allocation: 'manual' };
    expect(bundleInputSchema.safeParse(manual).success).toBe(false);
    expect(bundleInputSchema.safeParse({ ...manual, shares: [{ appId: 10, amount: 20 }, { appId: 20, amount: 5 }] }).success).toBe(false);
    expect(bundleInputSchema.safeParse({ ...manual, shares: [{ appId: 10, amount: 20 }, { appId: 99, amount: 10 }] }).success).toBe(false);
    expect(bundleInputSchema.safeParse({ ...manual, shares: [{ appId: 10, amount: 20.01 }, { appId: 20, amount: 9.99 }] }).success).toBe(true);
  });
});

describe('importCommitSchema', () => {
  it('validates reviewed transactions', () => {
    expect(importCommitSchema.safeParse({ transactions: [{ appIds: [10], total: 5, currency: 'EUR', purchaseDate: '2024-01-02' }] }).success).toBe(true);
    expect(importCommitSchema.safeParse({ transactions: [] }).success).toBe(false);
    expect(importCommitSchema.safeParse({ transactions: [{ appIds: [], total: 5, currency: 'EUR' }] }).success).toBe(false);
  });
});
