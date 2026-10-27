<script setup lang="ts">
import type { PriceDto } from '@steam-analytics/shared';
import { useFormat } from '@/composables/useFormat';

defineProps<{ price: PriceDto }>();
const f = useFormat();
</script>

<template>
  <span v-if="price.status === 'priced'" class="inline-flex items-center gap-1.5">
    <span v-if="price.discountPercent" class="badge bg-success/20 text-success">-{{ price.discountPercent }}%</span>
    <span class="font-medium">{{ f.money(price.price) }}</span>
  </span>
  <span v-else-if="price.status === 'free'" class="badge bg-accent/15 text-accent">{{ $t('price.free') }}</span>
  <span v-else class="badge bg-surface-2 text-muted" :title="$t(`price.reason.${price.status}`)">{{ $t('common.unavailable') }}</span>
</template>
