import type { Tile } from './tiles';

export type MeldKind = 'pung' | 'kong-exposed' | 'kong-concealed' | 'kong-added';

export interface Meld {
  kind: MeldKind;
  tile: Tile;
  /** Seat the claimed tile came from (pung / exposed kong). */
  from?: number;
  /**
   * Pung made while already holding a concealed triplet (the 4th copy stayed in hand).
   * A later added kong on it collects nothing (先碰后杠不收钱).
   */
  heldFourth?: boolean;
}

export const isKong = (m: Meld): boolean => m.kind !== 'pung';
