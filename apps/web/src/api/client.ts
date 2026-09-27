import type {
  ActionType,
  ChartNodeView,
  ExplanationResponse,
  HandView,
  StartHandRequest,
  SubmitDecisionResponse,
} from '@gtotutor/shared-types';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  startHand: (req: StartHandRequest) => request<HandView>('/api/hands', { method: 'POST', body: JSON.stringify(req) }),
  decide: (handId: string, action: ActionType) =>
    request<SubmitDecisionResponse>(`/api/hands/${handId}/decisions`, { method: 'POST', body: JSON.stringify({ action }) }),
  explanation: (handId: string, decisionId: string) =>
    request<ExplanationResponse>(`/api/hands/${handId}/decisions/${decisionId}/explanation`),
  chart: (nodeKey: string) => request<ChartNodeView>(`/api/charts/${encodeURIComponent(nodeKey)}`),
};
