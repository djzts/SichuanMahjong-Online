import type { Tile } from './tiles';

export type MeldKind = 'pung' | 'kong-exposed' | 'kong-concealed' | 'kong-added';

export interface Meld {
  kind: MeldKind;
  tile: Tile;
  /** Seat the claimed tile came from (pung / exposed kong). */
  from?: number;
}

export const isKong = (m: Meld): boolean => m.kind !== 'pung';
