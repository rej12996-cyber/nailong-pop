export const SOUND_COLORS = Object.freeze([
  { name: '金黄', folder: 'yellow', semitones: 0 },
  { name: '草绿', folder: 'green', semitones: 20 },
  { name: '天蓝', folder: 'blue', semitones: 10 },
  { name: '玫红', folder: 'pink', semitones: 5 },
  { name: '紫色', folder: 'purple', semitones: 15 },
]);

export const RANDOM_VOICE_URLS = Object.freeze(Array.from({ length: 10 }, (_, index) =>
  `./assets/audio/game/v2/voice-${String(index + 1).padStart(2, '0')}.mp3`));

function laughForColor(type) {
  const color = SOUND_COLORS[type];
  return { type, kind: 'laugh', semitones: color.semitones, url: `./assets/audio/game/v1/${color.folder}/tiles-11-plus.mp3` };
}

export const ELIMINATION_SOUND_URLS = Object.freeze([
  ...RANDOM_VOICE_URLS, ...SOUND_COLORS.map((_, type) => laughForColor(type).url),
]);
export const RESULT_SOUND_URL = './assets/audio/game/v3/result-laugh.mp3';
export const GAME_SOUND_URLS = Object.freeze([...ELIMINATION_SOUND_URLS, RESULT_SOUND_URL]);

export function soundForElimination(type, count, random = Math.random) {
  if (!Number.isInteger(type) || !SOUND_COLORS[type] || !Number.isInteger(count) || count < 2 || count > 100) return null;
  if (count >= 11) return { ...laughForColor(type), count };
  const index = Math.floor(random() * RANDOM_VOICE_URLS.length);
  return { type, count, kind: 'voice', semitones: 0, url: RANDOM_VOICE_URLS[index] };
}

export class EliminationAudio {
  constructor({ createContext, fetcher, onError, random = Math.random } = {}) {
    this.createContext = createContext || (() => {
      const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!Context) throw new Error('Audio playback is unavailable');
      return new Context();
    });
    this.fetcher = fetcher || ((url) => fetch(url));
    this.onError = onError || (() => {});
    this.random = random;
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
      await Promise.allSettled(GAME_SOUND_URLS.map(url => this.load(url)));
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
    if (!this.enabled || this.volume === 0) return false;
    const sound = soundForElimination(type, count, this.random);
    if (!sound) return false;
    return this.playUrl(sound.url);
  }

  async playResult() {
    return this.playUrl(RESULT_SOUND_URL);
  }

  async playUrl(url) {
    if (!this.enabled || this.volume === 0) return false;
    this.stop();
    const revision = this.revision;
    try {
      await this.unlock();
      const buffer = await this.load(url);
      if (revision !== this.revision || !this.enabled || this.volume === 0) return false;
      const source = this.context.createBufferSource(), envelope = this.context.createGain();
      source.buffer = buffer;
      source.loop = false;
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
