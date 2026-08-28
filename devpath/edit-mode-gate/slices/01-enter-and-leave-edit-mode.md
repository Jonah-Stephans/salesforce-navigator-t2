---
depends_on:
touches:
  - force-app/main/default/lwc/salesforceNavigator/salesforceNavigator.js
  - force-app/main/default/lwc/salesforceNavigator/salesforceNavigator.html
  - force-app/main/default/lwc/salesforceNavigator/__tests__/salesforceNavigator.test.js
---

# Enter and leave edit mode, and nothing is written until Save

> Watch a new test go red before you make it green.
> _Why: a test written before the code cannot be written to hit a coverage number — there is nothing to
> cover yet. Retires when Apex gets mutation testing._

## What to build

A user sees a small edit affordance in the top right of the Navigator; clicking it enters edit mode, where
the page-level customisation controls appear and every change to the canvas is held unwritten until the
user presses Save, or thrown away when they press Cancel.

## Acceptance criteria

- [ ] Out of edit mode the Navigator's action row holds exactly two controls: the layout switcher and the edit affordance.
- [ ] The layout switcher lists the user's saved layouts and switches between them out of edit mode, because choosing a layout is navigation.
- [ ] The switcher's "New layout…", "Rename layout…" and "Delete layout…" entries are absent out of edit mode and present in it.
- [ ] "New section" is absent out of edit mode and present in it.
- [ ] Clicking the edit affordance replaces it with Cancel and Save; leaving edit mode restores the affordance.
- [ ] A canvas change made in edit mode is still unwritten after the autosave interval has elapsed — the debounce does not fire while editing.
- [ ] Save writes the layout, leaves edit mode, and the change is still there after a page reload.
- [ ] Cancel restores the canvas to exactly what it was when edit mode was entered, and writes nothing.
- [ ] A user who closes the tab or navigates away mid-edit loses the unsaved canvas change rather than having it flushed.
- [ ] Creating, renaming or deleting a saved layout inside an edit session commits immediately and is still there after a later Cancel.
- [ ] Entering edit mode and leaving it each produce a live-region announcement.
- [ ] Entering edit mode moves focus to the first revealed control in the action row; leaving returns focus to the edit affordance.
- [ ] The edit affordance does not render when the stored layout failed to load, so there is no way into a mode that could not save.

## Deviations

## Critique findings
