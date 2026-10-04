import type { Song } from '../models/Song';

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 185 -> "3:05" */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  const rest = String(total % 60).padStart(2, '0');
  if (minutes >= 60) return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${rest}`;
  return `${minutes}:${rest}`;
}

/** 4000 -> "1 hr 6 min" */
export function formatLongDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} hr ${minutes % 60} min`;
}

/** Stable hue (0-359) generated from a text, used for placeholder covers. */
export function hueFrom(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0;
  return Math.abs(hash) % 360;
}

export function coverHtml(song: Song | null | undefined, className = 'cover'): string {
  if (song?.coverUrl) {
    return `<img class="${className}" src="${escapeHtml(song.coverUrl)}" alt="" loading="lazy" />`;
  }
  const hue = hueFrom(song ? song.title + song.artist : 'empty');
  return `<div class="${className} cover--placeholder" style="--hue:${hue}">♪</div>`;
}

export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}
