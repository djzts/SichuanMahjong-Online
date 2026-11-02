/** Browser storage helpers. Every access is wrapped: storage can be unavailable or throw. */
import type { RoomState } from '../engine/room';

function get(store: () => Storage, key: string): string | null {
  try {
    return store().getItem(key);
  } catch {
    return null;
  }
}

function put(store: () => Storage, key: string, value: string | null): void {
  try {
    if (value === null) store().removeItem(key);
    else store().setItem(key, value);
  } catch {
    /* storage unavailable: features degrade gracefully */
  }
}

const local = () => localStorage;
const session = () => sessionStorage;

function uuid(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

/**
 * Per-tab player ID. sessionStorage survives a refresh (so a refreshed tab gets its seat back)
 * while letting several tabs on one computer act as different players. If a tab is closed and
 * reopened, the host falls back to matching the nickname of a disconnected seat.
 */
export function getPlayerId(): string {
  let id = get(session, 'scmj.playerId');
  if (!id) {
    id = uuid();
    put(session, 'scmj.playerId', id);
  }
  return id;
}

export function getName(): string {
  return get(local, 'scmj.name') ?? '';
}

export function setName(name: string): void {
  put(local, 'scmj.name', name);
}

const HOST_KEY = (code: string) => `scmj.host.${code}`;
const HOST_TTL_MS = 12 * 60 * 60 * 1000;

export function saveHostRoom(room: RoomState): void {
  put(local, HOST_KEY(room.code), JSON.stringify({ savedAt: Date.now(), room }));
  put(local, 'scmj.lastHost', room.code);
}

export function loadHostRoom(code: string): RoomState | null {
  const raw = get(local, HOST_KEY(code));
  if (!raw) return null;
  try {
    const { savedAt, room } = JSON.parse(raw) as { savedAt: number; room: RoomState };
    if (Date.now() - savedAt > HOST_TTL_MS) return null;
    return room;
  } catch {
    return null;
  }
}

export function clearHostRoom(code: string): void {
  put(local, HOST_KEY(code), null);
}

export function lastHostCode(): string | null {
  const code = get(local, 'scmj.lastHost');
  return code && loadHostRoom(code) ? code : null;
}
