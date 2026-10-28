<script setup lang="ts">
import { ref } from 'vue';
import type { GameListItemDto, GameVisibilityInput } from '@steam-analytics/shared';
import { useSteamStore } from '@/stores/steam';
import ErrorState from '@/components/ui/ErrorState.vue';

const props = defineProps<{ game: GameListItemDto }>();
const steam = useSteamStore();
const busy = ref(false);
const error = ref<unknown>(null);
let lastAttempt: GameVisibilityInput = { hidden: false, excludeFromStats: true };

async function save(hidden: boolean, excludeFromStats = true) {
  if (busy.value) return;
  busy.value = true;
  error.value = null;
  lastAttempt = { hidden, excludeFromStats };
  try {
    await steam.setGameVisibility(props.game.appId, { hidden, excludeFromStats });
  } catch (err) {
    error.value = err;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <button type="button" class="btn btn-secondary text-xs" :disabled="busy" :aria-label="$t(game.hidden ? 'library.restoreNamed' : 'library.hideNamed', { name: game.name })" @click="save(!game.hidden)">
      {{ $t(game.hidden ? 'library.restore' : 'library.hide') }}
    </button>
    <label v-if="game.hidden" class="flex items-center gap-2 text-xs text-muted">
      <input type="checkbox" :checked="game.excludedFromStats" :disabled="busy" @change="save(true, ($event.target as HTMLInputElement).checked)" />
      {{ $t('library.excludeFromStats') }}
    </label>
    <ErrorState v-if="error" :error="error" compact @retry="save(lastAttempt.hidden, lastAttempt.excludeFromStats)" />
  </div>
</template>
