/** `useNowPlaying(player)`: the app's player's state (`nowPlaying.ts`), re-rendering as it changes. */
import { useSyncExternalStore } from 'react';
import { IDLE, type NowPlaying, type NowPlayingState } from './nowPlaying';

const unsubscribed = () => () => undefined;
const idle = () => IDLE;

/** `player` is null on the server (no `<audio>` there): the state stays idle. */
export function useNowPlaying(player: NowPlaying | null): NowPlayingState {
  return useSyncExternalStore(player?.subscribe ?? unsubscribed, player?.getState ?? idle, idle);
}
