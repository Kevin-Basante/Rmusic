export type SongSource = 'local' | 'jamendo';

/** A song that can be stored in a playlist. */
export interface Song {
  id: string;
  title: string;
  artist: string;
  album: string;
  /** Duration in seconds (0 when unknown). */
  duration: number;
  source: SongSource;
  /** Stream URL for online songs. Local songs are resolved from their stored file. */
  audioUrl?: string;
  /** Cover image URL for online songs. */
  coverUrl?: string;
}

/** A song as it is saved in the browser database (local files include their binary data). */
export interface StoredSong extends Song {
  file?: Blob;
  cover?: Blob;
  addedAt: number;
}

export function createId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
