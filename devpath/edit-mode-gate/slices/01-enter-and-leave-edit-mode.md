---
done: true
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

- [x] met Out of edit mode the Navigator's action row holds exactly two controls: the layout switcher and the edit affordance.
- [x] met The layout switcher lists the user's saved layouts and switches between them out of edit mode, because choosing a layout is navigation.
- [x] met The switcher's "New layout…", "Rename layout…" and "Delete layout…" entries are absent out of edit mode and present in it.
- [x] met "New section" is absent out of edit mode and present in it.
- [x] met Clicking the edit affordance replaces it with Cancel and Save; leaving edit mode restores the affordance.
- [x] met A canvas change made in edit mode is still unwritten after the autosave interval has elapsed — the debounce does not fire while editing.
- [x] met Save writes the layout, leaves edit mode, and the change is still there after a page reload.
- [x] met Cancel restores the canvas to exactly what it was when edit mode was entered, and writes nothing.
- [x] met A user who closes the tab or navigates away mid-edit loses the unsaved canvas change rather than having it flushed.
- [x] met Creating, renaming or deleting a saved layout inside an edit session commits immediately and is still there after a later Cancel.
- [x] met Entering edit mode and leaving it each produce a live-region announcement.
- [x] met Entering edit mode moves focus to the first revealed control in the action row; leaving returns focus to the edit affordance.
- [x] met The edit affordance does not render when the stored layout failed to load, so there is no way into a mode that could not save.

## Deviations

- **Entering edit mode flushes a pending pre-edit save.** The design does not mention it. A change made
  out of edit mode arms the 1000 ms debounce, and entering the mode a moment later would leave a write
  the autosave had already promised sitting behind a Save the user has not pressed — and hand Cancel a
  change it has no business reverting. Flushing on entry makes the boundary exact: the snapshot is what
  is stored, so "restore what was on screen on entry" and "restore what the store holds" are one
  sentence. Pinned by *commits a change made before edit mode was entered, so the snapshot is what is
  stored*.
- **The no-row rename commits through a new `commitLayoutNow()` rather than through its own Apex call.**
  The design says Tier 2 "already commits through its own Apex call"; that is true of four of the five
  paths and false of one. A user who owns no layout row is renamed by the write that *creates* the row,
  which is the autosave — and the autosave writes nothing in edit mode, so criterion 10 would have been
  false for exactly that user. `commitLayoutNow()` writes the layout as it stands without waiting for a
  debounce; it shares `captureSaveTarget()` with `scheduleSave()` so the two cannot disagree about what
  a write is addressed to.
- **A Tier 2 act that replaces the canvas re-takes the entry snapshot** (`resnapshotEdit()`, called from
  `createNewLayout` and `adoptFromStore`). Not in the design. Create, delete and switch each put a
  *different* layout on screen and commit on the spot; a Cancel restoring the pre-act snapshot would
  paint the previous layout's sections onto the layout now showing and hold them as unwritten draft —
  reverting a Tier 1 change the user never made, onto a row the revert was never about.
- **Save writes nothing when nothing changed.** The comparison is the same string equality on the
  canonical payload that slice 02 needs, exposed here as `hasUnsavedCanvasChanges`. Without it, a user
  who opened the mode, changed nothing and pressed Save would have a `Navigator_Layout__c` row created
  for them — breaking the component's oldest settled rule, that a user who has only ever looked owns no
  row.
- **Two guards in this slice are unreachable by construction and no test can fail on them**, and both
  are kept deliberately rather than missed: the `isEditing` branch in `disconnectedCallback`, and
  `discardPendingSave()` in `handleEditCancel`. Nothing can arm a save timer while editing — entry
  flushes, `scheduleSave` suppresses — so both are equivalent to their absence today. Measured by
  mutation, not assumed: removing either leaves all 489 tests green. They stay because the fact they
  depend on lives in two *other* methods, and the cost of it changing is a user's unsaved draft written
  to their layout without them asking. The comment on each says so.
- **Nine existing tests were changed by the gate**, none weakened. Four drove "New section" through a
  bare `querySelector("lightning-button")` and now enter edit mode first; three asserted the layout
  menu's six entries and now assert the three Tier 3 entries that render out of edit mode, with the
  Tier 2 half asked in edit mode where it lives; two asserted the absence of "New section" as proof
  that nothing could be changed yet and now assert the absence of the edit affordance — which is the
  only assertion that can still fail there, since "New section" is absent out of edit mode on any build
  at all.

## Critique findings
