---
type: feature
upstream: []
intent_accepted: true
design_approved: true
---

# Section width follows its field-column count, and sections sit side by side

## Intent

Every section in the layout builder renders at the same width no matter how many field columns it holds,
so a one-column section occupies as much horizontal room as a six-column one and sections have no choice
but to stack vertically. A section's width should instead follow the number of field columns it holds, so
narrow sections take narrow space and several sections can sit side by side in one row.

A column's width is not a fixed length. It **grows with the space available**, between a floor and a
ceiling, so a layout on a large monitor shows wider items carrying more of a long tab name than the same
layout on a laptop. Where the space runs out — including when the user zooms in — columns stop shrinking
at the floor and the layout gains a horizontal scroll bar rather than clipping, shrinking further, or
reflowing.

Items stay on one line. A label too long for its column is truncated with an ellipsis, never wrapped.

## Outcomes

- O1 — A section's rendered width is a function of the number of field columns it holds, replacing the
  unbound full-width stretch that currently applies to every section alike.
- O10 — A field column's width is derived from the horizontal space available rather than declared as a
  fixed length, bounded by a floor and a ceiling, and is **uniform across the whole layout**: a section
  holding N field columns is always the same width as any other section holding N, whichever row each
  one sits in.
- O3 — Sections render side by side in a row when the row's column budget admits them, rather than
  always stacking vertically.
- O4 — When the sections in a row exceed the horizontal space available — including when the shortfall
  is caused by the user zooming in — a horizontal scroll bar appears and scrolls the layout, and the
  sections are not clipped, shrunk below the floor width of O10, or reflowed.
- O7 — The number of sections permitted side by side in one row is governed by a single declared limit
  on the **total field columns a row may hold**, and the layout never places sections in a row whose
  column counts exceed it. Because every section holds at least one column, this also caps the number of
  sections in a row.
- O8 — On the `Small` form factor the derived widths do not apply: each section occupies one row at the
  full width of the viewport with equal fractional columns, which is the behaviour that ships today.
- O11 — An item label too long for its column is truncated with an ellipsis rather than overflowing its
  pill or wrapping, and the full label remains available to a pointer, a screen reader and find-in-page.

## Out of scope

- **Section height and vertical sizing.** Nothing here changes how tall a section is or how it grows.
  Items stay on one line, so nothing in this spec makes a section taller.
- **What a field column contains, and how fields are arranged inside one.** The unit this spec reasons
  about is the column count, not the column's contents.
- **A search or filter over items.** Raised at Design as the eventual answer to a label truncated by O11
  being hard to find; it is a separate spec.
- **Improving mobile column density.** O8 preserves today's `Small` behaviour exactly, including that a
  six-column section on a phone is unusable. Making it better is a different spec.

## Current state

- O1 — **There is no fixed maximum width to replace.** `grep -rn "max-width\|maxWidth"` across
  `force-app` returns nothing. The uniformity is structural: `.rstk-nav-section` carries no width rule
  at all (`navigatorSection.css:3-11`) and sits as a block-level flex item inside `.rstk-nav-sections`,
  which is `display: flex; flex-direction: column` with no `align-items` override
  (`salesforceNavigator.css:11-16`) — so every card defaults to `stretch` and takes 100% of the
  container whether it holds one column or six. `columns` drives only the _inner_ grid
  `.rstk-nav-section__grid` (`navigatorSection.css:129-157`), dividing the card's already-full-width
  interior into `repeat(N, minmax(0, 1fr))`; it never touches the card's own footprint.
- O10 — The keying concept already exists and is already clamped. Each section carries an integer
  `columns`, clamped by `clampColumns()` (`navigatorLayoutModel.js:720-725`) against `MIN_COLUMNS = 1`,
  `MAX_COLUMNS = 6`, `DEFAULT_COLUMNS = 3` (lines 32-34), and independently re-clamped server-side in
  `NavigatorLayoutController.columnsOf()` (`:36-38`, `:689-692`) — **two hand-synchronised copies of
  the constant**, the Apex comment stating it matches `clampColumns` key for key. Storage is a JSON
  integer per section inside `Layout_JSON__c`. `columnChoices` (`navigatorSection.js:251-263`) generates
  the section menu from those constants. **Nothing anywhere expresses a width**, and no column has a px
  or rem size — every track is `minmax(0, 1fr)`, an equal share of whatever the card happens to be.
- O3 — Nothing chose stacking; there is no alternative. `.rstk-nav-sections` is `flex-direction: column`
  and `salesforceNavigator.html:156` renders one `<c-navigator-section>` per iteration of a flat
  `for:each={sections}`. **There is no row concept in the data model** — a layout is `{ sections: [...] }`
  with no row or position-in-row field anywhere. `slds-grid` appears nowhere in the repo.
- O4 — No scroll container, no overflow handling, and nothing responsive exists. The only `overflow` is
  `overflow: hidden` with `text-overflow: ellipsis` on the section **title** (`navigatorSection.css:63,65`).
  No media query, no `ResizeObserver`, no container query, no `slds-size_*` class, and nothing that
  shrinks or reflows at narrow widths. The element a scroll container goes on has an ancestor this repo
  does not style: `lightning-card` wraps everything (`salesforceNavigator.html:2`).
- O7 — No per-row limit of any kind exists. `MAX_COLUMNS` caps columns _inside_ one section; there is no
  sibling constant capping a row, because sections do not share rows today.
- O8 — Today's behaviour _is_ O8's target state, which is what makes the `Small` branch a stand-down
  rather than a build: one full-width card per row with `repeat(N, minmax(0, 1fr))` tracks.
- O11 — **There is no ellipsis on an item anywhere.** `.rstk-nav-item__label` carries only `font-size`,
  `font-weight` and `color` (`navigatorItem.css:63-67`), and `.rstk-nav-item` itself declares no
  `overflow` and no `text-overflow` (`:29-43`). It has never needed one, because the card is full width
  and the tracks are fractional, so a label has always had room. `min-width: 0` is present on
  `.rstk-nav-item__row .rstk-nav-item` (`:9-12`) — the half of the truncation idiom that stops a flex
  item refusing to shrink — but the ellipsis half was never added. No item carries a `title` either.

**The item's own chrome is the dominant cost per column, and it was missed until Slice read the code.**
An item is a `.rstk-nav-item__row` (`display: flex`, `gap: 0.25rem`) holding the anchor and an
`lightning-button-menu` that is `flex: 0 0 auto`. The anchor carries `padding: 0.75rem 1rem` and a `1px`
border. So per column: **28px menu + 4px row gap + 32px anchor padding + 2px border = 66px** consumed
before a character is drawn, and the label renders at `--slds-g-font-scale-1`, **14px**. A 192px column
leaves the label 126px, not 180px.

**The layout spacing, all of it checked-in SLDS tokens.** `node_modules/@salesforce-ux/` gives
`--slds-g-spacing-2: 0.5rem`, `-3: 0.75rem`, `-4: 1rem`, so the CSS fallbacks match the resolved values
and the arithmetic needed no live org. Section padding `1rem` all sides (`navigatorSection.css:4`); gap
between sections `1rem` (`salesforceNavigator.css:14`); canvas padding `1rem` all sides
(`salesforceNavigator.css:15`); gap between field columns inside a section `0.5rem`
(`navigatorSection.css:131`). Sections carry no border under SLDS 2 — chrome is padding plus a
`box-shadow`, which adds nothing to layout width.

**Two facts from the merged predecessor that constrain the mechanism**
(`dev-path/personal-navigator-layouts`, merged as PR #1):

- **The SLDS linter validates `width`; `grid-template-columns` is not on its validated-property list.**
  That is why the predecessor put column counts in classes rather than inline styles. It is also why
  this design expresses sizing entirely through grid properties — see `## Design`.
- **Rendered width is not assertable in jest.** jsdom applies no stylesheet and
  `getBoundingClientRect()` returns zeros. The repo's existing answer is to read the shipped stylesheet
  as text and pin it — `navigatorSection.test.js:208-229` regexes `.cols-1`…`.cols-6` and asserts
  `repeat(N, minmax(0, 1fr))` verbatim.

**Where the horizontal budget comes from is not in this repo.** No Flexipage or app metadata references
`salesforceNavigator`, so the width available is org- and placement-dependent — tab page, App page
region, or Home page column. `lightning-card`'s own padding is platform CSS absent from this repo. Both
are measurable only in a live org, and O4's scroll bar is what keeps them from blocking the design.

**The in-flight neighbour does not collide.** `navigator-test-system-mode` carries an approved design and
is unmerged. Its diff is `NavigatorLayoutControllerTest.cls`, two `.claude/rules/` files,
`.prettierignore` and a research doc — no LWC and no CSS. Its intent is an Apex access-mode fix,
unrelated to sizing, and nothing here builds on it.

## Design

Decided in conversation with the engineer on 2026-08-28, across four rounds of sixteen questions. Two
sizing models were designed, measured and rejected before this one; the rejections are recorded below
because each was rejected for a reason that still binds.

### The mechanism, entire

The canvas becomes a grid of exactly six tracks. A section spans as many tracks as it has field columns.

```css
.rstk-nav-sections {
  display: grid;
  grid-template-columns: repeat(
    6,
    minmax(var(--rstk-nav-col-min, 10rem), var(--rstk-nav-col-max, 26rem))
  );
  grid-auto-flow: row;
  justify-content: start;
  gap: var(--slds-g-spacing-4, 1rem);
  padding: var(--slds-g-spacing-4, 1rem);
  overflow-x: auto;
}
.rstk-nav-section_span-1 {
  grid-column: span 1;
} /* … through span-6 */
```

That is the whole of it, and it settles five things at once:

- **O10's uniformity is free.** Every row draws from the same six tracks, so a 3-column section is the
  same width in every row it could sit in. Per-row sizing — deriving each row's column width from its
  own chrome — was rejected precisely here: it makes the same section 216px wide in one row and 223px in
  another, which breaks O10's own property.
- **The floor and the ceiling are the `minmax()`.** No JavaScript, no `ResizeObserver`, no media query.
- **O7's budget is structural.** A row cannot exceed six columns because the grid has six tracks. The
  "single declared limit" is the track count.
- **O4's scroll is what happens at the floor.** Six tracks at 10rem plus five 1rem gaps plus 1rem of
  canvas padding either side is **1,072px**; below that the grid overflows its container and
  `overflow-x: auto` scrolls. Zooming in narrows the viewport in CSS pixels until the floor binds, which
  is exactly the behaviour the requirement asked for.
- **The linter trap disappears.** The rejected fixed-width design needed `width: calc(...)` on the card,
  and `width` is a property the SLDS linter validates. Sizing through `grid-template-columns` and
  `grid-column` side-steps it, on the predecessor's own finding that grid properties are not on the
  validated list.

### What a monitor buys, measured

| Viewport     | One 6-column section                       | Six 1-column sections          |
| ------------ | ------------------------------------------ | ------------------------------ |
| Tablet 1024  | 160px track · 12 of 40 chars · **scrolls** | 160px · 12 of 40 · **scrolls** |
| Laptop 1280  | 196px · 17 of 40                           | 163px · 12 of 40               |
| Desktop 1440 | 223px · 21 of 40                           | 189px · 16 of 40               |
| Wide 1680    | 263px · 27 of 40                           | 229px · 22 of 40               |
| Ultra 2560   | 409px · **40 of 40**                       | 376px · **40 of 40**           |

Characters are of `Receivable Transaction Scheduled Payment`, the longest tab name in the org, measured
against the real 14px font with the real 66px of item chrome subtracted.

### The floor and the ceiling

```
--rstk-nav-col-min: 10rem   /* 160px */
--rstk-nav-col-max: 26rem   /* 416px */
```

**The floor is what produces the scroll bar**, and it is set so a column at its narrowest still shows
about twelve characters. **The ceiling has two jobs**: it is measured as the width at which the longest
name in the org fits whole, and it stops a lone one-column section becoming a 1,376px-wide nav link on a
1440px monitor — which is what an unbounded track does when only one section shares the row.

### Packing is the browser's, not ours

`grid-auto-flow: row` with `grid-column: span N` **is** the greedy packing algorithm: sections are placed
in order and a section that does not fit the remaining tracks moves to the next row. Implementing that in
JavaScript and then rendering it would duplicate the browser.

**Four consequences, all deliberate:**

- **A row can end under-full.** Sections `[4, 3, 3]` place as `[4]` then `[3, 3]`: two tracks go unused
  because the next section needs three.
- **A new row never starts while the next section would still fit.** This is what removes voluntary
  stacking — two one-column sections will always pair up, with no way to ask for them stacked. A stored
  `newRow` flag was designed and **declined by the engineer**, who accepted the loss rather than pay a
  `Schema_Version__c` bump. Absence means false, so it stays addable later.
- **A 6-column section always sits alone**, having spent every track.
- **Reordering a section, or changing its column count, re-packs the rows.**

**Nothing re-groups on zoom, and that is a property rather than a hope.** The track count is fixed at six
and a section's span comes from its stored column count, so row membership is viewport-independent by
construction. Tracks shrink to the floor and then the container scrolls. This is why `flex-wrap` was
never an option: it re-groups at the container width, which is the reflow O4 forbids.

### Form factor, not viewport width

```js
import FORM_FACTOR from "@salesforce/client/formFactor";
```

- **`Medium` and `Large`** — six tracks, sections spanning, scroll at the floor.
- **`Small`** — the canvas collapses to a single track, `grid-template-columns: minmax(0, 1fr)`, and every
  section spans it. Tracks then have no floor to overflow, so a phone never scrolls horizontally. This is
  exactly today's behaviour.

**Why not a media query.** A width-keyed breakpoint cannot distinguish a phone from a zoomed-in desktop —
`@media (max-width: 48em)` fires on both — and the zoom case is the one the requirement names explicitly
as wanting a scroll bar. Form factor is a device class, it does not change when the user zooms, and it is
a plain JS value a test can assert. **No media query ships anywhere in this spec.**

**Stated plainly:** a six-column section on a 390px phone gives six ~50px tracks. That is unusable, and
it is unusable identically today. This spec commits to not making mobile worse.

### Item truncation

`.rstk-nav-item` gains `overflow: hidden`, `.rstk-nav-item__label` gains
`white-space: nowrap; overflow: hidden; text-overflow: ellipsis`, and the anchor gains a `title`. The
`min-width: 0` the idiom also needs is **already present** on `.rstk-nav-item__row .rstk-nav-item`.

**This is new work, not a tidy-up.** Nothing in the component truncates an item today, because nothing
has ever bounded a column. Without it a long label overflows its pill.

**Wrapped labels were designed, built into the sketch, measured, and rejected by the engineer** — see
`## Evidence`. The measurements that argued for them are in git; the reason they lost is that a wrapped
pill reads as awkward spacing and collides with the pill's own border.

### The consequence I could not remove

A section's padding sits _inside_ the tracks it spans, so a one-column section pays 32px of padding
across one track while a six-column section spreads the same 32px across six. At 1440px that makes the
item pills in a one-column section about **189px** and those in a six-column section about **222px**. The
_sections_ align across rows, as O10 requires; the _pills inside them_ do not quite.

CSS `subgrid` would align them exactly, but only if the section drops its horizontal padding, which is a
visible change to shipped styling. **Look at it in a real org before trading the padding for it.**

### Test entry points

**`c-navigator-section`'s span class.** The component exposes a `span-N` class derived from its clamped
column count, driven through the real column menu exactly as the existing `cols-N` test drives it. That
is the one callable, refactor-surviving seam this design has.

Four facts live only in CSS and go through the repo's existing stylesheet-text pattern — the six-track
template, the floor and ceiling, `overflow-x: auto`, and the `Small` single-track override — because
jsdom applies no stylesheet and `getBoundingClientRect()` returns zeros.

**And the honest limit, stated because the alternative is a test that cannot fail: row packing itself is
verified in a real org, not in jest.** The browser does the placing, so a jest assertion could only
re-state the algorithm rather than observe it. A `packRows` written purely to be tested was offered and
declined: it would not drive the rendering, and could silently diverge from what the grid actually does.

### The altitude stop, raised and dissolved

The predecessor named a second spec — an admin-authored org-wide default layout — inheriting the
`Layout_JSON__c` contract. A `newRow` flag would have made that spec inherit it too. Declining the flag
dissolves it: nothing is stored, the contract is unchanged, `Schema_Version__c` stays at 1.

### The UX detour

`devpath/variable-width-sections/sketches/section-widths.html` computes every width from the real
formula, the real SLDS tokens and the real item chrome, and measures character fitting against the real
font rather than estimating it. It earned its keep three times: it caught an estimate of mine that was
seven characters optimistic, then caught the item chrome being 66px rather than 12px, and then made the
proportional model checkable before any code existed.

**Deliberately not a Lightning facsimile.** Density and native feel are answerable only in the real
runtime; a facsimile collects feedback on its own inaccuracies. Density confirmation is a live-org check
at Build.

### Rejected sizing models, and why each still binds

1. **Fixed widths from a declared per-column unit.** Six widths generated from `--rstk-nav-col-width`.
   Rejected because a fixed unit gives the same 16 of 40 characters at every viewport — a larger monitor
   buys the user nothing. It also required `width: calc(...)`, the one property the SLDS linter checks.
2. **Two-line wrapped labels.** Rejected by the engineer on appearance. It was also already in trouble on
   measurement: with the real item chrome the longest name needs **four** lines at every unit from 9rem
   to 12rem, so the two-line clamp the design had settled on would have hidden two of its four words.
   Cutting the anchor's padding to 0.5rem bought exactly one line and still did not reach two.

### Known unverified

- **`lightning-card`'s own padding is unmeasured** — platform CSS, absent from this repo. Every viewport
  figure above excludes it, so real available width is slightly less than stated and the 1,072px scroll
  threshold is slightly higher in practice.
- **Where the component is placed at runtime is org-dependent.** O4's scroll bar is what makes this
  non-blocking.
- **Whether the pill mismatch reads as wrong**, and so whether `subgrid` is worth its cost, needs eyes on
  a real org.
- **Whether a `title` on the anchor duplicates its `aria-label` audibly.** The anchor already carries
  `aria-label={label}`; adding `title` may cause some screen readers to announce the name twice. See
  `## Traps`.

### Retired Outcome IDs

**O5, O6 and O9 are retired.** O5 was a section count and O7 is a column budget — different statements.
O6 declared a fixed set of six widths and O10 derives width from available space — different statements.
O9 required wrapped labels and O11 requires the opposite. **O1, O3, O4, O7 and O8 keep their IDs**: O1's
premise was corrected in mechanism without changing what it asserts, O3's condition was made precise,
O4's rule is unchanged with its referent updated from O6 to O10's floor, and O7 and O8 are as approved.
No ID is reused; O2 was retired at Initiate.

## Traps

- **`overflow-x: auto` forces `overflow-y` to `auto`.** `overflow-x: auto; overflow-y: visible` is not a
  valid combination — the computed value becomes `auto`. The section cards' `box-shadow` will clip
  vertically inside the scroll container unless the container carries padding, which it does.
- **`justify-content: start` is load-bearing.** Without it, tracks that have hit the 26rem ceiling leave
  free space the grid distributes rather than leaving at the end, and the layout drifts away from the
  left edge on a wide monitor.
- **`title` plus `aria-label` on the same anchor may double-announce.** The anchor already carries
  `aria-label={label}`. Verify against a screen reader before assuming `title` is free; the fallback is
  `title` on the label `<span>` rather than the anchor.
- **`MAX_COLUMNS` exists twice**, `navigatorLayoutModel.js:32-34` and
  `NavigatorLayoutController.cls:36-38`, kept in lockstep by hand. The six tracks in CSS are now a
  **third** copy of that six and cannot import the constant. If the maximum ever moves, all three move.
- **The existing `cols-N` grid rules and their test are untouched by design.** `.rstk-nav-section__grid`
  keeps `repeat(N, minmax(0, 1fr))`, so `navigatorSection.test.js:208-229` stays green. A change there is
  a signal something drifted.
- **A sizing class that lands inside a child component's shadow root is inert.** The canvas grid is a
  `<div>` in `salesforceNavigator`'s template and the elements it places are the `<c-navigator-section>`
  hosts, so a rule carrying `grid-column` reaches nothing if it is written against an element in
  `navigatorSection`'s own shadow tree. A test here must be able to fail on the span class being absent
  from `.rstk-nav-sections`'s direct children — that is assertable in jsdom, where a class-name check on
  the inner `<article>` and a stylesheet-text pin both stay green regardless.

## Evidence

> This is coming along well, but I'm not a fan of the max horizontal width of each section. I'd like to
> be variable width sections depending on the number of columns the user has in the section. Meaning,
> there should be 6 available horizontal widths for a section, determined by the number of field
> columns. this also means a user could have up to 6 sections side by side instead of stacked
> vertically. That being said, 6 sections side by side might be wider than a section with 6 field
> columns, meaning we may have to reduce our column limit (reduce the number of sections that can fit
> side by side). I'd expect that if a user zooms in, and the sections cannot all fit horizontally, then
> a scroll bar would appear for them to horizontally scroll

— Jonah Stephans, 2026-08-28, typed directly into `devpath:initiate`.

On the six being provisional, declining the first draft of these Outcomes at the intent gate:

> I thought I was pretty clear that I don't want to lock ourselves into "exactly six widths" if that
> sizing doesn't work on 6 sections, then we should move the max to 5, for instance. This will be
> something we look at in the design.

— Jonah Stephans, 2026-08-28. No tracker item; this is an engineer-originated change to work already in
progress.

At `devpath:technical-design`, 2026-08-28. On the mobile experience, which produced the form-factor
branch instead of a breakpoint:

> hm... maybe 3 isn't a hill I want to die on if it kills the mobile experience. Do you have a more
> broad recommendation here for the user experience?

Declining the `newRow` flag, and dissolving the altitude stop with it:

> no, i accept the fact that you can't stack.

On the two-line clamp, before the item chrome was measured — the condition that later failed:

> the longest name we have is "receivable transaction scheduled payment" if that fits on 2 you can cap
> it to two. My only concern is if the important word is hidden by ... and the user is cntrl f, then it
> might not show up? We could fix this later with a search bar that filters and can find hidden text,
> so I'm not concerned.

Rejecting wrapped labels and proposing the sizing model this design is built on:

> not a fan of these wrapped text boxes at all. I find them to be award spacing and getting clipped by
> the cell borders. What about: single row, no wrapped, but if you zoom out and out it scales out and
> you can see the full width? So if I have it up on a big monitor I'd see longer boxes that fix longer
> text?

— Jonah Stephans, 2026-08-28, all four at `devpath:technical-design`.
