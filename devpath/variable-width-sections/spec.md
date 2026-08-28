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
