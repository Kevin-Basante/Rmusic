import type { Playlist } from '../../models/Playlist';
import type { Song } from '../../models/Song';
import type { AudioEngine } from '../AudioEngine';
import type { MusicPlayer } from '../MusicPlayer';

/**
 * Base decorator: wraps another MusicPlayer and forwards every call to it.
 * Concrete decorators extend this class and override only the behaviour
 * they want to change, without modifying the wrapped player.
 */
export abstract class PlayerDecorator implements MusicPlayer {
  protected readonly inner: MusicPlayer;

  constructor(inner: MusicPlayer) {
    this.inner = inner;
  }

  get engine(): AudioEngine {
    return this.inner.engine;
  }

  getPlaylist(): Playlist | null {
    return this.inner.getPlaylist();
  }

  setPlaylist(playlist: Playlist): void {
    this.inner.setPlaylist(playlist);
  }

  getCurrentSong(): Song | null {
    return this.inner.getCurrentSong();
  }

  playAt(index: number): Promise<void> {
    return this.inner.playAt(index);
  }

  playFirst(): Promise<boolean> {
    return this.inner.playFirst();
  }

  play(): Promise<void> {
    return this.inner.play();
  }

  pause(): Promise<void> {
    return this.inner.pause();
  }

  /** Uses this decorator's own play/pause so their extra behaviour applies. */
  async togglePlay(): Promise<void> {
    if (this.engine.paused) await this.play();
    else await this.pause();
  }

  next(): Promise<boolean> {
    return this.inner.next();
  }

  previous(): Promise<boolean> {
    return this.inner.previous();
  }

  handleTrackEnd(): Promise<void> {
    return this.inner.handleTrackEnd();
  }

  stop(): void {
    this.inner.stop();
  }

  describe(): string {
    return `${this.name}(${this.inner.describe()})`;
  }

  protected abstract get name(): string;
}
