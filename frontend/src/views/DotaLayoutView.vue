<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '@/services/api';
import SteamRequired from '@/components/steam/SteamRequired.vue';
import AppIcon from '@/components/ui/AppIcon.vue';
import ErrorState from '@/components/ui/ErrorState.vue';

const route = useRoute();
const router = useRouter();

const lookup = ref('');
const lookupValid = computed(() => /^\d{1,16}$/.test(lookup.value.trim()));
function openMatch() {
  if (!lookupValid.value) return;
  void router.push({ name: 'dota-match', params: { matchid: lookup.value.trim() } });
  lookup.value = '';
}

// Remounts the current page, which reloads its data.
const revision = ref(0);
const refreshing = ref(false);
const refreshed = ref(false);
const refreshError = ref<unknown>(null);
async function refresh() {
  refreshing.value = true;
  refreshed.value = false;
  refreshError.value = null;
  try {
    await api.post('/dota/refresh');
    refreshed.value = true;
    revision.value += 1;
  } catch (err) {
    refreshError.value = err;
  } finally {
    refreshing.value = false;
  }
}

const tabs = [
  { name: 'dota', label: 'dota.overviewTab' },
  { name: 'dota-matches', label: 'dota.matchesTab' },
] as const;
const isActive = (name: string) => (name === 'dota' ? route.name === 'dota' : route.name !== 'dota');
</script>

<template>
  <SteamRequired>
    <div class="flex flex-col gap-6">
      <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 class="text-2xl font-semibold">{{ $t('dota.title') }}</h1>
          <p class="text-xs text-muted">{{ $t('dota.attribution') }}</p>
        </div>
        <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
          <form class="flex gap-2" @submit.prevent="openMatch">
            <input v-model="lookup" type="search" inputmode="numeric" class="input sm:w-52" :placeholder="$t('dota.lookupPlaceholder')" :aria-label="$t('dota.lookupPlaceholder')" />
            <button type="submit" class="btn btn-secondary" :disabled="!lookupValid" :aria-label="$t('dota.lookup')">
              <AppIcon name="search" :size="16" />
            </button>
          </form>
          <button type="button" class="btn btn-secondary" :disabled="refreshing" @click="refresh">
            <AppIcon name="refresh" :size="16" :class="refreshing ? 'animate-spin' : ''" />
            {{ $t('dota.refresh') }}
          </button>
        </div>
      </div>

      <p v-if="refreshed" role="status" class="rounded-lg bg-accent/10 p-3 text-sm">{{ $t('dota.refreshRequested') }}</p>
      <ErrorState v-if="refreshError" compact :error="refreshError" @retry="refresh" />

      <nav class="flex gap-1 border-b border-line" :aria-label="$t('dota.title')">
        <RouterLink
          v-for="tab in tabs"
          :key="tab.name"
          :to="{ name: tab.name }"
          class="-mb-px border-b-2 px-3 py-2 text-sm"
          :class="isActive(tab.name) ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-fg'"
        >
          {{ $t(tab.label) }}
        </RouterLink>
      </nav>

      <RouterView :key="revision" />
    </div>
  </SteamRequired>
</template>
