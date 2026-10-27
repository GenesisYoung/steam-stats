<script setup lang="ts">
import { useAuthStore } from '@/stores/auth';
import AppIcon from '@/components/ui/AppIcon.vue';

const authStore = useAuthStore();
const features = [
  { icon: 'clock', key: 'playtime' },
  { icon: 'trophy', key: 'achievements' },
  { icon: 'wallet', key: 'value' },
  { icon: 'chart', key: 'efficiency' },
  { icon: 'lock', key: 'security' },
  { icon: 'refresh', key: 'sync' },
];
</script>

<template>
  <div class="min-h-screen">
    <header class="mx-auto flex max-w-6xl items-center justify-between px-4 py-5">
      <div class="flex items-center gap-2 text-lg font-semibold">
        <img src="/favicon.svg" alt="" class="h-9 w-9" />
        <span>Steam <span class="text-accent">Analytics</span></span>
      </div>
      <nav class="flex gap-2">
        <template v-if="authStore.isAuthenticated">
          <RouterLink :to="{ name: 'dashboard' }" class="btn btn-primary">{{ $t('landing.openDashboard') }}</RouterLink>
        </template>
        <template v-else>
          <RouterLink :to="{ name: 'login' }" class="btn btn-ghost">{{ $t('auth.login') }}</RouterLink>
          <RouterLink :to="{ name: 'register' }" class="btn btn-primary">{{ $t('auth.register') }}</RouterLink>
        </template>
      </nav>
    </header>

    <main class="mx-auto max-w-6xl px-4">
      <section class="py-16 text-center sm:py-24">
        <p class="badge mb-5 border border-accent/40 text-accent">{{ $t('landing.badge') }}</p>
        <h1 class="mx-auto max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl">{{ $t('landing.title') }}</h1>
        <p class="mx-auto mt-5 max-w-2xl text-lg text-muted">{{ $t('landing.subtitle') }}</p>
        <div class="mt-8 flex justify-center gap-3">
          <RouterLink :to="{ name: authStore.isAuthenticated ? 'dashboard' : 'register' }" class="btn btn-primary px-6 py-3 text-base">{{ $t('landing.cta') }}</RouterLink>
        </div>
      </section>

      <section class="grid gap-4 pb-16 sm:grid-cols-2 lg:grid-cols-3">
        <article v-for="f in features" :key="f.key" class="card">
          <AppIcon :name="f.icon" :size="24" class="mb-3 text-accent" />
          <h2 class="font-semibold">{{ $t(`landing.features.${f.key}.title`) }}</h2>
          <p class="mt-1 text-sm text-muted">{{ $t(`landing.features.${f.key}.body`) }}</p>
        </article>
      </section>

      <p class="pb-10 text-center text-xs text-muted">{{ $t('nav.disclaimer') }}</p>
    </main>
  </div>
</template>
