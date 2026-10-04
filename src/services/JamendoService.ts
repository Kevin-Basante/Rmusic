import type { Song } from '../models/Song';

const API_URL = 'https://api.jamendo.com/v3.0/tracks/';
const STORAGE_KEY = 'jamendo-client-id';

interface JamendoTrack {
  id: string;
  name: string;
  duration: number;
  artist_name: string;
  album_name: string;
  album_image: string;
  image: string;
  audio: string;
}

interface JamendoResponse {
  headers: { status: string; code: number; error_message: string };
  results: JamendoTrack[];
}

export interface SearchOptions {
  query?: string;
  tag?: string;
  limit?: number;
}

/**
 * Client for the Jamendo API (free, full-length, Creative Commons music).
 * Docs: https://developer.jamendo.com/v3.0/tracks
 */
export class JamendoService {
  /** Client ID from the build (.env) or the one typed by the user in Settings. */
  get clientId(): string {
    const fromEnv = (import.meta.env.VITE_JAMENDO_CLIENT_ID as string | undefined) ?? '';
    return localStorage.getItem(STORAGE_KEY) || fromEnv;
  }

  set clientId(value: string) {
    if (value.trim()) localStorage.setItem(STORAGE_KEY, value.trim());
    else localStorage.removeItem(STORAGE_KEY);
  }

  get isConfigured(): boolean {
    return this.clientId !== '';
  }

  async searchTracks({ query = '', tag = '', limit = 30 }: SearchOptions = {}): Promise<Song[]> {
    if (!this.isConfigured) throw new Error('Add your Jamendo Client ID in Settings to search online music.');

    const params = new URLSearchParams({
      client_id: this.clientId,
      format: 'json',
      limit: String(limit),
      imagesize: '300',
      audioformat: 'mp32',
      include: 'musicinfo',
    });
    if (query) params.set('search', query);
    if (tag) params.set('fuzzytags', tag);
    params.set('order', query ? 'relevance' : 'popularity_week');

    const response = await fetch(`${API_URL}?${params.toString()}`);
    if (!response.ok) throw new Error(`Jamendo request failed (${response.status}).`);

    const data = (await response.json()) as JamendoResponse;
    if (data.headers.status !== 'success') {
      throw new Error(data.headers.error_message || 'Jamendo returned an error.');
    }
    return data.results.filter((track) => track.audio).map(toSong);
  }
}

function toSong(track: JamendoTrack): Song {
  return {
    id: `jamendo-${track.id}`,
    title: track.name,
    artist: track.artist_name,
    album: track.album_name,
    duration: Number(track.duration) || 0,
    source: 'jamendo',
    audioUrl: track.audio,
    coverUrl: track.album_image || track.image,
  };
}
