import { DoublyLinkedList } from '../structures/DoublyLinkedList';
import type { Node } from '../structures/Node';
import { createId, type Song } from './Song';

export interface PlaylistData {
  id: string;
  name: string;
  createdAt: number;
  songIds: string[];
}

/**
 * A playlist is a doubly linked list of songs plus a pointer to the
 * node that is currently selected. Moving forward follows "next",
 * moving backward follows "prev".
 */
export class Playlist {
  id: string;
  name: string;
  createdAt: number;
  /** Temporary playlists (search results, library) are not saved. */
  temporary: boolean;
  readonly songs: DoublyLinkedList<Song>;
  current: Node<Song> | null;

  constructor(name: string, id = createId('playlist'), temporary = false) {
    this.id = id;
    this.name = name;
    this.createdAt = Date.now();
    this.temporary = temporary;
    this.songs = new DoublyLinkedList<Song>();
    this.current = null;
  }

  static fromSongs(name: string, songs: Song[], temporary = false): Playlist {
    const playlist = new Playlist(name, createId('playlist'), temporary);
    songs.forEach((song) => playlist.addLast(song));
    return playlist;
  }

  get length(): number {
    return this.songs.length;
  }

  get totalDuration(): number {
    let total = 0;
    for (const song of this.songs) total += song.duration;
    return total;
  }

  addFirst(song: Song): Node<Song> {
    return this.songs.prepend(song);
  }

  addLast(song: Song): Node<Song> {
    return this.songs.append(song);
  }

  /** Adds a song at any position (0 = first). */
  addAt(index: number, song: Song): Node<Song> {
    return this.songs.insert(index, song);
  }

  /** Removes a song. If it was the current song, the pointer moves to its neighbour. */
  removeAt(index: number): { song: Song; wasCurrent: boolean } {
    const node = this.songs.traverseToIndex(index);
    const wasCurrent = node === this.current;
    if (wasCurrent) this.current = node.next ?? node.prev;
    const song = this.songs.removeNode(node);
    return { song, wasCurrent };
  }

  /** Moves a song to another position, keeping the current pointer on it. */
  move(from: number, to: number): void {
    if (from === to) return;
    const wasCurrent = this.songs.traverseToIndex(from) === this.current;
    const newNode = this.songs.move(from, to);
    if (wasCurrent) this.current = newNode;
  }

  select(index: number): Node<Song> {
    this.current = this.songs.traverseToIndex(index);
    return this.current;
  }

  currentIndex(): number {
    return this.current ? this.songs.indexOfNode(this.current) : -1;
  }

  /** Follows the "next" pointer. With loop = true the tail connects to the head. */
  next(loop = false): Node<Song> | null {
    if (!this.current) return this.songs.head;
    const node = this.current.next ?? (loop ? this.songs.head : null);
    if (node) this.current = node;
    return node;
  }

  /** Follows the "prev" pointer. With loop = true the head connects to the tail. */
  previous(loop = false): Node<Song> | null {
    if (!this.current) return this.songs.tail;
    const node = this.current.prev ?? (loop ? this.songs.tail : null);
    if (node) this.current = node;
    return node;
  }

  indexOfSong(songId: string): number {
    let node = this.songs.head;
    let i = 0;
    while (node) {
      if (node.value.id === songId) return i;
      node = node.next;
      i++;
    }
    return -1;
  }

  toData(): PlaylistData {
    return {
      id: this.id,
      name: this.name,
      createdAt: this.createdAt,
      songIds: this.songs.toArray().map((song) => song.id),
    };
  }

  static fromData(data: PlaylistData, lookup: (id: string) => Song | undefined): Playlist {
    const playlist = new Playlist(data.name, data.id);
    playlist.createdAt = data.createdAt;
    for (const id of data.songIds) {
      const song = lookup(id);
      if (song) playlist.addLast(song);
    }
    return playlist;
  }
}
