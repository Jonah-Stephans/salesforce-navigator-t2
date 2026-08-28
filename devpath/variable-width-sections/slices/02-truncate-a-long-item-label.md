---
depends_on:
  - devpath/variable-width-sections/slices/01-width-follows-columns-side-by-side.md
touches:
  - force-app/main/default/lwc/navigatorItem/navigatorItem.css
  - force-app/main/default/lwc/navigatorItem/navigatorItem.html
  - force-app/main/default/lwc/navigatorItem/__tests__/navigatorItem.test.js
---

# A long item label is cut off inside its pill, not spilled out of it

> Watch a new test go red before you make it green.
> _Why: a test written before the code cannot be written to hit a coverage number — there is nothing to
> cover yet. Retires when Apex gets mutation testing._

## What to build

An item whose tab name is longer than the column it sits in shows as much of the name as fits followed by
an ellipsis, staying inside its own pill, and the user can still get at the whole name by hovering it, by
searching the page for it, or with a screen reader.

## Acceptance criteria

- [ ] An item whose label does not fit its column shows the label truncated with an ellipsis.
- [ ] That item's text stays inside the pill's border rather than overflowing past it or overlapping the
      item's overflow menu.
- [ ] Hovering a truncated item reveals the full label.
- [ ] The browser's find-in-page still matches text that the ellipsis hides.
- [ ] A screen reader announces the full label, and announces it once rather than twice.
- [ ] An item whose label already fits is unchanged — no ellipsis and no truncation.
- [ ] No item label wraps to a second line at any column width.
- [ ] `npm run lint` passes at `--max-warnings 0` over the changed CSS and HTML.

## Deviations

## Critique findings
