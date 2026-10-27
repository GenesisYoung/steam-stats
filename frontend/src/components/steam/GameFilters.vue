<script setup lang="ts">
import { GAME_SORT_KEYS, type GameSortKey } from '@steam-analytics/shared';
import AppIcon from '@/components/ui/AppIcon.vue';
import type { FilterState } from './filters';

const model = defineModel<FilterState>({ required: true });
const set = <K extends keyof FilterState>(key: K, value: FilterState[K]) => (model.value = { ...model.value, [key]: value });
</script>

<template>
  <div class="card flex flex-col gap-3 p-4 lg:flex-row lg:items-end">
    <label class="flex-1">
      <span class="label">{{ $t('filters.search') }}</span>
      <span class="relative block">
        <AppIcon name="search" :size="16" class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
        <input :value="model.q" type="search" class="input pl-9" :placeholder="$t('filters.searchPlaceholder')" @input="set('q', ($event.target as HTMLInputElement).value)" />
      </span>
    </label>
    <label>
      <span class="label">{{ $t('filters.sort') }}</span>
      <span class="flex gap-1">
        <select :value="model.sort" class="input" @change="set('sort', ($event.target as HTMLSelectElement).value as GameSortKey)">
          <option v-for="k in GAME_SORT_KEYS" :key="k" :value="k">{{ $t(`filters.sortBy.${k}`) }}</option>
        </select>
        <button
          type="button"
          class="btn btn-secondary px-2"
          :aria-label="$t('filters.toggleOrder')"
          :title="$t('filters.toggleOrder')"
          @click="set('order', model.order === 'asc' ? 'desc' : model.order === 'desc' ? 'asc' : model.sort === 'name' || model.sort === 'costPerHour' ? 'desc' : 'asc')"
        >
          <AppIcon :name="(model.order ?? (model.sort === 'name' || model.sort === 'costPerHour' ? 'asc' : 'desc')) === 'asc' ? 'arrowUp' : 'arrowDown'" :size="16" />
        </button>
      </span>
    </label>
    <label>
      <span class="label">{{ $t('filters.played') }}</span>
      <select :value="model.played" class="input" @change="set('played', ($event.target as HTMLSelectElement).value as FilterState['played'])">
        <option value="all">{{ $t('filters.all') }}</option>
        <option value="yes">{{ $t('filters.playedYes') }}</option>
        <option value="no">{{ $t('filters.playedNo') }}</option>
      </select>
    </label>
    <label>
      <span class="label">{{ $t('filters.achievements') }}</span>
      <select :value="model.achievements" class="input" @change="set('achievements', ($event.target as HTMLSelectElement).value as FilterState['achievements'])">
        <option value="all">{{ $t('filters.all') }}</option>
        <option value="yes">{{ $t('filters.withAchievements') }}</option>
        <option value="no">{{ $t('filters.withoutAchievements') }}</option>
      </select>
    </label>
  </div>
</template>
