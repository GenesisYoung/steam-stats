import { createI18n } from 'vue-i18n';
import type { Language } from '@steam-analytics/shared';
import en from './en';
import zhCN from './zh-CN';

const STORAGE_KEY = 'sad.language';

function initialLocale(): Language {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'en' || stored === 'zh-CN') return stored;
  } catch {
    /* ignore */
  }
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
}

export type MessageSchema = typeof en;

export const i18n = createI18n({
  legacy: false,
  locale: initialLocale(),
  fallbackLocale: 'en',
  messages: { en, 'zh-CN': zhCN },
});

export function setLocale(lang: Language) {
  i18n.global.locale.value = lang;
  document.documentElement.lang = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* ignore */
  }
}
