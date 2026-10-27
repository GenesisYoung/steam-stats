import { useI18n } from 'vue-i18n';
import type { CostPerHourDto, CurrencyTotal, Money } from '@steam-analytics/shared';

export function useFormat() {
  const { t, locale } = useI18n();

  const number = (n: number, digits = 0) =>
    new Intl.NumberFormat(locale.value, { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(n);

  const money = (m: Money | null | undefined, digits?: number) => {
    if (!m) return t('common.unavailable');
    try {
      return new Intl.NumberFormat(locale.value, {
        style: 'currency',
        currency: m.currency,
        maximumFractionDigits: digits,
        minimumFractionDigits: digits,
      }).format(m.amount);
    } catch {
      return `${m.amount.toFixed(2)} ${m.currency}`;
    }
  };

  const totals = (list: CurrencyTotal[] | Money[] | null | undefined) =>
    list && list.length > 0 ? list.map((m) => money(m)).join(' + ') : t('common.unavailable');

  const hours = (minutes: number | null | undefined) => {
    if (minutes === null || minutes === undefined) return t('common.unavailable');
    const h = minutes / 60;
    return t('format.hours', { n: number(h, h < 10 ? 1 : 0) });
  };

  const date = (iso: string | null | undefined, withTime = false) =>
    iso
      ? new Intl.DateTimeFormat(locale.value, withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' }).format(new Date(iso))
      : t('common.unavailable');

  const relative = (iso: string | null | undefined) => {
    if (!iso) return t('common.never');
    const diff = (new Date(iso).getTime() - Date.now()) / 1000;
    const rtf = new Intl.RelativeTimeFormat(locale.value, { numeric: 'auto' });
    const abs = Math.abs(diff);
    if (abs < 60) return rtf.format(Math.round(diff), 'second');
    if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
    if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
    return rtf.format(Math.round(diff / 86400), 'day');
  };

  const percent = (n: number | null | undefined, digits = 1) =>
    n === null || n === undefined ? t('common.unavailable') : `${number(n, digits)}%`;

  const costPerHour = (c: CostPerHourDto | null | undefined) => {
    if (!c) return t('common.notRecorded');
    switch (c.status) {
      case 'ok': return t('format.perHour', { value: money(c.value, 2) });
      case 'not_played': return t('cost.notPlayed');
      case 'free': return t('cost.free');
      case 'no_price': return t('common.unavailable');
    }
  };

  return { number, money, totals, hours, date, relative, percent, costPerHour };
}
