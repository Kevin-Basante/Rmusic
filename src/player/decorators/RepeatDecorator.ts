import type { MusicPlayer } from '../MusicPlayer';
import { PlayerDecorator } from './PlayerDecorator';

export type RepeatMode = 'all' | 'one';

/**
 * "all": when the tail is reached, playback continues from the head
 *        (the list behaves like a circular doubly linked list).
 * "one": the current song is played again when it ends.
 */
export class RepeatDecorator extends PlayerDecorator {
  private readonly mode: RepeatMode;

  constructor(inner: MusicPlayer, mode: RepeatMode) {
    super(inner);
    this.mode = mode;
  }

  protected get name(): string {
    return `Repeat:${this.mode}`;
  }

  async next(): Promise<boolean> {
    const moved = await this.inner.next();
    if (moved) return true;
    return this.inner.playFirst();
  }

  async previous(): Promise<boolean> {
    const moved = await this.inner.previous();
    if (moved) return true;
    const playlist = this.getPlaylist();
    if (!playlist || playlist.length === 0) return false;
    await this.inner.playAt(playlist.length - 1);
    return true;
  }

  async handleTrackEnd(): Promise<void> {
    if (this.mode === 'one') {
      this.engine.currentTime = 0;
      await this.inner.play();
      return;
    }
    await this.next();
  }
}
