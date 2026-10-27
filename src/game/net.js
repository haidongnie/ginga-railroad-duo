import * as PK from 'playroomkit';

// Thin wrapper over Playroom Kit. If the multiplayer service cannot be reached the game
// keeps working solo through a local shim with the same surface.
let offline = false;
const local = { states: {}, rpc: {}, player: null };

function makeLocalPlayer() {
  const s = {};
  return {
    id: 'local',
    getState: (k) => s[k],
    setState: (k, v) => { s[k] = v; },
    getProfile: () => ({ name: '', color: { hexString: '#9fd4ff' } }),
    onQuit: () => () => {},
  };
}

export async function connect(defaultStates) {
  try {
    await Promise.race([
      PK.insertCoin({
        skipLobby: true,
        maxPlayersPerRoom: 2,
        defaultStates,
        reconnectGracePeriod: 8000,
        // Optional: register at dev.joinplayroom.com and build with VITE_PLAYROOM_GAME_ID=...
        ...(import.meta.env.VITE_PLAYROOM_GAME_ID ? { gameId: import.meta.env.VITE_PLAYROOM_GAME_ID } : {}),
      }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 20000)),
    ]);
  } catch (e) {
    console.warn('Playroom unavailable, playing offline:', e);
    offline = true;
    local.player = makeLocalPlayer();
    Object.assign(local.states, defaultStates);
  }
  return !offline;
}

export const isOffline = () => offline;
export const isHost = () => (offline ? true : PK.isHost());
export const myPlayer = () => (offline ? local.player : PK.myPlayer());
export const getState = (k) => (offline ? local.states[k] : PK.getState(k));
export const setState = (k, v) => (offline ? (local.states[k] = v) : PK.setState(k, v, true));
export const roomCode = () => (offline ? null : PK.getRoomCode());
// Everyone currently in the room (including me), readable synchronously.
export const players = () => (offline ? [local.player] : Object.values(PK.getParticipants()));

// Playroom patches object states key-by-key, so nulls and removed keys don't always propagate.
// Shared story state is therefore stored as JSON strings, which are replaced atomically.
const parsed = {};
export function getJSON(k) {
  const raw = getState(k);
  if (typeof raw !== 'string') return raw ?? null;
  if (parsed[k]?.raw !== raw) {
    let value = JSON.parse(raw);
    if (typeof value === 'string') value = JSON.parse(value); // remote copies can arrive double-encoded
    parsed[k] = { raw, value };
  }
  return parsed[k].value;
}
export const setJSON = (k, v) => setState(k, JSON.stringify(v));

export function onPlayerJoin(cb) {
  if (offline) cb(local.player);
  else PK.onPlayerJoin(cb);
}

const handlers = {};
export function register(name, fn) {
  handlers[name] = fn;
  if (!offline) PK.RPC.register(name, async (data, sender) => fn(data, sender));
}

// Runs on the host (directly when we are the host).
export function callHost(name, data) {
  if (offline || PK.isHost()) return handlers[name]?.(data, myPlayer());
  PK.RPC.call(name, data, PK.RPC.Mode.HOST);
}

export function broadcast(name, data) {
  handlers[name]?.(data, myPlayer());
  if (!offline) PK.RPC.call(name, data, PK.RPC.Mode.OTHERS);
}
