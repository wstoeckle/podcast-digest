import { afterEach, expect, it, vi } from 'vitest';
import { parseInput, rankDigests } from '../api/recommend';
import { evaluate, parseAnswers, type Question } from '../api/_lib/typesafe';
const digest = {
  guid: 'a',
  title: 'Episode',
  show: 'Show',
  tldr: 'Heat pump controls improve efficiency.',
  bullets: ['A field trial.'],
  topics: ['climate'],
};
const input = { interests: 'Climate technology', candidates: [digest], history: [] };
afterEach(() => vi.unstubAllEnvs());
it('validates bounded complete inputs and prevents history/candidate overlap', () => {
  expect(parseInput(input)).toEqual(input);
  for (const invalid of [
    { ...input, interests: '' },
    { ...input, candidates: [digest, digest] },
    { ...input, history: [digest] },
    { ...input, candidates: Array(21).fill(digest) },
    { ...input, candidates: [{ ...digest, bullets: [null] }] },
  ])
    expect(() => parseInput(invalid)).toThrow();
});
it('batches independent scores, keeps identifiers out of state, and skips novelty without history', async () => {
  const run: typeof evaluate = async (state, questions) => {
    expect(JSON.stringify(state)).not.toContain('"guid"');
    expect(Object.keys(questions)).toEqual(['relevance_0']);
    return {
      model: 'test',
      answers: {
        relevance_0: {
          type: 'score',
          score: 2.5,
          confidence: 0.9,
          probabilities: { '0': 0, '1': 0, '2': 0.5, '3': 0.5 },
        },
      },
    };
  };
  expect((await rankDigests(input, run)).ranks).toEqual([
    { guid: 'a', relevance: 2.5, novelty: 3 },
  ]);
});
it('rejects missing, wrong-type, nonfinite, and incomplete distributions', () => {
  const questions: Record<string, Question> = {
    r: { type: 'score', instructions: 'Interest fit?', criteria: ['none', 'some', 'strong'] },
  };
  const valid = {
    model: 'test',
    answers: {
      r: {
        type: 'score',
        score: 1.5,
        confidence: 0.9,
        probabilities: { '0': 0, '1': 0.5, '2': 0.5 },
      },
    },
  };
  expect(parseAnswers(valid, questions).answers.r?.score).toBe(1.5);
  for (const bad of [
    { ...valid, answers: {} },
    { ...valid, answers: { r: { ...valid.answers.r, score: NaN } } },
    { ...valid, answers: { r: { ...valid.answers.r, probabilities: { '0': 1 } } } },
  ])
    expect(() => parseAnswers(bad, questions)).toThrow();
});
it('requires a server key and redacts upstream errors', async () => {
  vi.stubEnv('TYPESAFE_API_KEY', '');
  const transport = vi.fn();
  await expect(evaluate({}, {}, transport)).rejects.toThrow('not configured');
  expect(transport).not.toHaveBeenCalled();
  vi.stubEnv('TYPESAFE_API_KEY', 'test');
  await expect(
    evaluate({}, {}, async () => new Response('private request', { status: 401 })),
  ).rejects.toThrow('401');
});
