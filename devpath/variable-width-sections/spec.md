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

Recorded before any of this spec's code existed, and corrected here where Build proved a claim wrong.

- O1 — **There was no fixed maximum width to replace.** `grep -rn "max-width\|maxWidth"` across
  `force-app` returned nothing. The uniformity was structural: `.rstk-nav-sections` was
  `display: flex; flex-direction: column` with no `align-items` override, and **its flex items were the
  `<c-navigator-section>` hosts** — not `.rstk-nav-section`, the `<article>` inside each host's own
  shadow root. Every host defaulted to `stretch` and took 100% of the container whether it held one
  column or six. **The original wording of this note named the `<article>` as the flex item, and the
  first build inherited the error**, putting the span class inside the shadow root where `grid-column`
  reaches nothing. The correction is recorded rather than quietly overwritten, because the same mistake
  is available to any later change — see `## Traps`. `columns` drove only the _inner_ grid
  `.rstk-nav-section__grid`, dividing the card's already-full-width interior into
  `repeat(N, minmax(0, 1fr))`; it never touched the card's own footprint.
- O10 — The keying concept already existed and was already clamped. Each section carries an integer
  `columns`, clamped by `clampColumns()` (`navigatorLayoutModel.js:720-725`) against `MIN_COLUMNS = 1`,
  `MAX_COLUMNS = 6`, `DEFAULT_COLUMNS = 3` (lines 32-34), and independently re-clamped server-side in
  `NavigatorLayoutController.columnsOf()` (`:36-38`, `:689-692`) — **two hand-synchronised copies of the
  constant**. Storage is a JSON integer per section inside `Layout_JSON__c`. **Nothing anywhere
  expressed a width**, and no column had a px or rem size — every track was `minmax(0, 1fr)`, an equal
  share of whatever the card happened to be.
- O3 — Nothing chose stacking; there was no alternative. **There is no row concept in the data model** —
  a layout is `{ sections: [...] }` with no row or position-in-row field anywhere. `slds-grid` appears
  nowhere in the repo.
- O4 — No scroll container, no overflow handling, and nothing responsive. The only `overflow` was
  `overflow: hidden` with `text-overflow: ellipsis` on the section **title**
  (`navigatorSection.css:63,65`). No media query, no `ResizeObserver`, no container query, no
  `slds-size_*` class. The element a scroll container goes on has an ancestor this repo does not style:
  `lightning-card` wraps everything (`salesforceNavigator.html:2`).
- O7 — No per-row limit of any kind existed. `MAX_COLUMNS` caps columns _inside_ one section.
- O8 — Today's behaviour _is_ O8's target state, which is what makes the `Small` branch a stand-down
  rather than a build.
- O11 — **There was no ellipsis on an item anywhere.** `.rstk-nav-item__label` carried only `font-size`,
  `font-weight` and `color` (`navigatorItem.css:63-67`), and `.rstk-nav-item` declared no `overflow` and
  no `text-overflow` (`:29-43`). It had never needed one, because the card was full width and the tracks
  fractional. `min-width: 0` is present on `.rstk-nav-item__row .rstk-nav-item` (`:9-12`) — the half of
  the truncation idiom that stops a flex item refusing to shrink. No item carries a `title`.

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

**The whole `--slds-g-sizing-*` scale, read from
`node_modules/@salesforce-ux/sds-metadata/current/SLDSStylingHooks.csv`.** Every value carries the 🔒
that means it is confirmed and cannot change, and `slds` and `cosmos` agree on all of them:

| Hook                 | rem   | px    |
| -------------------- | ----- | ----- |
| `--slds-g-sizing-13` | 10rem | 160px |
| `--slds-g-sizing-14` | 15rem | 240px |
| `--slds-g-sizing-15` | 20rem | 320px |
| `--slds-g-sizing-16` | 30rem | 480px |

`-16` is the top of the scale, and the CSV scopes the family to `width, height`. **Nothing on the scale
sits between 20rem and 30rem** — the fact `### The floor and the ceiling` turns on, and the fact an
earlier pass missed by stopping its search at `-14`.

**Two facts from the merged predecessor that constrain the mechanism**
(`dev-path/personal-navigator-layouts`, merged as PR #1):

- **The SLDS linter validates `width`; `grid-template-columns` is not on its validated-property list.**
  That is why the predecessor put column counts in classes rather than inline styles. It is also why
  this design expresses sizing entirely through grid properties — see `## Design`.
- **Rendered width is not assertable in jest.** jsdom applies no stylesheet and
  `getBoundingClientRect()` returns zeros. The repo's existing answer is to read the shipped stylesheet
  as text and pin it — `navigatorSection.test.js:208-229` regexes `.cols-1`…`.cols-6` and asserts
  `repeat(N, minmax(0, 1fr))` verbatim.

**Where the horizontal budget comes from is not in this repo, and is now partly measured.** No Flexipage
or app metadata references `salesforceNavigator`, so the width available is org- and placement-dependent
— tab page, App page region, or Home page column. Build measured a track at **255.66px at viewport
1680** against this design's predicted 263px; the ~7px gap is `lightning-card`'s own platform padding,
which remains unmeasured directly. O4's scroll bar is what keeps both from blocking the design.

**The in-flight neighbour does not collide.** `navigator-test-system-mode` carries an approved design and
is unmerged. Its diff is `NavigatorLayoutControllerTest.cls`, two `.claude/rules/` files,
`.prettierignore` and a research doc — no LWC and no CSS.

## Design

Decided in conversation with the engineer on 2026-08-28, across four rounds of sixteen questions, and
revised on the same day in a second conversation of five questions opened by what Build found. Two sizing
models were designed, measured and rejected before this one; the rejections are recorded below because
each was rejected for a reason that still binds.

**What the second conversation changed, and nothing else did:** the ceiling moved from a raw `26rem` to
`--slds-g-sizing-16`; item truncation moved from hand-written CSS to `slds-truncate`; the dropdown
hazard inside the scroll container was weighed and the scroll container kept; and two deviations from
the repo's LWC rules that were being taken silently are now written down. **No Outcome changed and no
Outcome ID was retired.**

### The mechanism, entire

The canvas becomes a grid of exactly six tracks. A section spans as many tracks as it has field columns.

```css
/* salesforceNavigator.css — the grid's own stylesheet */
.rstk-nav-sections {
  display: grid;
  grid-template-columns: repeat(
    6,
    minmax(
      var(--rstk-nav-col-min, var(--slds-g-sizing-13, 10rem)),
      var(--rstk-nav-col-max, var(--slds-g-sizing-16, 30rem))
    )
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

**The span class goes on the `<c-navigator-section>` host, bound in `salesforceNavigator.html`, and the
span rules live in `salesforceNavigator.css`.** `.rstk-nav-sections`'s actual children are those hosts;
a `grid-column` rule written against the `<article>` inside a host's own shadow root reaches nothing.
The first build put it there and the mechanism was inert — see `## Current state`'s O1 note and
`## Traps`. `spanClass` is still computed once, in `navigatorLayoutModel.js`'s `resolveLayout`, so the
clamp and the class have one definition between them.

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
against the real 14px font with the real 66px of item chrome subtracted. **The ceiling binds at none of
these rows** — see below. One row is checked against a real org: Build measured 255.66px at 1680 against
the 263px predicted here, the difference being `lightning-card`'s own padding.

### The floor and the ceiling

```
--slds-g-sizing-13   10rem / 160px   the floor
--slds-g-sizing-16   30rem / 480px   the ceiling
```

**Both are styling hooks, and that is a rule rather than a preference.** `rstk-slds2-ux-standards.md`
reaches every `**/lwc/**/*.css` file this spec touches and says never to hardcode sizing;
`--slds-g-sizing-*` is the named scale for dimension-bearing properties. Each is nested inside its own
`--rstk-nav-col-*` override seam and each hook carries the fallback the linter demands, so overriding the
project property still bypasses the hook entirely, exactly as it always could.

**The floor is what produces the scroll bar**, and at 160px a column at its narrowest still shows about
twelve characters.

**The ceiling caps track growth on a very wide display, and that is now its only job.** An earlier
draft claimed it also stopped a lone one-column section becoming a 1,376px-wide nav link. **That cannot
happen under this mechanism** — six tracks always exist, so a lone one-column section occupies exactly
one of them and is the same width as any other one-column section. The claim was a leftover from the
rejected fixed-width model and is retracted here rather than carried.

**Why `-16` and not the raw `26rem` an earlier pass settled on.** 26rem/416px was measured as the width
at which the longest name in the org fits whole — 350px of label after the 66px of chrome, against the
343px the name needs. It is therefore _exactly at_ the fitting threshold, with 7px of margin and no room
for a longer tab name or a different font. It is also a hardcoded sizing value that the linter cannot
catch, because no hook maps to it and so `no-hardcoded-values-slds2` never fires — the rule doc's own
"the linter is the backstop, not the design step" case. The pass that settled on it stopped its hook
search at `--slds-g-sizing-14` and concluded nothing matched; the scale in fact continues to `-15`
(20rem) and `-16` (30rem). `-15` leaves 254px of label, about **30 of 40** characters, and fails the
ceiling's one job. `-16` leaves 414px and fits the name whole with 71px to spare.

**What moving the ceiling changes, and it is nearly nothing.** The ceiling binds only once six tracks
plus five 1rem gaps plus 2rem of canvas padding exceed the space available: **2,608px at 416px per
track, 2,992px at 480px.** Below roughly 2,600px of available width the two are indistinguishable, which
is every row of the table above. Above it, tracks reach 480px instead of stopping at 416px. The floor,
and so the 1,072px scroll threshold, is untouched.

### The dropdown inside the scroll container

`overflow-x: auto` forces the computed `overflow-y` to `auto` — `auto`/`visible` is not a valid pairing —
so the canvas is a scroll container, and a scroll container is a clipping context for every
`position: absolute` SLDS dropdown inside it: the section menu (`navigatorSection.html`) and each item's
menu (`navigatorItem.html`). **The scroll container stays. The hazard is accepted, and here is the whole
of the reasoning, because it was not weighed the first time.**

**There is no _how_ left to find.** `menu-alignment` is the only attribute `lightning-button-menu`
exposes that governs dropdown position, and `auto` — already set on both menus — is the platform's own
documented answer for exactly this case: _"If you're using `lightning-button-menu` in a container that
specifies the `overflow:hidden` CSS property, setting `menu-alignment="auto"` makes sure that the
dropdown menu isn't hidden from view when the menu is toggled."_ No attribute exists for z-index, an
overlay container, or portal rendering. On the CSS side, `overflow-y: clip` escapes the coercion to
`auto` but still clips descendants; `visible` is the one value that would let a dropdown out, and it is
the one value that cannot be paired with a scrolling `overflow-x`. **No overflow value scrolls one axis
without clipping descendants on the other.**

**Measured, the hazard is real and latent.** In `sfnav-t2`: a 350px dropdown against a 540px scroller
fits, and a bottom-row item menu auto-flipped upward without clipping. The residual case is a layout
short enough that neither direction has room — a single row of narrow sections, which is also the case
carrying the most "Move to…" entries per item menu.

**`overflow-y: auto` is load-bearing over `hidden` here.** An overflowing dropdown grows the container's
scroll height, so it stays reachable by scrolling rather than being cut away. `hidden` would be strictly
worse.

**The two routes not taken, and why each is worse than the hazard.**

1. **Drop the scroll container** — delete `overflow-x: auto` and let the grid overflow `lightning-card`,
   so no new clipping context exists and the problem dissolves. It breaks no rule. It fails on a
   property: O4 asks that the layout scroll _and_ the sections not be clipped, and owning the scroll
   container is the only way that holds on a tab page, a Home-page column and an App-page region alike.
   This route makes the behaviour depend on an ancestor this repo neither owns nor can see — the one
   unknown `### Known unverified` already names as unresolvable from here.
2. **Replace both menus with our own popover** rendered outside the scroller. Certain, and against two
   rules that reach these files: `rstk-lwc-standards.md`'s _"Prefer `lightning-*` base components over
   custom implementations"_, and `rstk-complexity-guard.md`'s Infrastructure Overreach test, which reads
   a hand-built overlay-portaled menu replacing a platform component as a fix landing at the wrong
   layer. It would also mean rebuilding `lightning-button-menu`'s keyboard and screen-reader behaviour
   by hand, in two components, for a hazard nothing has yet hit.

**What ships instead: the hazard is recorded in `## Traps` and named as a live-org check.** It is not
dispositioned as fixed and it is not pretended away.

### Packing is the browser's, not ours

`grid-auto-flow: row` with `grid-column: span N` **is** the greedy packing algorithm: sections are placed
in order and a section that does not fit the remaining tracks moves to the next row. Implementing that in
JavaScript and then rendering it would duplicate the browser.

**Four consequences, all deliberate:**

- **A row can end under-full.** Sections `[4, 3, 3]` place as `[4]` then `[3, 3]`: two tracks go unused
  because the next section needs three. Confirmed in a real org, exactly.
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

**The section reorder keys stay ±1 through the flat stored order**, which is what packs into the rows.
The assistive text says "move this section earlier or later" rather than naming a direction, because a
direction would imply a two-dimensional move this key does not make. The item axis carries the identical
mismatch and its own wording already avoids the same claim.

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

`.rstk-nav-item__label` carries **`class="slds-truncate"`**, `.rstk-nav-item` gains `overflow: hidden`,
and the anchor gains a `title`. The `min-width: 0` the idiom also needs is **already present** on
`.rstk-nav-item__row .rstk-nav-item`.

**The utility class rather than hand-written CSS, because that is the rule.** `rstk-lwc-standards.md`
says _"Use SLDS utility classes for layout and spacing — don't write custom CSS for standard patterns"_,
and truncation-with-ellipsis is the canonical standard pattern. `slds-truncate` is a recognised SLDS 2
class in this repo's own `node_modules/@salesforce-ux/sds-metadata/next/sldsClasses.json`, and SLDS
utilities demonstrably reach inside these shadow roots — `slds-assistive-text` and `slds-p-around_medium`
are both already in use in these templates. `overflow: hidden` on `.rstk-nav-item` stays hand-written;
that one is not a utility-class pattern.

**One check the build owes rather than assumes:** `slds-truncate` brings more than the three declarations
an earlier draft of this section spelled out by hand. Read what the class actually resolves to in the org
and check it against the flex row before treating it as a drop-in alias.

**This is new work, not a tidy-up.** Nothing in the component truncates an item today, because nothing
has ever bounded a column. Without it a long label overflows its pill.

**Wrapped labels were designed, built into the sketch, measured, and rejected by the engineer** — see
`## Evidence`. The measurements that argued for them are in git; the reason they lost is that a wrapped
pill reads as awkward spacing and collides with the pill's own border.

### Where this deviates from the repo's LWC rules, deliberately

Both of these were being taken silently. Critique reads these rules, so they are written down.

- **`rstk-lwc-standards.md` says "Use `lightning-card`, `lightning-layout`, `lightning-layout-item` for
  structure" and "don't write custom CSS for standard patterns". The six-track canvas is hand-rolled CSS
  Grid instead.** `lightning-layout` is flexbox with `slds-size_*` fractional sizing and `flex-wrap`,
  and `flex-wrap` re-groups at the container width — the exact reflow O4 forbids. It also cannot express
  `minmax(floor, ceiling)` tracks that are uniform across rows, which is O10's whole property. No SLDS
  structural component expresses this layout; the deviation is what the Outcomes require.
- **The same rule's SLDS-utility line would point at the responsive `slds-*-size_*` family for the
  `Small` stand-down. Form factor is used instead.** Those classes are width-keyed breakpoints, and a
  width-keyed breakpoint cannot tell a phone from a zoomed-in desktop — the distinction O4 and O8 turn
  on.

The rules this spec does **not** deviate from, checked rather than assumed: every value is a
`var(--slds-g-*, fallback)` on the `--slds-g-*` global scale; the project's own custom properties carry a
`--rstk-` prefix, not `--slds`/`--sds`; no `--slds-c-*`, `--slds-s-*`, `--lwc-*` or `--sds-*` is
authored; no `prefers-color-scheme` query and no colour-mode branch in JS; focus is indicated with
`--slds-g-shadow-outline-focus-1` rather than a hand-rolled outline. `rstk-testing.md` does not reach
this spec at all — its globs are `**/*.cls` and `**/*.trigger`.

### The consequence I could not remove

A section's padding sits _inside_ the tracks it spans, so a one-column section pays 32px of padding
across one track while a six-column section spreads the same 32px across six. At 1440px that makes the
item pills in a one-column section about **189px** and those in a six-column section about **222px**. The
_sections_ align across rows, as O10 requires; the _pills inside them_ do not quite.

CSS `subgrid` would align them exactly, but only if the section drops its horizontal padding, which is a
visible change to shipped styling. **Left as it is**, at the engineer's decision: nothing in the live-org
measurement pass reported the misalignment as reading wrong, and giving up a section's horizontal padding
is a larger visual change than the ~33px it buys. It stays in `### Known unverified` so it is cheap to
revisit.

### Test entry points

**`c-navigator-section`'s span class.** The component exposes a `span-N` class derived from its clamped
column count, driven through the real column menu exactly as the existing `cols-N` test drives it. That
is the one callable, refactor-surviving seam this design has. The class is asserted on
`.rstk-nav-sections`'s **direct child**, which is where it has to land to do anything, and the assertion
is a filter-and-compare over the whole `span-1`…`span-6` family at every column count — not a `toContain`
— so a second member of the family landing on one host goes red.

Four facts live only in CSS and go through the repo's existing stylesheet-text pattern — the six-track
template driven off `MAX_COLUMNS` rather than a hard-coded six, the floor and ceiling hooks,
`overflow-x: auto`, and the `Small` single-track override — because jsdom applies no stylesheet and
`getBoundingClientRect()` returns zeros.

**And the honest limit, stated because the alternative is a test that cannot fail: row packing itself is
verified in a real org, not in jest.** The browser does the placing, so a jest assertion could only
re-state the algorithm rather than observe it. A `packRows` written purely to be tested was offered and
declined: it would not drive the rendering, and could silently diverge from what the grid actually does.
`rstk-testing.md` is Apex-scoped and imposes nothing here, so this limit is the design's own and is
carried in the open.

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
runtime; a facsimile collects feedback on its own inaccuracies. Density confirmation is a live-org check.

### Rejected sizing models, and why each still binds

1. **Fixed widths from a declared per-column unit.** Six widths generated from `--rstk-nav-col-width`.
   Rejected because a fixed unit gives the same 16 of 40 characters at every viewport — a larger monitor
   buys the user nothing. It also required `width: calc(...)`, the one property the SLDS linter checks.
2. **Two-line wrapped labels.** Rejected by the engineer on appearance. It was also already in trouble on
   measurement: with the real item chrome the longest name needs **four** lines at every unit from 9rem
   to 12rem, so the two-line clamp the design had settled on would have hidden two of its four words.
   Cutting the anchor's padding to 0.5rem bought exactly one line and still did not reach two.

### Known unverified

- **Whether a dropdown ever clips in practice.** Measured latent, not absent — see
  `### The dropdown inside the scroll container`. The case to look for is a single row of narrow sections
  with a long "Move to…" list.
- **`lightning-card`'s own padding is still unmeasured directly**, though now bounded: a track measured
  255.66px at 1680 against 263px predicted, so the card costs roughly 7px per track and the 1,072px
  scroll threshold is marginally higher in practice.
- **Where the component is placed at runtime is org-dependent.** O4's scroll bar is what makes this
  non-blocking, and it is the reason the scroll container is owned here rather than left to an ancestor.
- **Whether the pill mismatch reads as wrong**, and so whether `subgrid` is ever worth its cost.
- **Whether a `title` on the anchor duplicates its `aria-label` audibly.** The anchor already carries
  `aria-label={label}`; adding `title` may cause some screen readers to announce the name twice. See
  `## Traps`.
- **What `slds-truncate` actually resolves to** in the org, against the flex row it lands in.

### Retired Outcome IDs

**O5, O6 and O9 are retired.** O5 was a section count and O7 is a column budget — different statements.
O6 declared a fixed set of six widths and O10 derives width from available space — different statements.
O9 required wrapped labels and O11 requires the opposite. **O1, O3, O4, O7 and O8 keep their IDs**: O1's
premise was corrected in mechanism without changing what it asserts, O3's condition was made precise,
O4's rule is unchanged with its referent updated from O6 to O10's floor, and O7 and O8 are as approved.
No ID is reused; O2 was retired at Initiate. **The second design conversation retired no ID and changed
no Outcome text.**

## Traps

- **`overflow-x: auto` forces `overflow-y` to `auto`, and that makes the canvas a clipping context for
  every dropdown inside it.** `overflow-x: auto; overflow-y: visible` is not a valid combination — the
  computed value becomes `auto`. Two consequences, and an earlier draft of this trap weighed only the
  first. (1) The section cards' `box-shadow` clips vertically inside the scroll container unless the
  container carries padding, which it does. (2) **Every `lightning-button-menu` in the layout is inside
  that container** — the section menu and each item's menu — and an SLDS dropdown is `position: absolute`
  inside a `position: relative` trigger, so one that cannot fit either direction is cut at the canvas
  edge rather than overlaying it. This is accepted, not fixed; the reasoning, the platform attributes
  checked, and the two routes not taken are in `### The dropdown inside the scroll container`. The layout
  menu in the card's `slot="actions"` is outside the canvas and is unaffected.
- **`overflow-y: clip` is not an escape from the above.** It avoids the coercion to `auto`, but it still
  clips descendants; it only forgoes the scrollbar and script-driven scrolling. `visible` is the one
  value that would let a dropdown out and the one value that cannot pair with a scrolling `overflow-x`.
  Do not reopen this without a new fact.
- **`justify-content: start` is load-bearing.** Without it, tracks that have hit the ceiling leave free
  space the grid distributes rather than leaving at the end, and the layout drifts away from the left
  edge on a wide monitor.
- **`title` plus `aria-label` on the same anchor may double-announce.** The anchor already carries
  `aria-label={label}`. Verify against a screen reader before assuming `title` is free; the fallback is
  `title` on the label `<span>` rather than the anchor.
- **`MAX_COLUMNS` exists twice**, `navigatorLayoutModel.js:32-34` and
  `NavigatorLayoutController.cls:36-38`, kept in lockstep by hand. The six tracks in CSS are a **third**
  copy of that six and cannot import the constant. The stylesheet pin in `salesforceNavigator.test.js`
  drives its `repeat(N, …)` off the imported `MAX_COLUMNS` so the CSS copy cannot drift silently — the
  Apex copy still can. If the maximum ever moves, all three move.
- **A raw length inside a grid track function is invisible to the linter, mapped or not.**
  `no-hardcoded-values-slds2` is **property-scoped**, and an earlier form of this entry said it was
  value-scoped and drew the wrong lesson from it. Measured against a probe stylesheet under
  `**/lwc/**`: a raw `30rem` — which maps exactly to `--slds-g-sizing-16` — warns on `width` and draws
  nothing at all on `grid-template-columns`, `grid-template-rows`, `gap` or `flex-basis`; and a raw
  `26rem` on `width` warns _"There's no replacement styling hook for the 26rem static value. Remove the
  static value"_. So the rule does fire on unmapped values, and `26rem` passed
  `npm run lint --max-warnings 0` in silence for three fix cycles **because of the property it sat in**,
  not because no hook matched it. Lint is not a guard over the canvas grid's track sizing at any value;
  the stylesheet-text pin is the only one there is. A test here must be able to fail on a raw length
  reappearing anywhere in that track function — floor, ceiling or track count. (Searching the whole
  scale is still right — `-13` 10rem, `-14` 15rem, `-15` 20rem, `-16` 30rem, and it stops — just not
  because the linter would otherwise catch you.)
- **The existing `cols-N` grid rules and their test are untouched by design.** `.rstk-nav-section__grid`
  keeps `repeat(N, minmax(0, 1fr))`, so `navigatorSection.test.js:208-229` stays green. A change there is
  a signal something drifted.
- **A sizing class that lands inside a child component's shadow root is inert.** The canvas grid is a
  `<div>` in `salesforceNavigator`'s template and the elements it places are the `<c-navigator-section>`
  hosts, so a rule carrying `grid-column` reaches nothing if it is written against an element in
  `navigatorSection`'s own shadow tree. This is not hypothetical — the first build did exactly that, and
  a class-name check on the inner `<article>` plus a stylesheet-text pin both stayed green on it. A test
  here must be able to fail on the span class being absent from `.rstk-nav-sections`'s direct children.
- **A mutually-exclusive class family needs a uniqueness assertion, not only a `toContain`.** One host
  carrying two of `rstk-nav-section_span-1` … `-6` renders at whichever the stylesheet orders last, and
  every `toContain` check on that family stays green on it. A test here must be able to fail on two
  members of the family being applied to the same element — the filter-and-compare beside the `cols-N`
  class assertion is the shape that can, and the hazard arrives wherever a second rule has to override
  a section's stored span rather than replace the class that carries it.
- **A uniqueness guard on a parameterised class family has to run at every member, not at one.** A
  filter-and-compare fixed at a single value of the parameter is green on a duplicate emitted only at
  the _other_ values — and since an override that has to beat a stored value is conditional by nature,
  the conditional case is the likely shape rather than the contrived one. The guard belongs inside the
  `it.each` that already walks the family, not in a single-case test beside it. One honest bound on what
  such a guard can catch: an _exact duplicate_ of the same class token is inert to both the framework's
  class rendering and to CSS matching, so no DOM-level guard observes it — because it is not a rendering
  hazard. Two _different_ members on one host is the shape that matters, and that is caught at every
  count where it can occur.

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
