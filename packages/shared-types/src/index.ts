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
  /** The table's stack depth; with mixed stacks, the base everyone has unless `stacks` says otherwise. */
  stackDepthBb: StackDepth;
  /**
   * Deal a solved mixed-stack table on `stackDepthBb` (docs/stack-depths-plan.md): one shorter seat,
   * or several (one 20bb and two 60bb at 100bb). Only offered where the loaded charts have them.
   */
  mixedStacks?: MixedStacks;
}

/** Mixed-stack tables: one shorter seat, or several. */
export type MixedStacks = 'one' | 'several';

/** A hand's stacks as dealt: the chart profile ("100", "100:BB20") and each seat's starting stack in bb. */
export interface HandStacks {
  profile: string;
  stacks: Record<Position, number>;
}

/** GET /api/options: what the loaded charts can deal. */
export interface TableOptions {
  /** Equal-stack depths with solved (or placeholder) charts. */
  stackDepths: StackDepth[];
  /** Depths that also have solved mixed-stack tables, with one shorter seat or several. */
  mixedStacks: Record<MixedStacks, StackDepth[]>;
}

/** Opponent archetypes: player types the opponents can play as instead of the charts (docs/archetypes.md). */
export type Archetype = 'fish' | 'nit' | 'lag' | 'tag';
export const ARCHETYPES: Archetype[] = ['fish', 'nit', 'lag', 'tag'];
export const ARCHETYPE_NAMES: Record<Archetype, string> = { fish: 'Fish', nit: 'Nit', lag: 'Loose-aggressive', tag: 'Tight-aggressive' };
/** How the opponents play: the charts ('gto'), one archetype at every seat, or a random archetype per seat. */
export type VillainStyle = 'gto' | Archetype | 'mixed';

export interface StartHandRequest extends Omit<HandConfig, 'stackDepthBb'> {
  /** The table depth, or 'random' for a new one each hand among those the charts have (for the chosen mixed stacks, if any). */
  stackDepthBb: StackDepth | 'random';
  heroPosition: Position | 'random';
  /**
   * Play every hand against this seat: everyone else folds, so the pot is hero against it. When it
   * acts before hero, only deals where it opens or limps are kept. Needs a fixed hero position.
   */
  opponentPosition?: Position | 'any';
  /** How the opponents play preflop. Defaults to 'gto' (the charts). */
  villainStyle?: VillainStyle;
  /** The practice session (a sitting of hands) this hand belongs to; the API requires it. */
  sessionId?: string;
  /** Mostly skip hands whose first decision is an obvious fold. Defaults to true. */
  skipEasyFolds?: boolean;
  /**
   * Simple pots: opponents never limp or call ahead of hero, so every pot is one raiser against
   * one caller and hero can always call. Defaults to false (the full charts, where hero sometimes
   * can only fold or raise).
   */
  simplePots?: boolean;
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
  /**
   * Postflop actions of an opponent with a player type: JEV AI chose it, or the solver did (no
   * JEV_API_KEY, or Jev failed or took too long). Shown in the API response for checking, not in the UI.
   */
  decidedBy?: 'jev' | 'solver';
  /** How long the JEV AI request took (ms), when there was one. */
  jevMs?: number;
}

export interface SeatView {
  position: Position;
  isHero: boolean;
  stackBb: number;
  committedBb: number;
  folded: boolean;
  allIn: boolean;
  cards: string[] | null;
  /** The player type this opponent plays as; absent when it plays the charts. */
  archetype?: Archetype;
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
  /** "Close call": preflop, an option the chart rarely plays but within a few tenths of a bb of the best EV. Graded 'mixed'. */
  closeEv?: boolean;
  hintUsed: boolean;
  street: Street;
  /** Board cards when the decision was made (empty preflop). */
  board: string[];
  /** Set when the strategy comes from a similar solved flop rather than this exact one. */
  approxFlop: string | null;
  /** Preflop, facing a raise: who made it and from which chart node, so the coach can describe their range. */
  villainRange?: VillainRange;
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
  /**
   * Hero folded to a bet or raise: the cards of the player who made it, shown once the pot is
   * pushed so hero can judge the fold. handName is null before the flop. Missing on older hands.
   */
  foldReveal?: { position: Position; cards: string[]; handName: string | null } | null;
  /** What each winner takes from the pot (main and side pots). Missing on older hands: split `potBb` evenly. */
  won?: Partial<Record<Position, number>>;
  /** Chips handed back uncalled (a shove over a shorter all-in), beyond what the action log shows put in. */
  returned?: Partial<Record<Position, number>>;
}

export interface HandView {
  id: string;
  config: HandConfig & Partial<HandStacks>;
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
  /** Set while the hand waits for its live turn solve (or, after a server restart, the river's). */
  solving?: 'turn' | 'river' | null;
  /** Why the turn and river ran out instead of being played (the live solve failed or was too slow). */
  liveNote?: string | null;
  /** Commit of the solver service behind this hand's turn and river strategies, for the source link (AGPL). */
  solverCommit?: string | null;
  /** Why hero has no Call option in this spot (someone already called, or facing a limp), or null. */
  noCallReason?: NoCallReason | null;
}

/** The greyed Call button's tooltip: "3-bet or fold" and why. */
export interface NoCallReason {
  title: string;
  text: string;
}

export interface SubmitDecisionRequest {
  action: ActionType;
  /** Which size, when several options share `action` (e.g. flop bets of 33/66/100%). */
  toBb?: number;
}

/**
 * The session's run of good decisions after this one: a best play adds 1, a mixed one keeps it,
 * a mistake ends it. `milestone` is set when this decision reached 5, 10, 15, 20, 25, then every 25;
 * `ended` is the length of a streak this decision ended.
 */
export interface StreakUpdate {
  count: number;
  best: number;
  milestone: number | null;
  ended: number | null;
}

export interface SubmitDecisionResponse {
  feedback: DecisionFeedback;
  hand: HandView;
  streak: StreakUpdate;
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

export type SpotType = 'RFI' | 'LIMPED' | 'VS_OPEN' | 'VS_3BET' | 'VS_4BET_PLUS' | 'FLOP' | 'TURN_RIVER';
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
  /** Longest run of good decisions (see `StreakUpdate`). Missing on stats saved before 2026-10-10. */
  bestStreak?: number;
}

export const MIN_DECISIONS_FOR_REVIEW = 5;

export type SessionCoachReview =
  /** brief: a 3-4 line overview, shown first on the profile page. Missing on reviews written before 2026-10-10. */
  | { status: 'ok'; brief?: string; summary: string; leaks: { title: string; advice: string }[]; drill: string; ungroundedNumbers: string[] }
  | { status: 'unavailable'; reason: string }
  | { status: 'not_enough_data'; needed: number };

/** GET /api/sessions/:id/stats: the numbers alone, without waiting for the coach. */
export interface SessionStatsResponse {
  stats: SessionStats;
}

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
  /** The same numbers over the most recent tenth of hands, to show progress; null until that's enough decisions to say much. */
  recent: ProfileRecent | null;
}

/** Profile numbers over the most recent tenth of hands (see `ProfileResponse.recent`). */
export interface ProfileRecent {
  hands: number;
  stats: SessionStats;
  style: PlayerStyle;
  gto: GtoSummary;
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
