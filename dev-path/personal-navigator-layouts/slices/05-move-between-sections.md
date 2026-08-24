---
depends_on:
  - dev-path/personal-navigator-layouts/slices/04-reorder-within-a-section.md
touches:
---

# Move an item into a different section

> Watch a new test go red before you make it green.
> _Why: a test written before the code cannot be written to hit a coverage number — there is nothing to
> cover yet. Retires when Apex gets mutation testing._

## What to build

A user moves an item out of one section and into another, by dragging it or by picking the destination
from a menu on the item.

## Acceptance criteria

- [ ] A user drags an item from one section into another, drops it at a chosen position, and both
      sections show the right contents after a page reload and a fresh login.
- [ ] Each item offers a "Move to…" menu listing the other sections; choosing one moves the item there.
- [ ] A keyboard-only user can complete a cross-section move using that menu — arrow keys are not
      required to cross a section boundary, and are not expected to.
- [ ] The move is announced to a screen reader, naming the destination section.
- [ ] The section an item is dragged over is visually distinguishable as the drop target while the drag is
      in progress.
- [ ] The cross-section move uses the same placement function as the within-section reorder from slice 04
      rather than a second implementation.
- [ ] Dropping an item back into the section it came from leaves the layout unchanged.

## Deviations

## Critique findings
