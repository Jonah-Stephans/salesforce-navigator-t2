---
depends_on:
  - devpath/variable-width-sections/slices/01-width-follows-columns-side-by-side.md
touches:
  - force-app/main/default/lwc/salesforceNavigator/salesforceNavigator.css
  - force-app/main/default/lwc/salesforceNavigator/__tests__/salesforceNavigator.test.js
---

# On a very wide display a column keeps widening a little further before it stops

> Watch a new test go red before you make it green.
> _Why: a test written before the code cannot be written to hit a coverage number — there is nothing to
> cover yet. Retires when Apex gets mutation testing._

## What to build

A user on a display wide enough to run the columns out to their limit sees them keep widening to 480px
instead of stopping at 416px, so the longest tab name has room to spare rather than only just fitting —
and the width they stop at is a value the design system supplies rather than a number written into this
component's stylesheet.

## Acceptance criteria

- [ ] Past the point where the ceiling binds — roughly 2,992px of available width — a column measures
      480px rather than 416px.
- [ ] Below roughly 2,600px of available width the layout is unchanged from what slice 01 shipped: the
      same track widths at 1280, 1440 and 1680.
- [ ] The floor is untouched — a column still stops shrinking at 160px, and the layout still gains its
      horizontal scroll bar below roughly 1,072px of available width.
- [ ] The shipped stylesheet expresses the ceiling as `--slds-g-sizing-16` carrying its own fallback, and
      no raw length remains anywhere in the canvas grid's `minmax()`.
- [ ] Overriding `--rstk-nav-col-max` still bypasses the hook entirely and sets the ceiling directly,
      exactly as it did before.
- [ ] `npm run lint` passes at `--max-warnings 0` over the changed CSS.
- [ ] Slice 01's existing checks all still pass untouched — the six-track pin driven off `MAX_COLUMNS`,
      the floor pin, the `overflow-x: auto` pin, and the span-class uniqueness guard across all six
      column counts. A change needed in any of them is a signal something drifted.

## Deviations

## Critique findings
