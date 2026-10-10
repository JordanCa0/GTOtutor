export type TableSize = 'HU' | 'SIX_MAX' | 'NINE_MAX';
export type StackDepth = 20 | 40 | 60 | 100 | 150;
export type Position = 'UTG' | 'HJ' | 'CO' | 'BTN' | 'SB' | 'BB';
export type ActionType = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allin';
export type Street = 'preflop' | 'flop' | 'turn' | 'river';
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
  /** The practice session (a sitting of hands) this hand belongs to; the API requires it. */
  sessionId?: string;
  /** Mostly skip hands whose first decision is an obvious fold. Defaults to true. */
  skipEasyFolds?: boolean;
  /**
   * Testing aid: deal straight into a solved BTN-vs-BB single-raised pot and start at hero's flop
   * decision (hero is BTN or BB; preflop is played automatically and not graded).
   */
  flopPractice?: boolean;
}

export interface LegalAction {
  id: ActionType;
  label: string;
  toBb: number | null;
}

export interface ActionLogEntry {
  position: Position;
  action: ActionType;
  /** Total the player has put in this hand after the action. */
  toBb: number;
  isHero: boolean;
  street: Street;
  /** Postflop: the player's total bet on this street after the action (what "bets 1.8" refers to). */
  streetBb?: number;
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
  /** Bet/raise size (street total postflop, hand total preflop); tells apart several options of one type, e.g. three flop bets. */
  toBb?: number | null;
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
  /** Indexes into `options` of hero's choice and the most frequent option (decisions before 2026-10-09 lack them). */
  chosenIndex?: number;
  bestIndex?: number;
  grade: Grade;
  /** "Right idea, different size": betting or raising was right but at another size, for little EV. Graded 'mixed'. */
  sizeOnly?: boolean;
  hintUsed: boolean;
  street: Street;
  /** Board cards when the decision was made (empty preflop). */
  board: string[];
  /** Set when the strategy comes from a similar solved flop rather than this exact one. */
  approxFlop: string | null;
}

export interface PendingSpot {
  nodeKey: string;
  nodeLabel: string;
  handClass: string;
  street: Street;
  /** Preflop, facing a raise: the chart node the last raiser played from and the action they took, so the UI can show their range. */
  villainRange: VillainRange | null;
}

export interface VillainRange {
  position: Position;
  nodeKey: string;
  actionId: ActionType;
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
  /** Board cards dealt so far while the hand is in play (the full board is in `result`). */
  board: string[];
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
  /** Which size, when several options share `action` (e.g. flop bets of 33/66/100%). */
  toBb?: number;
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
  /** Coach replies: the one-sentence answer shown bold above `content`. */
  tldr?: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
}

export const CHAT_LIMITS = { maxUserTurns: 10, maxUserChars: 500 } as const;

export type ChatResponse =
  | {
      status: 'ok';
      /** One-sentence direct answer, shown bold above the reply; null for the fixed off-topic redirect. */
      tldr: string | null;
      reply: string;
      ungroundedNumbers: string[];
    }
  | { status: 'unavailable'; reason: string };

/** A decision the player starred to come back to, with an optional note. */
export interface DecisionStar {
  starred: boolean;
  note: string | null;
}

/** PUT …/decisions/:id/star. Unstarring clears the note. */
export interface StarRequest {
  starred: boolean;
  note?: string | null;
}

export const STAR_NOTE_MAX_CHARS = 500;

/** GET …/decisions/:id/coach: the saved coach thread for a decision, so it survives a reload. */
export interface CoachThreadResponse {
  explanation: Extract<ExplanationResponse, { status: 'ok' }> | null;
  messages: ChatMessage[];
}

export type HintResponse = { status: 'ok'; hint: string; cached: boolean } | { status: 'unavailable'; reason: string };

/** GET /api/me: the signed-in account, or null for a guest. */
export interface MeResponse {
  user: { id: string; email: string | null; name: string | null } | null;
}

export type SpotType = 'RFI' | 'LIMPED' | 'VS_OPEN' | 'VS_3BET' | 'VS_4BET_PLUS' | 'FLOP';
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

/** Hero's option in a decision. Decisions saved before 2026-10-09 lack `chosenIndex`; each type appeared once then. */
export function chosenOption(d: Pick<DecisionFeedback, 'options' | 'chosenAction' | 'chosenIndex'>): ActionOption {
  return d.options[d.chosenIndex ?? d.options.findIndex((o) => o.actionId === d.chosenAction)];
}

/** The most frequent option in a decision (see `chosenOption`). */
export function bestOption(d: Pick<DecisionFeedback, 'options' | 'bestAction' | 'bestIndex'>): ActionOption {
  return d.options[d.bestIndex ?? d.options.findIndex((o) => o.actionId === d.bestAction)];
}

/**
 * One axis of the style chart: how far the player's choices lean from the charts', in percentage
 * points (0 = plays like the charts), over `n` decisions, with its standard error.
 */
export interface StyleAxis {
  value: number;
  n: number;
  se: number;
  /** How often the player continued (x) or bet/raised (y) in these decisions, in percent. */
  you: number;
  /** How often the charts do the same in the same spots, in percent. `value` is `you − chart`. */
  chart: number;
}

/**
 * One direction of a loose/tight leak, weighted by the charts' own mixes (no cutoff for "a chart fold").
 * `rate` is in percent; `weight` is how many hands' worth of chart weight it's measured over.
 */
export interface StyleLeakRate {
  rate: number;
  weight: number;
}

export interface StyleLeakRates {
  /** Of the hands the charts fold, the share the player played anyway. */
  playedChartFolds: StyleLeakRate;
  /** Of the hands the charts play, the share the player folded. */
  foldedChartPlays: StyleLeakRate;
}

/** A point on the style chart. x: tight (−) to loose (+). y: passive (−) to aggressive (+). */
export interface StylePoint {
  x: StyleAxis;
  y: StyleAxis;
}

export interface PlayerStyle {
  overall: StylePoint;
  bySpot: (StylePoint & { spot: SpotType; label: string })[];
  /** All decisions together, split into the two directions the x axis nets out. */
  leaks: StyleLeakRates;
}

/** How close to the charts and solver: share of decisions graded best or mixed, and EV given up. */
export interface GtoSummary {
  accuracy: number;
  /** Average bb lost per decision against the best-EV action; null when no decision has EVs. */
  evLossBb: number | null;
  /** How many decisions had EVs to measure. */
  evDecisions: number;
}

/** GET /api/me/profile: all-time numbers for the signed-in player (most recent decisions). */
export interface ProfileResponse {
  stats: SessionStats;
  style: PlayerStyle;
  gto: GtoSummary;
  starredCount: number;
}

/** GET /api/me/profile/review: the coach's write-up of all-time play (saved, refreshed every so often). */
export interface ProfileReviewResponse {
  coach: SessionCoachReview;
}

export interface StarredDecision {
  handId: string;
  decision: DecisionFeedback;
  note: string | null;
  starredAt: string;
}

/** GET /api/me/starred: newest first. Pass `nextBefore` back as `before` for the next page. */
export interface StarredResponse {
  items: StarredDecision[];
  nextBefore: string | null;
}
