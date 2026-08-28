---
depends_on:
  - devpath/edit-mode-gate/slices/03-gate-the-section-header-controls.md
touches:
  - force-app/main/default/lwc/navigatorSection/navigatorSection.html
  - force-app/main/default/lwc/navigatorItem/navigatorItem.js
  - force-app/main/default/lwc/navigatorItem/navigatorItem.html
  - force-app/main/default/lwc/navigatorItem/__tests__/navigatorItem.test.js
---

# Out of edit mode an item is a link and nothing else

> Watch a new test go red before you make it green.
> _Why: a test written before the code cannot be written to hit a coverage number — there is nothing to
> cover yet. Retires when Apex gets mutation testing._

## What to build

Out of edit mode a navigation item shows only its label and icon as a working link; the per-item overflow
menu — rename, remove, move to another section — appears only once the user enters edit mode.

## Acceptance criteria

- [ ] Out of edit mode an item renders no overflow menu, so renaming it, removing it and moving it to another section are all unreachable.
- [ ] In edit mode the menu is present and its entries behave exactly as they do today, including "Move to…" appearing only when there is somewhere to move to.
- [ ] The menu is absent from the DOM rather than hidden by CSS.
- [ ] The item's link still renders, is still clickable and still navigates to the right place out of edit mode.
- [ ] An item takes the mode as an `@api editing` property passed down by its section, and renders correctly for both values of it when mounted on its own.

## Deviations

## Critique findings
