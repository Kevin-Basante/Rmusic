import type { MusicPlayer } from '../MusicPlayer';
import { PlayerDecorator } from './PlayerDecorator';

/**
 * Adds smooth volume fades: fade-out before pausing or changing song,
 * fade-in when the new song starts.
 */
export class FadeDecorator extends PlayerDecorator {
  private readonly duration: number;

  constructor(inner: MusicPlayer, duration = 600) {
    super(inner);
    this.duration = duration;
  }

  protected get name(): string {
    return 'Fade';
  }

  async play(): Promise<void> {
    this.engine.setFadeLevel(0);
    await this.inner.play();
    await this.engine.fadeTo(1, this.duration);
  }

  async pause(): Promise<void> {
    await this.engine.fadeTo(0, this.duration / 2);
    await this.inner.pause();
    this.engine.setFadeLevel(1);
  }

  playAt(index: number): Promise<void> {
    return this.withFade(() => this.inner.playAt(index));
  }

  playFirst(): Promise<boolean> {
    return this.withFade(() => this.inner.playFirst());
  }

  next(): Promise<boolean> {
    return this.withFade(() => this.inner.next());
  }

  previous(): Promise<boolean> {
    return this.withFade(() => this.inner.previous());
  }

  async handleTrackEnd(): Promise<void> {
    this.engine.setFadeLevel(0);
    await this.inner.handleTrackEnd();
    await this.engine.fadeTo(1, this.duration);
  }

  private async withFade<T>(action: () => Promise<T>): Promise<T> {
    if (!this.engine.paused) await this.engine.fadeTo(0, this.duration / 2);
    else this.engine.setFadeLevel(0);
    const result = await action();
    await this.engine.fadeTo(1, this.duration);
    return result;
  }
}
