import type { HandState } from './handEngine.js';

/** Anonymous per-browser sessions → the hands played in them (most recent last). */
export class SessionStore {
  private readonly sessions = new Map<string, HandState[]>();

  constructor(
    private readonly maxSessions = 5000,
    private readonly maxHandsPerSession = 200,
  ) {}

  add(state: HandState): void {
    if (!state.sessionId) return;
    const hands = this.sessions.get(state.sessionId) ?? [];
    hands.push(state);
    if (hands.length > this.maxHandsPerSession) hands.shift();
    this.sessions.delete(state.sessionId);
    this.sessions.set(state.sessionId, hands);
    if (this.sessions.size > this.maxSessions) this.sessions.delete(this.sessions.keys().next().value!);
  }

  hands(sessionId: string): HandState[] {
    return this.sessions.get(sessionId) ?? [];
  }
}
