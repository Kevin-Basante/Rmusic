import { PlayerDecorator } from './PlayerDecorator';

/**
 * Plays the songs of the playlist in random order without repeating
 * any song until all of them have been played. "Previous" goes back
 * through the songs that were actually played.
 */
export class ShuffleDecorator extends PlayerDecorator {
  private readonly history: string[] = [];
  private played = new Set<string>();

  protected get name(): string {
    return 'Shuffle';
  }

  async playAt(index: number): Promise<void> {
    this.remember();
    await this.inner.playAt(index);
    this.markCurrent();
  }

  async playFirst(): Promise<boolean> {
    this.played.clear();
    return this.playRandom();
  }

  async next(): Promise<boolean> {
    this.remember();
    return this.playRandom();
  }

  async previous(): Promise<boolean> {
    const playlist = this.getPlaylist();
    if (this.engine.currentTime > 3 || !playlist) return this.inner.previous();

    while (this.history.length > 0) {
      const index = playlist.indexOfSong(this.history.pop()!);
      if (index !== -1) {
        await this.inner.playAt(index);
        return true;
      }
    }
    return this.inner.previous();
  }

  async handleTrackEnd(): Promise<void> {
    const moved = await this.next();
    if (!moved) {
      this.engine.pause();
      this.engine.currentTime = 0;
    }
  }

  private async playRandom(): Promise<boolean> {
    const playlist = this.getPlaylist();
    if (!playlist || playlist.length === 0) return false;
    this.markCurrent();

    // Collect the positions that have not been played yet.
    const candidates: number[] = [];
    let node = playlist.songs.head;
    let i = 0;
    while (node) {
      if (!this.played.has(node.value.id)) candidates.push(i);
      node = node.next;
      i++;
    }
    if (candidates.length === 0) {
      this.played.clear();
      return false;
    }

    const index = candidates[Math.floor(Math.random() * candidates.length)];
    await this.inner.playAt(index);
    this.markCurrent();
    return true;
  }

  private remember(): void {
    const song = this.getCurrentSong();
    if (song) this.history.push(song.id);
    if (this.history.length > 100) this.history.shift();
  }

  private markCurrent(): void {
    const song = this.getCurrentSong();
    if (song) this.played.add(song.id);
  }
}
