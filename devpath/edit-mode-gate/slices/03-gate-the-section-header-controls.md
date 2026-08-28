---
depends_on:
  - devpath/edit-mode-gate/slices/01-enter-and-leave-edit-mode.md
touches:
  - force-app/main/default/lwc/salesforceNavigator/salesforceNavigator.html
  - force-app/main/default/lwc/navigatorSection/navigatorSection.js
  - force-app/main/default/lwc/navigatorSection/navigatorSection.html
  - force-app/main/default/lwc/navigatorSection/__tests__/navigatorSection.test.js
---

# Out of edit mode a section is a heading and its items

> Watch a new test go red before you make it green.
> _Why: a test written before the code cannot be written to hit a coverage number — there is nothing to
> cover yet. Retires when Apex gets mutation testing._

## What to build

Out of edit mode a section shows its name and its links and nothing else; the "Add items" button and the
section's overflow menu — rename, column count, delete — appear only once the user enters edit mode.

## Acceptance criteria

- [ ] Out of edit mode a section renders no "Add items" button.
- [ ] Out of edit mode a section renders no overflow menu, so renaming it, changing its column count and deleting it are all unreachable.
- [ ] In edit mode all of those are present and behave exactly as they do today, including the 1-6 column-count entries.
- [ ] The controls are absent from the DOM rather than hidden by CSS, so neither the tab order nor a screen reader can reach them out of edit mode.
- [ ] A section takes the mode as an `@api editing` property set by the Navigator, and renders correctly for both values of it when mounted on its own.

## Deviations

## Critique findings
