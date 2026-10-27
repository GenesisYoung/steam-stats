import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '../src/locales/en';
import zhCN from '../src/locales/zh-CN';

type Tree = { [k: string]: string | Tree };

function flatten(tree: Tree, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([k, v]) => (typeof v === 'string' ? [`${prefix}${k}`] : flatten(v, `${prefix}${k}.`)));
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? sourceFiles(p) : /\.(vue|ts)$/.test(f) && !p.includes('locales') ? [p] : [];
  });
}

describe('locales', () => {
  const enKeys = new Set(flatten(en as unknown as Tree));
  const zhKeys = new Set(flatten(zhCN as unknown as Tree));

  it('English and Simplified Chinese have identical keys', () => {
    expect([...enKeys].filter((k) => !zhKeys.has(k))).toEqual([]);
    expect([...zhKeys].filter((k) => !enKeys.has(k))).toEqual([]);
  });

  it('every static key used in the source exists', () => {
    const used = new Set<string>();
    for (const file of sourceFiles(join(__dirname, '../src'))) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/\$?\bte?\(\s*'([a-zA-Z0-9_.-]+)'/g)) used.add(m[1]!);
      for (const m of text.matchAll(/'((?:auth|errors|purchase)\.[a-zA-Z.]+)'/g)) used.add(m[1]!);
    }
    const missing = [...used].filter((k) => k.includes('.') && !enKeys.has(k));
    expect(missing).toEqual([]);
  });

  it('messages avoid characters reserved by vue-i18n', () => {
    for (const key of enKeys) {
      const value = key.split('.').reduce<unknown>((o, k) => (o as Tree)[k], en) as string;
      expect(value, key).not.toMatch(/[@|]/);
    }
  });
});
