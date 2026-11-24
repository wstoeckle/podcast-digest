// Pluggable speech-to-text. The default provider is AssemblyAI, which ingests
// the episode's audio URL directly (submit → poll) so we never download or
// transcode large audio inside the serverless function. Swap in Groq/Deepgram
// later behind the same interface.

import type { TranscriptStatus } from '../../src/types.js';
import { formatTimed, type Cue } from '../../src/lib/timed.js';

export interface SttProvider {
  /** Kick off a transcription of a remote audio URL; returns a job id. */
  submit(audioUrl: string): Promise<string>;
  /** Poll a job; returns status and, when ready, the text. */
  poll(jobId: string): Promise<{ status: TranscriptStatus; text?: string; error?: string }>;
}

const AAI_BASE = 'https://api.assemblyai.com/v2/transcript';

/**
 * AssemblyAI's model, from ASSEMBLYAI_SPEECH_MODEL. Default `universal-2`
 * ($0.15/hr + $0.02/hr speaker labels): about 30% cheaper than the account
 * default (`assemblyai-stt-3-7`, $0.21/hr) and plenty for spoken podcasts.
 */
export function assemblyAiModel(): string {
  return process.env.ASSEMBLYAI_SPEECH_MODEL?.trim() || 'universal-2';
}

/** The body of a transcription request for an episode's audio. */
export function assemblyAiRequest(audioUrl: string): Record<string, unknown> {
  return { audio_url: audioUrl, speech_models: [assemblyAiModel()], speaker_labels: true };
}

class AssemblyAI implements SttProvider {
  constructor(private key: string) {}

  async submit(audioUrl: string): Promise<string> {
    const res = await fetch(AAI_BASE, {
      method: 'POST',
      headers: { authorization: this.key, 'content-type': 'application/json' },
      body: JSON.stringify(assemblyAiRequest(audioUrl)),
    });
    if (!res.ok) {
      throw new Error(`AssemblyAI submit failed: ${res.status} ${await safeText(res)}`);
    }
    const data = (await res.json()) as { id?: string };
    if (!data.id) throw new Error('AssemblyAI submit returned no id');
    return data.id;
  }

  async poll(jobId: string): Promise<{ status: TranscriptStatus; text?: string; error?: string }> {
    const res = await fetch(`${AAI_BASE}/${encodeURIComponent(jobId)}`, {
      headers: { authorization: this.key },
    });
    if (!res.ok) throw new Error(`AssemblyAI poll failed: ${res.status}`);
    const data = (await res.json()) as AaiTranscript;
    switch (data.status) {
      case 'completed': {
        const out: { status: TranscriptStatus; text?: string } = { status: 'ready' };
        const text = assemblyAiText(data);
        if (text) out.text = text;
        return out;
      }
      case 'error': {
        const out: { status: TranscriptStatus; error?: string } = { status: 'error' };
        if (data.error) out.error = data.error;
        return out;
      }
      default:
        return { status: 'processing' };
    }
  }
}

interface AaiWord {
  text?: string;
  start?: number;
}
interface AaiUtterance {
  speaker?: string;
  start?: number;
  text?: string;
  words?: AaiWord[];
}
export interface AaiTranscript {
  status?: string;
  text?: string;
  error?: string;
  utterances?: AaiUtterance[] | null;
  words?: AaiWord[] | null;
}

/**
 * Timed text from an AssemblyAI result: speaker turns (speaker_labels is on)
 * split into sentences with their start times, so the transcript carries
 * `[m:ss] Speaker A: …` paragraphs. Falls back to the flat text.
 */
export function assemblyAiText(data: AaiTranscript): string | undefined {
  const cues: Cue[] = [];
  const turns: AaiUtterance[] = data.utterances?.length
    ? data.utterances
    : data.words?.length
      ? [{ words: data.words }]
      : [];
  for (const turn of turns) {
    const speaker = turn.speaker ? `Speaker ${turn.speaker}` : undefined;
    const words = turn.words ?? [];
    if (!words.length) {
      if (turn.text && typeof turn.start === 'number') {
        cues.push(withSpeaker({ start: turn.start / 1000, text: turn.text }, speaker));
      }
      continue;
    }
    let start: number | undefined;
    let parts: string[] = [];
    for (const w of words) {
      if (!w.text) continue;
      if (start === undefined && typeof w.start === 'number') start = w.start / 1000;
      parts.push(w.text);
      if (/[.!?]["')\]]*$/.test(w.text) && start !== undefined) {
        cues.push(withSpeaker({ start, text: parts.join(' ') }, speaker));
        start = undefined;
        parts = [];
      }
    }
    if (parts.length && start !== undefined) {
      cues.push(withSpeaker({ start, text: parts.join(' ') }, speaker));
    }
  }
  return cues.length >= 2 ? formatTimed(cues) : data.text || undefined;
}

function withSpeaker(cue: Cue, speaker: string | undefined): Cue {
  return speaker ? { ...cue, speaker } : cue;
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return '';
  }
}

export function hasStt(): boolean {
  return Boolean(process.env.ASSEMBLYAI_API_KEY);
}

export function sttProvider(): SttProvider | null {
  const key = process.env.ASSEMBLYAI_API_KEY;
  if (!key) return null;
  return new AssemblyAI(key);
}
