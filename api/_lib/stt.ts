// Pluggable speech-to-text. The default provider is AssemblyAI, which ingests
// the episode's audio URL directly (submit → poll) so we never download or
// transcode large audio inside the serverless function. Swap in Groq/Deepgram
// later behind the same interface.

import type { TranscriptStatus } from '../../src/types.js';

export interface SttProvider {
  /** Kick off a transcription of a remote audio URL; returns a job id. */
  submit(audioUrl: string): Promise<string>;
  /** Poll a job; returns status and, when ready, the text. */
  poll(jobId: string): Promise<{ status: TranscriptStatus; text?: string; error?: string }>;
}

const AAI_BASE = 'https://api.assemblyai.com/v2/transcript';

class AssemblyAI implements SttProvider {
  constructor(private key: string) {}

  async submit(audioUrl: string): Promise<string> {
    const res = await fetch(AAI_BASE, {
      method: 'POST',
      headers: { authorization: this.key, 'content-type': 'application/json' },
      body: JSON.stringify({ audio_url: audioUrl, speaker_labels: true }),
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
    const data = (await res.json()) as { status?: string; text?: string; error?: string };
    switch (data.status) {
      case 'completed': {
        const out: { status: TranscriptStatus; text?: string } = { status: 'ready' };
        if (data.text) out.text = data.text;
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
