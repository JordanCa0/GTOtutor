/**
 * JEV AI: TypeSafe's Jev decision model (https://api.typesafe.ai/docs). One request asks several
 * named choice questions about one shared state and gets back a probability per option, which is
 * what an archetype's mixed strategy needs.
 */
export interface JevChoice {
  instructions: string;
  /** Option name -> when it applies. */
  criteria: Record<string, string>;
}

export interface JevClient {
  /** Each question's probability per option, keyed like the questions and their criteria. */
  choose(state: Record<string, unknown>, questions: Record<string, JevChoice>, timeoutMs?: number): Promise<Record<string, Record<string, number>>>;
}

const DEFAULT_URL = 'https://api.typesafe.ai/v1/systemone';
const TIMEOUT_MS = 20_000;

interface SystemOneResponse {
  answers?: Record<string, { type?: string; probabilities?: Record<string, number> }>;
}

/** Statuses worth retrying, with backoff: rate limited (429) and overloaded (529). */
const RETRY_STATUSES = new Set([429, 529]);
const FIRST_BACKOFF_MS = 500;

export function jevClient(apiKey: string, model = 'jev-latest', url = DEFAULT_URL, fetchImpl: typeof fetch = fetch): JevClient {
  return {
    async choose(state, questions, timeoutMs = TIMEOUT_MS) {
      const deadline = Date.now() + timeoutMs;
      const request = JSON.stringify({
        model,
        state,
        questions: Object.fromEntries(Object.entries(questions).map(([name, q]) => [name, { type: 'choice', ...q }])),
      });
      let res: Response;
      for (let attempt = 0; ; attempt++) {
        res = await fetchImpl(url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: request,
          signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
        });
        // Rate limited or overloaded: back off and retry while the time allows.
        const wait = FIRST_BACKOFF_MS * 2 ** attempt;
        if (!RETRY_STATUSES.has(res.status) || Date.now() + wait >= deadline) break;
        await new Promise((r) => setTimeout(r, wait));
      }
      if (!res.ok) throw new Error(`Jev answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const body = (await res.json()) as SystemOneResponse;
      const out: Record<string, Record<string, number>> = {};
      for (const name of Object.keys(questions)) {
        const probs = body.answers?.[name]?.probabilities;
        if (probs) out[name] = probs;
      }
      return out;
    },
  };
}

/** JEV AI from JEV_API_KEY (and optional JEV_MODEL, JEV_API_URL); null without a key. */
export function jevFromEnv(env: NodeJS.ProcessEnv = process.env): JevClient | null {
  const key = env.JEV_API_KEY?.trim();
  if (!key) return null;
  return jevClient(key, env.JEV_MODEL?.trim() || undefined, env.JEV_API_URL?.trim() || undefined);
}
