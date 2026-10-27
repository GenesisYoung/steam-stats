<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useSteamStore } from '@/stores/steam';
import { useFormat } from '@/composables/useFormat';
import { ApiError } from '@/services/api';
import AppIcon from '@/components/ui/AppIcon.vue';

const steam = useSteamStore();
const f = useFormat();
const { t } = useI18n();

const label = computed(() => {
  const active = steam.sync?.active;
  if (active) return t('sync.running', { stage: t(`sync.stage.${active.stage}`) });
  return t('sync.last', { time: f.relative(steam.sync?.lastSuccessfulSyncAt) });
});

async function syncNow() {
  try {
    await steam.startSync('full');
  } catch (err) {
    if (err instanceof ApiError && err.code === 'RATE_LIMITED') window.alert(t('apiErrors.RATE_LIMITED'));
    else window.alert(t('errors.generic'));
  }
}
</script>

<template>
  <div class="flex items-center gap-2 text-xs text-muted" aria-live="polite">
    <span class="hidden md:inline">{{ label }}</span>
    <span v-if="steam.sync?.latest?.status === 'failed' && !steam.syncing" class="badge bg-danger/15 text-danger" :title="steam.sync.latest.error?.message">{{ $t('sync.failed') }}</span>
    <span v-else-if="steam.sync?.latest?.status === 'partial' && !steam.syncing" class="badge bg-warning/15 text-warning" :title="$t('sync.partialHint')">{{ $t('sync.partial') }}</span>
    <button type="button" class="btn btn-ghost px-2 py-1" :disabled="steam.syncing" :aria-label="$t('sync.now')" :title="$t('sync.now')" @click="syncNow">
      <AppIcon name="refresh" :size="16" :class="steam.syncing ? 'animate-spin' : ''" />
    </button>
  </div>
</template>
