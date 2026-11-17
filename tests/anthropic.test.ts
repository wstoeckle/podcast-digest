// @vitest-environment node
// Checks the requests the SDK sends and how replies are handled, with fetch
// stubbed: no key, no network, no spend.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface Captured {
  url: string;
  headers: Headers;
  body: Record<string, unknown>;
}

let calls: Captured[] = [];

function stubFetch(reply: () => Response) {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(input),
        headers: new Headers(init?.headers),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      });
      return reply();
    }),
  );
}

function message(content: unknown[], stop_reason = 'end_turn', model = 'claude-opus-5-5') {
  return new Response(
    JSON.stringify({
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model,
      content,
      stop_reason,
      stop_sequence: null,
      stop_details: null,
      usage: { input_tokens: 100, output_tokens: 50 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

function sse(text: string, stop_reason = 'end_turn') {
  const events: [string, unknown][] = [
    [
      'message_start',
      {
        type: 'message_start',
        message: {
          id: 'msg_2',
          type: 'message',
          role: 'assistant',
          model: 'claude-opus-5-5',
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 1 },
        },
      },
    ],
    [
      'content_block_start',
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    ],
    [
      'content_block_delta',
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
    ],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    [
      'message_delta',
      {
        type: 'message_delta',
        delta: { stop_reason, stop_sequence: null },
        usage: { output_tokens: 5 },
      },
    ],
    ['message_stop', { type: 'message_stop' }],
  ];
  const body = events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('');
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

const TRANSCRIPT =
  'Host: Welcome. Guest: The batteries got cheap, and once they got cheap everything else followed. Host: Thanks.';

async function load(env: Record<string, string> = {}) {
  vi.resetModules();
  vi.stubEnv('ANTHROPIC_API_KEY', 'sk-test');
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  return import('../api/_lib/anthropic');
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('generateDigest', () => {
  const reply = {
    tldr: 'Cheap batteries changed everything.',
    bullets: ['Batteries got cheap.'],
    topics: ['energy'],
    outline: [{ title: 'Batteries', summary: 'Why costs fell.' }],
    quotes: [
      'The batteries got cheap, and once they got cheap',
      'A line nobody ever said on the show',
    ],
  };

  it('asks Opus 5.5 for schema-shaped output at medium effort with refusal fallbacks on', async () => {
    stubFetch(() => message([{ type: 'text', text: JSON.stringify(reply) }]));
    const { generateDigest } = await load();
    await generateDigest(TRANSCRIPT, { episodeTitle: 'Ep' });

    const [call] = calls;
    expect(call?.url).toContain('/v1/messages');
    expect(call?.headers.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01');
    expect(call?.body).toMatchObject({
      model: 'claude-opus-5-5',
      fallbacks: 'default',
      max_tokens: 16000,
      output_config: { effort: 'medium', format: { type: 'json_schema' } },
    });
    expect(call?.body).not.toHaveProperty('betas'); // sent as a header, not in the body
    expect(call?.body).not.toHaveProperty('thinking');
    expect(call?.body).not.toHaveProperty('temperature');
  });

  it('keeps only verbatim quotes', async () => {
    stubFetch(() => message([{ type: 'text', text: JSON.stringify(reply) }]));
    const { generateDigest } = await load();
    const d = await generateDigest(TRANSCRIPT, {});
    expect(d.quotes).toEqual(['The batteries got cheap, and once they got cheap']);
    expect(d.outline).toEqual(reply.outline);
  });

  it('reads the answer by block type when thinking blocks come first', async () => {
    stubFetch(() =>
      message([
        { type: 'thinking', thinking: '', signature: 'sig' },
        { type: 'text', text: JSON.stringify(reply) },
      ]),
    );
    const { generateDigest } = await load();
    expect((await generateDigest(TRANSCRIPT, {})).tldr).toBe(reply.tldr);
  });

  it('turns a refusal into a plain error', async () => {
    stubFetch(() => message([], 'refusal'));
    const { generateDigest } = await load();
    await expect(generateDigest(TRANSCRIPT, {})).rejects.toThrow(/declined/);
  });

  it('leaves out fallbacks and effort where the model would reject them', async () => {
    stubFetch(() =>
      message([{ type: 'text', text: JSON.stringify(reply) }], 'end_turn', 'claude-haiku-4-5'),
    );
    const { generateDigest } = await load({ DIGEST_MODEL: 'claude-haiku-4-5' });
    await generateDigest(TRANSCRIPT, {});
    expect(calls[0]?.body).not.toHaveProperty('fallbacks');
    expect(calls[0]?.headers.get('anthropic-beta') ?? '').not.toContain('server-side-fallback');
    expect(calls[0]?.body.output_config).toEqual({ format: expect.any(Object) });
  });

  it('uses Haiku 5.5 with effort but without fallbacks when configured', async () => {
    stubFetch(() =>
      message([{ type: 'text', text: JSON.stringify(reply) }], 'end_turn', 'claude-haiku-5-5'),
    );
    const { generateDigest } = await load({
      DIGEST_MODEL: 'claude-haiku-5-5',
      DIGEST_EFFORT: 'low',
    });
    await generateDigest(TRANSCRIPT, {});
    expect(calls[0]?.body).toMatchObject({
      model: 'claude-haiku-5-5',
      output_config: { effort: 'low' },
    });
    expect(calls[0]?.body).not.toHaveProperty('fallbacks');
  });
});

describe('streamAnswer', () => {
  it('streams text at low effort with the transcript prompt-cached', async () => {
    stubFetch(() => sse('They said batteries.'));
    const { streamAnswer } = await load();
    let out = '';
    await streamAnswer({
      transcript: TRANSCRIPT,
      meta: {},
      history: [
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello' },
      ],
      question: 'What got cheap?',
      onDelta: (t) => (out += t),
    });
    expect(out).toBe('They said batteries.');
    const body = calls[0]?.body as {
      stream: boolean;
      output_config: unknown;
      messages: { role: string; content: unknown }[];
    };
    expect(body.stream).toBe(true);
    expect(body.output_config).toEqual({ effort: 'low' });
    expect(JSON.stringify(body.messages[0])).toContain('"cache_control":{"type":"ephemeral"}');
    expect(body.messages.map((m) => m.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
      'user',
    ]);
  });

  it('tells the reader when the answer was declined', async () => {
    stubFetch(() => sse('', 'refusal'));
    const { streamAnswer } = await load();
    let out = '';
    await streamAnswer({
      transcript: TRANSCRIPT,
      meta: {},
      history: [],
      question: 'q',
      onDelta: (t) => (out += t),
    });
    expect(out).toMatch(/declined/);
  });
});
