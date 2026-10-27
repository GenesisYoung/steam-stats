<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { CURRENCIES, PURCHASE_SOURCES, purchaseInputSchema, type GameAchievementsDto, type GameDetailDto } from '@steam-analytics/shared';
import { api } from '@/services/api';
import { useApi } from '@/composables/useAsync';
import { useFormat } from '@/composables/useFormat';
import { useAuthStore } from '@/stores/auth';
import { useSteamStore } from '@/stores/steam';
import SteamRequired from '@/components/steam/SteamRequired.vue';
import PriceTag from '@/components/steam/PriceTag.vue';
import AchievementProgress from '@/components/steam/AchievementProgress.vue';
import ErrorState from '@/components/ui/ErrorState.vue';
import SkeletonBlock from '@/components/ui/SkeletonBlock.vue';
import StatCard from '@/components/ui/StatCard.vue';
import DataAsOf from '@/components/ui/DataAsOf.vue';
import AppIcon from '@/components/ui/AppIcon.vue';

const props = defineProps<{ appId: number }>();
const f = useFormat();
const { t } = useI18n();
const authStore = useAuthStore();
const steam = useSteamStore();

const detail = useApi(() => api.get<GameDetailDto>(`/steam/games/${props.appId}`), [() => props.appId, () => steam.dataRevision]);
const achievements = useApi(() => api.get<GameAchievementsDto>(`/steam/games/${props.appId}/achievements`), [() => props.appId]);

// ---- Achievement list filters ----
const achFilter = ref<'all' | 'unlocked' | 'locked'>('all');
const achSearch = ref('');
const achSort = ref<'default' | 'rarity' | 'recent'>('default');
const visibleAchievements = computed(() => {
  const list = achievements.data.value?.achievements ?? [];
  const q = achSearch.value.trim().toLowerCase();
  const filtered = list.filter((a) => {
    if (achFilter.value === 'unlocked' && !a.unlocked) return false;
    if (achFilter.value === 'locked' && a.unlocked) return false;
    return !q || a.displayName.toLowerCase().includes(q) || (a.description ?? '').toLowerCase().includes(q);
  });
  if (achSort.value === 'rarity') return [...filtered].sort((a, b) => (a.globalPercent ?? 101) - (b.globalPercent ?? 101));
  if (achSort.value === 'recent') return [...filtered].sort((a, b) => (b.unlockedAt ?? '').localeCompare(a.unlockedAt ?? ''));
  return filtered;
});

// ---- Purchase (Model B) form ----
const form = reactive({ amount: '', currency: authStore.me?.preferences.currency ?? 'USD', purchaseDate: '', source: 'steam', notes: '' });
const editing = ref(false);
const saving = ref(false);
const formError = ref<string | null>(null);
const saveError = ref<unknown>(null);

watch(
  () => detail.data.value?.purchaseRecord,
  (p) => {
    form.amount = p ? String(p.amount) : '';
    form.currency = p?.currency ?? authStore.me?.preferences.currency ?? 'USD';
    form.purchaseDate = p?.purchaseDate ?? '';
    form.source = p?.source ?? 'steam';
    form.notes = p?.notes ?? '';
  },
  { immediate: true },
);

async function savePurchase() {
  formError.value = null;
  saveError.value = null;
  const parsed = purchaseInputSchema.safeParse({
    amount: Number(form.amount),
    currency: form.currency,
    purchaseDate: form.purchaseDate || null,
    source: form.source,
    notes: form.notes,
  });
  if (form.amount === '' || !parsed.success) {
    formError.value = 'purchase.invalid';
    return;
  }
  saving.value = true;
  try {
    await api.put(`/purchases/${props.appId}`, parsed.data);
    editing.value = false;
    await detail.reload();
  } catch (err) {
    saveError.value = err;
  } finally {
    saving.value = false;
  }
}

async function deletePurchase() {
  if (!window.confirm(t('purchase.confirmDelete'))) return;
  saving.value = true;
  try {
    await api.delete(`/purchases/${props.appId}`);
    await detail.reload();
  } catch (err) {
    saveError.value = err;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <SteamRequired>
    <div class="flex flex-col gap-6">
      <RouterLink :to="{ name: 'library' }" class="text-sm text-accent hover:underline">← {{ $t('game.back') }}</RouterLink>

      <ErrorState v-if="detail.error.value" :error="detail.error.value" @retry="detail.reload" />
      <SkeletonBlock v-else-if="!detail.data.value" class="h-56 rounded-xl" />
      <template v-else>
        <section class="card flex flex-col gap-5 md:flex-row">
          <img :src="detail.data.value.coverUrl" alt="" class="w-full rounded-lg border border-line object-cover md:w-96" />
          <div class="flex flex-1 flex-col gap-2">
            <h1 class="text-2xl font-semibold">{{ detail.data.value.name }}</h1>
            <p class="font-mono text-xs text-muted">AppID {{ detail.data.value.appId }}<span v-if="detail.data.value.storeType"> · {{ detail.data.value.storeType }}</span></p>
            <PriceTag :price="detail.data.value.price" />
            <p class="text-xs text-muted">
              {{ $t('price.assumption', { region: detail.data.value.price.region.toUpperCase() }) }}
              <span v-if="detail.data.value.price.fetchedAt">· {{ $t('price.updated', { time: f.relative(detail.data.value.price.fetchedAt) }) }}</span>
            </p>
            <a :href="detail.data.value.storeUrl" target="_blank" rel="noopener noreferrer" class="mt-auto inline-flex items-center gap-1 self-start text-sm text-accent hover:underline">
              {{ $t('game.storePage') }} <AppIcon name="external" :size="14" />
            </a>
          </div>
        </section>

        <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard :label="$t('game.playtime')" icon="clock" :value="detail.data.value.playtimeForeverMinutes > 0 ? f.hours(detail.data.value.playtimeForeverMinutes) : $t('cost.notPlayed')" :hint="$t('game.minutes', { n: f.number(detail.data.value.playtimeForeverMinutes) })" />
          <StatCard :label="$t('game.recent')" icon="gamepad" :value="f.hours(detail.data.value.playtime2WeeksMinutes)" :hint="$t('game.lastPlayedAt', { date: f.date(detail.data.value.lastPlayedAt) })" />
          <StatCard :label="$t('cost.estimatedPerHour')" icon="tag" :value="f.costPerHour(detail.data.value.estimatedCostPerHour)" :hint="$t('cost.estimatedHint')" />
          <StatCard :label="$t('cost.actualPerHour')" icon="wallet" :value="f.costPerHour(detail.data.value.actualCostPerHour)" :hint="$t('cost.actualHint')" />
        </div>

        <section class="card flex flex-col gap-4">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h2 class="section-title">{{ $t('purchase.title') }}</h2>
            <span class="badge bg-warning/15 text-warning">{{ $t('purchase.unverified') }}</span>
          </div>
          <p class="text-sm text-muted">{{ $t('purchase.description') }}</p>
          <div v-if="detail.data.value.purchaseRecord && !editing" class="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <span><span class="text-muted">{{ $t('purchase.amount') }}:</span> {{ f.money(detail.data.value.purchaseRecord) }}</span>
            <span><span class="text-muted">{{ $t('purchase.date') }}:</span> {{ detail.data.value.purchaseRecord.purchaseDate ?? $t('common.notRecorded') }}</span>
            <span><span class="text-muted">{{ $t('purchase.source') }}:</span> {{ $t(`purchase.sources.${detail.data.value.purchaseRecord.source}`) }}</span>
            <span v-if="detail.data.value.purchaseRecord.notes" class="w-full text-muted">“{{ detail.data.value.purchaseRecord.notes }}”</span>
            <div class="flex gap-2">
              <button type="button" class="btn btn-secondary" @click="editing = true">{{ $t('common.edit') }}</button>
              <button type="button" class="btn btn-ghost text-danger" :disabled="saving" @click="deletePurchase">{{ $t('common.delete') }}</button>
            </div>
          </div>
          <button v-else-if="!editing" type="button" class="btn btn-secondary self-start" @click="editing = true">{{ $t('purchase.add') }}</button>
          <form v-else class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" @submit.prevent="savePurchase">
            <label>
              <span class="label">{{ $t('purchase.amount') }}</span>
              <input v-model="form.amount" type="number" min="0" max="100000" step="0.01" inputmode="decimal" required class="input" />
            </label>
            <label>
              <span class="label">{{ $t('purchase.currency') }}</span>
              <select v-model="form.currency" class="input">
                <option v-for="c in CURRENCIES" :key="c" :value="c">{{ c }}</option>
              </select>
            </label>
            <label>
              <span class="label">{{ $t('purchase.date') }}</span>
              <input v-model="form.purchaseDate" type="date" class="input" />
            </label>
            <label>
              <span class="label">{{ $t('purchase.source') }}</span>
              <select v-model="form.source" class="input">
                <option v-for="s in PURCHASE_SOURCES" :key="s" :value="s">{{ $t(`purchase.sources.${s}`) }}</option>
              </select>
            </label>
            <label class="sm:col-span-2 lg:col-span-4">
              <span class="label">{{ $t('purchase.notes') }}</span>
              <textarea v-model="form.notes" maxlength="500" rows="2" class="input" />
            </label>
            <p v-if="formError" role="alert" class="text-sm text-danger sm:col-span-2 lg:col-span-4">{{ $t(formError) }}</p>
            <ErrorState v-if="saveError" :error="saveError" compact class="sm:col-span-2 lg:col-span-4" @retry="savePurchase" />
            <div class="flex gap-2 sm:col-span-2 lg:col-span-4">
              <button type="submit" class="btn btn-primary" :disabled="saving">{{ $t('common.save') }}</button>
              <button type="button" class="btn btn-ghost" @click="editing = false">{{ $t('common.cancel') }}</button>
            </div>
          </form>
        </section>
      </template>

      <section class="card flex flex-col gap-4">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h2 class="section-title">{{ $t('nav.achievements') }}</h2>
          <DataAsOf v-if="achievements.data.value" :at="achievements.data.value.syncedAt" />
        </div>
        <ErrorState v-if="achievements.error.value" :error="achievements.error.value" compact @retry="achievements.reload" />
        <SkeletonBlock v-else-if="achievements.loading.value" class="h-40" />
        <template v-else-if="achievements.data.value">
          <p v-if="achievements.data.value.status !== 'available'" class="text-sm text-muted">{{ $t(`achievements.statusLong.${achievements.data.value.status}`) }}</p>
          <template v-else>
            <AchievementProgress :summary="{ status: 'available', total: achievements.data.value.total, unlocked: achievements.data.value.unlocked, percent: achievements.data.value.percent }" />
            <div class="flex flex-col gap-2 sm:flex-row">
              <input v-model="achSearch" type="search" class="input sm:max-w-xs" :placeholder="$t('achievements.search')" :aria-label="$t('achievements.search')" />
              <select v-model="achFilter" class="input sm:w-40" :aria-label="$t('filters.filter')">
                <option value="all">{{ $t('filters.all') }}</option>
                <option value="unlocked">{{ $t('achievements.unlocked') }}</option>
                <option value="locked">{{ $t('achievements.locked') }}</option>
              </select>
              <select v-model="achSort" class="input sm:w-48" :aria-label="$t('filters.sort')">
                <option value="default">{{ $t('achievements.sortDefault') }}</option>
                <option value="rarity">{{ $t('achievements.sortRarity') }}</option>
                <option value="recent">{{ $t('achievements.sortRecent') }}</option>
              </select>
            </div>
            <ul class="grid gap-2 md:grid-cols-2">
              <li v-for="a in visibleAchievements" :key="a.apiName" class="flex items-center gap-3 rounded-lg border border-line p-3" :class="a.unlocked ? '' : 'opacity-70'">
                <img v-if="a.iconUrl" :src="a.iconUrl" alt="" class="h-12 w-12 shrink-0 rounded" loading="lazy" />
                <div v-else class="h-12 w-12 shrink-0 rounded bg-surface-2" />
                <div class="min-w-0 flex-1">
                  <p class="flex items-center gap-1.5 font-medium">
                    <AppIcon :name="a.unlocked ? 'check' : 'lock'" :size="14" :class="a.unlocked ? 'text-success' : 'text-muted'" />
                    <span class="truncate">{{ a.displayName }}</span>
                  </p>
                  <p class="line-clamp-2 text-xs text-muted">{{ a.description ?? (a.hidden ? $t('achievements.hidden') : $t('achievements.noDescription')) }}</p>
                  <p class="mt-0.5 text-xs text-muted">
                    <template v-if="a.unlocked">{{ a.unlockedAt ? $t('achievements.unlockedOn', { date: f.date(a.unlockedAt, true) }) : $t('achievements.unlockedNoDate') }}</template>
                    <template v-else>{{ $t('achievements.locked') }}</template>
                    <span v-if="a.globalPercent !== null"> · {{ $t('achievements.global', { pct: f.percent(a.globalPercent) }) }}</span>
                  </p>
                </div>
              </li>
            </ul>
            <p v-if="visibleAchievements.length === 0" class="text-center text-sm text-muted">{{ $t('common.noData') }}</p>
          </template>
        </template>
      </section>
    </div>
  </SteamRequired>
</template>
