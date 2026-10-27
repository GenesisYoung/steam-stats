<script setup lang="ts">
import { computed } from 'vue';
import VChart from 'vue-echarts';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { BarChart, LineChart, PieChart, ScatterChart } from 'echarts/charts';
import { DataZoomComponent, GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import type { ChartOption } from './types';
import { useChartTheme } from '@/composables/useChartTheme';
import SkeletonBlock from '@/components/ui/SkeletonBlock.vue';

use([CanvasRenderer, BarChart, LineChart, PieChart, ScatterChart, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent]);

const props = withDefaults(defineProps<{ option: ChartOption; loading?: boolean; height?: string; label: string }>(), { height: '320px' });
const theme = useChartTheme();

type AxisLike = Record<string, unknown>;

// ECharts ignores CSS variables, so axis colors are applied here for every chart.
function themeAxis(axis: unknown): unknown {
  if (Array.isArray(axis)) return axis.map(themeAxis);
  if (!axis || typeof axis !== 'object') return axis;
  const a = axis as AxisLike;
  const t = theme.value;
  return {
    ...a,
    axisLabel: { color: t.muted, ...(a.axisLabel as AxisLike) },
    axisLine: { lineStyle: { color: t.grid }, ...(a.axisLine as AxisLike) },
    axisTick: { lineStyle: { color: t.grid }, ...(a.axisTick as AxisLike) },
    splitLine: { ...(a.splitLine as AxisLike), lineStyle: { color: t.grid, ...((a.splitLine as AxisLike | undefined)?.lineStyle as AxisLike) } },
    nameTextStyle: { color: t.muted, ...(a.nameTextStyle as AxisLike) },
  };
}

const themed = computed<ChartOption>(() => {
  const t = theme.value;
  const legend = props.option.legend as AxisLike | undefined;
  return {
    color: t.palette,
    textStyle: { color: t.text, fontFamily: 'inherit' },
    grid: { left: 12, right: 16, top: 32, bottom: 12, containLabel: true },
    ...props.option,
    tooltip: { backgroundColor: t.tooltipBg, borderColor: t.grid, textStyle: { color: t.text }, confine: true, ...(props.option.tooltip as AxisLike) },
    ...(legend ? { legend: { ...legend, textStyle: { color: t.muted } } } : {}),
    ...(props.option.xAxis ? { xAxis: themeAxis(props.option.xAxis) } : {}),
    ...(props.option.yAxis ? { yAxis: themeAxis(props.option.yAxis) } : {}),
  } as ChartOption;
});
</script>

<template>
  <div :style="{ height }" role="img" :aria-label="label">
    <SkeletonBlock v-if="loading" class="h-full w-full" />
    <VChart v-else :option="themed" autoresize class="h-full w-full" />
  </div>
</template>
