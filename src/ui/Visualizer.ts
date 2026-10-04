import type { AudioEngine } from '../player/AudioEngine';

/**
 * Draws animated frequency bars on a canvas.
 * Uses real audio data when available; otherwise (remote file without CORS)
 * it draws a smooth simulated animation so the UI still feels alive.
 */
export class Visualizer {
  private readonly canvas: HTMLCanvasElement;
  private readonly engine: AudioEngine;
  private data = new Uint8Array(128);
  private levels: number[] = [];

  constructor(canvas: HTMLCanvasElement, engine: AudioEngine) {
    this.canvas = canvas;
    this.engine = engine;
    requestAnimationFrame(this.draw);
  }

  private readonly draw = (time: number) => {
    requestAnimationFrame(this.draw);
    const canvas = this.canvas;
    if (!canvas.isConnected || canvas.clientWidth === 0) return;

    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth * ratio;
    const height = canvas.clientHeight * ratio;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, width, height);

    const bars = 40;
    if (this.levels.length !== bars) this.levels = new Array(bars).fill(0);
    const analyser = this.engine.analyser;
    const playing = !this.engine.paused;

    if (analyser && playing) {
      if (this.data.length !== analyser.frequencyBinCount) this.data = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(this.data);
    }

    const gap = 3 * ratio;
    const barWidth = (width - gap * (bars - 1)) / bars;
    const gradient = context.createLinearGradient(0, height, 0, 0);
    gradient.addColorStop(0, '#7c5cff');
    gradient.addColorStop(0.6, '#c45cff');
    gradient.addColorStop(1, '#ff6fb5');
    context.fillStyle = gradient;

    for (let i = 0; i < bars; i++) {
      let target = 0.04;
      if (playing) {
        if (analyser) {
          // Use the lower ~70% of the spectrum, where most music energy is.
          const bin = Math.floor((i / bars) * this.data.length * 0.7);
          target = Math.max(0.04, this.data[bin] / 255);
        } else {
          const t = time / 1000;
          target = 0.25 + 0.35 * Math.abs(Math.sin(t * 2.1 + i * 0.45) * Math.cos(t * 1.3 + i * 0.2));
        }
      }
      this.levels[i] += (target - this.levels[i]) * 0.25;
      const barHeight = Math.max(2 * ratio, this.levels[i] * height);
      const x = i * (barWidth + gap);
      const radius = Math.min(barWidth / 2, 4 * ratio);
      context.beginPath();
      context.roundRect(x, height - barHeight, barWidth, barHeight, [radius, radius, 0, 0]);
      context.fill();
    }
  };
}
