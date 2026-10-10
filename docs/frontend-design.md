# Frontend design rules

These are the rules for the web app's look (`apps/web`). They exist so new screens match the old ones without anyone having to eyeball it. The tokens live at the top of `apps/web/src/styles.css`; this doc says when to use which.

If something here and the code disagree, the code is usually older. Fix the code when you're already touching that rule, and don't start a sweep just for that.

## 1. Units: relative or fixed

The stylesheet mixes units on purpose. Each unit has one job:

| Unit | Use it for | Why |
| --- | --- | --- |
| `rem` | Font sizes, spacing (gap, padding, margin), button and control sizes | Scales with the browser's font-size setting, so someone who zooms text gets a bigger UI, not overlapping text |
| `px` | Borders (1px), hairline gaps (1–2px), radii, shadows, icon boxes, fixed layout columns (the 480/540px side panel) | These should look the same at any text size. A 1px line that becomes 1.25px looks blurry |
| `%`, `cqw`, `cqh` | Everything inside the poker table (seats, chips, cards, felt) | The table is a size container (`.table-area`, `.table-wrap`). Its contents scale with it, so the table looks the same at any window size |
| `dvh`, `vh`, `vw` | Only the outer shell (`.app` height, page margins) and the bounds of a `clamp()` | Using viewport units inside components ties them to the window rather than their container |
| `ch` | How wide a paragraph of text can get (`max-width: 46ch`) | Keeps lines readable |
| `em` | Only something that should follow its own text's size (an icon inside a line of text) | Anywhere else, `em` compounds unpredictably when nested |

Never use `px` for font sizes or spacing in new code.

**Where we are today:** fonts are almost all on the `--fs-*` scale (seven one-off sizes remain). Spacing is not on any scale yet: about 30 different `rem` values are in use (0.2, 0.3, 0.35, 0.45, 0.55, 0.6, 0.65, 0.7, 0.85, 0.9…). That's the main source of "slightly off" spacing. The spacing scale below fixes it going forward.

## 2. Spacing

Use the scale. It steps by 4px at the small end and grows wider at the large end:

| Token | Value | Typical use |
| --- | --- | --- |
| `--sp-1` | 0.25rem (4px) | Icon to its label, number to its unit |
| `--sp-2` | 0.5rem (8px) | Items in a tight group (pills, chips, a label above its control) |
| `--sp-3` | 0.75rem (12px) | Items in a normal group (buttons in a row, rows in a list); panel padding |
| `--sp-4` | 1rem (16px) | Between groups; card padding; the page gutter on phones |
| `--sp-5` | 1.5rem (24px) | Between sections in a panel or modal |
| `--sp-6` | 2rem (32px) | Large page padding (setup, title screen) |
| `--sp-7` | 3rem (48px) | Hero spacing only |

Rules:

- **Closer means related.** The space inside a group must be smaller than the space between groups. If two things are 12px apart, the next unrelated thing is at least 16px away.
- **Use gap, not margin, for siblings.** Lay out rows and stacks with `display: flex` or `grid` plus `gap`. Margins are for one-off offsets.
- **Use `px` for hairlines.** A 1–2px gap that draws a line between segments (as in `.act-group`) isn't spacing; leave it in px.
- **Moving old values:** round to the nearest token (0.45 → `--sp-2`, 0.6 → `--sp-2` or `--sp-3` depending on context, 0.85/0.9 → `--sp-4`). Check that the screen still reads right, because rounding can merge two levels that used to differ.

## 3. Type

- Sizes: `--fs-xs` 12px, `--fs-sm` 14px, `--fs-md` 16px, `--fs-lg` 20px, `--fs-xl` 24px, `--fs-2xl` 40px. Nothing else, except card faces and range-grid cell text, which are sized to their box.
- Body copy is `--fs-sm` or `--fs-md` with `line-height: 1.55`. Single-line controls use `line-height: 1.2`.
- Numbers that change or sit in columns (bb amounts, %, EV) get `font-variant-numeric: tabular-nums` so they don't jitter.
- Labels are quiet and in sentence case (`.label`, `.eyebrow`). No tracked uppercase.
- `--serif` is for the brand and big headings only. Everything else is `--sans`.

## 4. Shape and surface

- Radii: `--r-sm` 6px (small controls, keys, cells), `--r-md` 10px (buttons, cards, inputs), `--r-lg` 16px (panels, modals), `999px` for pills. When one rounded thing sits inside another, the inner radius is smaller.
- Surfaces are flat: one fill (`--panel` or `--raised`) and one 1px border (`--line`, or `--line-2` when it needs to stand out more). Only floating things (modals, popovers, menus) get `--shadow-float`.

## 5. Colour

- **Gold means you**: the logo, the main button, your seat, your hand, your pick in the verdict. Don't use it for decoration.
- **Action colours never change meaning**: fold grey, check/call blue, bet/raise/all-in green (`ACTION_COLORS` in `components/actionColors.ts`). They're the same on the buttons, the range charts, the verdict pills and the action log.
- **Sizes of one action** (flop bets of 33/66/100%) are shades of that colour from `optionColor()`, lightest for the smallest. Always get the colour from `optionColor()`; never write your own shade.
- **Text on a coloured fill** stays white. Light shades don't give white text enough contrast, so shaded sizes on buttons keep the slot's fill and show their shade as a bottom bar (`.act-size`). Pills and chart stripes, which have no text on the colour, use the shade directly.
- **Status colours**: `--good`, `--ok`, `--bad`, only for verdicts and results.
- White text on an action fill must reach 4.5:1: `--raise` #278358 is 4.7:1 and `--call` #3f72a7 is 5.0:1. The values are defined twice (the CSS variables in `styles.css` and `ACTION_COLORS` in `actionColors.ts`); change both together.

## 6. Layout

- **Shell:** `.app` fills the viewport (`100dvh`) with rows for the header, banner and main. `main` is pinned to the last row (`grid-row: 3`) because the banner is optional. Without the pin, `main` falls into the auto-height banner row and the table shrinks. `main` has two columns, the table side (`minmax(0, 1fr)`) and the side panel (480px, 540px from 1500px). It turns into one column below 1024px.
- **Breakpoints:** 640px (phone), 1024px (one column), 1500px (wide). Use only these in new code. The older one-off breakpoints (480, 700, 760, 860) should move to the nearest of these when touched.
- **Columns under 1024px:** give every fixed-width thing a way to shrink (`min-width: 0`, `minmax(0, 1fr)`, `flex-wrap`). Phones need a 16px side gutter and no sideways scrolling.
- **The table must not change size between decisions.** The left column is `table / controls / log`, and the table gets whatever height is left. Anything in the controls row has to stay one line on a 1280px-wide screen:
  - The action bar has at most the three slots (Fold, Call/Check, Raise/Bet) plus one extra (all-in).
  - Several sizes of one action go in the raise slot as one segmented group (`.act-group`), never as separate buttons.
  - An empty Fold slot is left out when you can check, since there is nothing to fold to.
- **Fixed slots:** a button stays in the same place on every decision, so players build muscle memory. Add new options inside a slot, not as new slots.

## 7. Components

- **Buttons:** `.primary` (gold, the main action on a screen, at most one), `.ghost`/`.secondary` (everything else), `.icon-btn` (34px square), `.act` (table actions, at least 150px wide and 3rem tall), `.link`.
- **Every button:**
  - shrinks to `scale(0.97)` when pressed;
  - only gets hover styles inside `@media (hover: hover) and (pointer: fine)`;
  - shows a visible `:focus-visible` outline.
- **Keyboard shortcuts:**
  - Table actions show their key in a `.key` badge (F, C, R; 1/2/3 for sizes; A for all-in; N for next hand).
  - Hide the badges on touch screens (`hover: none`).
  - Every action reachable by mouse has a key.

## 8. Motion

| Thing | How often it's seen | Motion |
| --- | --- | --- |
| Action buttons, keyboard actions | Every decision | 150ms fade at most; never movement |
| Hover and press | Constantly | 150–160ms, `ease` for colour, `--ease` for transform |
| Verdict, chart, coach card appearing | Every decision | 300–450ms `--ease`, fade and small rise |
| Modals, popovers | Occasionally | 200ms `--ease`; popovers grow from their trigger, modals from the centre |
| Cards dealt, chips sliding | Part of the game | Can be longer; the user can skip them |

- Use `--ease` (a strong ease-out) for things appearing. Never use `ease-in`.
- Animate only `transform` and `opacity` (and `translate`); never width, height or padding.
- Use transitions for anything that can be interrupted, and keyframes only for one-shot entrances.
- `prefers-reduced-motion`: the block at the end of `styles.css` turns movement into a 150ms fade. Add every new animated class to it.

## 9. Words

- Preflop copy says "chart", never "solver". Flop copy may say "solver".
- Bets read as a share of the pot ("Bet 33%"), with the chip amount in bb shown smaller.
- Use sentence case everywhere. Write button labels as verbs ("Deal next hand"), not nouns.

## Checklist for new UI

- [ ] Spacing uses `--sp-*`, fonts use `--fs-*`, radii use `--r-*`; no new raw `rem` or `px` values except hairlines.
- [ ] Units follow section 1.
- [ ] Works at 1280px, 1024px and 375px wide without sideways scrolling, and the table doesn't change size.
- [ ] Colours come from tokens or `optionColor()`; gold only for "you".
- [ ] Hover is gated, pressing scales, focus is visible, every action has a key.
- [ ] New animations are on the list in section 8 and have a reduced-motion fallback.
