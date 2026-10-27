import type { GameSortKey } from '@steam-analytics/shared';

export interface FilterState {
  q: string;
  sort: GameSortKey;
  order: 'asc' | 'desc' | undefined;
  played: 'all' | 'yes' | 'no';
  achievements: 'all' | 'yes' | 'no';
}
