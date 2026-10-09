import type {
  ActionType,
  ChartNodeView,
  ChatMessage,
  ChatResponse,
  CoachThreadResponse,
  DecisionStar,
  MeResponse,
  ProfileResponse,
  ProfileReviewResponse,
  ExplanationResponse,
  HandView,
  HintResponse,
  SessionReviewResponse,
  StarredResponse,
  StarRequest,
  StartHandRequest,
  SubmitDecisionResponse,
} from '@gtotutor/shared-types';
import { accessToken } from '../auth/auth';
import { getGuestId } from '../auth/identity';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const token = accessToken();
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      // Who's asking: the signed-in account, else this browser's guest id.
      'X-Guest-Id': getGuestId(),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });

export const api = {
  startHand: (req: StartHandRequest) => request<HandView>('/api/hands', post(req)),
  decide: (handId: string, action: ActionType) => request<SubmitDecisionResponse>(`/api/hands/${handId}/decisions`, post({ action })),
  hint: (handId: string) => request<HintResponse>(`/api/hands/${handId}/hint`),
  explanation: (handId: string, decisionId: string) =>
    request<ExplanationResponse>(`/api/hands/${handId}/decisions/${decisionId}/explanation`),
  coachThread: (handId: string, decisionId: string) =>
    request<CoachThreadResponse>(`/api/hands/${handId}/decisions/${decisionId}/coach`),
  chat: (handId: string, decisionId: string, messages: ChatMessage[]) =>
    request<ChatResponse>(`/api/hands/${handId}/decisions/${decisionId}/chat`, post({ messages })),
  star: (handId: string, decisionId: string) => request<DecisionStar>(`/api/hands/${handId}/decisions/${decisionId}/star`),
  setStar: (handId: string, decisionId: string, star: StarRequest) =>
    request<DecisionStar>(`/api/hands/${handId}/decisions/${decisionId}/star`, { method: 'PUT', body: JSON.stringify(star) }),
  review: (sessionId: string) => request<SessionReviewResponse>(`/api/sessions/${sessionId}/review`),
  chart: (nodeKey: string) => request<ChartNodeView>(`/api/charts/${encodeURIComponent(nodeKey)}`),
  me: () => request<MeResponse>('/api/me'),
  profile: () => request<ProfileResponse>('/api/me/profile'),
  profileReview: () => request<ProfileReviewResponse>('/api/me/profile/review'),
  starred: (before: string | null) => request<StarredResponse>(`/api/me/starred${before ? `?before=${encodeURIComponent(before)}` : ''}`),
  deleteAccount: () => request<{ ok: true }>('/api/me', { method: 'DELETE' }),
};
