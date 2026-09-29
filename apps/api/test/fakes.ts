import { vi } from 'vitest';
import { ExplanationUnavailable, type CoachLlm } from '../src/teacher/llmTeacher.js';

/** Scripted CoachLlm for tests: pass canned structured/text answers (or functions producing them). */
export function fakeLlm(opts: { structured?: unknown | (() => unknown); text?: string | string[] | (() => string) } = {}) {
  const texts = Array.isArray(opts.text) ? [...opts.text] : null;
  const structured = vi.fn(async () => (typeof opts.structured === 'function' ? (opts.structured as () => unknown)() : opts.structured));
  const text = vi.fn(async () => {
    if (texts) return texts.shift() ?? '';
    return typeof opts.text === 'function' ? opts.text() : (opts.text ?? '');
  });
  return { structured, text } as unknown as CoachLlm & { structured: typeof structured; text: typeof text };
}

export function unavailableLlm(reason = 'no key'): CoachLlm {
  const fail = () => Promise.reject(new ExplanationUnavailable(reason));
  return { structured: fail, text: fail };
}
