export const SOUND_COLORS = Object.freeze([
  { name: '金黄', folder: 'yellow', semitones: 0 },
  { name: '草绿', folder: 'green', semitones: 20 },
  { name: '天蓝', folder: 'blue', semitones: 10 },
  { name: '玫红', folder: 'pink', semitones: 5 },
  { name: '紫色', folder: 'purple', semitones: 15 },
]);

export function soundForElimination(type, count) {
  if (!Number.isInteger(type) || !SOUND_COLORS[type] || !Number.isInteger(count) || count < 2 || count > 100) return null;
  const clip = Math.min(11, count), color = SOUND_COLORS[type];
  return { type, count, semitones: color.semitones, url: `./assets/audio/game/v1/${color.folder}/tiles-${clip}${clip === 11 ? '-plus' : ''}.mp3` };
}

export class EliminationAudio {
  constructor({ createContext, fetcher, onError } = {}) {
    this.createContext = createContext || (() => {
      const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!Context) throw new Error('Audio playback is unavailable');
      return new Context();
    });
    this.fetcher = fetcher || ((url) => fetch(url));
    this.onError = onError || (() => {});
    this.enabled = true; this.volume = 0.6; this.revision = 0;
    this.buffers = new Map();
  }

  configure({ enabled, volume }) {
    this.enabled = enabled !== false;
    this.volume = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 0.6;
    if (this.master) this.master.gain.value = this.volume;
    if (!this.enabled || this.volume === 0) this.stop();
  }

  initialize() {
    if (this.context) return;
    this.context = this.createContext();
    this.master = this.context.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.context.destination);
  }

  async unlock() {
    this.initialize();
    if (this.context.state !== 'running') await this.context.resume();
  }

  async load(url) {
    if (this.buffers.has(url)) return this.buffers.get(url);
    const task = (async () => {
      const response = await this.fetcher(url);
      if (!response.ok) throw new Error('Sound file could not be loaded');
      return this.context.decodeAudioData(await response.arrayBuffer());
    })();
    this.buffers.set(url, task);
    try { return await task; }
    catch (error) { if (this.buffers.get(url) === task) this.buffers.delete(url); throw error; }
  }

  async warmup() {
    if (!this.enabled || this.volume === 0) return;
    try {
      await this.unlock();
      await Promise.allSettled(SOUND_COLORS.flatMap((_, type) => Array.from({ length: 10 }, (_, index) => this.load(soundForElimination(type, index + 2).url))));
    } catch (error) { this.report(error); }
  }

  report(error) {
    if (this.errorReported) return;
    this.errorReported = true;
    this.onError(error);
  }

  stop() {
    this.revision++;
    if (!this.active) return;
    const { source, envelope, cleanup } = this.active;
    this.active = null;
    const now = this.context.currentTime;
    envelope.gain.cancelScheduledValues(now);
    envelope.gain.setValueAtTime(envelope.gain.value, now);
    envelope.gain.linearRampToValueAtTime(0, now + 0.005);
    try { source.stop(now + 0.006); } catch { cleanup(); }
  }

  async play(type, count) {
    const sound = soundForElimination(type, count);
    if (!sound || !this.enabled || this.volume === 0) return false;
    this.stop();
    const revision = this.revision;
    try {
      await this.unlock();
      const buffer = await this.load(sound.url);
      if (revision !== this.revision || !this.enabled || this.volume === 0) return false;
      const source = this.context.createBufferSource(), envelope = this.context.createGain();
      source.buffer = buffer;
      source.connect(envelope); envelope.connect(this.master);
      const cleanup = () => {
        source.disconnect(); envelope.disconnect();
        if (this.active?.source === source) this.active = null;
      };
      source.onended = cleanup;
      this.active = { source, envelope, cleanup };
      source.start();
      return true;
    } catch (error) {
      if (revision === this.revision && this.enabled) this.report(error);
      return false;
    }
  }
}
