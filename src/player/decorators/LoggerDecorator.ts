import { PlayerDecorator } from './PlayerDecorator';

export interface LogEntry {
  time: number;
  action: string;
  song: string;
}

/**
 * Records every player operation and the song that ended up selected.
 * The app shows these entries in the "Activity" panel.
 */
export class LoggerDecorator extends PlayerDecorator {
  protected get name(): string {
    return 'Logger';
  }

  async playAt(index: number): Promise<void> {
    await this.inner.playAt(index);
    this.log(`playAt(${index})`);
  }

  async playFirst(): Promise<boolean> {
    const result = await this.inner.playFirst();
    this.log('playFirst()');
    return result;
  }

  async play(): Promise<void> {
    await this.inner.play();
    this.log('play()');
  }

  async pause(): Promise<void> {
    await this.inner.pause();
    this.log('pause()');
  }

  async next(): Promise<boolean> {
    const moved = await this.inner.next();
    this.log(moved ? 'next()' : 'next() - end of list');
    return moved;
  }

  async previous(): Promise<boolean> {
    const moved = await this.inner.previous();
    this.log(moved ? 'previous()' : 'previous() - start of list');
    return moved;
  }

  async handleTrackEnd(): Promise<void> {
    await this.inner.handleTrackEnd();
    this.log('trackEnded()');
  }

  stop(): void {
    this.inner.stop();
    this.log('stop()');
  }

  private log(action: string): void {
    const entry: LogEntry = {
      time: Date.now(),
      action,
      song: this.getCurrentSong()?.title ?? '-',
    };
    this.engine.emit('log', entry);
  }
}
