import type { Playlist } from '../models/Playlist';
import type { Song } from '../models/Song';
import type { AudioEngine } from './AudioEngine';
import type { MusicPlayer } from './MusicPlayer';

export type UrlResolver = (song: Song) => Promise<string>;

/**
 * Concrete component of the Decorator pattern.
 * Plays a playlist in order by following the "next" and "prev"
 * pointers of its doubly linked list.
 */
export class BasePlayer implements MusicPlayer {
  readonly engine: AudioEngine;
  private readonly resolveUrl: UrlResolver;
  private playlist: Playlist | null = null;
  private loadToken = 0;

  constructor(engine: AudioEngine, resolveUrl: UrlResolver) {
    this.engine = engine;
    this.resolveUrl = resolveUrl;
  }

  getPlaylist(): Playlist | null {
    return this.playlist;
  }

  setPlaylist(playlist: Playlist): void {
    this.playlist = playlist;
    this.engine.emit('playlistchange');
  }

  getCurrentSong(): Song | null {
    return this.playlist?.current?.value ?? null;
  }

  async playAt(index: number): Promise<void> {
    if (!this.playlist || this.playlist.length === 0) return;
    this.playlist.select(index);
    await this.loadCurrent(true);
  }

  async playFirst(): Promise<boolean> {
    if (!this.playlist || this.playlist.length === 0) return false;
    await this.playAt(0);
    return true;
  }

  async play(): Promise<void> {
    if (!this.playlist || this.playlist.length === 0) return;
    if (!this.engine.hasSource) {
      if (!this.playlist.current) this.playlist.select(0);
      await this.loadCurrent(true);
      return;
    }
    await this.engine.play();
  }

  async pause(): Promise<void> {
    this.engine.pause();
  }

  async togglePlay(): Promise<void> {
    if (this.engine.paused) await this.play();
    else await this.pause();
  }

  async next(): Promise<boolean> {
    if (!this.playlist) return false;
    const node = this.playlist.next();
    if (!node) return false;
    await this.loadCurrent(true);
    return true;
  }

  async previous(): Promise<boolean> {
    if (!this.playlist) return false;
    // Like most players: if the song is already advanced, "previous" restarts it.
    if (this.engine.currentTime > 3) {
      this.engine.currentTime = 0;
      return true;
    }
    const node = this.playlist.previous();
    if (!node) {
      this.engine.currentTime = 0;
      return false;
    }
    await this.loadCurrent(true);
    return true;
  }

  async handleTrackEnd(): Promise<void> {
    const moved = await this.next();
    if (!moved) {
      this.engine.pause();
      this.engine.currentTime = 0;
    }
  }

  stop(): void {
    this.engine.stop();
    if (this.playlist) this.playlist.current = null;
    this.engine.emit('songchange');
  }

  describe(): string {
    return 'AudioPlayer';
  }

  private async loadCurrent(autoplay: boolean): Promise<void> {
    const song = this.getCurrentSong();
    if (!song) return;
    const token = ++this.loadToken;
    const url = await this.resolveUrl(song);
    // A newer song was requested while this one was resolving.
    if (token !== this.loadToken) return;
    this.engine.load(url, song.source !== 'local');
    this.engine.emit('songchange');
    if (autoplay) await this.engine.play();
  }
}
