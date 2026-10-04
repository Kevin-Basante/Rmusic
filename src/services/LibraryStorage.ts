import type { PlaylistData } from '../models/Playlist';
import type { Song, StoredSong } from '../models/Song';

const DB_NAME = 'wave-player';
const DB_VERSION = 1;
const SONGS = 'songs';
const PLAYLISTS = 'playlists';

/**
 * Saves the library (including local audio files) and the playlists
 * in the browser with IndexedDB, so nothing is lost after a reload.
 */
export class LibraryStorage {
  private db: IDBDatabase | null = null;
  private readonly objectUrls = new Map<string, string>();

  async open(): Promise<void> {
    this.db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(SONGS)) db.createObjectStore(SONGS, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(PLAYLISTS)) db.createObjectStore(PLAYLISTS, { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  getSongs(): Promise<StoredSong[]> {
    return this.request<StoredSong[]>(SONGS, 'readonly', (store) => store.getAll());
  }

  async saveSong(song: StoredSong): Promise<void> {
    await this.request(SONGS, 'readwrite', (store) => store.put(song));
  }

  async deleteSong(id: string): Promise<void> {
    await this.request(SONGS, 'readwrite', (store) => store.delete(id));
    const url = this.objectUrls.get(id);
    if (url) URL.revokeObjectURL(url);
    this.objectUrls.delete(id);
    this.objectUrls.delete(`${id}#cover`);
  }

  getPlaylists(): Promise<PlaylistData[]> {
    return this.request<PlaylistData[]>(PLAYLISTS, 'readonly', (store) => store.getAll());
  }

  async savePlaylist(playlist: PlaylistData): Promise<void> {
    await this.request(PLAYLISTS, 'readwrite', (store) => store.put(playlist));
  }

  async deletePlaylist(id: string): Promise<void> {
    await this.request(PLAYLISTS, 'readwrite', (store) => store.delete(id));
  }

  /** Returns a playable URL. Local files get a temporary object URL. */
  async resolveAudioUrl(song: Song): Promise<string> {
    if (song.source !== 'local') return song.audioUrl ?? '';
    const cached = this.objectUrls.get(song.id);
    if (cached) return cached;
    const stored = await this.request<StoredSong | undefined>(SONGS, 'readonly', (store) => store.get(song.id));
    if (!stored?.file) throw new Error('The audio file is no longer available.');
    const url = URL.createObjectURL(stored.file);
    this.objectUrls.set(song.id, url);
    return url;
  }

  /** Creates (once) an object URL for a stored cover image. */
  coverUrlFor(song: StoredSong): string | undefined {
    if (!song.cover) return song.coverUrl;
    const key = `${song.id}#cover`;
    let url = this.objectUrls.get(key);
    if (!url) {
      url = URL.createObjectURL(song.cover);
      this.objectUrls.set(key, url);
    }
    return url;
  }

  private request<T>(
    storeName: string,
    mode: IDBTransactionMode,
    action: (store: IDBObjectStore) => IDBRequest,
  ): Promise<T> {
    if (!this.db) return Promise.reject(new Error('Database is not open.'));
    return new Promise<T>((resolve, reject) => {
      const transaction = this.db!.transaction(storeName, mode);
      const request = action(transaction.objectStore(storeName));
      request.onsuccess = () => resolve(request.result as T);
      request.onerror = () => reject(request.error);
    });
  }
}
