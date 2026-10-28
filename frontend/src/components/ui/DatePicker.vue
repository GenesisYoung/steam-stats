<script setup lang="ts">
/**
 * Accessible date picker (value: "YYYY-MM-DD" or null).
 * Calendar popover with month/year jump, keyboard navigation
 * (arrows, Home/End, PageUp/PageDown, Enter, Escape) and locale-aware labels.
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import AppIcon from './AppIcon.vue';

const model = defineModel<string | null>({ default: null });
const props = withDefaults(defineProps<{ max?: string; min?: string; placeholder?: string; label?: string; clearable?: boolean }>(), {
  clearable: true,
});

const { t, locale } = useI18n();
const open = ref(false);
const root = ref<HTMLElement | null>(null);
const grid = ref<HTMLElement | null>(null);

const pad = (n: number) => String(n).padStart(2, '0');
const toIso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromIso = (s: string | null | undefined) => {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
};
const todayIso = toIso(new Date());

const selected = computed(() => fromIso(model.value));
const focused = ref<Date>(selected.value ?? new Date());
const viewYear = computed(() => focused.value.getFullYear());
const viewMonth = computed(() => focused.value.getMonth());

const disabled = (iso: string) => (props.max !== undefined && iso > props.max) || (props.min !== undefined && iso < props.min);

/** Monday-first for zh-CN, Sunday-first otherwise (falls back when Intl week info is unavailable). */
const firstDay = computed(() => {
  try {
    const info = (new Intl.Locale(locale.value) as Intl.Locale & { weekInfo?: { firstDay: number }; getWeekInfo?: () => { firstDay: number } });
    const fd = info.getWeekInfo?.().firstDay ?? info.weekInfo?.firstDay;
    if (fd) return fd % 7;
  } catch {
    /* ignore */
  }
  return locale.value.startsWith('zh') ? 1 : 0;
});

const weekdays = computed(() => {
  const fmt = new Intl.DateTimeFormat(locale.value, { weekday: 'narrow' });
  const longFmt = new Intl.DateTimeFormat(locale.value, { weekday: 'long' });
  // 2024-01-07 was a Sunday.
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(2024, 0, 7 + ((i + firstDay.value) % 7));
    return { short: fmt.format(d), long: longFmt.format(d) };
  });
});

const weeks = computed(() => {
  const first = new Date(viewYear.value, viewMonth.value, 1);
  const offset = (first.getDay() - firstDay.value + 7) % 7;
  const start = new Date(viewYear.value, viewMonth.value, 1 - offset);
  return Array.from({ length: 6 }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => {
      const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + d);
      const iso = toIso(date);
      return { date, iso, day: date.getDate(), inMonth: date.getMonth() === viewMonth.value, disabled: disabled(iso) };
    }),
  );
});

const monthNames = computed(() => {
  const fmt = new Intl.DateTimeFormat(locale.value, { month: 'long' });
  return Array.from({ length: 12 }, (_, m) => fmt.format(new Date(2024, m, 1)));
});
const maxYear = computed(() => (props.max ? Number(props.max.slice(0, 4)) : new Date().getFullYear() + 1));
const years = computed(() => {
  const min = props.min ? Number(props.min.slice(0, 4)) : 2003; // Steam launched in 2003
  return Array.from({ length: maxYear.value - min + 1 }, (_, i) => maxYear.value - i);
});

const display = computed(() =>
  selected.value ? new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium' }).format(selected.value) : '',
);
const fullLabel = (d: Date) => new Intl.DateTimeFormat(locale.value, { dateStyle: 'full' }).format(d);

function setFocused(d: Date) {
  focused.value = d;
  void nextTick(() => grid.value?.querySelector<HTMLElement>('[data-focused="true"]')?.focus());
}

function shiftMonth(delta: number) {
  const d = focused.value;
  const target = new Date(d.getFullYear(), d.getMonth() + delta, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  setFocused(new Date(target.getFullYear(), target.getMonth(), Math.min(d.getDate(), lastDay)));
}

function jump(year: number, month: number) {
  const lastDay = new Date(year, month + 1, 0).getDate();
  focused.value = new Date(year, month, Math.min(focused.value.getDate(), lastDay));
}

function choose(iso: string) {
  if (disabled(iso)) return;
  model.value = iso;
  close();
}

function toggle() {
  if (open.value) return close();
  focused.value = selected.value ?? fromIso(props.max && todayIso > props.max ? props.max : todayIso)!;
  open.value = true;
  setFocused(focused.value);
}

function close(returnFocus = true) {
  open.value = false;
  if (returnFocus) void nextTick(() => root.value?.querySelector<HTMLElement>('[data-trigger]')?.focus());
}

function onKey(e: KeyboardEvent) {
  const d = focused.value;
  const day = (n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const keys: Record<string, () => void> = {
    ArrowLeft: () => setFocused(day(-1)),
    ArrowRight: () => setFocused(day(1)),
    ArrowUp: () => setFocused(day(-7)),
    ArrowDown: () => setFocused(day(7)),
    Home: () => setFocused(day(-((d.getDay() - firstDay.value + 7) % 7))),
    End: () => setFocused(day(6 - ((d.getDay() - firstDay.value + 7) % 7))),
    PageUp: () => shiftMonth(e.shiftKey ? -12 : -1),
    PageDown: () => shiftMonth(e.shiftKey ? 12 : 1),
    Enter: () => choose(toIso(d)),
    ' ': () => choose(toIso(d)),
    Escape: () => close(),
  };
  const action = keys[e.key];
  if (action) {
    e.preventDefault();
    action();
  }
}

function onOutside(e: PointerEvent) {
  if (open.value && root.value && !root.value.contains(e.target as Node)) close(false);
}
watch(open, (o) => (o ? document.addEventListener('pointerdown', onOutside) : document.removeEventListener('pointerdown', onOutside)));
onBeforeUnmount(() => document.removeEventListener('pointerdown', onOutside));
</script>

<template>
  <div ref="root" class="relative">
    <div class="input flex items-center gap-2 p-0">
      <button
        type="button"
        data-trigger
        class="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left"
        :aria-label="label ? `${label}: ${display || t('datePicker.none')}` : undefined"
        aria-haspopup="dialog"
        :aria-expanded="open"
        @click="toggle"
      >
        <AppIcon name="calendar" :size="16" class="shrink-0 text-muted" />
        <span class="truncate whitespace-nowrap" :class="display ? 'text-fg' : 'text-muted/70'">{{ display || placeholder || t('datePicker.placeholder') }}</span>
      </button>
      <button v-if="clearable && model" type="button" class="mr-1 rounded p-1 text-muted hover:bg-surface-2 hover:text-fg" :aria-label="t('datePicker.clear')" @click="model = null">
        <AppIcon name="close" :size="14" />
      </button>
    </div>

    <Transition name="fade">
      <div
        v-if="open"
        role="dialog"
        :aria-label="t('datePicker.dialog')"
        class="absolute left-0 z-50 mt-2 w-72 rounded-xl border border-line bg-bg-elevated p-3 shadow-xl shadow-black/30"
        @keydown="onKey"
      >
        <div class="mb-2 flex items-center gap-1">
          <button type="button" class="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-fg" :aria-label="t('datePicker.prevMonth')" @click="shiftMonth(-1)">
            <AppIcon name="chevronLeft" :size="16" />
          </button>
          <select
            class="min-w-0 flex-1 rounded-md bg-transparent px-1 py-1 text-sm font-medium hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            :value="viewMonth"
            :aria-label="t('datePicker.month')"
            @change="jump(viewYear, Number(($event.target as HTMLSelectElement).value))"
          >
            <option v-for="(name, m) in monthNames" :key="m" :value="m">{{ name }}</option>
          </select>
          <select
            class="rounded-md bg-transparent px-1 py-1 text-sm font-medium hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            :value="viewYear"
            :aria-label="t('datePicker.year')"
            @change="jump(Number(($event.target as HTMLSelectElement).value), viewMonth)"
          >
            <option v-for="y in years" :key="y" :value="y">{{ y }}</option>
          </select>
          <button type="button" class="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-fg" :aria-label="t('datePicker.nextMonth')" @click="shiftMonth(1)">
            <AppIcon name="chevronRight" :size="16" />
          </button>
        </div>

        <table ref="grid" role="grid" class="w-full table-fixed border-collapse text-center text-sm">
          <thead>
            <tr>
              <th v-for="w in weekdays" :key="w.long" scope="col" :abbr="w.long" class="pb-1 text-xs font-medium text-muted">{{ w.short }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(week, wi) in weeks" :key="wi">
              <td v-for="cell in week" :key="cell.iso" class="p-0.5">
                <button
                  type="button"
                  :tabindex="cell.iso === toIso(focused) ? 0 : -1"
                  :data-focused="cell.iso === toIso(focused)"
                  :aria-label="fullLabel(cell.date)"
                  :aria-selected="cell.iso === model"
                  :aria-current="cell.iso === todayIso ? 'date' : undefined"
                  :disabled="cell.disabled"
                  class="h-8 w-full rounded-lg transition-colors focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-30"
                  :class="[
                    cell.iso === model ? 'bg-accent-strong font-semibold text-white' : 'hover:bg-surface-2',
                    !cell.inMonth && cell.iso !== model ? 'text-muted/60' : '',
                    cell.iso === todayIso && cell.iso !== model ? 'ring-1 ring-accent/60' : '',
                  ]"
                  @click="choose(cell.iso)"
                >
                  {{ cell.day }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>

        <div class="mt-2 flex justify-between border-t border-line pt-2">
          <button type="button" class="rounded-md px-2 py-1 text-sm text-accent hover:bg-surface-2 disabled:opacity-40" :disabled="disabled(todayIso)" @click="choose(todayIso)">
            {{ t('datePicker.today') }}
          </button>
          <button v-if="clearable" type="button" class="rounded-md px-2 py-1 text-sm text-muted hover:bg-surface-2 hover:text-fg" @click="model = null; close()">
            {{ t('datePicker.clear') }}
          </button>
        </div>
      </div>
    </Transition>
  </div>
</template>
