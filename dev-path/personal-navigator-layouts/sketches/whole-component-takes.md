# Sketch — three whole-component takes

**Artifact:** `whole-component-takes.html` (open it; the light/dark switch is the point)
**Raised:** 2026-08-24, by the engineer, mid-Build
**Source kit:** `~/Downloads/UI Style Reference.html` — "Rootstock on Salesforce · UI reference"

## The question

`## Open questions` closed at the design gate — all four answered, `design_approved: true`. This one
was raised afterwards and is not in that list:

> The built component styles itself from SLDS 2 hooks and has no visual language of its own. Which
> whole-component treatment does the Navigator adopt, and what does that cost against the Outcomes
> that are already built?

## The candidates

| | Take | Reads as | Costs |
| --- | --- | --- | --- |
| **A** | **Nested cards** | what is built, re-tuned to the kit — section stays a card at 12px inside the 20px shell, item loses its border | heaviest at the seeded 174 items; the kit's hairline contradicts the built CSS comment that SLDS 2 cards have no border |
| **B** | **Flat bands** | one card; a section becomes the kit's inset band and its items sit on the white surface | a section stops looking grabbable, and **section reorder is a drag** — the grab affordance and the drop-target signal both need re-drawing |
| **C** | **Pill grid** | items as pills in a flowing wrap; densest by a wide margin | **breaks Outcome 4** — a wrap has no columns, so "column count between one and six" has nothing to set, and slice 03 comes out |

## The answer

**Not yet chosen — awaiting the engineer.** Recorded here so the state survives this session.

**The recommendation is A.** C is not a style choice, it is an Outcome change: it deletes the
column-count Outcome and the slice that built it, so it cannot be picked without re-opening the spec.
Between A and B, B is genuinely lighter at 174 items, but it takes its cost in exactly the place the
build is least settled — the drag affordance on a section, which is both the grab source for Outcome 6
and the drop-target signal `.rstk-nav-section_droptarget` currently paints on the card edge. A reaches
the kit's look through **CSS values only**: no template change in any bundle, no Outcome touched.

If the engineer picks B, the note to carry into `## Design` is that the band becomes the grab handle
and both drag states need re-verifying against Outcome 6 before slice 07.

## Two findings that hold whichever take wins

Both are verified, not asserted — measured against `@salesforce-ux/sds-metadata@next` in this repo's
own `node_modules`, and the arithmetic is in the artifact.

**1. An `on-*` hook must carry the same index as the surface under it.** Filling the primary button
with `--slds-g-color-accent-2` (the kit's blue) and labelling it `--slds-g-color-on-accent-1` gives
6.66:1 in light and **2.19:1 in dark** — `accent-2` flips to `#7cb1fe`, `on-accent-1` is a fixed
`#fff`. Pairing by index (`on-accent-2`) only reaches 3.04:1, which is large-text-only and a 14px bold
label is not large text. **Accent has two jobs and they take different hooks:**

- **as a fill under a label** — buttons, selected chips — `accent-1` + `on-accent-1`, both fixed,
  **4.67:1 in both modes**. Costs a slightly brighter blue than the kit's `#0050D9`.
- **as ink or line** — link text, hover, focus ring, selected border — `accent-2`, which *is* the
  kit's blue, **6.66:1 light / 7.08:1 dark** against the card.

This is the trap `## Design` › *Styling* warns about, caught in the wild.

**2. The kit is expressible in semantic hooks almost end to end, but only if mapped by role.** Ask
the metadata which hook *holds* `#181818` and it answers `--slds-g-color-palette-neutral-10` — one of
the 38 with no `light-dark()` that the spec already flags. Mapped by role instead, the kit lands
cleanly: its 4 / 8 / 12 / 20 radius ladder is exactly `--slds-g-radius-border-1…4`; its navy title is
`--slds-g-color-on-surface-3`, which is *already* navy (`light-dark(#03234d, #d8e6fe)`); its `#5C5C5C`
secondary is `--slds-g-color-on-surface-1` exactly. Four values have no hook and are named in the
artifact rather than hard-coded quietly: the `#E5E5E5` hairline, the 9999px pill, the `#F8FAFF`
selected fill, and `#2D844A` success.

## One defect found on the way

`navigatorSection.css` has `color: var(--slds-g-color-on-surface-3, #181818)` commented as the title
colour. The hook is right; the fallback is wrong — under Cosmos it resolves to `#03234d`. Nothing is
visibly broken, since the fallback only applies if the hook is missing, but the file records the wrong
intent. Not fixed here: this sketch does not touch component source.

## Route back

Primary: the engineer carries the choice into the open design conversation and Design writes
`## Design`. Fallback if that session is gone: re-run `dev-path:technical-design`, which reads this
directory and finds this note.
