export type TableSize = 'HU' | 'SIX_MAX' | 'NINE_MAX';
export type StackDepth = 20 | 40 | 60 | 100 | 150;
export type Position = 'UTG' | 'HJ' | 'CO' | 'BTN' | 'SB' | 'BB';
export type ActionType = 'fold' | 'check' | 'call' | 'raise' | 'allin';
export type Grade = 'best' | 'mixed' | 'mistake';

export const TABLE_SIZES: { id: TableSize; label: string; available: boolean }[] = [
  { id: 'HU', label: 'Heads-up', available: false },
  { id: 'SIX_MAX', label: '6-max', available: true },
  { id: 'NINE_MAX', label: '9-max', available: false },
];

export const STACK_DEPTHS: { id: StackDepth; available: boolean }[] = [
  { id: 20, available: false },
  { id: 40, available: false },
  { id: 60, available: false },
  { id: 100, available: true },
  { id: 150, available: false },
];

export const SIX_MAX_POSITIONS: Position[] = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'];

export interface DataSource {
  kind: 'fixture' | 'solver';
  note: string;
}

export interface HandConfig {
  tableSize: TableSize;
  stackDepthBb: StackDepth;
}

export interface StartHandRequest extends HandConfig {
  heroPosition: Position | 'random';
  /** Anonymous per-browser session, used for the session review. */
  sessionId?: string;
  /** Mostly skip hands whose first decision is an obvious fold. Defaults to true. */
  skipEasyFolds?: boolean;
}

export interface LegalAction {
  id: ActionType;
  label: string;
  toBb: number | null;
}

export interface ActionLogEntry {
  position: Position;
  action: ActionType;
  toBb: number;
  isHero: boolean;
}

export interface SeatView {
  position: Position;
  isHero: boolean;
  stackBb: number;
  committedBb: number;
  folded: boolean;
  allIn: boolean;
  cards: string[] | null;
}

export interface ActionOption {
  actionId: ActionType;
  label: string;
  frequency: number;
  evBb: number | null;
}

export interface DecisionFeedback {
  id: string;
  nodeKey: string;
  nodeLabel: string;
  heroCards: string[];
  handClass: string;
  chosenAction: ActionType;
  options: ActionOption[];
  chosenFrequency: number;
  bestAction: ActionType;
  grade: Grade;
  hintUsed: boolean;
}

export interface PendingSpot {
  nodeKey: string;
  nodeLabel: string;
  handClass: string;
}

export interface ShowdownEntry {
  position: Position;
  cards: string[];
  handName: string;
  isWinner: boolean;
}

export interface HandResult {
  board: string[];
  showdown: ShowdownEntry[] | null;
  winners: Position[];
  potBb: number;
  heroNetBb: number;
  summary: string;
}

export interface HandView {
  id: string;
  config: HandConfig;
  heroPosition: Position;
  heroCards: string[];
  seats: SeatView[];
  potBb: number;
  actionLog: ActionLogEntry[];
  legalActions: LegalAction[];
  pendingSpot: PendingSpot | null;
  status: 'awaiting_hero' | 'complete';
  decisions: DecisionFeedback[];
  result: HandResult | null;
  dataSource: DataSource;
}

export interface SubmitDecisionRequest {
  action: ActionType;
}

export interface SubmitDecisionResponse {
  feedback: DecisionFeedback;
  hand: HandView;
}

export interface ChartNodeView {
  nodeKey: string;
  label: string;
  actions: LegalAction[];
  /** handClass -> frequencies aligned with `actions` */
  strategy: Record<string, number[]>;
  dataSource: DataSource;
}

export type ExplanationResponse =
  | {
      status: 'ok';
      /** At most ~15 words: the verdict plus the one deciding reason. */
      tldr: string;
      /** 2-3 short, distinct reasons. */
      points: string[];
      cached: boolean;
      ungroundedNumbers: string[];
    }
  | { status: 'unavailable'; reason: string };

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
}

export const CHAT_LIMITS = { maxUserTurns: 10, maxUserChars: 500 } as const;

export type ChatResponse =
  | { status: 'ok'; reply: string; ungroundedNumbers: string[] }
  | { status: 'unavailable'; reason: string };

export type HintResponse = { status: 'ok'; hint: string; cached: boolean } | { status: 'unavailable'; reason: string };

export type SpotType = 'RFI' | 'LIMPED' | 'VS_OPEN' | 'VS_3BET' | 'VS_4BET_PLUS';
export type LeakType = 'over_fold' | 'over_call' | 'over_raise' | 'under_raise';

export interface SessionMistake {
  nodeLabel: string;
  heroCards: string[];
  handClass: string;
  chosenLabel: string;
  chosenFrequency: number;
  bestLabel: string;
  bestFrequency: number;
}

export interface SessionStats {
  hands: number;
  decisions: number;
  grades: Record<Grade, number>;
  hintsUsed: number;
  bySpot: { spot: SpotType; label: string; decisions: number; best: number; mistakes: number }[];
  leaks: { type: LeakType; label: string; count: number }[];
  worstMistakes: SessionMistake[];
  easyFoldsSkipped: boolean;
}

export const MIN_DECISIONS_FOR_REVIEW = 5;

export type SessionCoachReview =
  | { status: 'ok'; summary: string; leaks: { title: string; advice: string }[]; drill: string; ungroundedNumbers: string[] }
  | { status: 'unavailable'; reason: string }
  | { status: 'not_enough_data'; needed: number };

export interface SessionReviewResponse {
  stats: SessionStats;
  coach: SessionCoachReview;
}
