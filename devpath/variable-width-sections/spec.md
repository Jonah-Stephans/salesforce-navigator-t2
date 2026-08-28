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
but to stack vertically. A section's width should instead follow the number of field columns it holds —
one width per column count — so narrow sections take narrow space and several sections can sit side by
side in one row. Where the sections in a row exceed the space available, including when the user has
zoomed in, the layout gains a horizontal scroll bar rather than clipping, shrinking, or reflowing them.

Fixing a section's width fixes the width of every field column inside it, which makes long tab names —
`Receivable Transaction Scheduled Payment` is the longest in the org — a design problem the current
full-width stretch does not have. Item labels therefore wrap to a second line rather than truncating on
one.

## Outcomes

- O1 — A section's rendered width is a function of the number of field columns it holds, replacing the
  unbound full-width stretch that currently applies to every section alike.
- O6 — The set of available section widths is keyed to the maximum number of field columns a section may
  hold: there is one width per column count, and a section holding N field columns renders at the Nth
  width. Both the maximum and the number of widths are **six**, and every width is generated from a
  single declared per-column unit rather than written out independently.
- O3 — Sections render side by side in a row when the row's column budget admits them, rather than
  always stacking vertically.
- O4 — When the sections in a row exceed the horizontal space available — including when the shortfall
  is caused by the user zooming in — a horizontal scroll bar appears and scrolls the layout, and the
  sections are not clipped, shrunk below their O6 width, or reflowed.
- O7 — The number of sections permitted side by side in one row is governed by a single declared limit
  on the **total field columns a row may hold**, and the layout never places sections in a row whose
  column counts exceed it. Because every section holds at least one column, this also caps the number of
  sections in a row.
- O8 — On the `Small` form factor the keyed widths do not apply: each section occupies one row at the
  full width of the viewport with equal fractional columns, which is the behaviour that ships today.
- O9 — An item's label wraps to a second line rather than being truncated on one, and is clamped at two
  lines; the full label remains available to a pointer, a screen reader and find-in-page.

## Out of scope

- **A height sizing mechanism.** Nothing here keys a section's height to anything, introduces a
  row-height budget, or makes height a declared set of values the way O6 does for width. Height stays
  content-driven. **Wrapped labels do make sections taller than they are today** — measured at +35% on a
  three-row, three-column section — and that is a consequence of O9 rather than an accident.
- **What a field column contains, and how fields are arranged inside one.** The unit this spec reasons
  about is the column count, not the column's contents.
- **A search or filter over items.** Raised at Design as the eventual answer to a label clipped by O9's
  two-line clamp being hard to find; it is a separate spec.

## Current state

- O1 — **There is no fixed maximum width to replace.** `grep -rn "max-width\|maxWidth"` across
  `force-app` returns nothing. The uniformity is structural: `.rstk-nav-section` carries no width rule
  at all (`navigatorSection.css:3-11`) and sits as a block-level flex item inside `.rstk-nav-sections`,
  which is `display: flex; flex-direction: column` with no `align-items` override
  (`salesforceNavigator.css:11-16`) — so every card defaults to `stretch` and takes 100% of the
  container whether it holds one column or six. `columns` drives only the _inner_ grid
  `.rstk-nav-section__grid` (`navigatorSection.css:129-157`), dividing the card's already-full-width
  interior into `repeat(N, minmax(0, 1fr))`; it never touches the card's own footprint.
- O6 — The keying concept already exists and is already clamped. Each section carries an integer
  `columns`, clamped by `clampColumns()` (`navigatorLayoutModel.js:720-725`) against `MIN_COLUMNS = 1`,
  `MAX_COLUMNS = 6`, `DEFAULT_COLUMNS = 3` (lines 32-34), and independently re-clamped server-side in
  `NavigatorLayoutController.columnsOf()` (`:36-38`, `:689-692`) — **two hand-synchronised copies of
  the constant**, the Apex comment stating it matches `clampColumns` key for key. Storage is a JSON
  integer per section inside `Layout_JSON__c`. `columnChoices` (`navigatorSection.js:251-263`) generates
  the section menu from those constants. **There is no "available widths" concept today** — the only
  per-count artefact is the `cols-1`…`cols-6` class family, and it governs the inner item grid alone.
- O3 — Nothing chose stacking; there is no alternative. `.rstk-nav-sections` is `flex-direction: column`
  and `salesforceNavigator.html:156` renders one `<c-navigator-section>` per iteration of a flat
  `for:each={sections}`. **There is no row concept in the data model** — a layout is `{ sections: [...] }`
  with no row or position-in-row field anywhere. `slds-grid` appears nowhere in the repo.
- O4 — No scroll container, no overflow handling, and nothing responsive exists. The only `overflow` is
  `overflow: hidden` with `text-overflow: ellipsis` on the section title (`navigatorSection.css:63,65`).
  No media query, no `ResizeObserver`, no container query, no `slds-size_*` class, and nothing that
  shrinks or reflows at narrow widths. The element a scroll container goes on has an ancestor this repo
  does not style: `lightning-card` wraps everything (`salesforceNavigator.html:2`).
- O7 — No per-row limit of any kind exists. `MAX_COLUMNS` caps columns _inside_ one section; there is no
  sibling constant capping a row, because sections do not share rows today.
- O9 — Items are single-line today and cannot truncate visibly, because the card is full width and the
  tracks are fractional. The repo's established answer to a long string is
  `overflow: hidden; text-overflow: ellipsis` plus `min-width: 0` and a `title`, applied to the section
  heading (`navigatorSection.css:63,65`); no item carries it.

**The measurements.** Every spacing value is a checked-in SLDS token and the CSS fallbacks match the real
resolved values — `node_modules/@salesforce-ux/` gives `--slds-g-spacing-2: 0.5rem`, `-3: 0.75rem`,
`-4: 1rem`, so the arithmetic needed no live org. Section padding is `1rem` on all four sides
(`navigatorSection.css:4`); the gap between sections is `1rem` (`salesforceNavigator.css:14`); canvas
padding is `1rem` all sides (`salesforceNavigator.css:15`); the gap between field columns inside a
section is `0.5rem` (`navigatorSection.css:131`). Sections carry no border under SLDS 2 — chrome is
padding plus a `box-shadow`, which adds nothing to layout width.

**But the width of one field column did not exist as a quantity.** Every track is `minmax(0, 1fr)` — an
equal share of whatever the card ends up being. There was no px or rem per-column number anywhere in the
codebase, so this spec invents it; O6 cannot be built without it.

**Two facts from the merged predecessor that constrain the mechanism**
(`dev-path/personal-navigator-layouts`, merged as PR #1):

- **A per-section width cannot be an inline style.** That spec chose the `cols-N` class family over
  inline styles specifically because the SLDS linter validates `width` while `grid-template-columns` is
  not on its validated-property list. Section width is exactly the property the linter checks. The gate
  is real: one CI job runs `eslint --max-warnings 0` over `**/lwc/**/*.{css,html}`.
- **Rendered width is not assertable in jest.** jsdom applies no stylesheet and
  `getBoundingClientRect()` returns zeros. The repo's existing answer is to read the shipped stylesheet
  as text and pin it — `navigatorSection.test.js:208-229` regexes `.cols-1`…`.cols-6` and asserts
  `repeat(N, minmax(0, 1fr))` verbatim. A width-per-count table is testable the same way and no other
  way.

**Where the horizontal budget comes from is not in this repo.** No Flexipage or app metadata references
`salesforceNavigator`, so the width available to a row is org- and placement-dependent — tab page, App
page region, or Home page column. `lightning-card`'s own padding is platform CSS absent from this repo.
Both are measurable only in a live org, and O4's scroll bar is what keeps them from blocking the design.

**The in-flight neighbour does not collide.** `navigator-test-system-mode` carries
`design_approved: true` and is unmerged. Its diff is `NavigatorLayoutControllerTest.cls`, two
`.claude/rules/` files, `.prettierignore` and a research doc — no LWC and no CSS. Its intent is an Apex
access-mode fix, unrelated to sizing, and nothing here builds on it.

## Design

Decided in conversation with the engineer on 2026-08-28, across three rounds of eleven questions. Every
decision below is the engineer's; the reasoning is recorded so a later reader can tell a choice from an
accident.

### One number, used three ways

Six. It is the maximum field columns a section may hold, the number of available section widths, and the
**total field columns one row may hold**. The requirement imagined those as one number and then doubted
it would survive measurement; it survives, but only because the third of the three is a _column budget_
rather than a section count.

**Why the budget and not a count.** The requirement's worry was that six sections side by side are wider
than one six-column section, so the limit might have to drop to five. The arithmetic confirms the worry
and dissolves the remedy. Writing `c` for the per-column unit:

- one section holding N columns: `N·c + 8(N−1) + 32`
- a row of `k` sections whose column counts sum to 6: `6c + 32 + 40k`

The difference between six one-column sections and one six-column section is `40(6−1) = 200px` and **`c`
cancels out** — it is true at every unit. But a plain count of six leaves row width unbounded (six
_six-column_ sections would be 6,272px), whereas the budget makes row width monotonic in `k` and
maximal at `k=6`. The budget is what makes six survive: it bounds the worst row instead of leaving it
open, and it never permits more than six sections in a row because every section holds at least one
column.

### The per-column unit, and the six widths

```
--rstk-nav-col-width: 12rem   /* 192px */
```

| Field columns | Section width | Row canvas when one section fills the budget |
| ------------- | ------------- | -------------------------------------------- |
| 1             | 224px         | —                                            |
| 2             | 424px         | —                                            |
| 3             | 624px         | —                                            |
| 4             | 824px         | —                                            |
| 5             | 1024px        | —                                            |
| 6             | 1224px        | 1256px                                       |

The widest row the budget permits is six one-column sections: **1,456px** including canvas padding. A
single six-column section is **1,256px**, which fits a 1280px laptop with 24px to spare.

**Why 12rem, decided against measurements taken in the sketch rather than by argument.** Wrapping (below)
makes legibility very nearly unit-independent — `Receivable Transaction Scheduled Payment` wraps to two
lines at 10rem, 11rem and 12rem alike. So the unit trades **width against height**: a larger unit fits
more on one line, so fewer labels wrap and sections run shorter, at the cost of wider rows. 12rem is the
unit at which that longest name still fits on two lines with 26 of its 40 characters on the first, and at
which a single six-column section still fits a laptop. 9rem was ruled out by measurement: the same name
needs **three** lines at a 144px track.

**The accepted cost, stated rather than discovered:** the six-across extreme at 1,456px scrolls a 1440px
desktop by 16px and a 1280px laptop by 176px. That is the case O4 exists for, and it is the rarest
layout the budget permits — every other composition of the budget is narrower.

### How the width is expressed

One formula, six one-line classes:

```css
.rstk-nav-section {
  width: calc(
    var(--rstk-nav-cols) * var(--rstk-nav-col-width, 12rem) +
      (var(--rstk-nav-cols) - 1) * var(--slds-g-spacing-2, 0.5rem) + 2 *
      var(--slds-g-spacing-4, 1rem)
  );
}
.cols-1 {
  --rstk-nav-cols: 1;
} /* … through cols-6 */
```

Three rejected alternatives, each for a reason worth keeping:

- **An inline style** — the SLDS linter validates `width`, which is why the predecessor put column counts
  in classes rather than styles in the first place.
- **`width: fit-content`** — a long _section name_ contributes to max-content and would stretch the card,
  breaking one-width-per-count. The width has to be immune to the header's content.
- **Six independent `width` declarations** — duplicates the arithmetic six times. `--rstk-nav-cols` keeps
  one formula and one unit as the single source of truth.

**The existing `cols-N` grid rules do not change, and neither does their test.** With the card's width
fixed, each `repeat(N, minmax(0, 1fr))` track resolves to exactly `--rstk-nav-col-width`, so
`navigatorSection.test.js:208-229` stays green untouched. The `cols-N` classes gain the custom property
and keep the grid template.

### Wrapped labels

`.item` wraps rather than truncating, clamped at two lines:

- `white-space: normal`, `overflow-wrap: break-word`
- `display: -webkit-box`, `-webkit-box-orient: vertical`, `-webkit-line-clamp: 2`, `overflow: hidden`
- `title` carrying the full label

**Two lines is enough, by measurement rather than by assumption.** At a 192px track, every one of the
thirteen longest ERP tab names tested — the longest being
`Receivable Transaction Scheduled Payment` — wraps to two lines.

**Pill height is auto, not uniform.** CSS Grid already sizes each row to its tallest item and the pills
stretch to fill it, so **within a row the pills are uniform for free**; the only unevenness is between
rows. A uniform two-line minimum was built and measured identically on long-label data, and would only
cost height in a layout whose labels are short — forcing a two-line pill onto "Leads".

**What this costs.** A three-row, three-column section measures 168px tall with ellipsis and 227px
wrapped: **+35%**. That is why `## Out of scope` was narrowed rather than left to contradict this.

**Adding columns never widens a track.** A track is exactly `--rstk-nav-col-width` whatever the section's
column count, so truncation is identical in a one-column section and a six-column one. A user with long
tab names cannot fix it by any layout choice available to them — the unit is the only lever, and it is
ours. This is counterintuitive and is written down because a user will hit it.

**Known limitation, accepted by the engineer.** A label clipped by the two-line clamp cannot be scrolled
into view by find-in-page. It is _not_ invisible to it: clipped text remains in the DOM and the
accessibility tree, so find-in-page and screen readers still match it, and `title` carries the full
string to a pointer. The eventual answer is a filter over items, which is now named in
`## Out of scope`.

### How a section comes to share a row

Rows are **derived**, by greedy packing over the section order already stored in `Layout_JSON__c`:

> A section joins the current row if its column count fits the remaining budget; otherwise it starts a
> new row.

`packRows` is a pure function. Nothing is stored, `Schema_Version__c` stays at 1, and there is no new
drag interaction — the user controls row composition through the section order they already drag and the
column counts they already choose.

**Three consequences, all deliberate:**

- **A row can end under-full.** Sections `[4, 3, 3]` pack as `[4]` then `[3, 3]`: two columns of budget
  go unused because the next section needs three. The budget is a ceiling, not a quota.
- **A new row never starts while the next section would still fit.** This is the clause that removes
  voluntary stacking: two one-column sections will always pair up, and there is no way to ask for them
  stacked. A per-section `newRow` flag was designed and **declined at the design gate** — the engineer
  accepted the loss rather than pay a `Schema_Version__c` bump for it. Absence means false, so it stays
  addable later without breaking anything.
- **Reordering a section, or changing its column count, re-packs the rows.** Raising a section from 3 to
  4 columns can eject its row-mate to the next row.

**`flex-wrap` is ruled out, and this is a derivation from O4 rather than a preference.** Wrapping
re-groups sections at the container width, so zooming in would re-wrap — precisely the reflow O4
forbids. Row membership therefore has to be viewport-independent, which is what makes it a property of
the layout rather than of the window.

### Form factor, not viewport width

```js
import FORM_FACTOR from "@salesforce/client/formFactor";
```

- **`Medium` and `Large`** — keyed widths, side by side under the budget, horizontal scroll on shortfall.
- **`Small`** — the mechanism stands down. One section per row at the full width of the viewport, tracks
  back to `minmax(0, 1fr)`. This is exactly today's behaviour, unchanged.

**Why not a media query, and it is the whole reason this branch exists at all.** A width-keyed breakpoint
cannot distinguish a phone from a zoomed-in desktop — `@media (max-width: 48em)` fires on both — and the
zoom case is the one the requirement names explicitly as wanting a scroll bar. Form factor is a device
class, it does not change when the user zooms, and it is a plain JS value a test can pass in. **No media
query ships anywhere in this spec.**

**O4 needs no rewording for this.** On `Small` there is one full-width section per row, so "the sections
in a row exceed the horizontal space available" is never true and O4 is satisfied vacuously. O8 states
the `Small` behaviour rather than O4 being narrowed to exclude it.

**Stated plainly because it would otherwise be discovered at Build:** a six-column section on a 390px
phone gives six ~50px tracks. That is unusable — and it is unusable identically today, since today's card
is full-width with fractional tracks. This spec commits to not making mobile worse, not to improving it.

### The scroll container

`overflow-x: auto` on `.rstk-nav-sections`, which becomes the scroll container. Its children are rows —
`display: flex; flex-direction: row; flex-wrap: nowrap` — and all rows scroll together, which is what
"scrolls the layout" in O4 means. Zoom needs no JavaScript: rem-based widths hold while the viewport
narrows in CSS pixels, so the scrollbar appears on its own.

### Test entry points

**`packRows(sections, { formFactor })` in `navigatorLayoutModel`** — one exported pure function returning
an array of rows. It is where the budget, the packing, the under-full row, the `Small` stand-down and the
cap are asserted. `navigatorLayoutModel` is already this repo's designated home for pure functions with
no `lwc` import, already holds `clampColumns` and `reorder`, and is already where the tests point.

The four facts that live only in CSS — the six widths, the unit, the two-line clamp, and `overflow-x` —
go through the repo's existing stylesheet-text pattern, because jsdom applies no stylesheet and
`getBoundingClientRect()` returns zeros. There is no other route, and pretending otherwise is how a test
that cannot fail gets written.

**Naming the entry point is why the packing is a function at all.** Almost everything else here is
declarative CSS; had rows been computed inline in the component's template or a getter, there would be
nothing callable to point a test at.

### The altitude stop, raised and dissolved

The predecessor spec named a second spec — an admin-authored org-wide default layout — which inherits the
`Layout_JSON__c` contract. Adding a `newRow` flag would have made that spec inherit it too, and the
question was put to the engineer as an altitude stop. Declining the flag dissolves it: nothing is stored,
the contract is unchanged, and `Schema_Version__c` stays at 1.

### The UX detour

A geometry sketch was built and used to settle the unit, the wrap decision and the clamp:
`devpath/variable-width-sections/sketches/section-widths.html`. It computes every width from the real
formula and the real SLDS tokens, and measures character fitting against the real font rather than
estimating it — which is what caught a rough estimate of mine being seven characters optimistic.

**It is deliberately not a Lightning facsimile.** Density and native feel are answerable only in the real
runtime; a facsimile collects feedback on its own inaccuracies instead. Density confirmation is a live-org
check at Build.

### Known unverified

- **`lightning-card`'s own padding is unmeasured.** It is platform CSS, absent from this repo. Every row
  figure above excludes it, so real available width is slightly less than stated.
- **Where the component is placed at runtime is org-dependent.** No Flexipage metadata references it, so
  the horizontal budget varies by tab page, App page region or Home page column. O4's scroll bar is what
  makes this non-blocking.
- **Whether `-webkit-line-clamp` and `display: -webkit-box` clear the SLDS lint gate is unconfirmed.**
  See `## Traps`.

### Retired Outcome IDs

**O5 is retired**, replaced by **O7**: a section count and a column budget permit different layouts, so
it is a different statement and takes a new ID. **O1, O3, O4 and O6 keep their IDs** — O1's premise was
corrected in mechanism without changing what it asserts, O3's condition was made precise, O6's value was
fixed at the six it always proposed, and O4 is untouched. **O8 and O9 are new.** No ID is reused; O2 was
retired at Initiate.

## Traps

- **`-webkit-line-clamp` against `eslint --max-warnings 0`.** The clamp needs a vendor-prefixed
  `display: -webkit-box`, and whether the SLDS plugin flags either is unconfirmed. It must be checked
  against the real gate, not assumed. **Fallback if it fails:** `max-height` plus `overflow: hidden`,
  which bounds height but cuts the second line without an ellipsis.
- **`overflow-x: auto` forces `overflow-y` to `auto`.** `overflow-x: auto; overflow-y: visible` is not a
  valid combination — the computed value becomes `auto`. The section cards' `box-shadow` will therefore
  clip vertically inside the scroll container unless the container carries padding.
- **`MAX_COLUMNS` exists twice**, in `navigatorLayoutModel.js:32-34` and
  `NavigatorLayoutController.cls:36-38`, kept in lockstep by hand. The row budget is presentation-only
  and is client-side alone, so do not add a second Apex constant for it — but if `MAX_COLUMNS` itself
  ever moves, both copies move.
- **`width: calc()` over `var()` is the one place this spec touches a property the SLDS linter
  validates.** If it is flagged, the fix is not an inline style — that is the alternative the
  predecessor already rejected for the same reason.

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

At `devpath:technical-design`, 2026-08-28, on the mobile experience — the exchange that produced the
form-factor branch instead of a breakpoint:

> hm... maybe 3 isn't a hill I want to die on if it kills the mobile experience. Do you have a more
> broad recommendation here for the user experience?

Declining the `newRow` flag, and dissolving the altitude stop with it:

> no, i accept the fact that you can't stack.

Asking for wrapped labels, which is the decision the rest of the design turned on:

> hm, tough. I like the 12 rem, tbh. But maybe what I'd want here is 11 rem but it wrap texts to create
> larger field pills instead of trailing off?

Settling the unit and the clamp, and accepting the find-in-page limitation:

> 3 - let's go with 12 and wrapped. q9- the longest name we have is "receivable transaction scheduled
> payment" if that fits on 2 you can cap it to two. My only concern is if the important word is hidden
> by ... and the user is cntrl f, then it might not show up? We could fix this later with a search bar
> that filters and can find hidden text, so I'm not concerned.

— Jonah Stephans, 2026-08-28, all four at `devpath:technical-design`.
