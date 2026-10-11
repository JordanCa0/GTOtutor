# Mobile browser plan

**Status (2026-10-10): built, except the check on real phones (Phase 5).** It replaces the "Mobile layout" note in `docs/future-ideas.md`. The rules it set are now in `docs/frontend-design.md` sections 1, 6 and 8.

**Where the build differs from the plan below:**

- **The header menu applies below 1024px,** not just on phones. At 768px the header buttons wrapped onto two lines.
- **Table contents scale with `--table-scale`** instead of every px value being rewritten in `cq*` units. `Table.tsx` measures the table and sets the factor (0.55–1). Tooltips scale back up so they stay readable.
- **Touch targets:** table actions, the strip and the Deal button are at least 44px tall. Every other button is at least 24×24 (WCAG 2.2). Icon buttons stay 34px.
- **Playwright runs against the dev servers** (placeholder charts), not stubbed hands: `npm run test:e2e -w apps/web`. It starts `npm run dev` if nothing is running.
- **The strip's text hint** ("Chart and coach") shows on tablets only; phones get the chevron.
- **Still to do:** a pass on a real iPhone (Safari) and Android (Chrome), with the API running and `npm run dev -w apps/web -- --host` (open the LAN address it prints). Headless Chromium can't show the Safari toolbar, the keyboard over the coach input, or the notch.

## Goals

- **No sideways scrolling, ever,** on any screen from 320px wide up.
- **Playing a hand needs no vertical scrolling.** The table, your cards, the action buttons and the verdict all fit in one phone screen (390×664, an iPhone 12–15 in Safari with its bars showing). The smallest target is an iPhone SE in Safari (375×548).
- **Scrolling only where the content is long by nature:** a coach conversation, session review, the profile page. These scroll inside their own panel, never the page.
- **Same game, same rules.** Fixed action slots, the same colours and the same verdicts as desktop (`docs/frontend-design.md` sections 5 and 6). Only the arrangement changes.

## What's wrong today

Worked out from the CSS rather than measured on a device (Phase 0 adds the measuring).

| Problem | Cause | Where |
| --- | --- | --- |
| Seats and cards pile on top of each other | The table shrinks to about 358×224px, but seats (`min-width: 96px`), cards and the board keep their desktop pixel sizes. Each seat with cards is about 80px tall, and four seats share 224px. | `.seat`, `.seat-cards`, `.card`, `.board` in `styles.css`; `SLOTS` in `Table.tsx` |
| The table is short and wide on a tall screen | `aspect-ratio: 16 / 10` and `height: 62vw` waste a portrait screen's height | `.table-wrap`, `.table-area` |
| The bet sizes run off the screen | `.act` has `min-width: 150px`, so 33/66/100% in one `.act-group` needs 450px+. A group can't wrap. | `.act`, `.act-group` |
| Fold/Call/Raise wrap onto two rows | Three 150px buttons plus gaps need 474px | `.actions` |
| Everything stacks into one long page | Below 1024px the shell becomes one column with `height: auto`, so the verdict, chart and coach sit below the table and you scroll down after every decision, then back up | `.app`, `main`, `.right` at `max-width: 1023px` |
| Setup feels cramped | 48px side padding inside a card on a 390px screen | `.setup` |
| Pop-ups don't fit | The session review, reader and range modal are desktop-sized boxes. The enlarged range chart opens partly off-screen (found 2026-10-08). | `.modal`, `.reader`, `.range-modal` |
| iPhone quirks | Typing in the coach box zooms the page if its text is under 16px. Double-tap zooms. Safe areas (notch, home bar) are ignored. | global |

## The phone layout

### One screen, four rows

```
┌──────────────────────────┐
│ GTOtutor             ☰   │  header, 48px (done)
├──────────────────────────┤
│        ┌────────┐        │
│   ○    │  felt  │    ○   │  table: tall oval, takes
│        │        │        │  whatever height is left
│   ○    │ board  │    ○   │
│        │  pot   │        │
│        └────────┘        │
│        ○  YOU  ○         │
│        [A♠][K♦]          │
├──────────────────────────┤
│ ✓ Best: Raise  · Chart ▸ │  feedback strip, 64px, always there
├──────────────────────────┤
│ [ Fold ][ Call ][Raise ] │  action bar, 56px + home-bar inset
└──────────────────────────┘
```

- `.app` stays `height: 100dvh` with `overflow: hidden` on phones too. Undo the `height: auto` rule.
- Rows are `header / table / strip / actions`. The table row is `minmax(0, 1fr)`. The other rows are fixed, so **the table never changes size between decisions**: the same rule as desktop (section 6).
- The action bar sits at the bottom, where thumbs reach, with `padding-bottom: env(safe-area-inset-bottom)`.
- On a 390×664 screen the table gets about 460px of height on a 358px width. On an SE it gets about 345 × 343px. Phase 2 lays the table out for both shapes.

### The table: a tall oval

- **Two sets of seat anchors:** today's `SLOTS` for a wide table, and new `SLOTS_TALL` for a tall one:
  - hero at the bottom centre;
  - two seats down each side;
  - one at the top.
  - `betSpot`, the pot and the board follow the same centre.
- **Pick the set by the table's own shape, not the screen width.** A `useTableShape()` hook watches `.table-wrap` with a ResizeObserver and returns `'wide'` or `'tall'` (tall when height ÷ width > 1.1). Chip slides already work in `cqw`/`cqh`, so they follow the anchors without changes.
- **Size seats, cards and the board in `cqw`/`cqmin`** with a `clamp()` floor and ceiling. Today they're in px, which breaks the rule in `frontend-design.md` section 1 ("everything inside the poker table" is `%`/`cq*`). This fixes desktop drift at odd window sizes too.
- **Smaller seats on phones:**
  - Villains get one pill (position + stack) with small card backs tucked behind it.
  - Hero keeps big cards: they're the thing you're deciding on.
  - Action bubbles ("Raise 2.5") stay; the table already shows the action happening.
- **The felt** becomes `aspect-ratio: auto` with `border-radius: 999px` on the tall shape, so it fills its row as a long oval rather than a squashed one.
- **The action log moves into the feedback sheet** ("Hand" tab, below). On a phone the bubbles on the table and the board tell the story. The 2.6rem log row is height we need for the table.

### The action bar

- `display: grid; grid-template-columns: repeat(var(--slots), minmax(0, 1fr))`, with no `min-width` on phones. The three fixed slots keep their order and colours.
- **Bet sizes split the raise slot into segments:** 33% · 66% · 100%, with the bb amount dropped below 640px. Each segment is about 75px wide on a 390 screen, and the labels fit at `--fs-sm`. Same `.act-group`, same `optionColor()` bottom bars. The raise slot spans two columns when it holds sizes, so Fold and Call stay comfortable to tap.
- An all-in extra takes a fourth column, at most one, as section 6 already allows.
- Every target is at least 44px tall. The 3rem `.act` already is.
- Key badges are already hidden on touch screens.

### The feedback strip and sheet

The right-hand panel (hint, verdict, chart, coach) becomes a **bottom sheet** with a strip that peeks out above the action bar:

| Moment | The strip shows | Tapping it opens |
| --- | --- | --- |
| Your turn | "Need a hint?" (quiet) | The hint |
| Just decided | Verdict icon + "Best: Raise 2.5" or "Mistake: −1.2bb", the streak count, and a gold "Next decision" or "Deal next hand" when there is one | The verdict, open on the Verdict tab |
| Villains acting | The last verdict, dimmed | The same |
| Hand over | Result ("+4.5bb") and "Deal next hand" | The hand's decisions |

- **The strip has a fixed height.** Its contents fade in over 150ms (section 8: seen every decision, so no movement).
- **The sheet opens to about 88% of the screen,** over the table, with tabs: **Verdict · Chart · Coach · Hand**.
  - Verdict: `VerdictBanner`, then the decision stepper when there's more than one decision.
  - Chart: `RangeGrid` at full width, `calc(100vw - 32px)`. That retires the enlarged-chart modal on phones, and with it the off-screen bug.
  - Coach: `CoachCard`/`CoachThread`. Only this tab scrolls, with the input pinned at the bottom of the sheet.
  - Hand: the action log and board.
- **Closing:** drag down on the handle, tap the dimmed table, Escape, or the close button.
  - The drag dismisses past 25% of the height or on a quick flick (velocity > 0.11 px/ms), with pointer capture while dragging.
  - Dragging up past the top meets increasing resistance.
- **Motion:** open and close with a CSS `transform` transition, `cubic-bezier(0.32, 0.72, 0, 1)`, 300ms open and 200ms close. It's a transition, not keyframes, so a drag or a quick re-tap can reverse it mid-way. Reduced motion: a 150ms fade. Add the sheet to the section 8 table and the reduced-motion list.
- **Built in-house.** It's about 150 lines (`BottomSheet.tsx`) on top of `Presence`. No new dependency. The behaviour above is what Vaul does, if we'd rather not hand-roll the drag.
- **Coach typing:** the textarea gets `font-size: 16px` on phones, so iOS doesn't zoom. Add `interactive-widget=resizes-content` to the viewport meta, so the keyboard shrinks the sheet instead of covering the input.

### Which widths get this layout (decision needed)

- **Recommended:** below 1024px. That's where the current one-column layout starts, and that one-column layout is what causes the long scroll. A portrait iPad then gets the same one-screen layout with a bigger table.
- Phone-only sizing (smaller seats, bb amounts dropped, 16px gutters) stays at 640px and below.
- **Landscape phones** (about 844×390) are too short for four rows. Recommended: two columns, the table on the left and the strip, sheet and action bar on the right, using `@media (orientation: landscape) and (max-height: 500px)`. The cheaper alternative is a "Turn your phone upright" card. That's honest, but people do lie in bed with their phone sideways.

## The other screens

| Screen | Change on phones |
| --- | --- |
| Title | Already has a 480px rule. Check at 320px; the preview card can drop to verdict-only. |
| Setup (first screen and Configure modal) | Padding goes to `--sp-4`. As a modal it opens full-screen with the Deal button pinned at the bottom. |
| Session review | Full-screen sheet, header and close pinned. `.review-grid` moves its 760px breakpoint to 640px (section 6 breakpoints). |
| Coach reader (`.reader`) | Full-screen, same pattern. |
| Profile | Already full-screen. Check `StyleChart` (433 lines, fixed-width parts) and `.profile-stats` at 320px; move 700/860px breakpoints to 640/1024. |
| Auth and delete dialogs | Already `min(420px, 100%)`. Add the 16px gutter around them. |
| Tour | Steps that point at the right panel point at the strip instead (the `'.review-btn, .menu-btn'` pattern already allows two targets). On phones the card docks to the top or bottom edge rather than beside the target. |
| Position tooltips | Hover-only today. On touch, a tap on a seat pill toggles the tooltip and a tap elsewhere closes it. |

## Site-wide fixes

- Viewport meta: `width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content`.
- `-webkit-tap-highlight-color: transparent` on buttons (we have our own pressed states). `touch-action: manipulation` on the app, which stops double-tap zoom without blocking pinch-zoom.
- Safe areas: `env(safe-area-inset-*)` padding on the header, action bar and sheets.
- `overscroll-behavior: none` on `html` in the play screen, so a swipe at the top doesn't pull-to-refresh mid-hand.
- Every input at least 16px on phones.
- `html, body { overflow-x: clip }` as a last line of defence. **It doesn't replace fixing the cause:** the test below fails on any overflow first.

## Testing

- **Playwright, a new dev dependency (decision needed).** `apps/web/e2e/mobile.spec.ts` loads each screen at 320×568, 375×548, 390×664, 412×780 and 844×390. It checks:
  - `document.documentElement.scrollWidth <= innerWidth` on every screen;
  - `scrollHeight <= innerHeight` on the play screen, before and after a decision;
  - the table's box is the same size before and after a decision;
  - every button is at least 44×44 (24×24 for range-grid cells, the WCAG 2.2 minimum).
  
  The API can be stubbed with fixture hands, so the test doesn't need the solver.
- **Real phones:** `npm run dev -- --host` and open the LAN address on an iPhone (Safari) and an Android (Chrome). The Playwright viewports can't show the Safari toolbar, the keyboard or the notch.
- Add "Works at 320px, 390px and 844×390 landscape" to the checklist in `docs/frontend-design.md`, and section 6 gets a "Phones" subsection describing the four-row shell.

## Phases

Each phase ships on its own and leaves the app better than before.

1. **Phase 0: guard rails and quick wins** (half a day)
   - Viewport meta, tap highlight, `touch-action`, 16px inputs, setup padding.
   - The action bar as a grid with segmented sizes. That alone removes today's sideways scroll on the play screen.
   - Playwright set up with the overflow checks, expected to fail on the remaining screens.
2. **Phase 1: the one-screen shell** (1 day)
   - `100dvh` rows below 1024px, the feedback strip, the action bar pinned with safe areas.
   - The panel content temporarily opens in a plain full-screen view until Phase 3.
3. **Phase 2: the tall table** (1–2 days)
   - `SLOTS_TALL`, `useTableShape()`, seats, cards and board in `cq*` units, compact villain seats.
   - Check desktop is unchanged: screenshots before and after at 1280 and 1920.
4. **Phase 3: the feedback sheet** (2 days)
   - `BottomSheet.tsx`, the four tabs, the strip's states, drag to dismiss, the coach input above the keyboard.
   - The enlarged-chart modal is retired on phones.
5. **Phase 4: the other screens** (1–2 days)
   - Full-screen sheets for session review, reader and Configure. Profile and style chart at 320px. Tour docking, tap tooltips.
6. **Phase 5: landscape and real devices** (1 day)
   - The two-column landscape layout (or the "turn upright" card), a pass on a real iPhone and Android, design doc updates.

About 7–9 days in all.

## Decisions (2026-10-10)

1. **The one-screen layout applies below 1024px,** portrait tablets included. Phone-only sizing at 640px and below.
2. **Landscape phones get two columns:** the table on the left, the strip, sheet and action bar on the right.
3. **Playwright is a dev dependency** for the overflow tests.
4. **Villain cards on phones are small backs** behind the seat pill.
