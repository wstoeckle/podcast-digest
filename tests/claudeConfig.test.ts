import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MODEL,
  acceptsEffort,
  acceptsFallbacks,
  resolveEffort,
  resolveModel,
} from '../api/_lib/claudeConfig';

describe('resolveModel', () => {
  it('defaults to Claude Opus 5.5 and honors an override', () => {
    expect(DEFAULT_MODEL).toBe('claude-opus-5-5');
    expect(resolveModel(undefined)).toBe('claude-opus-5-5');
    expect(resolveModel('  ')).toBe('claude-opus-5-5');
    expect(resolveModel(' claude-haiku-5-5 ')).toBe('claude-haiku-5-5');
  });
});

describe('resolveEffort', () => {
  it('accepts known levels in any case and falls back otherwise', () => {
    expect(resolveEffort('HIGH', 'low')).toBe('high');
    expect(resolveEffort('xhigh', 'low')).toBe('xhigh');
    expect(resolveEffort('extreme', 'medium')).toBe('medium');
    expect(resolveEffort(undefined, 'low')).toBe('low');
  });
});

describe('acceptsEffort', () => {
  it('is true for current models and false for ones that reject the parameter', () => {
    for (const m of [
      'claude-opus-5-5',
      'claude-sonnet-5-5',
      'claude-haiku-5-5',
      'claude-opus-4-8',
    ]) {
      expect(acceptsEffort(m)).toBe(true);
    }
    for (const m of ['claude-haiku-4-5', 'claude-sonnet-4-5', 'claude-3-5-haiku-latest']) {
      expect(acceptsEffort(m)).toBe(false);
    }
  });
});

describe('acceptsFallbacks', () => {
  it('is on for models with server-side refusal fallbacks only', () => {
    for (const m of ['claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5', 'claude-fable-5-2']) {
      expect(acceptsFallbacks(m)).toBe(true);
    }
    // Haiku 5.5 has no server-side fallback; older models don't take the parameter.
    for (const m of [
      'claude-haiku-5-5',
      'claude-sonnet-5',
      'claude-opus-4-8',
      'claude-haiku-4-5',
    ]) {
      expect(acceptsFallbacks(m)).toBe(false);
    }
  });
});
