<script setup lang="ts">
import { computed, ref } from 'vue';
import type { SteamProfileDto } from '@steam-analytics/shared';
import AppIcon from '@/components/ui/AppIcon.vue';
import DataAsOf from '@/components/ui/DataAsOf.vue';

const props = defineProps<{ profile: SteamProfileDto; source?: 'live' | 'cache' | null }>();
const avatarFailed = ref(false);

const statusColor = computed(() => {
  if (props.profile.currentGame) return 'bg-success';
  return props.profile.personaState === 'offline' ? 'bg-muted' : 'bg-accent';
});
</script>

<template>
  <div class="card flex flex-col gap-4 sm:flex-row sm:items-center">
    <div class="relative shrink-0">
      <img v-if="!avatarFailed" :src="profile.avatarUrl" :alt="$t('profile.avatarAlt', { name: profile.personaName })" class="h-20 w-20 rounded-xl border border-line" @error="avatarFailed = true" />
      <div v-else class="flex h-20 w-20 items-center justify-center rounded-xl border border-line bg-surface-2 text-2xl font-semibold text-accent" aria-hidden="true">{{ profile.personaName.slice(0, 1).toUpperCase() }}</div>
      <span class="absolute -right-1 -bottom-1 h-4 w-4 rounded-full border-2 border-surface" :class="statusColor" />
    </div>
    <div class="flex min-w-0 flex-1 flex-col gap-1">
      <div class="flex flex-wrap items-center gap-2">
        <h2 class="truncate text-xl font-semibold">{{ profile.personaName }}</h2>
        <span v-if="profile.steamLevel !== null" class="badge border border-accent/50 text-accent">{{ $t('profile.level', { level: profile.steamLevel }) }}</span>
        <span v-else class="badge bg-surface-2 text-muted">{{ $t('profile.levelUnavailable') }}</span>
        <span v-if="profile.communityVisibility !== 'public'" class="badge bg-warning/15 text-warning">
          <AppIcon name="lock" :size="12" />{{ $t('profile.private') }}
        </span>
      </div>
      <p class="text-sm">
        <span v-if="profile.currentGame" class="text-success">{{ $t('profile.playing', { game: profile.currentGame.name }) }}</span>
        <span v-else class="text-muted">{{ $t(`profile.state.${profile.personaState}`) }}</span>
        <span v-if="profile.communityVisibility !== 'public'" class="ml-1 text-xs text-muted">({{ $t('profile.statusMayBeInaccurate') }})</span>
      </p>
      <p class="font-mono text-xs text-muted">SteamID64: {{ profile.steamId }}</p>
      <DataAsOf :at="profile.summaryFetchedAt" :source="source" />
    </div>
    <a :href="profile.profileUrl" target="_blank" rel="noopener noreferrer" class="btn btn-secondary self-start sm:self-center">
      {{ $t('profile.viewOnSteam') }} <AppIcon name="external" :size="16" />
    </a>
  </div>
</template>
