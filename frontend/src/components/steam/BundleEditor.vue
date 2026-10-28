<script setup lang="ts">
/** Create or edit a bundle: several games bought together for one price. */
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  CURRENCIES, PURCHASE_SOURCES, allocateBundle, bundleInputSchema,
  type BundleAllocation, type BundleDto, type CurrencyCode, type GameDetailDto, type GameListItemDto, type PurchaseSource,
} from '@steam-analytics/shared';
import { api, ApiError } from '@/services/api';
import { useAuthStore } from '@/stores/auth';
import { useFormat } from '@/composables/useFormat';
import { localTodayIso } from '@/composables/dates';
import ModalDialog from '@/components/ui/ModalDialog.vue';
import DatePicker from '@/components/ui/DatePicker.vue';
import ErrorState from '@/components/ui/ErrorState.vue';
import AppIcon from '@/components/ui/AppIcon.vue';

const props = defineProps<{ open: boolean; bundleId?: string | null; initialAppIds?: number[] }>();
const emit = defineEmits<{ close: []; saved: [bundle: BundleDto | null] }>();

const { t } = useI18n();
const f = useFormat();
const authStore = useAuthStore();
const todayIso = localTodayIso();

interface Picked { appId: number; name: string; price: number | null; priceCurrency: string | null }

const picked = ref<Picked[]>([]);
const form = reactive({
  total: '',
  currency: (authStore.me?.preferences.currency ?? 'USD') as CurrencyCode,
  purchaseDate: null as string | null,
  source: 'bundle' as PurchaseSource,
  notes: '',
  allocation: 'store_price' as BundleAllocation,
  manual: {} as Record<number, string>,
  replaceExisting: false,
});
const loading = ref(false);
const saving = ref(false);
const error = ref<unknown>(null);
const formError = ref<string | null>(null);
const conflictIds = ref<number[]>([]);

const toPicked = (g: GameListItemDto): Picked => ({
  appId: g.appId,
  name: g.name,
  price: g.price.status === 'priced' ? g.price.price?.amount ?? null : null,
  priceCurrency: g.price.price?.currency ?? null,
});

async function load() {
  error.value = null;
  formError.value = null;
  conflictIds.value = [];
  picked.value = [];
  Object.assign(form, { total: '', purchaseDate: null, source: 'bundle', notes: '', allocation: 'store_price', manual: {}, replaceExisting: false, currency: authStore.me?.preferences.currency ?? 'USD' });
  if (!props.bundleId && !props.initialAppIds?.length) return;
  loading.value = true;
  try {
    let appIds = props.initialAppIds ?? [];
    if (props.bundleId) {
      const b = (await api.get<BundleDto>(`/purchases/bundles/${props.bundleId}`)).data;
      appIds = b.items.map((i) => i.appId);
      Object.assign(form, { total: String(b.total), currency: b.currency, purchaseDate: b.purchaseDate, source: b.source, notes: b.notes, allocation: b.allocation });
      form.manual = Object.fromEntries(b.items.map((i) => [i.appId, String(i.amount)]));
    }
    const details = await Promise.all(appIds.map((id) => api.get<GameDetailDto>(`/steam/games/${id}`)));
    picked.value = details.map((d) => toPicked(d.data));
  } catch (err) {
    error.value = err;
  } finally {
    loading.value = false;
  }
}
watch(() => props.open, (o) => o && void load(), { immediate: true });

// ---- Game search ----
const query = ref('');
const results = ref<GameListItemDto[]>([]);
let timer: ReturnType<typeof setTimeout> | undefined;
watch(query, (q) => {
  clearTimeout(timer);
  if (!q.trim()) {
    results.value = [];
    return;
  }
  timer = setTimeout(async () => {
    try {
      results.value = (await api.get<GameListItemDto[]>('/steam/games', { q: q.trim(), sort: 'name', pageSize: 8 })).data;
    } catch {
      results.value = [];
    }
  }, 200);
});
function add(g: GameListItemDto) {
  if (!picked.value.some((p) => p.appId === g.appId)) picked.value.push(toPicked(g));
  query.value = '';
}
const remove = (appId: number) => (picked.value = picked.value.filter((p) => p.appId !== appId));

// ---- Allocation preview ----
const totalNumber = computed(() => (form.total === '' ? NaN : Number(form.total)));
const preview = computed(() => {
  if (form.allocation === 'manual') return { amounts: picked.value.map((p) => Number(form.manual[p.appId] ?? 0)), method: 'manual' as const };
  if (!Number.isFinite(totalNumber.value) || picked.value.length === 0) return { amounts: picked.value.map(() => null), method: form.allocation };
  const weights = form.allocation === 'even' ? picked.value.map(() => 1) : picked.value.map((p) => p.price);
  return allocateBundle(totalNumber.value, weights);
});
const manualRemaining = computed(() => {
  if (form.allocation !== 'manual' || !Number.isFinite(totalNumber.value)) return 0;
  const cents = picked.value.reduce((s, p) => s + Math.round(Number(form.manual[p.appId] ?? 0) * 100), 0);
  return (Math.round(totalNumber.value * 100) - cents) / 100;
});

async function save() {
  formError.value = null;
  error.value = null;
  const payload = {
    appIds: picked.value.map((p) => p.appId),
    total: totalNumber.value,
    currency: form.currency,
    purchaseDate: form.purchaseDate,
    source: form.source,
    notes: form.notes,
    allocation: form.allocation,
    ...(form.allocation === 'manual' ? { shares: picked.value.map((p) => ({ appId: p.appId, amount: Number(form.manual[p.appId] ?? 0) })) } : {}),
    replaceExisting: form.replaceExisting,
  };
  const parsed = bundleInputSchema.safeParse(payload);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    formError.value = issue?.path[0] === 'appIds' ? 'bundle.needTwo' : issue?.path[0] === 'shares' ? 'bundle.sharesMismatch' : 'purchase.invalid';
    return;
  }
  saving.value = true;
  try {
    const res = props.bundleId
      ? await api.put<BundleDto>(`/purchases/bundles/${props.bundleId}`, parsed.data)
      : await api.post<BundleDto>('/purchases/bundles', parsed.data);
    emit('saved', res.data);
  } catch (err) {
    if (err instanceof ApiError && err.code === 'PURCHASE_CONFLICT') {
      conflictIds.value = ((err.details as { appIds?: number[] } | undefined)?.appIds ?? []);
    } else {
      error.value = err;
    }
  } finally {
    saving.value = false;
  }
}

async function removeBundle() {
  if (!props.bundleId || !window.confirm(t('bundle.confirmDelete'))) return;
  saving.value = true;
  try {
    await api.delete(`/purchases/bundles/${props.bundleId}`);
    emit('saved', null);
  } catch (err) {
    error.value = err;
  } finally {
    saving.value = false;
  }
}

const conflictNames = computed(() => picked.value.filter((p) => conflictIds.value.includes(p.appId)).map((p) => p.name));
</script>

<template>
  <ModalDialog wide :open="open" :title="bundleId ? t('bundle.editTitle') : t('bundle.newTitle')" @close="emit('close')">
    <p class="text-sm text-muted">{{ t('bundle.description') }}</p>

    <div v-if="loading" class="h-40 animate-pulse rounded-lg bg-surface-2" />
    <form v-else id="bundle-form" class="flex max-h-[65vh] flex-col gap-4 overflow-y-auto pr-1" @submit.prevent="save">
      <div>
        <span class="label">{{ t('bundle.games') }}</span>
        <div class="relative">
          <AppIcon name="search" :size="16" class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
          <input v-model="query" type="search" class="input pl-9" :placeholder="t('bundle.searchGames')" :aria-label="t('bundle.searchGames')" />
          <ul v-if="results.length" class="absolute z-40 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-line bg-bg-elevated shadow-lg" role="listbox">
            <li v-for="g in results" :key="g.appId">
              <button type="button" class="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-surface-2 disabled:opacity-50" :disabled="picked.some((p) => p.appId === g.appId)" @click="add(g)">
                <span class="truncate">{{ g.name }}</span>
                <span class="shrink-0 text-xs text-muted">{{ g.price.status === 'priced' ? f.money(g.price.price) : t('common.unavailable') }}</span>
              </button>
            </li>
          </ul>
        </div>
      </div>

      <div class="grid gap-3 sm:grid-cols-2">
        <label>
          <span class="label">{{ t('bundle.total') }}</span>
          <input v-model="form.total" type="number" min="0" max="100000" step="0.01" inputmode="decimal" required class="input" />
        </label>
        <label>
          <span class="label">{{ t('purchase.currency') }}</span>
          <select v-model="form.currency" class="input">
            <option v-for="c in CURRENCIES" :key="c" :value="c">{{ c }}</option>
          </select>
        </label>
        <div>
          <span class="label">{{ t('purchase.date') }}</span>
          <DatePicker v-model="form.purchaseDate" :max="todayIso" :label="t('purchase.date')" />
        </div>
        <label>
          <span class="label">{{ t('purchase.source') }}</span>
          <select v-model="form.source" class="input">
            <option v-for="s in PURCHASE_SOURCES" :key="s" :value="s">{{ t(`purchase.sources.${s}`) }}</option>
          </select>
        </label>
      </div>

      <fieldset>
        <legend class="label">{{ t('bundle.split') }}</legend>
        <div class="flex flex-wrap gap-2" role="radiogroup">
          <label v-for="a in (['store_price', 'even', 'manual'] as const)" :key="a" class="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm" :class="form.allocation === a ? 'border-accent bg-accent/10 text-accent' : 'border-line text-muted'">
            <input v-model="form.allocation" type="radio" :value="a" class="sr-only" />
            {{ t(`bundle.allocation.${a}`) }}
          </label>
        </div>
        <p class="mt-1 text-xs text-muted">{{ t(`bundle.allocationHint.${form.allocation}`) }}</p>
      </fieldset>

      <div>
        <p v-if="picked.length === 0" class="rounded-lg bg-surface-2 p-4 text-center text-sm text-muted">{{ t('bundle.empty') }}</p>
        <ul v-else class="divide-y divide-line rounded-lg border border-line text-sm">
          <li v-for="(p, i) in picked" :key="p.appId" class="flex items-center gap-3 px-3 py-2" :class="conflictIds.includes(p.appId) ? 'bg-warning/10' : ''">
            <div class="min-w-0 flex-1">
              <p class="truncate font-medium">{{ p.name }}</p>
              <p class="text-xs text-muted">{{ t('bundle.storePrice') }}: {{ p.price !== null && p.priceCurrency ? f.money({ amount: p.price, currency: p.priceCurrency }) : t('common.unavailable') }}</p>
            </div>
            <input
              v-if="form.allocation === 'manual'"
              v-model="form.manual[p.appId]"
              type="number"
              min="0"
              step="0.01"
              class="input w-28 text-right"
              :aria-label="t('bundle.shareFor', { name: p.name })"
            />
            <span v-else class="w-24 text-right font-medium">{{ preview.amounts[i] !== null && preview.amounts[i] !== undefined ? f.money({ amount: preview.amounts[i]!, currency: form.currency }) : '—' }}</span>
            <button type="button" class="rounded p-1 text-muted hover:bg-surface-2 hover:text-danger" :aria-label="t('bundle.removeGame', { name: p.name })" @click="remove(p.appId)">
              <AppIcon name="close" :size="14" />
            </button>
          </li>
        </ul>
        <p v-if="form.allocation === 'store_price' && preview.method === 'even' && picked.length > 1" class="mt-1 text-xs text-warning">{{ t('bundle.fallbackEven') }}</p>
        <p v-if="form.allocation === 'manual' && manualRemaining !== 0" class="mt-1 text-xs" :class="manualRemaining > 0 ? 'text-warning' : 'text-danger'">
          {{ t('bundle.remaining', { amount: f.money({ amount: manualRemaining, currency: form.currency }) }) }}
        </p>
      </div>

      <label>
        <span class="label">{{ t('purchase.notes') }}</span>
        <textarea v-model="form.notes" maxlength="500" rows="2" class="input" />
      </label>

      <div v-if="conflictIds.length" role="alert" class="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
        <p>{{ t('bundle.conflict', { games: conflictNames.join(', ') }) }}</p>
        <label class="mt-2 flex items-center gap-2">
          <input v-model="form.replaceExisting" type="checkbox" class="h-4 w-4" />
          {{ t('bundle.replaceExisting') }}
        </label>
      </div>
      <p v-if="formError" role="alert" class="text-sm text-danger">{{ t(formError) }}</p>
      <ErrorState v-if="error" :error="error" compact @retry="save" />
      <p class="text-xs text-muted">{{ t('purchase.unverified') }}</p>
    </form>

    <template #actions>
      <button v-if="bundleId" type="button" class="btn btn-ghost mr-auto text-danger" :disabled="saving" @click="removeBundle">{{ t('bundle.delete') }}</button>
      <button type="button" class="btn btn-ghost" @click="emit('close')">{{ t('common.cancel') }}</button>
      <button type="submit" form="bundle-form" class="btn btn-primary" :disabled="saving || loading">{{ t('common.save') }}</button>
    </template>
  </ModalDialog>
</template>
