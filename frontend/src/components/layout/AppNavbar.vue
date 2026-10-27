<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useSteamStore } from '@/stores/steam';
import AppIcon from '@/components/ui/AppIcon.vue';
import SyncStatusIndicator from '@/components/steam/SyncStatusIndicator.vue';

defineEmits<{ menu: [] }>();
const authStore = useAuthStore();
const steam = useSteamStore();
const router = useRouter();
const avatarFailed = ref(false);

async function logout() {
  steam.reset();
  await authStore.logout();
  await router.push({ name: 'login' });
}
</script>

<template>
  <header class="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line bg-bg/80 px-4 backdrop-blur lg:px-8">
    <button type="button" class="btn btn-ghost px-2 lg:hidden" :aria-label="$t('nav.open')" @click="$emit('menu')">
      <AppIcon name="menu" />
    </button>
    <div class="flex-1" />
    <SyncStatusIndicator v-if="authStore.steamLinked" />
    <RouterLink :to="{ name: 'settings' }" class="flex items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-surface-2">
      <img v-if="steam.profile && !avatarFailed" :src="steam.profile.avatarUrl" alt="" class="h-7 w-7 rounded-md" @error="avatarFailed = true" />
      <span v-else class="flex h-7 w-7 items-center justify-center rounded-md bg-accent/20 text-xs font-semibold text-accent">{{ authStore.me?.displayName?.slice(0, 1).toUpperCase() }}</span>
      <span class="hidden max-w-[10rem] truncate sm:inline">{{ authStore.me?.displayName }}</span>
    </RouterLink>
    <button type="button" class="btn btn-ghost px-2" :aria-label="$t('auth.logout')" :title="$t('auth.logout')" @click="logout">
      <AppIcon name="logout" :size="18" />
    </button>
  </header>
</template>
