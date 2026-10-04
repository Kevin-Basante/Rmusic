import { Playlist } from '../models/Playlist';
import { createId, type Song, type StoredSong } from '../models/Song';
import { AudioEngine } from '../player/AudioEngine';
import { BasePlayer } from '../player/BasePlayer';
import type { MusicPlayer } from '../player/MusicPlayer';
import { FadeDecorator } from '../player/decorators/FadeDecorator';
import { LoggerDecorator, type LogEntry } from '../player/decorators/LoggerDecorator';
import { RepeatDecorator } from '../player/decorators/RepeatDecorator';
import { ShuffleDecorator } from '../player/decorators/ShuffleDecorator';
import { readTags } from '../services/id3';
import { JamendoService } from '../services/JamendoService';
import { LibraryStorage } from '../services/LibraryStorage';
import { coverHtml, escapeHtml, formatLongDuration, formatTime, hueFrom, plural } from './format';
import { icons } from './icons';
import { Visualizer } from './Visualizer';

type View = { name: 'discover' } | { name: 'library' } | { name: 'playlist'; id: string };
type RepeatSetting = 'off' | 'all' | 'one';
type Position = 'start' | 'end' | 'index';

interface Settings {
  shuffle: boolean;
  repeat: RepeatSetting;
  fade: boolean;
  volume: number;
}

const SETTINGS_KEY = 'wave-settings';
const GENRES = ['pop', 'rock', 'electronic', 'hiphop', 'jazz', 'lounge', 'classical', 'ambient', 'indie', 'chillout'];
const AUDIO_EXTENSIONS = /\.(mp3|wav|ogg|oga|m4a|aac|flac|webm|opus)$/i;

export class App {
  private readonly root: HTMLElement;
  private readonly storage = new LibraryStorage();
  private readonly jamendo = new JamendoService();
  private readonly engine = new AudioEngine();
  private readonly base: BasePlayer;
  private player: MusicPlayer;

  private library = new Map<string, Song>();
  private playlists: Playlist[] = [];
  private view: View = { name: 'discover' };
  private results: Song[] = [];
  private searchQuery = '';
  private activeTag = '';
  private searching = false;
  private searchError = '';
  private libraryFilter: 'all' | 'local' | 'jamendo' = 'all';
  private settings: Settings;
  private logs: LogEntry[] = [];
  private dragIndex = -1;
  private seeking = false;
  private lastVolume = 0.8;

  constructor(root: HTMLElement) {
    this.root = root;
    this.settings = loadSettings();
    this.base = new BasePlayer(this.engine, (song) => this.storage.resolveAudioUrl(song));
    this.player = this.base;
    this.engine.setVolume(this.settings.volume);
  }

  async init(): Promise<void> {
    this.renderShell();
    this.buildPlayer();
    this.bindEvents();

    try {
      await this.storage.open();
      await this.loadData();
    } catch (error) {
      this.toast(`Storage is not available: ${(error as Error).message}`, 'error');
    }

    if (this.playlists.length > 0) this.view = { name: 'playlist', id: this.playlists[0].id };
    this.renderSidebar();
    this.renderMain();
    this.renderNowPlaying();
    this.updatePlayerBar();
    if (this.jamendo.isConfigured) void this.search();
  }

  // ---------------------------------------------------------------- data

  private async loadData(): Promise<void> {
    const songs = await this.storage.getSongs();
    songs.sort((a, b) => b.addedAt - a.addedAt);
    for (const stored of songs) this.library.set(stored.id, this.toRuntimeSong(stored));

    const playlists = await this.storage.getPlaylists();
    playlists.sort((a, b) => a.createdAt - b.createdAt);
    this.playlists = playlists.map((data) => Playlist.fromData(data, (id) => this.library.get(id)));

    if (this.playlists.length === 0) {
      const playlist = new Playlist('My Playlist');
      this.playlists.push(playlist);
      await this.storage.savePlaylist(playlist.toData());
    }
  }

  private toRuntimeSong(stored: StoredSong): Song {
    const { file: _file, cover: _cover, addedAt: _addedAt, ...song } = stored;
    return { ...song, coverUrl: this.storage.coverUrlFor(stored) };
  }

  private savePlaylist(playlist: Playlist): void {
    if (playlist.temporary) return;
    this.storage.savePlaylist(playlist.toData()).catch(() => this.toast('Could not save the playlist.', 'error'));
  }

  private async ensureInLibrary(song: Song): Promise<void> {
    if (this.library.has(song.id)) return;
    this.library.set(song.id, song);
    await this.storage.saveSong({ ...song, addedAt: Date.now() });
  }

  private findPlaylist(id: string): Playlist | undefined {
    return this.playlists.find((playlist) => playlist.id === id);
  }

  private get currentPlaylistView(): Playlist | undefined {
    return this.view.name === 'playlist' ? this.findPlaylist(this.view.id) : undefined;
  }

  private librarySongs(): Song[] {
    const songs = [...this.library.values()];
    if (this.libraryFilter === 'all') return songs;
    return songs.filter((song) => song.source === this.libraryFilter);
  }

  // ---------------------------------------------------------------- player

  /** Builds the decorator chain from the current settings. */
  private buildPlayer(): void {
    let player: MusicPlayer = this.base;
    if (this.settings.fade) player = new FadeDecorator(player);
    if (this.settings.shuffle) player = new ShuffleDecorator(player);
    if (this.settings.repeat !== 'off') player = new RepeatDecorator(player, this.settings.repeat);
    this.player = new LoggerDecorator(player);
    this.renderChain();
  }

  private async run(action: () => Promise<unknown>): Promise<void> {
    try {
      await action();
    } catch (error) {
      const message = (error as Error).message;
      if (!/user didn't interact|play\(\) failed/i.test(message)) this.toast(message, 'error');
    }
  }

  private playPlaylist(playlist: Playlist, index: number): void {
    if (playlist.length === 0) {
      this.toast('This playlist is empty. Add some songs first.');
      return;
    }
    if (this.player.getPlaylist() !== playlist) this.player.setPlaylist(playlist);
    void this.run(() => this.player.playAt(index));
  }

  private playTemporary(name: string, songs: Song[], index: number): void {
    const current = this.player.getPlaylist();
    const sameList =
      current?.temporary &&
      current.name === name &&
      current.length === songs.length &&
      current.songs.toArray().every((song, i) => song.id === songs[i].id);
    if (sameList && current) {
      void this.run(() => this.player.playAt(index));
      return;
    }
    this.playPlaylist(Playlist.fromSongs(name, songs, true), index);
  }

  private addToPlaylist(playlist: Playlist, song: Song, position: Position, index = 0): number {
    void this.ensureInLibrary(song);
    let at: number;
    if (position === 'start') {
      playlist.addFirst(song);
      at = 0;
    } else if (position === 'end') {
      playlist.addLast(song);
      at = playlist.length - 1;
    } else {
      at = Math.min(Math.max(0, index), playlist.length);
      playlist.addAt(at, song);
    }
    this.savePlaylist(playlist);
    this.refreshPlaylistViews(playlist);
    return at;
  }

  private removeTrack(playlist: Playlist, index: number): Song {
    const wasPlaying = !this.engine.paused;
    const isActive = this.player.getPlaylist() === playlist;
    const { song, wasCurrent } = playlist.removeAt(index);
    this.savePlaylist(playlist);

    if (isActive && wasCurrent) {
      if (playlist.length === 0) this.player.stop();
      else if (wasPlaying) void this.run(() => this.player.playAt(playlist.currentIndex()));
      else {
        this.engine.stop();
        this.engine.emit('songchange');
      }
    }
    this.refreshPlaylistViews(playlist);
    return song;
  }

  private refreshPlaylistViews(playlist: Playlist): void {
    this.renderSidebar();
    if (this.currentPlaylistView === playlist) this.renderMain();
    if (this.player.getPlaylist() === playlist) this.renderNowPlaying();
  }

  private saveSettings(): void {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
  }

  // ---------------------------------------------------------------- online music

  private async search(): Promise<void> {
    if (!this.jamendo.isConfigured) {
      this.renderMain();
      return;
    }
    this.searching = true;
    this.searchError = '';
    if (this.view.name === 'discover') this.renderMain();
    try {
      this.results = await this.jamendo.searchTracks({ query: this.searchQuery, tag: this.activeTag });
    } catch (error) {
      this.results = [];
      this.searchError = (error as Error).message || 'Could not reach Jamendo.';
    } finally {
      this.searching = false;
      if (this.view.name === 'discover') this.renderMain();
    }
  }

  // ---------------------------------------------------------------- local files

  private async importFiles(files: FileList | File[], target?: Playlist): Promise<void> {
    const audioFiles = [...files].filter((file) => file.type.startsWith('audio/') || AUDIO_EXTENSIONS.test(file.name));
    if (audioFiles.length === 0) {
      this.toast('No audio files were found.', 'error');
      return;
    }
    this.toast(`Importing ${plural(audioFiles.length, 'song')}...`);

    let imported = 0;
    for (const file of audioFiles) {
      try {
        const [tags, duration] = await Promise.all([readTags(file), readDuration(file)]);
        const fromName = parseFileName(file.name);
        const stored: StoredSong = {
          id: createId('local'),
          title: tags.title || fromName.title,
          artist: tags.artist || fromName.artist || 'Unknown artist',
          album: tags.album || 'Local file',
          duration,
          source: 'local',
          file,
          cover: tags.cover,
          addedAt: Date.now(),
        };
        await this.storage.saveSong(stored);
        const song = this.toRuntimeSong(stored);
        this.library = new Map([[song.id, song], ...this.library]);
        if (target) this.addToPlaylist(target, song, 'end');
        imported++;
      } catch {
        this.toast(`Could not import "${file.name}".`, 'error');
      }
    }

    this.toast(
      target
        ? `${plural(imported, 'song')} added to "${target.name}".`
        : `${plural(imported, 'song')} imported to your library.`,
      'success',
    );
    this.renderSidebar();
    this.renderMain();
  }

  private async deleteFromLibrary(song: Song): Promise<void> {
    for (const playlist of this.playlists) {
      let index = playlist.indexOfSong(song.id);
      while (index !== -1) {
        this.removeTrack(playlist, index);
        index = playlist.indexOfSong(song.id);
      }
    }
    const active = this.player.getPlaylist();
    if (active?.temporary) {
      const index = active.indexOfSong(song.id);
      if (index !== -1) this.removeTrack(active, index);
    }
    this.library.delete(song.id);
    await this.storage.deleteSong(song.id);
    this.toast(`"${song.title}" was removed from your library.`);
    this.renderSidebar();
    this.renderMain();
  }

  // ---------------------------------------------------------------- shell & events

  private renderShell(): void {
    this.root.innerHTML = `
      <div class="layout">
        <aside class="sidebar" id="sidebar"></aside>
        <main class="main" id="main"></main>
        <aside class="now-playing" id="now-playing">
          <div class="np-header">
            <span class="eyebrow">Now playing</span>
            <button class="icon-button np-close" data-action="toggle-panel" title="Close">${icons.close}</button>
          </div>
          <div id="np-song"></div>
          <canvas class="visualizer" id="visualizer"></canvas>
          <div id="np-pointers"></div>
          <section class="np-section">
            <h3>Decorator chain</h3>
            <div id="np-chain" class="chain"></div>
          </section>
          <section class="np-section">
            <h3>Activity</h3>
            <ol id="np-log" class="log"></ol>
          </section>
        </aside>
        <footer class="player-bar" id="player-bar">
          <div class="pb-song" id="pb-song"></div>
          <div class="pb-center">
            <div class="pb-controls">
              <button class="icon-button toggle" data-action="toggle-shuffle" id="btn-shuffle" title="Shuffle (decorator)">${icons.shuffle}</button>
              <button class="icon-button" data-action="prev" title="Previous (prev pointer)">${icons.prev}</button>
              <button class="play-button" data-action="toggle-play" id="btn-play" title="Play / Pause">${icons.play}</button>
              <button class="icon-button" data-action="next" title="Next (next pointer)">${icons.next}</button>
              <button class="icon-button toggle" data-action="cycle-repeat" id="btn-repeat" title="Repeat (decorator)">${icons.repeat}<span class="badge">1</span></button>
            </div>
            <div class="pb-progress">
              <span id="time-current">0:00</span>
              <input type="range" id="progress" class="range" min="0" max="1000" value="0" aria-label="Seek" />
              <span id="time-total">0:00</span>
            </div>
          </div>
          <div class="pb-right">
            <button class="icon-button toggle" data-action="toggle-fade" id="btn-fade" title="Fade in/out (decorator)">${icons.fade}</button>
            <button class="icon-button" data-action="toggle-mute" id="btn-mute" title="Mute">${icons.volume}</button>
            <input type="range" id="volume" class="range volume" min="0" max="100" aria-label="Volume" />
            <button class="icon-button panel-toggle" data-action="toggle-panel" title="Now playing panel">${icons.panel}</button>
          </div>
        </footer>
      </div>
      <div id="modal-root"></div>
      <div class="toasts" id="toasts"></div>
      <div class="drop-overlay" id="drop-overlay"><div>${icons.upload}<p>Drop your audio files to import them</p></div></div>
      <input type="file" id="file-input" accept="audio/*,.mp3,.wav,.ogg,.m4a,.flac" multiple hidden />
    `;
    new Visualizer(this.$('#visualizer') as HTMLCanvasElement, this.engine);
  }

  private $(selector: string): HTMLElement {
    return this.root.querySelector(selector) as HTMLElement;
  }

  private bindEvents(): void {
    this.root.addEventListener('click', (event) => {
      const target = (event.target as Element).closest<HTMLElement>('[data-action]');
      if (target && this.root.contains(target)) this.handleAction(target.dataset.action!, target, event);
    });

    this.root.addEventListener('dblclick', (event) => {
      const row = (event.target as Element).closest<HTMLElement>('[data-dblplay]');
      if (row && !(event.target as Element).closest('button')) {
        this.handleAction(row.dataset.dblplay!, row, event);
      }
    });

    this.root.addEventListener('submit', (event) => {
      const form = event.target as HTMLFormElement;
      if (form.id === 'search-form') {
        event.preventDefault();
        this.searchQuery = (form.elements.namedItem('query') as HTMLInputElement).value.trim();
        this.activeTag = '';
        void this.search();
      }
      if (form.id === 'client-form') {
        event.preventDefault();
        this.jamendo.clientId = (form.elements.namedItem('clientId') as HTMLInputElement).value;
        void this.search();
      }
    });

    const fileInput = this.$('#file-input') as HTMLInputElement;
    fileInput.addEventListener('change', () => {
      if (fileInput.files?.length) void this.importFiles(fileInput.files, this.currentPlaylistView);
      fileInput.value = '';
    });

    const progress = this.$('#progress') as HTMLInputElement;
    progress.addEventListener('input', () => {
      this.seeking = true;
      this.$('#time-current').textContent = formatTime((Number(progress.value) / 1000) * this.engine.duration);
      progress.style.setProperty('--value', `${Number(progress.value) / 10}%`);
    });
    progress.addEventListener('change', () => {
      this.engine.currentTime = (Number(progress.value) / 1000) * this.engine.duration;
      this.seeking = false;
    });

    const volume = this.$('#volume') as HTMLInputElement;
    volume.addEventListener('input', () => this.engine.setVolume(Number(volume.value) / 100));

    // Engine events
    this.engine.addEventListener('ended', () => void this.run(() => this.player.handleTrackEnd()));
    this.engine.addEventListener('songchange', () => this.onSongChange());
    this.engine.addEventListener('playlistchange', () => this.renderNowPlaying());
    this.engine.addEventListener('play', () => this.onPlayState());
    this.engine.addEventListener('pause', () => this.onPlayState());
    this.engine.addEventListener('timeupdate', () => this.updateProgress());
    this.engine.addEventListener('volumechange', () => this.updateVolume());
    this.engine.addEventListener('loadedmetadata', () => this.onMetadata());
    this.engine.addEventListener('error', (event) => this.toast(String((event as CustomEvent).detail), 'error'));
    this.engine.addEventListener('log', (event) => {
      this.logs.unshift((event as CustomEvent<LogEntry>).detail);
      this.logs = this.logs.slice(0, 12);
      this.renderLog();
    });

    // Drag & drop of files from the computer
    let dragDepth = 0;
    const overlay = this.$('#drop-overlay');
    const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false;
    window.addEventListener('dragenter', (event) => {
      if (!hasFiles(event)) return;
      dragDepth++;
      overlay.classList.add('visible');
    });
    window.addEventListener('dragleave', (event) => {
      if (!hasFiles(event)) return;
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) overlay.classList.remove('visible');
    });
    window.addEventListener('dragover', (event) => {
      if (hasFiles(event)) event.preventDefault();
    });
    window.addEventListener('drop', (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      dragDepth = 0;
      overlay.classList.remove('visible');
      if (event.dataTransfer?.files.length) void this.importFiles(event.dataTransfer.files, this.currentPlaylistView);
    });

    // Reordering songs inside a playlist (drag & drop rows)
    this.root.addEventListener('dragstart', (event) => {
      const row = (event.target as Element).closest<HTMLElement>('[data-drag-index]');
      if (!row) return;
      this.dragIndex = Number(row.dataset.dragIndex);
      row.classList.add('dragging');
      event.dataTransfer?.setData('text/plain', String(this.dragIndex));
    });
    this.root.addEventListener('dragover', (event) => {
      const row = (event.target as Element).closest<HTMLElement>('[data-drag-index]');
      if (!row || this.dragIndex === -1) return;
      event.preventDefault();
      this.root.querySelectorAll('.drop-target').forEach((el) => el.classList.remove('drop-target'));
      row.classList.add('drop-target');
    });
    this.root.addEventListener('drop', (event) => {
      const row = (event.target as Element).closest<HTMLElement>('[data-drag-index]');
      const playlist = this.currentPlaylistView;
      if (!row || this.dragIndex === -1 || !playlist) return;
      event.preventDefault();
      const to = Number(row.dataset.dragIndex);
      if (to !== this.dragIndex) {
        playlist.move(this.dragIndex, to);
        this.savePlaylist(playlist);
        this.refreshPlaylistViews(playlist);
      }
      this.dragIndex = -1;
    });
    this.root.addEventListener('dragend', () => {
      this.dragIndex = -1;
      this.root.querySelectorAll('.dragging, .drop-target').forEach((el) => el.classList.remove('dragging', 'drop-target'));
    });

    // Keyboard shortcuts
    window.addEventListener('keydown', (event) => {
      const tag = (event.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || this.$('#modal-root').childElementCount > 0) return;
      if (event.code === 'Space') {
        event.preventDefault();
        void this.run(() => this.player.togglePlay());
      } else if (event.code === 'ArrowRight' && event.shiftKey) {
        void this.run(() => this.player.next());
      } else if (event.code === 'ArrowLeft' && event.shiftKey) {
        void this.run(() => this.player.previous());
      }
    });

    this.setupMediaSession();
  }

  private handleAction(action: string, el: HTMLElement, event: Event): void {
    const index = Number(el.dataset.index);
    const playlist = this.currentPlaylistView;

    switch (action) {
      // Navigation
      case 'view':
        this.view = { name: el.dataset.view as 'discover' | 'library' };
        this.renderSidebar();
        this.renderMain();
        break;
      case 'open-playlist':
        this.view = { name: 'playlist', id: el.dataset.id! };
        this.renderSidebar();
        this.renderMain();
        break;
      case 'create-playlist':
        this.promptName('Create playlist', '', 'Create', (name) => {
          const created = new Playlist(name);
          this.playlists.push(created);
          this.savePlaylist(created);
          this.view = { name: 'playlist', id: created.id };
          this.renderSidebar();
          this.renderMain();
        });
        break;
      case 'settings':
        this.openSettings();
        break;
      case 'toggle-panel':
        this.root.querySelector('.layout')?.classList.toggle('panel-open');
        break;

      // Discover
      case 'tag':
        this.activeTag = this.activeTag === el.dataset.tag ? '' : el.dataset.tag!;
        this.searchQuery = '';
        void this.search();
        break;
      case 'play-result':
        this.playTemporary('Discover', this.results, index);
        break;
      case 'add-song': {
        const song = this.library.get(el.dataset.songId!) ?? this.results.find((s) => s.id === el.dataset.songId);
        if (song) this.openAddToPlaylist(song);
        break;
      }

      // Library
      case 'import':
        (this.$('#file-input') as HTMLInputElement).click();
        break;
      case 'library-filter':
        this.libraryFilter = el.dataset.filter as 'all' | 'local' | 'jamendo';
        this.renderMain();
        break;
      case 'play-library':
        this.playTemporary('Your Library', this.librarySongs(), index);
        break;
      case 'delete-song': {
        const song = this.library.get(el.dataset.songId!);
        if (song) {
          this.confirm(
            'Remove from library?',
            `"${song.title}" will also be removed from every playlist.`,
            'Remove',
            () => void this.deleteFromLibrary(song),
          );
        }
        break;
      }

      // Playlist
      case 'play-playlist':
        if (playlist) this.playPlaylist(playlist, 0);
        break;
      case 'shuffle-playlist':
        if (playlist) {
          if (!this.settings.shuffle) this.handleAction('toggle-shuffle', el, event);
          if (playlist.length === 0) this.toast('This playlist is empty. Add some songs first.');
          else {
            this.player.setPlaylist(playlist);
            void this.run(() => this.player.playFirst());
          }
        }
        break;
      case 'play-track':
        if (playlist) this.playPlaylist(playlist, index);
        break;
      case 'add-songs':
        if (playlist) this.openSongPicker(playlist);
        break;
      case 'move-up':
      case 'move-down':
        if (playlist) {
          const to = action === 'move-up' ? index - 1 : index + 1;
          if (to < 0 || to >= playlist.length) return;
          playlist.move(index, to);
          this.savePlaylist(playlist);
          this.refreshPlaylistViews(playlist);
        }
        break;
      case 'remove-track':
        if (playlist) {
          const song = this.removeTrack(playlist, index);
          this.toast(`"${song.title}" removed from "${playlist.name}".`);
        }
        break;
      case 'rename-playlist':
        if (playlist) {
          this.promptName('Rename playlist', playlist.name, 'Save', (name) => {
            playlist.name = name;
            this.savePlaylist(playlist);
            this.refreshPlaylistViews(playlist);
          });
        }
        break;
      case 'delete-playlist':
        if (playlist) {
          this.confirm('Delete playlist?', `"${playlist.name}" will be deleted. Your songs stay in the library.`, 'Delete', () => {
            if (this.player.getPlaylist() === playlist) this.player.stop();
            this.playlists = this.playlists.filter((p) => p !== playlist);
            void this.storage.deletePlaylist(playlist.id);
            this.view = this.playlists[0] ? { name: 'playlist', id: this.playlists[0].id } : { name: 'library' };
            this.renderSidebar();
            this.renderMain();
          });
        }
        break;

      // Player bar
      case 'toggle-play':
        void this.run(() => this.player.togglePlay());
        break;
      case 'next':
        void this.run(() => this.player.next());
        break;
      case 'prev':
        void this.run(() => this.player.previous());
        break;
      case 'toggle-shuffle':
        this.settings.shuffle = !this.settings.shuffle;
        this.afterSettingChange(`Shuffle ${this.settings.shuffle ? 'on' : 'off'}`);
        break;
      case 'cycle-repeat': {
        const order: RepeatSetting[] = ['off', 'all', 'one'];
        this.settings.repeat = order[(order.indexOf(this.settings.repeat) + 1) % order.length];
        const labels = { off: 'Repeat off', all: 'Repeat playlist', one: 'Repeat current song' };
        this.afterSettingChange(labels[this.settings.repeat]);
        break;
      }
      case 'toggle-fade':
        this.settings.fade = !this.settings.fade;
        this.afterSettingChange(`Fade ${this.settings.fade ? 'on' : 'off'}`);
        break;
      case 'toggle-mute':
        if (this.engine.getVolume() > 0) {
          this.lastVolume = this.engine.getVolume();
          this.engine.setVolume(0);
        } else {
          this.engine.setVolume(this.lastVolume || 0.8);
        }
        break;
    }
  }

  private afterSettingChange(message: string): void {
    this.saveSettings();
    this.buildPlayer();
    this.updatePlayerBar();
    this.toast(message);
  }

  // ---------------------------------------------------------------- engine callbacks

  private onSongChange(): void {
    this.updatePlayerBar();
    this.renderNowPlaying();
    this.updateHighlights();
    const playlist = this.currentPlaylistView;
    if (playlist && playlist === this.player.getPlaylist()) this.renderDiagram(playlist);
    this.updateMediaSession();
  }

  private onPlayState(): void {
    document.body.classList.toggle('is-playing', !this.engine.paused);
    const button = this.$('#btn-play');
    button.innerHTML = this.engine.paused ? icons.play : icons.pause;
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = this.engine.paused ? 'paused' : 'playing';
  }

  private onMetadata(): void {
    const song = this.player.getCurrentSong();
    if (song && !song.duration && this.engine.duration) {
      song.duration = this.engine.duration;
      this.updatePlayerBar();
    }
    this.updateProgress();
  }

  // ---------------------------------------------------------------- rendering: sidebar

  private renderSidebar(): void {
    const nav = (name: 'discover' | 'library', icon: string, label: string) => `
      <button class="nav-item ${this.view.name === name ? 'active' : ''}" data-action="view" data-view="${name}">
        ${icon}<span>${label}</span>
      </button>`;

    this.$('#sidebar').innerHTML = `
      <div class="brand">
        <div class="brand-logo"><span></span><span></span><span></span><span></span></div>
        <div>
          <strong>Wave</strong>
          <small>Doubly linked player</small>
        </div>
      </div>
      <nav class="nav">
        ${nav('discover', icons.compass, 'Discover')}
        ${nav('library', icons.library, 'Your Library')}
      </nav>
      <div class="sidebar-section">
        <div class="sidebar-title">
          <span>Playlists</span>
          <button class="icon-button small" data-action="create-playlist" title="Create playlist">${icons.plus}</button>
        </div>
        <div class="playlist-list">
          ${this.playlists
            .map((playlist) => {
              const active = this.view.name === 'playlist' && this.view.id === playlist.id;
              const playing = this.player.getPlaylist() === playlist;
              return `
                <button class="playlist-item ${active ? 'active' : ''} ${playing ? 'playing' : ''}" data-action="open-playlist" data-id="${playlist.id}">
                  ${this.playlistCover(playlist, 'mini-cover')}
                  <span class="playlist-item-text">
                    <span class="playlist-item-name">${escapeHtml(playlist.name)}</span>
                    <small>${plural(playlist.length, 'song')}</small>
                  </span>
                  ${playing ? '<span class="eq"><i></i><i></i><i></i></span>' : ''}
                </button>`;
            })
            .join('')}
        </div>
      </div>
      <button class="nav-item settings" data-action="settings">${icons.settings}<span>Settings</span></button>
    `;
  }

  private playlistCover(playlist: Playlist, className: string): string {
    const covers = playlist.songs
      .toArray()
      .map((song) => song.coverUrl)
      .filter((url): url is string => Boolean(url));
    const unique = [...new Set(covers)];
    if (unique.length >= 4) {
      return `<div class="${className} mosaic">${unique
        .slice(0, 4)
        .map((url) => `<img src="${escapeHtml(url)}" alt="" loading="lazy" />`)
        .join('')}</div>`;
    }
    if (unique.length > 0) return `<img class="${className}" src="${escapeHtml(unique[0])}" alt="" loading="lazy" />`;
    return `<div class="${className} cover--placeholder" style="--hue:${hueFrom(playlist.name)}">${icons.music}</div>`;
  }

  // ---------------------------------------------------------------- rendering: main views

  private renderMain(): void {
    const main = this.$('#main');
    if (this.view.name === 'discover') main.innerHTML = this.discoverHtml();
    else if (this.view.name === 'library') main.innerHTML = this.libraryHtml();
    else {
      const playlist = this.currentPlaylistView;
      if (!playlist) {
        this.view = { name: 'library' };
        main.innerHTML = this.libraryHtml();
      } else {
        main.innerHTML = this.playlistHtml(playlist);
        this.renderDiagram(playlist);
      }
    }
    this.updateHighlights();
  }

  private discoverHtml(): string {
    if (!this.jamendo.isConfigured) {
      return `
        <header class="page-header">
          <span class="eyebrow">Online music</span>
          <h1>Discover</h1>
        </header>
        <div class="empty-card">
          ${icons.cloud}
          <h2>Connect to Jamendo</h2>
          <p>Jamendo offers thousands of free, full-length songs. Create a free app at
          <a href="https://devportal.jamendo.com" target="_blank" rel="noopener">devportal.jamendo.com</a>
          and paste its Client ID here.</p>
          <form id="client-form" class="inline-form">
            <input name="clientId" class="input" placeholder="Jamendo Client ID" autocomplete="off" required />
            <button class="button primary">Connect</button>
          </form>
        </div>`;
    }

    let content: string;
    if (this.searching) {
      content = `<div class="grid">${'<div class="card skeleton"></div>'.repeat(12)}</div>`;
    } else if (this.searchError) {
      content = `<div class="empty-card">${icons.cloud}<h2>Something went wrong</h2><p>${escapeHtml(this.searchError)}</p></div>`;
    } else if (this.results.length === 0) {
      content = `<div class="empty-card">${icons.search}<h2>No songs found</h2><p>Try another search or genre.</p></div>`;
    } else {
      content = `<div class="grid">${this.results
        .map(
          (song, i) => `
          <article class="card" data-song-row="${song.id}" data-dblplay="play-result" data-index="${i}">
            <div class="card-cover">
              ${coverHtml(song, 'cover')}
              <button class="card-play" data-action="play-result" data-index="${i}" title="Play">${icons.play}</button>
            </div>
            <div class="card-body">
              <div class="card-text">
                <strong title="${escapeHtml(song.title)}">${escapeHtml(song.title)}</strong>
                <small>${escapeHtml(song.artist)}</small>
              </div>
              <button class="icon-button small" data-action="add-song" data-song-id="${song.id}" title="Add to playlist">${icons.plus}</button>
            </div>
          </article>`,
        )
        .join('')}</div>`;
    }

    const title = this.searchQuery
      ? `Results for "${escapeHtml(this.searchQuery)}"`
      : this.activeTag
        ? `Top ${escapeHtml(this.activeTag)} songs`
        : 'Trending this week';

    return `
      <header class="page-header hero">
        <span class="eyebrow">Online music · Jamendo</span>
        <h1>Discover</h1>
        <form id="search-form" class="search">
          ${icons.search}
          <input name="query" class="input" placeholder="Search songs, artists or albums" value="${escapeHtml(this.searchQuery)}" autocomplete="off" />
          <button class="button primary">Search</button>
        </form>
        <div class="chips">
          ${GENRES.map((tag) => `<button class="chip ${this.activeTag === tag ? 'active' : ''}" data-action="tag" data-tag="${tag}">${tag}</button>`).join('')}
        </div>
      </header>
      <section class="section">
        <h2 class="section-title">${title}</h2>
        ${content}
      </section>`;
  }

  private libraryHtml(): string {
    const songs = this.librarySongs();
    const filters: [typeof this.libraryFilter, string][] = [
      ['all', 'All'],
      ['local', 'On this device'],
      ['jamendo', 'Online'],
    ];

    const rows = songs
      .map(
        (song, i) => `
        <div class="track-row" data-song-row="${song.id}" data-dblplay="play-library" data-index="${i}">
          <button class="track-index" data-action="play-library" data-index="${i}" title="Play">
            <span class="num">${i + 1}</span><span class="play">${icons.play}</span><span class="eq"><i></i><i></i><i></i></span>
          </button>
          <div class="track-main">
            ${coverHtml(song, 'track-cover')}
            <div class="track-text"><strong>${escapeHtml(song.title)}</strong><small>${escapeHtml(song.artist)}</small></div>
          </div>
          <span class="track-album">${escapeHtml(song.album)}</span>
          <span class="source ${song.source}">${song.source === 'local' ? icons.disk + 'Device' : icons.cloud + 'Jamendo'}</span>
          <span class="track-time">${formatTime(song.duration)}</span>
          <div class="track-actions">
            <button class="icon-button small" data-action="add-song" data-song-id="${song.id}" title="Add to playlist">${icons.plus}</button>
            <button class="icon-button small danger" data-action="delete-song" data-song-id="${song.id}" title="Remove from library">${icons.trash}</button>
          </div>
        </div>`,
      )
      .join('');

    return `
      <header class="page-header">
        <span class="eyebrow">Your music</span>
        <h1>Your Library</h1>
        <p class="muted">Songs imported from this device and online songs you added to a playlist.</p>
        <div class="header-actions">
          <button class="button primary" data-action="import">${icons.upload}Import music</button>
          <div class="segmented">
            ${filters.map(([value, label]) => `<button class="${this.libraryFilter === value ? 'active' : ''}" data-action="library-filter" data-filter="${value}">${label}</button>`).join('')}
          </div>
        </div>
      </header>
      <section class="section">
        ${
          songs.length === 0
            ? `<div class="empty-card dropzone" data-action="import">${icons.upload}<h2>Import your music</h2><p>Click here or drag and drop audio files (MP3, WAV, OGG, M4A, FLAC) anywhere on the page.</p></div>`
            : `<div class="track-list">${this.trackHeader()}${rows}</div>`
        }
      </section>`;
  }

  private trackHeader(): string {
    return `
      <div class="track-row track-head">
        <span>#</span><span>Title</span><span class="track-album">Album</span><span class="source-head">Source</span><span class="track-time">Time</span><span></span>
      </div>`;
  }

  private playlistHtml(playlist: Playlist): string {
    const hue = hueFrom(playlist.name);
    const rows = playlist.songs
      .toArray()
      .map(
        (song, i) => `
        <div class="track-row" draggable="true" data-drag-index="${i}" data-node-index="${i}" data-dblplay="play-track" data-index="${i}">
          <button class="track-index" data-action="play-track" data-index="${i}" title="Play">
            <span class="num">${i + 1}</span><span class="play">${icons.play}</span><span class="eq"><i></i><i></i><i></i></span>
          </button>
          <div class="track-main">
            <span class="grip">${icons.grip}</span>
            ${coverHtml(song, 'track-cover')}
            <div class="track-text"><strong>${escapeHtml(song.title)}</strong><small>${escapeHtml(song.artist)}</small></div>
          </div>
          <span class="track-album">${escapeHtml(song.album)}</span>
          <span class="source ${song.source}">${song.source === 'local' ? icons.disk + 'Device' : icons.cloud + 'Jamendo'}</span>
          <span class="track-time">${formatTime(song.duration)}</span>
          <div class="track-actions">
            <button class="icon-button small" data-action="move-up" data-index="${i}" title="Move up" ${i === 0 ? 'disabled' : ''}>${icons.up}</button>
            <button class="icon-button small" data-action="move-down" data-index="${i}" title="Move down" ${i === playlist.length - 1 ? 'disabled' : ''}>${icons.down}</button>
            <button class="icon-button small danger" data-action="remove-track" data-index="${i}" title="Remove from playlist">${icons.trash}</button>
          </div>
        </div>`,
      )
      .join('');

    return `
      <header class="playlist-header" style="--hue:${hue}">
        ${this.playlistCover(playlist, 'playlist-cover')}
        <div class="playlist-info">
          <span class="eyebrow">Playlist · Doubly linked list</span>
          <h1>${escapeHtml(playlist.name)}</h1>
          <p class="muted">${plural(playlist.length, 'song')} · ${formatLongDuration(playlist.totalDuration)}</p>
        </div>
      </header>
      <div class="playlist-actions">
        <button class="play-button large" data-action="play-playlist" title="Play">${icons.play}</button>
        <button class="icon-button" data-action="shuffle-playlist" title="Shuffle play">${icons.shuffle}</button>
        <button class="button" data-action="add-songs">${icons.plus}Add songs</button>
        <button class="button ghost" data-action="import">${icons.upload}Import files</button>
        <span class="spacer"></span>
        <button class="icon-button" data-action="rename-playlist" title="Rename">${icons.edit}</button>
        <button class="icon-button danger" data-action="delete-playlist" title="Delete playlist">${icons.trash}</button>
      </div>
      <section class="section">
        ${
          playlist.length === 0
            ? `<div class="empty-card">${icons.music}<h2>This playlist is empty</h2><p>Add songs from your library, Discover, or drop audio files here.</p><button class="button primary" data-action="add-songs">${icons.plus}Add songs</button></div>`
            : `<div class="track-list">${this.trackHeader()}${rows}</div>`
        }
      </section>
      <section class="section diagram-section">
        <div class="section-head">
          <h2 class="section-title">Doubly linked list view</h2>
          <span class="muted small">Each node points to its <b>prev</b> and <b>next</b> node · click a node to play it</span>
        </div>
        <div id="diagram"></div>
      </section>`;
  }

  /** Draws the playlist as nodes: null ← [HEAD] ⇄ [node] ⇄ [TAIL] → null */
  private renderDiagram(playlist: Playlist): void {
    const container = this.root.querySelector('#diagram');
    if (!container) return;
    const isActive = this.player.getPlaylist() === playlist;
    const short = (song: Song | undefined) => (song ? escapeHtml(truncate(song.title, 14)) : 'null');

    const nodes: string[] = [];
    let node = playlist.songs.head;
    let i = 0;
    while (node) {
      const tags = [
        node === playlist.songs.head ? '<span class="tag head">HEAD</span>' : '',
        node === playlist.songs.tail ? '<span class="tag tail">TAIL</span>' : '',
        isActive && node === playlist.current ? '<span class="tag current">CURRENT</span>' : '',
      ].join('');
      nodes.push(`
        <button class="ll-node ${isActive && node === playlist.current ? 'is-current' : ''}" data-action="play-track" data-index="${i}">
          <span class="ll-tags">${tags || '&nbsp;'}</span>
          <span class="ll-body">
            <span class="ll-ptr"><small>prev</small>${short(node.prev?.value)}</span>
            <span class="ll-value">
              ${coverHtml(node.value, 'll-cover')}
              <strong>${escapeHtml(truncate(node.value.title, 22))}</strong>
              <small>index ${i}</small>
            </span>
            <span class="ll-ptr"><small>next</small>${short(node.next?.value)}</span>
          </span>
        </button>`);
      node = node.next;
      i++;
    }

    container.innerHTML =
      playlist.length === 0
        ? `<div class="ll-empty"><code>head = null · tail = null · length = 0</code></div>`
        : `
        <div class="ll-scroll">
          <div class="ll">
            <span class="ll-null">null</span><span class="ll-arrow">←</span>
            ${nodes.join('<span class="ll-arrow double">⇄</span>')}
            <span class="ll-arrow">→</span><span class="ll-null">null</span>
          </div>
        </div>
        <pre class="ll-print"><code>length = ${playlist.length}\nprintList(): ${escapeHtml(playlist.songs.printList((song) => song.title))}</code></pre>`;

    // Center the current node horizontally (only inside the diagram, the page does not scroll).
    const scroller = container.querySelector<HTMLElement>('.ll-scroll');
    const current = container.querySelector<HTMLElement>('.is-current');
    if (scroller && current) {
      scroller.scrollTo({ left: current.offsetLeft - scroller.clientWidth / 2 + current.offsetWidth / 2, behavior: 'smooth' });
    }
  }

  /** Marks the row of the song that is playing, without re-rendering the view. */
  private updateHighlights(): void {
    const song = this.player.getCurrentSong();
    const activePlaylist = this.player.getPlaylist();
    const viewPlaylist = this.currentPlaylistView;

    this.root.querySelectorAll<HTMLElement>('[data-song-row]').forEach((row) => {
      row.classList.toggle('is-current', !!song && row.dataset.songRow === song.id);
    });
    const currentIndex = viewPlaylist && viewPlaylist === activePlaylist ? viewPlaylist.currentIndex() : -1;
    this.root.querySelectorAll<HTMLElement>('[data-node-index]').forEach((row) => {
      row.classList.toggle('is-current', Number(row.dataset.nodeIndex) === currentIndex);
    });
    this.root.querySelectorAll<HTMLElement>('.playlist-item').forEach((item) => {
      item.classList.toggle('playing', item.dataset.id === activePlaylist?.id);
    });
  }

  // ---------------------------------------------------------------- rendering: now playing & player bar

  private renderNowPlaying(): void {
    const playlist = this.player.getPlaylist();
    const node = playlist?.current ?? null;
    const song = node?.value ?? null;

    this.$('#np-song').innerHTML = song
      ? `
        <div class="np-cover">${coverHtml(song, 'cover')}</div>
        <div class="np-text">
          <h2>${escapeHtml(song.title)}</h2>
          <p>${escapeHtml(song.artist)}</p>
          <small class="muted">Playing from <b>${escapeHtml(playlist!.name)}</b> · node ${playlist!.currentIndex() + 1} of ${playlist!.length}</small>
        </div>`
      : `
        <div class="np-cover">${coverHtml(null, 'cover')}</div>
        <div class="np-text"><h2>Nothing playing</h2><p class="muted">Pick a song to start listening.</p></div>`;

    const pointer = (label: string, value: Song | undefined, action: string) => `
      <button class="pointer" data-action="${action}" ${value ? '' : 'disabled'}>
        <small>${label}</small>
        ${value ? `${coverHtml(value, 'pointer-cover')}<span>${escapeHtml(value.title)}</span>` : '<code>null</code>'}
      </button>`;

    this.$('#np-pointers').innerHTML = song
      ? `<div class="pointers">
          ${pointer('◀ current.prev', node?.prev?.value, 'prev')}
          ${pointer('current.next ▶', node?.next?.value, 'next')}
        </div>`
      : '';
  }

  private renderChain(): void {
    const chain = this.player.describe().replace(/\)+$/, '').split('(');
    const el = this.root.querySelector('#np-chain');
    if (!el) return;
    el.innerHTML = chain
      .map((name, i) => `<span class="chain-item ${i === chain.length - 1 ? 'base' : ''}">${escapeHtml(name)}</span>`)
      .join('<span class="chain-arrow">→</span>');
  }

  private renderLog(): void {
    this.$('#np-log').innerHTML = this.logs
      .map(
        (entry) => `
        <li>
          <code>${escapeHtml(entry.action)}</code>
          <span>${escapeHtml(entry.song)}</span>
          <time>${new Date(entry.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>
        </li>`,
      )
      .join('');
  }

  private updatePlayerBar(): void {
    const song = this.player.getCurrentSong();
    this.$('#pb-song').innerHTML = song
      ? `${coverHtml(song, 'pb-cover')}
         <div class="pb-text"><strong>${escapeHtml(song.title)}</strong><small>${escapeHtml(song.artist)}</small></div>
         <button class="icon-button small" data-action="add-song" data-song-id="${song.id}" title="Add to playlist">${icons.plus}</button>`
      : `${coverHtml(null, 'pb-cover')}<div class="pb-text"><strong>Wave Player</strong><small>Choose a song</small></div>`;

    this.$('#btn-shuffle').classList.toggle('active', this.settings.shuffle);
    this.$('#btn-fade').classList.toggle('active', this.settings.fade);
    const repeat = this.$('#btn-repeat');
    repeat.classList.toggle('active', this.settings.repeat !== 'off');
    repeat.classList.toggle('one', this.settings.repeat === 'one');
    this.onPlayState();
    this.updateVolume();
    this.updateProgress();
  }

  private updateProgress(): void {
    if (this.seeking) return;
    const duration = this.engine.duration || this.player.getCurrentSong()?.duration || 0;
    const current = this.engine.hasSource ? this.engine.currentTime : 0;
    const progress = this.$('#progress') as HTMLInputElement;
    const value = duration ? (current / duration) * 1000 : 0;
    progress.value = String(value);
    progress.style.setProperty('--value', `${value / 10}%`);
    this.$('#time-current').textContent = formatTime(current);
    this.$('#time-total').textContent = formatTime(duration);
  }

  private updateVolume(): void {
    const volume = this.engine.getVolume();
    const input = this.$('#volume') as HTMLInputElement;
    input.value = String(Math.round(volume * 100));
    input.style.setProperty('--value', `${volume * 100}%`);
    this.$('#btn-mute').innerHTML = volume === 0 ? icons.mute : icons.volume;
    if (this.settings.volume !== volume) {
      this.settings.volume = volume;
      this.saveSettings();
    }
  }

  // ---------------------------------------------------------------- modals

  private openModal(title: string, body: string, onMount: (modal: HTMLElement, close: () => void) => void): void {
    const root = this.$('#modal-root');
    root.innerHTML = `
      <div class="modal-backdrop">
        <div class="modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
          <header class="modal-header">
            <h2>${escapeHtml(title)}</h2>
            <button class="icon-button" data-close title="Close">${icons.close}</button>
          </header>
          <div class="modal-body">${body}</div>
        </div>
      </div>`;
    const backdrop = root.firstElementChild as HTMLElement;
    const close = () => {
      root.innerHTML = '';
      window.removeEventListener('keydown', onKey);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    backdrop.addEventListener('mousedown', (event) => {
      if (event.target === backdrop) close();
    });
    backdrop.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', close));
    onMount(backdrop.querySelector('.modal') as HTMLElement, close);
    (backdrop.querySelector('input:not([type=radio]), select, button.primary') as HTMLElement | null)?.focus();
  }

  private promptName(title: string, value: string, confirmLabel: string, onConfirm: (name: string) => void): void {
    this.openModal(
      title,
      `<form class="form">
        <label class="field"><span>Name</span><input class="input" name="name" maxlength="60" required value="${escapeHtml(value)}" placeholder="My awesome playlist" /></label>
        <div class="modal-actions"><button type="button" class="button ghost" data-close>Cancel</button><button class="button primary">${confirmLabel}</button></div>
      </form>`,
      (modal, close) => {
        const form = modal.querySelector('form')!;
        form.addEventListener('submit', (event) => {
          event.preventDefault();
          const name = (form.elements.namedItem('name') as HTMLInputElement).value.trim();
          if (!name) return;
          close();
          onConfirm(name);
        });
      },
    );
  }

  private confirm(title: string, message: string, confirmLabel: string, onConfirm: () => void): void {
    this.openModal(
      title,
      `<p class="muted">${escapeHtml(message)}</p>
       <div class="modal-actions"><button class="button ghost" data-close>Cancel</button><button class="button danger-fill" data-confirm>${confirmLabel}</button></div>`,
      (modal, close) => {
        modal.querySelector('[data-confirm]')!.addEventListener('click', () => {
          close();
          onConfirm();
        });
      },
    );
  }

  private positionPicker(max: number): string {
    return `
      <fieldset class="positions">
        <legend>Insert position</legend>
        <label class="radio"><input type="radio" name="position" value="end" checked /><span>At the end <small>append()</small></span></label>
        <label class="radio"><input type="radio" name="position" value="start" /><span>At the start <small>prepend()</small></span></label>
        <label class="radio"><input type="radio" name="position" value="index" /><span>At position <small>insert(index)</small></span>
          <input class="input number" type="number" name="index" min="1" max="${max + 1}" value="${max + 1}" />
        </label>
      </fieldset>`;
  }

  private readPosition(container: HTMLElement): { position: Position; index: number } {
    const position = (container.querySelector('input[name=position]:checked') as HTMLInputElement).value as Position;
    const index = Number((container.querySelector('input[name=index]') as HTMLInputElement).value) - 1;
    return { position, index: Number.isFinite(index) ? index : 0 };
  }

  /** "Add to playlist" dialog for one song: choose playlist and position. */
  private openAddToPlaylist(song: Song): void {
    const options = this.playlists
      .map((p) => `<option value="${p.id}" ${this.currentPlaylistView === p ? 'selected' : ''}>${escapeHtml(p.name)} (${p.length})</option>`)
      .join('');
    this.openModal(
      'Add to playlist',
      `<div class="modal-song">${coverHtml(song, 'track-cover')}<div><strong>${escapeHtml(song.title)}</strong><small>${escapeHtml(song.artist)}</small></div></div>
       <form class="form">
         <label class="field"><span>Playlist</span>
           <select class="input" name="playlist">${options}<option value="__new">+ New playlist...</option></select>
         </label>
         <label class="field new-name" hidden><span>New playlist name</span><input class="input" name="newName" maxlength="60" placeholder="My new playlist" /></label>
         ${this.positionPicker(this.playlists[0]?.length ?? 0)}
         <div class="modal-actions"><button type="button" class="button ghost" data-close>Cancel</button><button class="button primary">Add song</button></div>
       </form>`,
      (modal, close) => {
        const form = modal.querySelector('form')!;
        const select = form.elements.namedItem('playlist') as HTMLSelectElement;
        const indexInput = form.elements.namedItem('index') as HTMLInputElement;
        const newName = modal.querySelector('.new-name') as HTMLElement;
        const syncMax = () => {
          const target = this.findPlaylist(select.value);
          const max = (target?.length ?? 0) + 1;
          indexInput.max = String(max);
          indexInput.value = String(Math.min(Number(indexInput.value) || max, max));
          newName.hidden = select.value !== '__new';
        };
        select.addEventListener('change', syncMax);
        indexInput.addEventListener('focus', () => {
          (form.querySelector('input[value=index]') as HTMLInputElement).checked = true;
        });
        syncMax();
        indexInput.value = indexInput.max;

        form.addEventListener('submit', (event) => {
          event.preventDefault();
          let target = this.findPlaylist(select.value);
          if (!target) {
            const name = (form.elements.namedItem('newName') as HTMLInputElement).value.trim() || 'New Playlist';
            target = new Playlist(name);
            this.playlists.push(target);
          }
          const { position, index } = this.readPosition(form);
          const at = this.addToPlaylist(target, song, position, index);
          close();
          this.toast(`Added to "${target.name}" at position ${at + 1}.`, 'success');
        });
      },
    );
  }

  /** "Add songs" dialog inside a playlist: pick songs from the library or Discover. */
  private openSongPicker(playlist: Playlist): void {
    const seen = new Set<string>();
    const songs = [...this.library.values(), ...this.results].filter((song) => {
      if (seen.has(song.id)) return false;
      seen.add(song.id);
      return true;
    });

    this.openModal(
      `Add songs to "${playlist.name}"`,
      songs.length === 0
        ? `<div class="empty-card compact">${icons.music}<p>Your library is empty. Import files or search songs in Discover first.</p>
           <button class="button primary" data-import>${icons.upload}Import files</button></div>`
        : `${this.positionPicker(playlist.length)}
           <div class="picker-search">${icons.search}<input class="input" placeholder="Filter songs" data-filter /></div>
           <div class="picker-list">
             ${songs
               .map(
                 (song) => `
                 <div class="picker-row" data-title="${escapeHtml(`${song.title} ${song.artist}`.toLowerCase())}">
                   ${coverHtml(song, 'track-cover')}
                   <div class="track-text"><strong>${escapeHtml(song.title)}</strong><small>${escapeHtml(song.artist)} · ${song.source === 'local' ? 'Device' : 'Jamendo'}</small></div>
                   <button class="button small" data-pick="${song.id}">${icons.plus}Add</button>
                 </div>`,
               )
               .join('')}
           </div>
           <div class="modal-actions"><button class="button primary" data-close>Done</button></div>`,
      (modal, close) => {
        modal.querySelector('[data-import]')?.addEventListener('click', () => {
          close();
          (this.$('#file-input') as HTMLInputElement).click();
        });
        const indexInput = modal.querySelector('input[name=index]') as HTMLInputElement | null;
        indexInput?.addEventListener('focus', () => {
          (modal.querySelector('input[value=index]') as HTMLInputElement).checked = true;
        });
        modal.querySelector('[data-filter]')?.addEventListener('input', (event) => {
          const term = (event.target as HTMLInputElement).value.toLowerCase();
          modal.querySelectorAll<HTMLElement>('.picker-row').forEach((row) => {
            row.hidden = !row.dataset.title!.includes(term);
          });
        });
        modal.querySelectorAll<HTMLButtonElement>('[data-pick]').forEach((button) => {
          button.addEventListener('click', () => {
            const song = songs.find((s) => s.id === button.dataset.pick);
            if (!song) return;
            const { position, index } = this.readPosition(modal);
            const at = this.addToPlaylist(playlist, song, position, index);
            // Keep inserting consecutive songs one after another.
            if (position === 'index' && indexInput) indexInput.value = String(at + 2);
            if (indexInput) indexInput.max = String(playlist.length + 1);
            button.innerHTML = `✓ Added at ${at + 1}`;
            button.classList.add('done');
          });
        });
      },
    );
  }

  private openSettings(): void {
    this.openModal(
      'Settings',
      `<form class="form">
        <label class="field"><span>Jamendo Client ID</span>
          <input class="input" name="clientId" value="${escapeHtml(this.jamendo.clientId)}" placeholder="e.g. 1a2b3c4d" autocomplete="off" />
          <small class="muted">Get one for free at <a href="https://devportal.jamendo.com" target="_blank" rel="noopener">devportal.jamendo.com</a>.</small>
        </label>
        <div class="shortcuts">
          <h3>Keyboard shortcuts</h3>
          <p><kbd>Space</kbd> Play / pause</p>
          <p><kbd>Shift</kbd> + <kbd>→</kbd> Next song</p>
          <p><kbd>Shift</kbd> + <kbd>←</kbd> Previous song</p>
        </div>
        <div class="modal-actions"><button type="button" class="button ghost" data-close>Cancel</button><button class="button primary">Save</button></div>
      </form>`,
      (modal, close) => {
        const form = modal.querySelector('form')!;
        form.addEventListener('submit', (event) => {
          event.preventDefault();
          this.jamendo.clientId = (form.elements.namedItem('clientId') as HTMLInputElement).value;
          close();
          this.toast('Settings saved.', 'success');
          void this.search();
        });
      },
    );
  }

  // ---------------------------------------------------------------- misc

  private toast(message: string, type: 'info' | 'success' | 'error' = 'info'): void {
    const container = this.root.querySelector('#toasts');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.append(toast);
    while (container.childElementCount > 3) container.firstElementChild?.remove();
    setTimeout(() => {
      toast.classList.add('leaving');
      setTimeout(() => toast.remove(), 300);
    }, 3200);
  }

  private setupMediaSession(): void {
    if (!('mediaSession' in navigator)) return;
    const session = navigator.mediaSession;
    session.setActionHandler('play', () => void this.run(() => this.player.play()));
    session.setActionHandler('pause', () => void this.run(() => this.player.pause()));
    session.setActionHandler('nexttrack', () => void this.run(() => this.player.next()));
    session.setActionHandler('previoustrack', () => void this.run(() => this.player.previous()));
  }

  private updateMediaSession(): void {
    const song = this.player.getCurrentSong();
    if (!('mediaSession' in navigator) || !song || typeof MediaMetadata === 'undefined') return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: song.title,
      artist: song.artist,
      album: song.album,
      artwork: song.coverUrl ? [{ src: song.coverUrl, sizes: '300x300' }] : [],
    });
  }
}

function loadSettings(): Settings {
  const defaults: Settings = { shuffle: false, repeat: 'off', fade: true, volume: 0.8 };
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') };
  } catch {
    return defaults;
  }
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** "Artist - Title.mp3" -> { artist, title } */
function parseFileName(name: string): { title: string; artist?: string } {
  const base = name.replace(/\.[^.]+$/, '').replace(/_/g, ' ').trim();
  const parts = base.split(' - ');
  if (parts.length >= 2) return { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim() };
  return { title: base };
}

/** Reads the duration of an audio file using a temporary <audio> element. */
function readDuration(file: Blob): Promise<number> {
  return new Promise((resolve) => {
    const audio = new Audio();
    const url = URL.createObjectURL(file);
    const done = (value: number) => {
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(value) ? value : 0);
    };
    const timer = setTimeout(() => done(0), 5000);
    audio.preload = 'metadata';
    audio.addEventListener('loadedmetadata', () => {
      clearTimeout(timer);
      done(audio.duration);
    });
    audio.addEventListener('error', () => {
      clearTimeout(timer);
      done(0);
    });
    audio.src = url;
  });
}
