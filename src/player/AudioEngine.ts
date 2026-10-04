/**
 * Low level audio output.
 *
 * It owns two <audio> elements:
 *  - "analysed": routed through the Web Audio API so the visualizer can read
 *    real frequency data. Remote files must allow CORS for this to work.
 *  - "plain": a regular element used as a fallback when a remote server
 *    does not allow CORS (the song still plays, the visualizer is simulated).
 *
 * Every event is re-dispatched from this object, so the rest of the app
 * never has to know which element is active.
 */
export class AudioEngine extends EventTarget {
  private readonly analysedAudio: HTMLAudioElement;
  private readonly plainAudio: HTMLAudioElement;
  private active: HTMLAudioElement;
  private context: AudioContext | null = null;
  private analyserNode: AnalyserNode | null = null;
  private remoteCorsAllowed = true;
  private currentSrc = '';
  private currentIsRemote = false;
  private retried = false;
  private wantsToPlay = false;
  private volume = 0.8;
  private fadeLevel = 1;
  private fadeFrame = 0;
  private finishFade: (() => void) | null = null;

  constructor() {
    super();
    this.analysedAudio = this.createElement(true);
    this.plainAudio = this.createElement(false);
    this.active = this.analysedAudio;
    this.applyVolume();
  }

  get analyser(): AnalyserNode | null {
    return this.active === this.analysedAudio ? this.analyserNode : null;
  }

  get currentTime(): number {
    return this.active.currentTime;
  }

  set currentTime(seconds: number) {
    if (Number.isFinite(seconds)) this.active.currentTime = seconds;
  }

  get duration(): number {
    const duration = this.active.duration;
    return Number.isFinite(duration) ? duration : 0;
  }

  get paused(): boolean {
    return this.active.paused;
  }

  get hasSource(): boolean {
    return this.currentSrc !== '';
  }

  load(src: string, isRemote: boolean): void {
    this.analysedAudio.pause();
    this.plainAudio.pause();
    this.currentSrc = src;
    this.currentIsRemote = isRemote;
    this.retried = false;
    this.active = isRemote && !this.remoteCorsAllowed ? this.plainAudio : this.analysedAudio;
    this.active.src = src;
    this.active.load();
  }

  async play(): Promise<void> {
    if (!this.hasSource) return;
    this.wantsToPlay = true;
    this.ensureAudioGraph();
    if (this.context?.state === 'suspended') await this.context.resume();
    try {
      await this.active.play();
    } catch (error) {
      // AbortError happens when a new song is loaded before the previous one started.
      if ((error as DOMException).name !== 'AbortError') throw error;
    }
  }

  pause(): void {
    this.wantsToPlay = false;
    this.active.pause();
  }

  stop(): void {
    this.pause();
    this.active.removeAttribute('src');
    this.active.load();
    this.currentSrc = '';
  }

  getVolume(): number {
    return this.volume;
  }

  setVolume(volume: number): void {
    this.volume = Math.min(1, Math.max(0, volume));
    this.applyVolume();
    this.emit('volumechange');
  }

  /** Smoothly changes an extra volume multiplier (used by the fade decorator). */
  fadeTo(level: number, milliseconds: number): Promise<void> {
    this.cancelFade();
    const start = this.fadeLevel;
    const startTime = performance.now();
    return new Promise((resolve) => {
      this.finishFade = resolve;
      const step = (now: number) => {
        const progress = Math.min(1, (now - startTime) / milliseconds);
        this.fadeLevel = start + (level - start) * progress;
        this.applyVolume();
        if (progress < 1) this.fadeFrame = requestAnimationFrame(step);
        else this.cancelFade();
      };
      this.fadeFrame = requestAnimationFrame(step);
    });
  }

  setFadeLevel(level: number): void {
    this.cancelFade();
    this.fadeLevel = level;
    this.applyVolume();
  }

  emit(type: string, detail?: unknown): void {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  /** Stops the running fade and resolves its promise so no caller waits forever. */
  private cancelFade(): void {
    cancelAnimationFrame(this.fadeFrame);
    const finish = this.finishFade;
    this.finishFade = null;
    finish?.();
  }

  private applyVolume(): void {
    const value = this.volume * this.fadeLevel;
    this.analysedAudio.volume = value;
    this.plainAudio.volume = value;
  }

  private createElement(analysed: boolean): HTMLAudioElement {
    const audio = new Audio();
    audio.preload = 'auto';
    if (analysed) audio.crossOrigin = 'anonymous';

    const forward = ['timeupdate', 'play', 'pause', 'ended', 'loadedmetadata', 'waiting', 'playing'];
    for (const type of forward) {
      audio.addEventListener(type, () => {
        if (audio === this.active) this.emit(type);
      });
    }
    audio.addEventListener('error', () => {
      if (audio !== this.active || !this.currentSrc) return;
      this.handleError();
    });
    return audio;
  }

  /** If a remote file fails with CORS enabled, retry it on the plain element. */
  private handleError(): void {
    if (this.currentIsRemote && this.active === this.analysedAudio && !this.retried) {
      this.retried = true;
      this.remoteCorsAllowed = false;
      this.active = this.plainAudio;
      this.active.src = this.currentSrc;
      this.active.load();
      if (this.wantsToPlay) void this.play();
      return;
    }
    this.emit('error', 'This song could not be played.');
  }

  /** The AudioContext can only start after a user gesture, so it is created lazily. */
  private ensureAudioGraph(): void {
    if (this.context) return;
    const AudioContextClass = window.AudioContext;
    if (!AudioContextClass) return;
    this.context = new AudioContextClass();
    const source = this.context.createMediaElementSource(this.analysedAudio);
    this.analyserNode = this.context.createAnalyser();
    this.analyserNode.fftSize = 256;
    this.analyserNode.smoothingTimeConstant = 0.8;
    source.connect(this.analyserNode);
    this.analyserNode.connect(this.context.destination);
  }
}
