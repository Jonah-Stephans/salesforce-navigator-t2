---
type: feature
upstream: []
intent_accepted: true
---

# Section width follows its field-column count, and sections sit side by side

## Intent

Every section in the layout builder renders at the same maximum horizontal width no matter how many
field columns it holds, so a one-column section occupies as much horizontal room as a six-column one
and sections have no choice but to stack vertically. A section's width should instead follow the number
of field columns it holds — one width per column count — so narrow sections take narrow space and
several sections can sit side by side in one row. Where the sections in a row exceed the space
available, including when the user has zoomed in, the layout gains a horizontal scroll bar rather than
clipping, shrinking, or reflowing them. **This spec deliberately does not fix the maximum at six.** Six
is the starting proposal, not a commitment: a row of narrow sections each carries its own padding and
gutters, so it can be wider than a single wide section spanning the same distance, and if the sizing
does not work at six the maximum comes down — to five, or to whatever the measurements support. That
value is a design decision.

## Outcomes

- O1 — A section's rendered width is a function of the number of field columns it holds, replacing the
  single fixed maximum width that currently applies to every section alike.
- O6 — The set of available section widths is keyed to the maximum number of field columns a section may
  hold: there is one width per column count, and a section holding N field columns renders at the Nth
  width. **The spec fixes neither that maximum nor the number of widths at six**; the value is settled
  at Design.
- O3 — Sections render side by side in a row when the row has room for them, rather than always
  stacking vertically.
- O4 — When the sections in a row exceed the horizontal space available — including when the shortfall
  is caused by the user zooming in — a horizontal scroll bar appears and scrolls the layout, and the
  sections are not clipped, shrunk below their O6 width, or reflowed.
- O5 — The number of sections permitted side by side in one row is a single declared limit, and the
  layout never places more than that many in a row.

## Out of scope

- **Section height and vertical sizing.** Nothing here changes how tall a section is or how it grows.
- **What a field column contains, and how fields are arranged inside one.** The unit this spec reasons
  about is the column count, not the column's contents.

## Open questions

- **What is the maximum, and is it one number or two?** The requirement proposes six — six field
  columns, six widths, six sections side by side — and then explicitly declines to commit to it: if the
  sizing does not work at six sections, the maximum should move to five. Settling it needs the real
  rendered widths including section chrome, padding and gutters, since a row of narrow sections each
  carrying its own chrome is wider than one wide section spanning the same distance. Design also has to
  decide whether the number of available widths and the cap on sections per row are the same number or
  two independent ones — the requirement treats them as one, and that may not survive measurement.
  Owner: Jonah, at Design.
- **How does a section come to share a row?** The requirement establishes that sections _can_ sit side
  by side but not what puts them there — whether the layout flows them into a row automatically until
  the O5 limit is reached, or the user places them explicitly. Owner: Jonah.
- **Is horizontal scroll the only response at every viewport, or do side-by-side sections stop being
  side by side below some width?** Zoom is named explicitly in the requirement; a narrow screen reaching
  the same state is not. Owner: Jonah.

## Current state

- O1 — **There is no fixed maximum width to replace.** `grep -rn "max-width\|maxWidth"` across
  `force-app` returns nothing. The uniformity is structural: `.rstk-nav-section` carries no width rule
  at all (`navigatorSection.css:3-11`) and sits as a block-level flex item inside `.rstk-nav-sections`,
  which is `display: flex; flex-direction: column` with no `align-items` override
  (`salesforceNavigator.css:11-16`) — so every card defaults to `stretch` and takes 100% of the
  container whether it holds one column or six. `columns` drives only the _inner_ grid
  `.rstk-nav-section__grid` (`navigatorSection.css:129-157`), dividing the card's already-full-width
  interior into `repeat(N, minmax(0, 1fr))`; it never touches the card's own footprint. The Outcome's
  premise is right in substance and wrong in mechanism — nothing caps section width, nothing binds it.
- O6 — The keying concept already exists and is already clamped. Each section carries an integer
  `columns`, clamped by `clampColumns()` (`navigatorLayoutModel.js:720-725`) against `MIN_COLUMNS = 1`,
  `MAX_COLUMNS = 6`, `DEFAULT_COLUMNS = 3` (lines 32-34), and independently re-clamped server-side in
  `NavigatorLayoutController.columnsOf()` (`:36-38`, `:689-692`) — **two hand-synchronised copies of
  the constant**, the Apex comment stating it matches `clampColumns` key for key. Storage is a JSON
  integer per section inside `Layout_JSON__c`, so moving the maximum is a constant change in two files
  and no schema change. `columnChoices` (`navigatorSection.js:251-263`) already generates the section
  menu from those constants, so a width-per-count table slots in beside it with no new plumbing.
  **There is no "available widths" concept today** — the only per-count artefact is the `cols-1`…`cols-6`
  class family, and it governs the inner item grid alone.
- O3 — Nothing chose stacking; there is no alternative. `.rstk-nav-sections` is `flex-direction: column`
  and `salesforceNavigator.html:156` renders one `<c-navigator-section>` per iteration of a flat
  `for:each={sections}`. **There is no row concept in the data model** — a layout is `{ sections: [...] }`
  with no row or position-in-row field anywhere. `slds-grid` appears nowhere in the repo (zero hits).
  Side-by-side is a green-field change to one container, not an override of an existing mechanism.
- O4 — No scroll container, no overflow handling, and nothing responsive exists. Across
  `salesforceNavigator`, `navigatorSection` and `navigatorItem` the only `overflow` is
  `overflow: hidden` with `text-overflow: ellipsis` on the section title (`navigatorSection.css:63,65`),
  and the only `minmax()` is the inner item grid. No media query, no `ResizeObserver`, no container
  query, no `clamp()` at row level, no `slds-size_*` class, and nothing that shrinks or reflows at
  narrow widths. Horizontal scroll-on-overflow is wholly new. Note the element it goes on has an
  ancestor this repo does not style: `lightning-card` wraps everything (`salesforceNavigator.html:2`).
- O5 — No per-row limit of any kind exists. `MAX_COLUMNS` caps columns _inside_ one section; there is no
  sibling constant capping sections per row, because sections do not share rows today. A new limit can
  copy `MAX_COLUMNS`'s shape. Whether it needs the Apex twin is open: stored `columns` has one because
  it is persisted and server-validated, and a row cap may be presentation-only.

**The measurements, and the one number that does not exist.** Every spacing value is a checked-in SLDS
token and the CSS fallbacks match the real resolved values — `node_modules/@salesforce-ux/` gives
`--slds-g-spacing-2: 0.5rem`, `-3: 0.75rem`, `-4: 1rem`, so the arithmetic needs no live org. Section
padding is `1rem` on all four sides (`navigatorSection.css:4`); the gap between stacked sections is
`1rem` (`salesforceNavigator.css:14`); canvas padding is `1rem` all sides
(`salesforceNavigator.css:15`); the gap between field columns inside a section is `0.5rem`
(`navigatorSection.css:131`). Sections carry no border under SLDS 2 — chrome is padding plus a
`box-shadow`, which adds nothing to layout width.

**But the width of one field column does not exist as a quantity.** Every track is `minmax(0, 1fr)` — an
equal share of whatever the card ends up being. There is no px or rem per-column number anywhere in the
codebase. This spec has to _invent_ that unit; it cannot be measured out of the repo, and O6 cannot be
built without it.

**What that nevertheless lets us settle before the conversation starts.** Writing `c` for the invented
per-column width, at the tokens above:

- one section holding N field columns: `N·c + 8(N−1) + 32`
- N one-column sections side by side: `N·(c + 32) + 16(N−1)`

The difference is `40(N−1)` px and **`c` cancels out.** So six one-column sections side by side are
**exactly 200px wider** than one six-column section, and five are 160px wider, whatever per-column unit
is chosen. The engineer's concern in `## Evidence` is confirmed and quantified without needing the unit.
What it does not settle is whether 200px matters: O4 already answers an over-wide row with a scroll bar,
so _wider_ is not _broken_, and what the sections-per-row cap is actually protecting is a live question.

**Two facts from the merged predecessor that constrain the mechanism**
(`dev-path/personal-navigator-layouts`, merged as PR #1):

- **A per-section width cannot be an inline style.** That spec chose the `cols-N` class family over
  inline styles specifically because the SLDS linter validates `width` while `grid-template-columns` is
  not on its validated-property list. Section width is exactly the property the linter checks, so it has
  to arrive as a class or a custom property. The gate is real: one CI job runs
  `eslint --max-warnings 0` over `**/lwc/**/*.{css,html}`.
- **Rendered width is not assertable in jest.** jsdom applies no stylesheet and
  `getBoundingClientRect()` returns zeros. The repo's existing answer is to read the shipped stylesheet
  as text and pin it — `navigatorSection.test.js:208-229` regexes `.cols-1`…`.cols-6` and asserts
  `repeat(N, minmax(0, 1fr))` verbatim. A width-per-count table is testable the same way and no other
  way. That test governs the inner grid, so a mechanism confined to the outer card should not disturb
  it; a mechanism that changes how columns render internally would need to move in lockstep with it.

**Where the horizontal budget comes from is not in this repo.** No Flexipage or app metadata references
`salesforceNavigator`, so the width available to a row is org- and placement-dependent — tab page, App
page region, or Home page column. `lightning-card`'s own padding is platform CSS absent from this repo.
Both are measurable only in a live org, and O4's scroll bar is what keeps them from blocking the design.

**The in-flight neighbour does not collide.** `navigator-test-system-mode` carries
`design_approved: true` and is unmerged. Its diff is `NavigatorLayoutControllerTest.cls`, two
`.claude/rules/` files, `.prettierignore` and a research doc — no LWC and no CSS. Its intent is an Apex
access-mode fix, unrelated to sizing, and nothing here builds on it.

**The ceiling did not shape this finding.** All five Outcomes concern one subsystem, so one researcher
covered all five rather than four re-reading the same files. The second dispatch was not spent because
both chaseable threads closed on bounded greps: the resolved SLDS spacing values are checked into
`node_modules`, and the predecessor's sketch turned out to pin no component width (its `1180px` and
`ch` measures are the sketch document's own chrome). Two threads stay open and are named above —
`lightning-card`'s chrome and the runtime placement width — and both are live-org measurements rather
than repo reads.

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
