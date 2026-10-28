<script setup lang="ts">
/**
 * Import purchase history from a screenshot: upload -> review -> save.
 * Nothing is saved until the user confirms the reviewed transactions.
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import {
  CURRENCIES, IMPORT_MAX_BYTES, IMPORT_MEDIA_TYPES,
  type CurrencyCode, type ImportCommitInput, type ImportCommitResultDto, type ImportPreviewDto, type ImportTransactionDto,
} from '@steam-analytics/shared';
import { api, ApiError } from '@/services/api';
import { useFormat } from '@/composables/useFormat';
import { localTodayIso } from '@/composables/dates';
import SteamRequired from '@/components/steam/SteamRequired.vue';
import DatePicker from '@/components/ui/DatePicker.vue';
import ErrorState from '@/components/ui/ErrorState.vue';
import AppIcon from '@/components/ui/AppIcon.vue';

const { t } = useI18n();
const f = useFormat();
const router = useRouter();
const todayIso = localTodayIso();

const available = ref<boolean | null>(null);
onMounted(async () => {
  try {
    available.value = (await api.get<{ available: boolean }>('/purchases/import')).data.available;
  } catch {
    available.value = false;
  }
});

// ---- Upload ----
const file = ref<File | null>(null);
const previewUrl = ref<string | null>(null);
const dragging = ref(false);
const uploading = ref(false);
const uploadError = ref<unknown>(null);
const fileError = ref<string | null>(null);
const preview = ref<ImportPreviewDto | null>(null);

function pick(f: File | null | undefined) {
  fileError.value = null;
  if (!f) return;
  if (!(IMPORT_MEDIA_TYPES as readonly string[]).includes(f.type)) {
    fileError.value = 'import.badType';
    return;
  }
  if (f.size > IMPORT_MAX_BYTES) {
    fileError.value = 'import.tooLarge';
    return;
  }
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
  file.value = f;
  previewUrl.value = URL.createObjectURL(f);
  preview.value = null;
}
const onDrop = (e: DragEvent) => {
  dragging.value = false;
  pick(e.dataTransfer?.files[0]);
};
const onPaste = (e: ClipboardEvent) => {
  const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
  if (item) pick(item.getAsFile());
};
onMounted(() => window.addEventListener('paste', onPaste));
onBeforeUnmount(() => {
  window.removeEventListener('paste', onPaste);
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
});

// ---- Review state ----
interface Row {
  tx: ImportTransactionDto;
  date: string | null;
  total: string;
  currency: CurrencyCode | '';
  selected: Set<number>;
}
const rows = ref<Row[]>([]);
const hideNonGame = ref(true);

async function analyze() {
  if (!file.value) return;
  uploading.value = true;
  uploadError.value = null;
  try {
    const res = await api.upload<ImportPreviewDto>('/purchases/import/screenshot', file.value);
    preview.value = res.data;
    rows.value = res.data.transactions.map((tx) => reactive({
      tx,
      date: tx.date,
      total: tx.total !== null ? String(tx.total) : '',
      currency: tx.currency ?? '',
      selected: new Set(tx.items.filter((i) => i.kind === 'game' && i.appId !== null && !i.alreadyRecorded).map((i) => i.appId!)),
    }));
  } catch (err) {
    uploadError.value = err;
  } finally {
    uploading.value = false;
  }
}

const visibleItems = (row: Row) => row.tx.items.filter((i) => !hideNonGame.value || i.kind !== 'non_game');
const hiddenCount = (row: Row) => row.tx.items.length - visibleItems(row).length;
const visibleRows = computed(() => rows.value.filter((r) => !hideNonGame.value || r.tx.items.some((i) => i.kind !== 'non_game')));
const hiddenRows = computed(() => rows.value.length - visibleRows.value.length);
const hasExtraItems = (row: Row) => row.tx.items.some((i) => i.appId === null || !row.selected.has(i.appId));

function toggle(row: Row, appId: number) {
  if (row.selected.has(appId)) row.selected.delete(appId);
  else row.selected.add(appId);
}

const chosen = computed(() => rows.value.filter((r) => r.selected.size > 0));
const problems = computed(() =>
  chosen.value.filter((r) => !r.currency || r.total === '' || !Number.isFinite(Number(r.total)) || Number(r.total) < 0),
);
const duplicateGames = computed(() => {
  const seen = new Set<number>();
  const dupes = new Set<number>();
  chosen.value.forEach((r) => r.selected.forEach((id) => (seen.has(id) ? dupes.add(id) : seen.add(id))));
  return dupes;
});

// ---- Commit ----
const saving = ref(false);
const saveError = ref<unknown>(null);
const result = ref<ImportCommitResultDto | null>(null);

async function commit() {
  if (problems.value.length || duplicateGames.value.size || chosen.value.length === 0) return;
  saving.value = true;
  saveError.value = null;
  const payload: ImportCommitInput = {
    replaceExisting: false,
    transactions: chosen.value.map((r) => ({
      appIds: [...r.selected],
      total: Math.round(Number(r.total) * 100) / 100,
      currency: r.currency as CurrencyCode,
      purchaseDate: r.date,
      source: r.tx.type === 'gift_purchase' ? 'steam_gift' : 'steam',
      notes: '',
    })),
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
  preview.value = null;
  rows.value = [];
  result.value = null;
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
  previewUrl.value = null;
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

      <div v-if="available === false" role="note" class="rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm">{{ t('apiErrors.IMPORT_UNAVAILABLE') }}</div>

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
        <!-- Upload -->
        <section class="card flex flex-col gap-4">
          <label
            class="flex cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed p-8 text-center transition-colors"
            :class="dragging ? 'border-accent bg-accent/10' : 'border-line hover:border-accent/60'"
            @dragover.prevent="dragging = true"
            @dragleave="dragging = false"
            @drop.prevent="onDrop"
          >
            <img v-if="previewUrl" :src="previewUrl" alt="" class="max-h-64 rounded-lg border border-line object-contain" />
            <AppIcon v-else name="image" :size="36" class="text-muted" />
            <span class="font-medium">{{ file ? file.name : t('import.drop') }}</span>
            <span class="text-xs text-muted">{{ t('import.dropHint', { mb: IMPORT_MAX_BYTES / 1024 / 1024 }) }}</span>
            <input type="file" class="sr-only" :accept="IMPORT_MEDIA_TYPES.join(',')" @change="pick(($event.target as HTMLInputElement).files?.[0])" />
          </label>
          <p v-if="fileError" role="alert" class="text-sm text-danger">{{ t(fileError) }}</p>
          <p class="flex items-start gap-2 text-xs text-muted"><AppIcon name="lock" :size="14" class="mt-0.5 shrink-0" />{{ t('import.privacy') }}</p>
          <ErrorState v-if="uploadError" :error="uploadError" compact @retry="analyze" />
          <button type="button" class="btn btn-primary self-start" :disabled="!file || uploading || available === false" @click="analyze">
            <AppIcon :name="uploading ? 'refresh' : 'upload'" :size="16" :class="uploading ? 'animate-spin' : ''" />
            {{ uploading ? t('import.reading') : t('import.read') }}
          </button>
        </section>

        <!-- Review -->
        <section v-if="preview" class="flex flex-col gap-4">
          <div v-if="!preview.recognized || rows.length === 0" class="card text-sm text-muted">{{ t('import.nothingFound') }}</div>
          <template v-else>
            <div class="flex flex-wrap items-center justify-between gap-3">
              <h2 class="section-title">{{ t('import.reviewTitle', { n: rows.length }) }}</h2>
              <label class="flex items-center gap-2 text-sm">
                <input v-model="hideNonGame" type="checkbox" class="h-4 w-4" />
                {{ t('import.hideNonGame') }}
              </label>
            </div>
            <p class="text-sm text-muted">{{ t('import.reviewHint') }}</p>
            <p v-if="hideNonGame && hiddenRows" class="text-xs text-muted">{{ t('import.hiddenRows', { n: hiddenRows }) }}</p>

            <article v-for="row in visibleRows" :key="row.tx.key" class="card flex flex-col gap-3 p-4" :class="row.selected.size ? '' : 'opacity-70'">
              <div class="grid gap-3 sm:grid-cols-[1fr_8rem_7rem_auto] sm:items-end">
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
                  <span v-if="item.alreadyRecorded" class="badge bg-warning/15 text-warning">{{ t('import.alreadyRecorded') }}</span>
                  <span class="badge" :class="kindBadge(item.kind)">{{ item.kind === 'non_game' ? t(`import.reasons.${item.reason ?? 'other'}`) : t(`import.kinds.${item.kind}`) }}</span>
                </li>
              </ul>
              <p v-if="hiddenCount(row)" class="text-xs text-muted">{{ t('import.hiddenItems', { n: hiddenCount(row) }) }}</p>
              <p v-if="row.selected.size && hasExtraItems(row)" class="text-xs text-warning">{{ t('import.adjustAmount') }}</p>
              <p v-if="row.selected.size > 1" class="flex items-center gap-1.5 text-xs text-accent"><AppIcon name="layers" :size="14" />{{ t('import.asBundle', { n: row.selected.size }) }}</p>
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
