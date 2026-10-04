import type { Playlist } from '../models/Playlist';
import type { Song } from '../models/Song';
import type { AudioEngine } from './AudioEngine';

/**
 * Component interface of the Decorator pattern.
 * The base player and every decorator implement it, so decorators can be
 * stacked in any order: new LoggerDecorator(new ShuffleDecorator(new BasePlayer(...))).
 */
export interface MusicPlayer {
  readonly engine: AudioEngine;

  getPlaylist(): Playlist | null;
  setPlaylist(playlist: Playlist): void;
  getCurrentSong(): Song | null;

  /** Plays the song at a position of the current playlist. */
  playAt(index: number): Promise<void>;
  /** Starts the playlist from its first song (in the active order). */
  playFirst(): Promise<boolean>;
  play(): Promise<void>;
  pause(): Promise<void>;
  togglePlay(): Promise<void>;
  /** Moves forward. Returns false when there is no next song. */
  next(): Promise<boolean>;
  /** Moves backward. Returns false when there is no previous song. */
  previous(): Promise<boolean>;
  /** Called when the current song finishes. */
  handleTrackEnd(): Promise<void>;
  stop(): void;

  /** Readable description of the decorator chain, e.g. "Logger(Shuffle(AudioPlayer))". */
  describe(): string;
}
