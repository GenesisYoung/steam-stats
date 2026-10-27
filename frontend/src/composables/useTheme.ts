import { ref, watchEffect } from 'vue';
import type { Theme } from '@steam-analytics/shared';

const STORAGE_KEY = 'sad.theme';
const media = window.matchMedia('(prefers-color-scheme: dark)');
const systemDark = ref(media.matches);
media.addEventListener('change', (e) => (systemDark.value = e.matches));

const stored = (() => {
  try {
    return localStorage.getItem(STORAGE_KEY) as Theme | null;
  } catch {
    return null;
  }
})();

export const theme = ref<Theme>(stored ?? 'dark');
export const isDark = ref(true);

watchEffect(() => {
  isDark.value = theme.value === 'dark' || (theme.value === 'system' && systemDark.value);
  const root = document.documentElement;
  root.classList.toggle('dark', isDark.value);
  root.classList.toggle('light', !isDark.value);
  try {
    localStorage.setItem(STORAGE_KEY, theme.value);
  } catch {
    /* storage unavailable */
  }
});

export const setTheme = (t: Theme) => (theme.value = t);
