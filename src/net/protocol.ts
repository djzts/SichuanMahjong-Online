/** Network messages between clients and the host. Bump PROTOCOL_VERSION on any change. */
import type { Action } from '../engine/game';
import type { Role } from '../engine/room';
import type { ClientView } from '../engine/view';

export { PROTOCOL_VERSION } from '../engine/view';

export type ClientMsg =
  | { t: 'hello'; v: number; playerId: string; name: string; role: Role }
  | { t: 'intent'; action: Action }
  /** Lobby only: move between a player seat and a spectator slot. */
  | { t: 'switch'; role: Role }
  | { t: 'ping' };

export type RejectReason = 'full' | 'version' | 'kicked';

export type HostMsg =
  | { t: 'welcome'; role: Role; seat: number | null; note?: string }
  | { t: 'state'; view: ClientView }
  | { t: 'reject'; reason: RejectReason }
  | { t: 'error'; message: string }
  | { t: 'ping' };

export function isClientMsg(x: unknown): x is ClientMsg {
  return !!x && typeof x === 'object' && typeof (x as { t?: unknown }).t === 'string';
}

export function isHostMsg(x: unknown): x is HostMsg {
  return !!x && typeof x === 'object' && typeof (x as { t?: unknown }).t === 'string';
}
