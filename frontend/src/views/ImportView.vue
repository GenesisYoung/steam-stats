<script setup lang="ts">
/**
 * Import purchase history from a CSV or Excel file:
 * choose file -> map columns -> review matches -> save.
 * The file is parsed in the browser; nothing is saved until the user confirms.
 */
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import {
  CURRENCIES,
  type CurrencyCode, type ImportCommitInput, type ImportCommitResultDto, type ImportPreviewDto, type ImportTransactionDto,
} from '@steam-analytics/shared';
import { api, ApiError } from '@/services/api';
import { useAuthStore } from '@/stores/auth';
import { useFormat } from '@/composables/useFormat';
import { localTodayIso } from '@/composables/dates';
import {
  IMPORT_FIELDS, MAX_FILE_BYTES, TEMPLATE_CSV, buildTransactions, detectMapping, looksLikeHeader, parseDate, readTable,
  type AmountMode, type Cell, type ColumnMapping, type DateFormat, type Table,
} from '@/lib/importParsing';
import SteamRequired from '@/components/steam/SteamRequired.vue';
import DatePicker from '@/components/ui/DatePicker.vue';
import ErrorState from '@/components/ui/ErrorState.vue';
import AppIcon from '@/components/ui/AppIcon.vue';

const { t } = useI18n();
const f = useFormat();
const router = useRouter();
const authStore = useAuthStore();
const todayIso = localTodayIso();
const ACCEPT = '.csv,.tsv,.txt,.xlsx';

// ---- Step 1: file ----
const file = ref<File | null>(null);
const table = ref<Table | null>(null);
const dragging = ref(false);
const fileError = ref<string | null>(null);
const reading = ref(false);

const mapping = ref<ColumnMapping>(Object.fromEntries(IMPORT_FIELDS.map((k) => [k, null])) as ColumnMapping);
const options = reactive({
  hasHeader: true,
  dateFormat: 'auto' as DateFormat,
  amountMode: 'item' as AmountMode,
  defaultCurrency: (authStore.me?.preferences.currency ?? 'USD') as CurrencyCode,
});

async function pick(picked: File | null | undefined) {
  fileError.value = null;
  if (!picked) return;
  if (picked.size > MAX_FILE_BYTES) {
    fileError.value = 'import.tooLarge';
    return;
  }
  reading.value = true;
  try {
    const rows = (await readTable(picked)).filter((r) => r.some((c) => c !== null && String(c).trim() !== ''));
    if (rows.length === 0) {
      fileError.value = 'import.emptyFile';
      return;
    }
    file.value = picked;
    table.value = rows;
    options.hasHeader = looksLikeHeader(rows[0]!);
    mapping.value = options.hasHeader ? detectMapping(rows[0]!) : { ...mapping.value, date: 0, item: 1, amount: 2 };
    preview.value = null;
  } catch (err) {
    fileError.value = (err as Error).message === 'unsupported' ? 'import.badType' : 'import.unreadable';
  } finally {
    reading.value = false;
  }
}
const onDrop = (e: DragEvent) => {
  dragging.value = false;
  void pick(e.dataTransfer?.files[0]);
};

function downloadTemplate() {
  const url = URL.createObjectURL(new Blob([`﻿${TEMPLATE_CSV}\n`], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'steam-analytics-purchases-template.csv';
  a.click();
  URL.revokeObjectURL(url);
}

const columnCount = computed(() => Math.max(0, ...(table.value ?? []).map((r) => r.length)));
const columnLabel = (i: number) => {
  const header = options.hasHeader ? String(table.value?.[0]?.[i] ?? '').trim() : '';
  const letter = String.fromCharCode(65 + (i % 26));
  return header ? `${letter} · ${header}` : t('import.column', { letter });
};
const sampleRows = computed(() => (table.value ?? []).slice(options.hasHeader ? 1 : 0, (options.hasHeader ? 1 : 0) + 5));
const cellText = (c: unknown, col: number) => {
  if (col === mapping.value.date) return parseDate(c as Cell, options.dateFormat) ?? String(c ?? '');
  return c instanceof Date ? c.toISOString().slice(0, 10) : String(c ?? '');
};
const dataRowCount = computed(() => Math.max(0, (table.value?.length ?? 0) - (options.hasHeader ? 1 : 0)));

// ---- Step 2: match ----
interface Row {
  tx: ImportTransactionDto;
  date: string | null;
  total: string;
  currency: CurrencyCode | '';
  selected: Set<number>;
}
const preview = ref<ImportPreviewDto | null>(null);
const parseInfo = ref<{ skippedRows: number; unreadableDates: number } | null>(null);
const rows = ref<Row[]>([]);
const matching = ref(false);
const matchError = ref<unknown>(null);
const hideNonGame = ref(true);

/** When every selected item has its own price, the amount is their sum. */
function syncTotal(row: Row) {
  const picked = row.tx.items.filter((i) => i.appId !== null && row.selected.has(i.appId));
  if (picked.length && picked.every((i) => i.amount !== null)) {
    row.total = String(Math.round(picked.reduce((s, i) => s + i.amount! * 100, 0)) / 100);
  }
}

async function match() {
  if (!table.value || mapping.value.item === null) return;
  matching.value = true;
  matchError.value = null;
  try {
    const parsed = buildTransactions(table.value, mapping.value, options);
    parseInfo.value = { skippedRows: parsed.skippedRows, unreadableDates: parsed.unreadableDates };
    if (parsed.input.transactions.length === 0) {
      preview.value = { transactions: [] };
      rows.value = [];
      return;
    }
    const res = await api.post<ImportPreviewDto>('/purchases/import/preview', parsed.input);
    preview.value = res.data;
    rows.value = res.data.transactions.map((tx) => {
      const row = reactive({
        tx,
        date: tx.date,
        total: tx.total !== null ? String(tx.total) : '',
        currency: tx.currency ?? '',
        selected: new Set(tx.items.filter((i) => i.kind === 'game' && i.appId !== null && !i.alreadyRecorded).map((i) => i.appId!)),
      }) as Row;
      if (row.selected.size < tx.items.length) syncTotal(row);
      return row;
    });
  } catch (err) {
    matchError.value = err;
  } finally {
    matching.value = false;
  }
}

const visibleItems = (row: Row) => row.tx.items.filter((i) => !hideNonGame.value || i.kind !== 'non_game');
const hiddenCount = (row: Row) => row.tx.items.length - visibleItems(row).length;
const visibleRows = computed(() => rows.value.filter((r) => !hideNonGame.value || r.tx.items.some((i) => i.kind !== 'non_game')));
const hiddenRows = computed(() => rows.value.length - visibleRows.value.length);
const pricedPerItem = (row: Row) => row.tx.items.filter((i) => i.appId !== null && row.selected.has(i.appId)).every((i) => i.amount !== null);
const needsAdjust = (row: Row) => row.selected.size > 0 && !pricedPerItem(row) && row.tx.items.some((i) => i.appId === null || !row.selected.has(i.appId));

function toggle(row: Row, appId: number) {
  if (row.selected.has(appId)) row.selected.delete(appId);
  else row.selected.add(appId);
  syncTotal(row);
}

const chosen = computed(() => rows.value.filter((r) => r.selected.size > 0));
const problems = computed(() => chosen.value.filter((r) => !r.currency || r.total === '' || !Number.isFinite(Number(r.total)) || Number(r.total) < 0));
const duplicateGames = computed(() => {
  const seen = new Set<number>();
  const dupes = new Set<number>();
  chosen.value.forEach((r) => r.selected.forEach((id) => (seen.has(id) ? dupes.add(id) : seen.add(id))));
  return dupes;
});

// ---- Step 3: save ----
const saving = ref(false);
const saveError = ref<unknown>(null);
const result = ref<ImportCommitResultDto | null>(null);

function sharesFor(row: Row, totalCents: number) {
  const picked = row.tx.items.filter((i) => i.appId !== null && row.selected.has(i.appId));
  if (picked.length < 2 || !picked.every((i) => i.amount !== null)) return undefined;
  const shares = picked.map((i) => ({ appId: i.appId!, amount: i.amount! }));
  return shares.reduce((s, x) => s + Math.round(x.amount * 100), 0) === totalCents ? shares : undefined;
}

async function commit() {
  if (problems.value.length || duplicateGames.value.size || chosen.value.length === 0) return;
  saving.value = true;
  saveError.value = null;
  const payload: ImportCommitInput = {
    replaceExisting: false,
    transactions: chosen.value.map((r) => {
      const total = Math.round(Number(r.total) * 100) / 100;
      return {
        appIds: [...r.selected],
        total,
        currency: r.currency as CurrencyCode,
        purchaseDate: r.date && r.date <= todayIso ? r.date : null,
        source: r.tx.source ?? (r.tx.type === 'gift_purchase' ? 'steam_gift' : r.selected.size > 1 ? 'bundle' : 'steam'),
        notes: r.tx.notes,
        shares: sharesFor(r, Math.round(total * 100)),
      };
    }),
  };
  try {
    result.value = (await api.post<ImportCommitResultDto>('/purchases/import/commit', payload)).data;
  } catch (err) {
    saveError.value = err;
  } finally {
    saving.value = false;
  }
}

function reset() {
  file.value = null;
  table.value = null;
  preview.value = null;
  rows.value = [];
  result.value = null;
}

const kindBadge = (kind: string) =>
  kind === 'game' ? 'bg-success/15 text-success' : kind === 'non_game' ? 'bg-surface-2 text-muted' : 'bg-warning/15 text-warning';
const isConflict = (e: unknown) => e instanceof ApiError && e.code === 'PURCHASE_CONFLICT';
</script>

<template>
  <SteamRequired>
    <div class="mx-auto flex max-w-5xl flex-col gap-6">
      <div>
        <RouterLink :to="{ name: 'valuation' }" class="text-sm text-accent hover:underline">← {{ t('nav.valuation') }}</RouterLink>
        <h1 class="mt-2 text-2xl font-semibold">{{ t('import.title') }}</h1>
        <p class="mt-1 text-muted">{{ t('import.subtitle') }}</p>
      </div>

      <!-- Done -->
      <section v-if="result" class="card flex flex-col items-center gap-3 py-10 text-center" role="status">
        <AppIcon name="check" :size="32" class="text-success" />
        <h2 class="text-lg font-semibold">{{ t('import.doneTitle') }}</h2>
        <p class="text-sm text-muted">{{ t('import.doneBody', { created: result.created, bundles: result.bundlesCreated, skipped: result.skipped }) }}</p>
        <div class="flex gap-2">
          <button type="button" class="btn btn-secondary" @click="reset">{{ t('import.another') }}</button>
          <button type="button" class="btn btn-primary" @click="router.push({ name: 'valuation' })">{{ t('import.viewPurchases') }}</button>
        </div>
      </section>

      <template v-else>
        <!-- Step 1: file -->
        <section class="card flex flex-col gap-4">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h2 class="section-title">{{ t('import.step1') }}</h2>
            <button type="button" class="btn btn-ghost" @click="downloadTemplate"><AppIcon name="download" :size="16" />{{ t('import.template') }}</button>
          </div>
          <label
            class="flex cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed p-8 text-center transition-colors"
            :class="dragging ? 'border-accent bg-accent/10' : 'border-line hover:border-accent/60'"
            @dragover.prevent="dragging = true"
            @dragleave="dragging = false"
            @drop.prevent="onDrop"
          >
            <AppIcon :name="reading ? 'refresh' : 'table'" :size="36" class="text-muted" :class="reading ? 'animate-spin' : ''" />
            <span class="font-medium">{{ file ? file.name : t('import.drop') }}</span>
            <span class="text-xs text-muted">{{ file && table ? t('import.rowsRead', { n: dataRowCount }) : t('import.dropHint', { mb: MAX_FILE_BYTES / 1024 / 1024 }) }}</span>
            <input type="file" class="sr-only" :accept="ACCEPT" @change="pick(($event.target as HTMLInputElement).files?.[0])" />
          </label>
          <p v-if="fileError" role="alert" class="text-sm text-danger">{{ t(fileError) }}</p>
          <ul class="list-disc space-y-1 pl-5 text-xs text-muted">
            <li>{{ t('import.help1') }}</li>
            <li>{{ t('import.help2') }}</li>
            <li>{{ t('import.help3') }}</li>
          </ul>
        </section>

        <!-- Step 2: columns -->
        <section v-if="table" class="card flex flex-col gap-4">
          <h2 class="section-title">{{ t('import.step2') }}</h2>
          <label class="flex items-center gap-2 text-sm">
            <input v-model="options.hasHeader" type="checkbox" class="h-4 w-4" />
            {{ t('import.hasHeader') }}
          </label>
          <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label v-for="field in IMPORT_FIELDS" :key="field">
              <span class="label">{{ t(`import.fields.${field}`) }}<span v-if="field === 'item'" class="text-danger"> *</span></span>
              <select v-model="mapping[field]" class="input">
                <option :value="null">{{ t('import.notInFile') }}</option>
                <option v-for="i in columnCount" :key="i" :value="i - 1">{{ columnLabel(i - 1) }}</option>
              </select>
            </label>
          </div>
          <div class="grid gap-3 sm:grid-cols-3">
            <label>
              <span class="label">{{ t('import.amountIs') }}</span>
              <select v-model="options.amountMode" class="input">
                <option value="item">{{ t('import.amountModes.item') }}</option>
                <option value="transaction">{{ t('import.amountModes.transaction') }}</option>
              </select>
            </label>
            <label>
              <span class="label">{{ t('import.dateFormat') }}</span>
              <select v-model="options.dateFormat" class="input">
                <option value="auto">{{ t('import.dateFormats.auto') }}</option>
                <option value="ymd">YYYY-MM-DD</option>
                <option value="dmy">DD/MM/YYYY</option>
                <option value="mdy">MM/DD/YYYY</option>
              </select>
            </label>
            <label>
              <span class="label">{{ t('import.defaultCurrency') }}</span>
              <select v-model="options.defaultCurrency" class="input">
                <option v-for="c in CURRENCIES" :key="c" :value="c">{{ c }}</option>
              </select>
            </label>
          </div>
          <p class="text-xs text-muted">{{ t('import.bundleHint') }}</p>

          <div class="overflow-x-auto rounded-lg border border-line">
            <table class="w-full min-w-[36rem] text-xs">
              <thead class="border-b border-line bg-surface-2/60 text-left text-muted">
                <tr><th v-for="i in columnCount" :key="i" class="px-3 py-2 font-medium whitespace-nowrap">{{ columnLabel(i - 1) }}</th></tr>
              </thead>
              <tbody>
                <tr v-for="(r, ri) in sampleRows" :key="ri" class="border-b border-line/60 last:border-0">
                  <td v-for="i in columnCount" :key="i" class="max-w-[14rem] truncate px-3 py-1.5" :title="cellText(r[i - 1], i - 1)">{{ cellText(r[i - 1], i - 1) }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <ErrorState v-if="matchError" :error="matchError" compact @retry="match" />
          <button type="button" class="btn btn-primary self-start" :disabled="matching || mapping.item === null" @click="match">
            <AppIcon :name="matching ? 'refresh' : 'search'" :size="16" :class="matching ? 'animate-spin' : ''" />
            {{ t('import.match') }}
          </button>
        </section>

        <!-- Step 3: review -->
        <section v-if="preview" class="flex flex-col gap-4">
          <div v-if="rows.length === 0" class="card text-sm text-muted">{{ t('import.nothingFound') }}</div>
          <template v-else>
            <div class="flex flex-wrap items-center justify-between gap-3">
              <h2 class="section-title">{{ t('import.reviewTitle', { n: rows.length }) }}</h2>
              <label class="flex items-center gap-2 text-sm">
                <input v-model="hideNonGame" type="checkbox" class="h-4 w-4" />
                {{ t('import.hideNonGame') }}
              </label>
            </div>
            <p class="text-sm text-muted">{{ t('import.reviewHint') }}</p>
            <p v-if="parseInfo?.skippedRows" class="text-xs text-muted">{{ t('import.skippedRows', { n: parseInfo.skippedRows }) }}</p>
            <p v-if="parseInfo?.unreadableDates" class="text-xs text-warning">{{ t('import.unreadableDates', { n: parseInfo.unreadableDates }) }}</p>
            <p v-if="hideNonGame && hiddenRows" class="text-xs text-muted">{{ t('import.hiddenRows', { n: hiddenRows }) }}</p>

            <article v-for="row in visibleRows" :key="row.tx.key" class="card flex flex-col gap-3 p-4" :class="row.selected.size ? '' : 'opacity-70'">
              <div class="grid gap-3 sm:grid-cols-[minmax(11rem,1fr)_8rem_7rem_auto] sm:items-end">
                <div>
                  <span class="label">{{ t('purchase.date') }}</span>
                  <DatePicker v-model="row.date" :max="todayIso" :label="t('purchase.date')" />
                </div>
                <label>
                  <span class="label">{{ t('import.amount') }}</span>
                  <input v-model="row.total" type="number" min="0" step="0.01" class="input" :class="row.selected.size && row.total === '' ? 'border-danger' : ''" />
                </label>
                <label>
                  <span class="label">{{ t('purchase.currency') }}</span>
                  <select v-model="row.currency" class="input" :class="row.selected.size && !row.currency ? 'border-danger' : ''">
                    <option value="" disabled>—</option>
                    <option v-for="c in CURRENCIES" :key="c" :value="c">{{ c }}</option>
                  </select>
                </label>
                <span class="badge self-center bg-surface-2 text-muted">{{ t(`import.types.${row.tx.type}`) }}</span>
              </div>

              <ul class="flex flex-col gap-1.5">
                <li v-for="(item, i) in visibleItems(row)" :key="i" class="flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-2/60">
                  <input
                    type="checkbox"
                    class="h-4 w-4"
                    :disabled="item.kind !== 'game' || item.appId === null"
                    :checked="item.appId !== null && row.selected.has(item.appId)"
                    :aria-label="t('import.include', { name: item.name })"
                    @change="item.appId !== null && toggle(row, item.appId)"
                  />
                  <div class="min-w-0 flex-1">
                    <p class="truncate">{{ item.name }}</p>
                    <p v-if="item.matchedName && item.matchedName !== item.name" class="truncate text-xs text-muted">→ {{ item.matchedName }}</p>
                  </div>
                  <span v-if="item.amount !== null && row.currency" class="text-xs text-muted">{{ f.money({ amount: item.amount, currency: row.currency }) }}</span>
                  <span v-if="item.alreadyRecorded" class="badge bg-warning/15 text-warning">{{ t('import.alreadyRecorded') }}</span>
                  <span class="badge" :class="kindBadge(item.kind)">{{ item.kind === 'non_game' ? t(`import.reasons.${item.reason ?? 'other'}`) : t(`import.kinds.${item.kind}`) }}</span>
                </li>
              </ul>
              <p v-if="hiddenCount(row)" class="text-xs text-muted">{{ t('import.hiddenItems', { n: hiddenCount(row) }) }}</p>
              <p v-if="needsAdjust(row)" class="text-xs text-warning">{{ t('import.adjustAmount') }}</p>
              <p v-if="row.selected.size > 1" class="flex items-center gap-1.5 text-xs text-accent">
                <AppIcon name="layers" :size="14" />{{ pricedPerItem(row) ? t('import.asBundleKnown', { n: row.selected.size }) : t('import.asBundle', { n: row.selected.size }) }}
              </p>
            </article>

            <div class="card sticky bottom-4 flex flex-wrap items-center justify-between gap-3 p-4">
              <p class="text-sm">
                {{ t('import.summary', { games: chosen.reduce((n, r) => n + r.selected.size, 0), transactions: chosen.length }) }}
                <span v-if="chosen.length" class="text-muted">· {{ f.totals(chosen.filter((r) => r.currency && r.total !== '').map((r) => ({ amount: Number(r.total), currency: r.currency as string }))) }}</span>
              </p>
              <p v-if="problems.length" class="text-sm text-danger">{{ t('import.fixRows', { n: problems.length }) }}</p>
              <p v-else-if="duplicateGames.size" class="text-sm text-danger">{{ t('import.duplicateGames') }}</p>
              <ErrorState v-if="saveError" :error="saveError" compact class="w-full" @retry="commit" />
              <p v-if="isConflict(saveError)" class="w-full text-xs text-muted">{{ t('import.conflictHint') }}</p>
              <button type="button" class="btn btn-primary" :disabled="saving || chosen.length === 0 || problems.length > 0 || duplicateGames.size > 0" @click="commit">
                {{ t('import.save') }}
              </button>
            </div>
          </template>
        </section>
      </template>
    </div>
  </SteamRequired>
</template>
