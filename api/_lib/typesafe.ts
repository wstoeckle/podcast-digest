// Server-only TypeSafe HTTP adapter. Never return provider bodies or credentials.
export type Question =
  | { type: 'choice'; instructions: string; criteria: Record<string, string> }
  | { type: 'score'; instructions: string; criteria: string[] };
export interface Answer {
  type: 'choice' | 'score';
  choice?: string;
  score?: number;
  confidence: number;
  probabilities: Record<string, number>;
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid TypeSafe response');
  return value as Record<string, unknown>;
}
function probability(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}
export function parseAnswers(
  value: unknown,
  questions: Record<string, Question>,
): { model: string; answers: Record<string, Answer> } {
  const envelope = object(value);
  if (typeof envelope.model !== 'string' || !envelope.model)
    throw new Error('Invalid TypeSafe model');
  const raw = object(envelope.answers);
  const answers: Record<string, Answer> = {};
  for (const [id, question] of Object.entries(questions)) {
    const a = object(raw[id]);
    const probs = object(a.probabilities);
    const keys =
      question.type === 'choice'
        ? Object.keys(question.criteria)
        : question.criteria.map((_, i) => String(i));
    if (
      a.type !== question.type ||
      !probability(a.confidence) ||
      Object.keys(probs).length !== keys.length ||
      keys.some((k) => !probability(probs[k])) ||
      Math.abs(keys.reduce((sum, k) => sum + (probs[k] as number), 0) - 1) > 0.02
    ) {
      throw new Error('Invalid TypeSafe distribution');
    }
    if (question.type === 'choice' && (typeof a.choice !== 'string' || !keys.includes(a.choice)))
      throw new Error('Invalid TypeSafe choice');
    if (
      question.type === 'score' &&
      (typeof a.score !== 'number' ||
        !Number.isFinite(a.score) ||
        a.score < 0 ||
        a.score > keys.length - 1)
    )
      throw new Error('Invalid TypeSafe score');
    answers[id] = {
      type: question.type,
      confidence: a.confidence,
      probabilities: probs as Record<string, number>,
      ...(question.type === 'choice'
        ? { choice: a.choice as string }
        : { score: a.score as number }),
    };
  }
  return { model: envelope.model, answers };
}
export async function evaluate(
  state: unknown,
  questions: Record<string, Question>,
  transport: typeof fetch = fetch,
) {
  const key = process.env.TYPESAFE_API_KEY?.trim();
  if (!key) throw new Error('TypeSafe is not configured. Set TYPESAFE_API_KEY on the server.');
  const signal = AbortSignal.timeout(25_000);
  const body = JSON.stringify({
    model: process.env.TYPESAFE_MODEL || 'jev-latest',
    state,
    questions,
  });
  if (body.length > 120_000) throw new Error('TypeSafe input exceeds the review limit');
  for (let attempt = 0; attempt < 2; attempt++) {
    let response: Response;
    try {
      response = await transport('https://api.typesafe.ai/v1/systemone', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body,
        signal,
        redirect: 'error',
      });
    } catch {
      throw new Error('TypeSafe is unavailable or timed out. Try again.');
    }
    if ((response.status === 429 || response.status === 529) && attempt === 0) {
      await response.body?.cancel();
      await new Promise((resolve) => setTimeout(resolve, 1000));
      continue;
    }
    if (!response.ok)
      throw new Error(
        `TypeSafe request failed (${response.status}). Check server configuration or try again.`,
      );
    try {
      return parseAnswers(await response.json(), questions);
    } catch {
      throw new Error('TypeSafe returned an incomplete or invalid review. Try again.');
    }
  }
  throw new Error('TypeSafe is busy. Try again.');
}
