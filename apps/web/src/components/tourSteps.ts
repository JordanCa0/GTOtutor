import type { TourStep } from './Tour';

/** Shown once the first hand is waiting on you. */
export const PLAY_STEPS: TourStep[] = [
  {
    target: '.seat.hero',
    side: 'top',
    title: 'This is you',
    body: 'Your seat and cards are outlined in gold. Every other seat is a bot playing from the same charts you get graded on.',
  },
  {
    target: '.spot-card',
    side: 'left',
    title: 'Read the spot',
    body: "What you're facing, the price to call, and the raiser's range. Stuck? Ask the coach for a hint. Using one is noted on your grade.",
  },
  {
    target: '.actions',
    side: 'top',
    title: 'Make your play',
    body: 'Click a button, or press F, C or R. You get graded the moment you act.',
  },
];

/** Shown after your first graded decision. */
export const VERDICT_STEPS: TourStep[] = [
  {
    target: '.verdict',
    side: 'left',
    title: 'Your grade',
    body: "Green is the chart's main play, yellow is a play it mixes in, and red is a mistake. The pills show how often the chart takes each action.",
  },
  {
    target: '.decision-panel .range',
    side: 'left',
    title: 'The whole range',
    body: 'Every hand in this spot, coloured by what the chart does with it. Yours is outlined. Click the grid to enlarge it.',
  },
  {
    target: '.coach-card',
    side: 'left',
    title: 'Ask why',
    body: "The coach explains the chart's play in a sentence or two, and answers follow-up questions.",
  },
  {
    target: '.review-btn',
    side: 'bottom',
    title: 'Find your leaks',
    body: 'After a few hands, Session review sums up where you lose the most. You can replay this tour from the ? button.',
  },
];
