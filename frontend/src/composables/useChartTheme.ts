import { computed } from 'vue';
import { isDark } from './useTheme';

/** Chart colors derived from the active theme (ECharts cannot read CSS variables). */
export function useChartTheme() {
  return computed(() => {
    const dark = isDark.value;
    return {
      text: dark ? '#e6edf3' : '#13202c',
      muted: dark ? '#8fa3b8' : '#566a7f',
      grid: dark ? '#263445' : '#d5dde6',
      tooltipBg: dark ? '#16212e' : '#ffffff',
      palette: dark
        ? ['#66c0f4', '#a4d007', '#f5a623', '#c06cf0', '#5ec2b7', '#ef6a6a', '#8fa3b8', '#ffd166', '#4f8cff', '#e58ad6']
        : ['#1a73c9', '#5d8a00', '#c47d0e', '#8b3fc4', '#2b8f85', '#c43a3a', '#566a7f', '#b8901d', '#3260c9', '#b4489f'],
    };
  });
}
