---
depends_on:
  - dev-path/personal-navigator-layouts/slices/03-sections-and-columns.md
touches:
---

# Put the items in the order you want them

> Watch a new test go red before you make it green.
> _Why: a test written before the code cannot be written to hit a coverage number — there is nothing to
> cover yet. Retires when Apex gets mutation testing._

## What to build

A user drags an item to a new position inside its section — or does the same thing from the keyboard —
and reorders whole sections the same way.

## Acceptance criteria

- [ ] A user drags an item to a new position within its section and it stays there after a page reload
      and a fresh login.
- [ ] A user reorders the sections themselves by dragging a section card, and that order also survives.
- [ ] A keyboard-only user can do both: Space to grab, arrow keys to move, Space to drop, Escape to
      cancel and leave the item where it started.
- [ ] A screen reader announces the grab, each move, the drop and the cancel, including the item's new
      position in the list.
- [ ] The instruction text is associated with the item only while it is grabbed, not permanently.
- [ ] Tab does not move focus out of a grabbed item mid-drag.
- [ ] `aria-grabbed` and `aria-dropeffect` do not appear anywhere — both are deprecated.
- [ ] The placement maths lives in a plain module with no component in it, unit-tested directly, and both
      the mouse path and the keyboard path call the same function.
- [ ] Dragging still works when the item's clickable link is the drag source — a drag does not navigate,
      and a click still does.

## Deviations

## Critique findings
