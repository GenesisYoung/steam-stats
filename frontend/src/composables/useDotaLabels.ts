import { useI18n } from 'vue-i18n';
import type { DotaInsight } from '@steam-analytics/shared';

/** Localized names for Dota game modes, medals and rule-based insights. */
export function useDotaLabels() {
  const { t, te } = useI18n();

  const gameMode = (id: number) => (te(`dota.mode.m${id}`) ? t(`dota.mode.m${id}`) : t('dota.mode.unknown', { id }));

  const rank = (rankTier: number | null | undefined) => {
    if (!rankTier) return t('dota.rank.none');
    const medal = Math.floor(rankTier / 10);
    const stars = rankTier % 10;
    const name = te(`dota.rank.m${medal}`) ? t(`dota.rank.m${medal}`) : t('dota.rank.none');
    return stars > 0 ? `${name} ${stars}` : name;
  };

  const benchmark = (key: string) => (te(`dota.benchmark.${key}`) ? t(`dota.benchmark.${key}`) : key);

  const insight = (i: DotaInsight) => {
    const values: Record<string, string | number> = { ...i.values };
    if (typeof values.metric === 'string') values.metric = benchmark(values.metric);
    if (typeof values.best === 'string') values.best = t(`dota.duration.${values.best}`);
    if (typeof values.worst === 'string') values.worst = t(`dota.duration.${values.worst}`);
    return t(`dota.insight.${i.code}`, values);
  };

  return { gameMode, rank, benchmark, insight };
}
