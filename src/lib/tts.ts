// On-device read-aloud over the Web Speech API. Speaks the digest sentence by
// sentence so we can (a) highlight the current sentence, (b) offer pause/resume
// reliably, and (c) work around iOS Safari cutting off long single utterances.
// No network, no keys.

export function isTtsSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

/** Split text into speakable sentences (kept short-ish for iOS reliability). */
export function splitSentences(text: string): string[] {
  const rough = text
    .replace(/\s+/g, ' ')
    .trim()
    .match(/[^.!?…]+[.!?…]+(?:["')\]]+)?|\S[^.!?…]*$/g);
  if (!rough) return text.trim() ? [text.trim()] : [];
  const out: string[] = [];
  for (const s of rough) {
    const t = s.trim();
    if (!t) continue;
    // Break very long sentences at clause boundaries so highlighting stays snappy.
    if (t.length > 240) {
      out.push(...t.split(/(?<=[,;:])\s+/).map((p) => p.trim()));
    } else {
      out.push(t);
    }
  }
  return out.filter(Boolean);
}

export type SpeakerState = 'idle' | 'playing' | 'paused';

/** Playback speeds offered everywhere audio is spoken. */
export const RATES = [0.5, 0.8, 1, 1.2, 1.5, 2] as const;

const RATE_KEY = 'pd.rate.v1';

/** The listener's preferred speed, shared across the episode player and the queue. */
export function readRate(): number {
  try {
    const n = Number(localStorage.getItem(RATE_KEY));
    return RATES.includes(n as (typeof RATES)[number]) ? n : 1;
  } catch {
    return 1;
  }
}

export function saveRate(rate: number): void {
  try {
    localStorage.setItem(RATE_KEY, String(rate));
  } catch {
    /* non-fatal */
  }
}

export interface SpeakerOptions {
  rate: number;
  voiceURI?: string;
}

/**
 * Drives speechSynthesis across a list of sentences. Emits the active sentence
 * index and playback state so the UI can highlight + toggle.
 */
export class SentenceSpeaker {
  private sentences: string[] = [];
  private index = 0;
  private opts: SpeakerOptions = { rate: 1 };
  private _state: SpeakerState = 'idle';

  onIndex: (i: number) => void = () => {};
  onState: (s: SpeakerState) => void = () => {};
  /** Fires only when the last sentence finishes naturally (not on stop) — lets a queue auto-advance. */
  onComplete: () => void = () => {};

  get state(): SpeakerState {
    return this._state;
  }

  static voices(): SpeechSynthesisVoice[] {
    if (!isTtsSupported()) return [];
    return window.speechSynthesis.getVoices();
  }

  load(sentences: string[]): void {
    this.stop();
    this.sentences = sentences;
    this.index = 0;
  }

  start(opts: SpeakerOptions, from = 0): void {
    if (!isTtsSupported() || this.sentences.length === 0) return;
    this.opts = opts;
    this.index = Math.max(0, Math.min(from, this.sentences.length - 1));
    window.speechSynthesis.cancel();
    this.setState('playing');
    this.speakCurrent();
  }

  private speakCurrent(): void {
    const text = this.sentences[this.index];
    if (text === undefined) {
      this.setState('idle');
      return;
    }
    this.onIndex(this.index);
    const u = new SpeechSynthesisUtterance(text);
    u.rate = this.opts.rate;
    const voice = SentenceSpeaker.voices().find((v) => v.voiceURI === this.opts.voiceURI);
    if (voice) u.voice = voice;
    u.onend = () => {
      if (this._state !== 'playing') return;
      this.index += 1;
      if (this.index < this.sentences.length) this.speakCurrent();
      else {
        this.index = 0;
        this.setState('idle');
        this.onComplete();
      }
    };
    u.onerror = () => {
      // 'interrupted'/'canceled' fire on stop; ignore unless we're still playing.
      if (this._state === 'playing') this.setState('idle');
    };
    window.speechSynthesis.speak(u);
  }

  pause(): void {
    if (!isTtsSupported() || this._state !== 'playing') return;
    window.speechSynthesis.pause();
    this.setState('paused');
  }

  resume(): void {
    if (!isTtsSupported() || this._state !== 'paused') return;
    window.speechSynthesis.resume();
    this.setState('playing');
  }

  stop(): void {
    if (isTtsSupported()) window.speechSynthesis.cancel();
    if (this._state !== 'idle') this.setState('idle');
  }

  private setState(s: SpeakerState): void {
    this._state = s;
    this.onState(s);
  }
}
