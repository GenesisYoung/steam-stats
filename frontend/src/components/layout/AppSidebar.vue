<script setup lang="ts">
import AppIcon from '@/components/ui/AppIcon.vue';

defineProps<{ open: boolean }>();
defineEmits<{ close: [] }>();

const items = [
  { name: 'dashboard', icon: 'dashboard' },
  { name: 'library', icon: 'library' },
  { name: 'achievements', icon: 'trophy' },
  { name: 'analytics', icon: 'chart' },
  { name: 'valuation', icon: 'wallet' },
  { name: 'settings', icon: 'settings' },
] as const;
</script>

<template>
  <div v-if="open" class="fixed inset-0 z-30 bg-black/50 lg:hidden" aria-hidden="true" @click="$emit('close')" />
  <aside
    class="fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-line bg-bg-elevated transition-transform duration-200 lg:static lg:translate-x-0"
    :class="open ? 'translate-x-0' : '-translate-x-full'"
    :aria-label="$t('nav.main')"
  >
    <div class="flex h-16 items-center justify-between gap-2 px-5">
      <RouterLink :to="{ name: 'dashboard' }" class="flex items-center gap-2 font-semibold tracking-tight">
        <img src="/favicon.svg" alt="" class="h-8 w-8" />
        <span>Steam <span class="text-accent">Analytics</span></span>
      </RouterLink>
      <button type="button" class="btn btn-ghost px-2 lg:hidden" :aria-label="$t('nav.close')" @click="$emit('close')">
        <AppIcon name="close" />
      </button>
    </div>
    <nav class="flex flex-1 flex-col gap-1 px-3 py-2">
      <RouterLink
        v-for="item in items"
        :key="item.name"
        :to="{ name: item.name }"
        class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-fg"
        active-class="!bg-accent/15 !text-accent"
        @click="$emit('close')"
      >
        <AppIcon :name="item.icon" :size="18" />
        {{ $t(`nav.${item.name}`) }}
      </RouterLink>
    </nav>
    <p class="px-5 py-4 text-[11px] leading-relaxed text-muted/80">{{ $t('nav.disclaimer') }}</p>
  </aside>
</template>
