<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { useSteamStore } from '@/stores/steam';
import AppSidebar from './AppSidebar.vue';
import AppNavbar from './AppNavbar.vue';

const sidebarOpen = ref(false);
const authStore = useAuthStore();
const steam = useSteamStore();

function loadSteam() {
  if (!authStore.steamLinked) return;
  void steam.loadSyncStatus().catch(() => undefined);
  if (!steam.profile) void steam.loadProfile();
}

onMounted(loadSteam);
watch(() => authStore.me?.steamId, loadSteam);
</script>

<template>
  <div class="flex min-h-screen">
    <a href="#main" class="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-accent focus:px-3 focus:py-2 focus:text-accent-contrast">{{ $t('nav.skip') }}</a>
    <AppSidebar :open="sidebarOpen" @close="sidebarOpen = false" />
    <div class="flex min-w-0 flex-1 flex-col">
      <AppNavbar @menu="sidebarOpen = true" />
      <div v-if="!authStore.emailVerified" class="border-b border-warning/30 bg-warning/10 px-4 py-2 text-sm text-warning lg:px-8">
        {{ $t('auth.verifyBanner') }}
        <RouterLink :to="{ name: 'verify-email' }" class="ml-1 underline">{{ $t('auth.verifyBannerCta') }}</RouterLink>
      </div>
      <main id="main" class="mx-auto w-full max-w-7xl flex-1 px-4 py-6 lg:px-8">
        <RouterView v-slot="{ Component }">
          <Transition name="fade" mode="out-in">
            <component :is="Component" />
          </Transition>
        </RouterView>
      </main>
    </div>
  </div>
</template>
