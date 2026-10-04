import { describe, expect, it } from 'vitest';
import { Playlist } from '../src/models/Playlist';
import type { Song } from '../src/models/Song';

const song = (id: string): Song => ({ id, title: id, artist: 'Artist', album: 'Album', duration: 60, source: 'local' });

describe('Playlist', () => {
  it('moves forward and backward through the list', () => {
    const playlist = Playlist.fromSongs('Test', [song('A'), song('B'), song('C')]);
    playlist.select(0);
    expect(playlist.next()?.value.id).toBe('B');
    expect(playlist.next()?.value.id).toBe('C');
    expect(playlist.next()).toBeNull();
    expect(playlist.current?.value.id).toBe('C');
    expect(playlist.previous()?.value.id).toBe('B');
  });

  it('loops from tail to head when asked', () => {
    const playlist = Playlist.fromSongs('Test', [song('A'), song('B')]);
    playlist.select(1);
    expect(playlist.next(true)?.value.id).toBe('A');
    expect(playlist.previous(true)?.value.id).toBe('B');
  });

  it('adds songs at the start, end and any position', () => {
    const playlist = new Playlist('Test');
    playlist.addLast(song('C'));
    playlist.addFirst(song('A'));
    playlist.addAt(1, song('B'));
    expect(playlist.songs.toArray().map((s) => s.id)).toEqual(['A', 'B', 'C']);
    expect(playlist.totalDuration).toBe(180);
  });

  it('moves the current pointer when the current song is removed', () => {
    const playlist = Playlist.fromSongs('Test', [song('A'), song('B'), song('C')]);
    playlist.select(1);
    const { wasCurrent } = playlist.removeAt(1);
    expect(wasCurrent).toBe(true);
    expect(playlist.current?.value.id).toBe('C');
  });

  it('keeps the current song selected after moving it', () => {
    const playlist = Playlist.fromSongs('Test', [song('A'), song('B'), song('C')]);
    playlist.select(0);
    playlist.move(0, 2);
    expect(playlist.current?.value.id).toBe('A');
    expect(playlist.currentIndex()).toBe(2);
  });

  it('serializes and restores the order', () => {
    const songs = [song('A'), song('B')];
    const playlist = Playlist.fromSongs('Test', songs);
    const restored = Playlist.fromData(playlist.toData(), (id) => songs.find((s) => s.id === id));
    expect(restored.songs.toArray().map((s) => s.id)).toEqual(['A', 'B']);
    expect(restored.name).toBe('Test');
  });
});
