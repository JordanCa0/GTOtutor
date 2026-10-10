import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { HourlyRateLimiter } from '../teacher/rateLimit.js';
import type { LiveOut, LiveRequest } from './liveSolve.js';

/** What the solver service answers (solver/src/bin/live.rs). */
export interface SolverResponse {
  commit: string;
  seconds?: number;
  /** Base64 gzip of the `LiveOut` JSON. */
  gz?: string;
  error?: string;
}

/** Sends one request to the solver service. Only JSON crosses (AGPL condition 1). */
export type SolverTransport = (payload: string) => Promise<SolverResponse>;

/** Where finished solves are kept, so players reaching the same spot share one solve. */
export interface SolveCache {
  get(key: string): Promise<Buffer | null>;
  put(key: string, value: Buffer): Promise<void>;
}

export interface LiveSolve {
  id: string;
  commit: string;
  cached: boolean;
  out: LiveOut;
}

export class LiveSolveError extends Error {
  constructor(
    readonly reason: 'limit' | 'timeout' | 'failed',
    message: string,
  ) {
    super(message);
  }
}

export interface LiveSolverOptions {
  /** A solve slower than this counts as failed (the solve still finishes into the cache). */
  timeoutMs?: number;
  /** Uncached solves per player per hour, and for everyone together. */
  perPlayerPerHour?: number;
  globalPerHour?: number;
}

/** A solve's id: a hash of the whole request, so any change in ranges, board or tree is a new solve. */
export const solveId = (req: LiveRequest) => createHash('sha256').update(JSON.stringify(req)).digest('hex').slice(0, 32);

/**
 * Runs live turn solves through the solver service: cache first, then the service. Identical
 * requests in flight share one call. A player's uncached solves are rate limited; when a limit is
 * hit, the solve fails and the hand runs out as before.
 */
export class LiveSolver {
  private readonly inFlight = new Map<string, Promise<LiveSolve>>();
  private readonly perPlayer: HourlyRateLimiter;
  private readonly global: HourlyRateLimiter;
  private readonly timeoutMs: number;

  constructor(
    private readonly transport: SolverTransport,
    private readonly cache: SolveCache,
    opts: LiveSolverOptions = {},
  ) {
    this.timeoutMs = opts.timeoutMs ?? 20_000;
    this.perPlayer = new HourlyRateLimiter(opts.perPlayerPerHour ?? 300);
    this.global = new HourlyRateLimiter(opts.globalPerHour ?? 3000);
  }

  /** `label` groups cache entries (the spot name); `player` is charged for an uncached solve. */
  solve(req: LiveRequest, label: string, player: string): Promise<LiveSolve> {
    const id = solveId(req);
    let p = this.inFlight.get(id);
    if (!p) {
      p = this.run(req, id, label, player).finally(() => this.inFlight.delete(id));
      this.inFlight.set(id, p);
    }
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new LiveSolveError('timeout', 'The turn solve took too long.')), this.timeoutMs);
    });
    return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
  }

  private async run(req: LiveRequest, id: string, label: string, player: string): Promise<LiveSolve> {
    const key = `turn-cache/${label}/${req.board.join('')}/${id}.json`;
    const hit = await this.cache.get(key).catch(() => null);
    if (hit) return { id, cached: true, ...decode(JSON.parse(hit.toString()) as SolverResponse) };
    if (!this.global.tryConsume('global') || !this.perPlayer.tryConsume(player)) {
      throw new LiveSolveError('limit', 'Too many turn solves this hour.');
    }
    let res: SolverResponse;
    try {
      res = await this.transport(JSON.stringify(req));
    } catch (err) {
      throw new LiveSolveError('failed', `The solver service could not be reached: ${(err as Error).message}`);
    }
    const solved = decode(res);
    await this.cache.put(key, Buffer.from(JSON.stringify(res))).catch(() => undefined);
    return { id, cached: false, ...solved };
  }
}

function decode(res: SolverResponse): { commit: string; out: LiveOut } {
  if (res.error || !res.gz) throw new LiveSolveError('failed', `The solver failed: ${res.error ?? 'empty response'}`);
  return { commit: res.commit, out: JSON.parse(gunzipSync(Buffer.from(res.gz, 'base64')).toString()) as LiveOut };
}

/** Local development: `live --serve <port>` (solver/src/bin/live.rs). */
export const httpTransport =
  (url: string): SolverTransport =>
  async (payload) => {
    const res = await fetch(url, { method: 'POST', body: payload, headers: { 'content-type': 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as SolverResponse;
  };

/** Production: the gtotutor-turn-solver Lambda function (solver/cloud/lambda-deploy.ps1). */
export async function lambdaTransport(functionName: string, region: string): Promise<SolverTransport> {
  const { LambdaClient, InvokeCommand } = await import('@aws-sdk/client-lambda');
  const client = new LambdaClient({ region });
  return async (payload) => {
    const out = await client.send(new InvokeCommand({ FunctionName: functionName, Payload: Buffer.from(payload) }));
    if (out.FunctionError) throw new Error(`function error: ${Buffer.from(out.Payload ?? []).toString().slice(0, 200)}`);
    return JSON.parse(Buffer.from(out.Payload ?? []).toString()) as SolverResponse;
  };
}

/** Production cache: the solver bucket's turn-cache/ prefix (the API server's role can read and write only that). */
export async function s3Cache(bucket: string, region: string): Promise<SolveCache> {
  const { S3Client, GetObjectCommand, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const client = new S3Client({ region });
  return {
    async get(key) {
      try {
        const out = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        return Buffer.from(await out.Body!.transformToByteArray());
      } catch (err) {
        if ((err as { name?: string }).name === 'NoSuchKey') return null;
        throw err;
      }
    },
    async put(key, value) {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: value, ContentType: 'application/json' }));
    },
  };
}

/** Development and tests: an in-memory cache of the most recent solves. */
export function memoryCache(max = 200): SolveCache {
  const m = new Map<string, Buffer>();
  return {
    async get(key) {
      return m.get(key) ?? null;
    },
    async put(key, value) {
      m.set(key, value);
      if (m.size > max) m.delete(m.keys().next().value!);
    },
  };
}

/**
 * The live solver from the environment, or null (turn and river run out as before):
 * - TURN_SOLVER_LAMBDA (function name) or TURN_SOLVER_URL (e.g. http://127.0.0.1:7879/solve for `live --serve 7879`)
 * - TURN_CACHE_BUCKET: S3 bucket for the shared cache (prefix turn-cache/); otherwise an in-memory cache
 * - LIVE_SOLVES_PER_HOUR, LIVE_SOLVES_GLOBAL_PER_HOUR, LIVE_SOLVE_TIMEOUT_MS
 */
export async function liveSolverFromEnv(env: NodeJS.ProcessEnv = process.env): Promise<LiveSolver | null> {
  const region = env.AWS_REGION || env.AWS_DEFAULT_REGION || 'us-east-1';
  const transport = env.TURN_SOLVER_LAMBDA
    ? await lambdaTransport(env.TURN_SOLVER_LAMBDA, region)
    : env.TURN_SOLVER_URL
      ? httpTransport(env.TURN_SOLVER_URL)
      : null;
  if (!transport) return null;
  const cache = env.TURN_CACHE_BUCKET ? await s3Cache(env.TURN_CACHE_BUCKET, region) : memoryCache();
  return new LiveSolver(transport, cache, {
    timeoutMs: Number(env.LIVE_SOLVE_TIMEOUT_MS) || undefined,
    perPlayerPerHour: Number(env.LIVE_SOLVES_PER_HOUR) || undefined,
    globalPerHour: Number(env.LIVE_SOLVES_GLOBAL_PER_HOUR) || undefined,
  });
}
