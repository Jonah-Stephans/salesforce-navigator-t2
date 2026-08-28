---
done: true
fix_cycles: 0
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

- [ ] A layout rename made inside an edit session by a user who owns no layout row writes the unsaved Tier 1 draft to the server. `renameCurrentLayout`'s no-`layoutId` branch calls `commitLayoutNow()`, which serialises `this.layout` — and in edit mode `this.layout` is `storedLayout`, which `applyLayout` has already been setting to the draft. Reproduced: enter edit mode with no stored row, press New section, then rename the layout, and the `createLayout` payload is `sections: ["All Items", "New section"]`. Press Cancel and the screen goes back to `["All Items"]` while the row keeps the section, so the cancelled change survives a reload — O10 and criterion 8's "writes nothing" both fail for that user. Two halves to fix: the commit must be addressed to the entry snapshot rather than to the current canvas, and the snapshot's `wasStored` must stop saying `false` once that write has created the row, or a later Cancel sets `storedLayout` back to `undefined` on a user who now owns one.
- [ ] `handleEditSave` announces "Changes saved. Edit mode off." even when `hasUnsavedCanvasChanges` is false and nothing was written. The guard that correctly stops the write does not reach the sentence, so the one channel a screen-reader user has reports a save that did not happen. Minor, but it is O12's channel and the Cancel wording was deliberately made a fact about the write rather than about the changes.
- [ ] Creating a new layout, or deleting one, inside an edit session discards the unsaved Tier 1 draft without asking, and `resnapshotEdit()` then puts it beyond Cancel's reach. `createNewLayout` writes `buildSeededLayout(this.items)` rather than the draft, so nothing leaks — the draft is simply gone. The design's discard confirmation names two call sites, Cancel and layout-switch, and slice 02's criteria inherit that pair; these two are a third and fourth. Likely slice 02's ground rather than a rebuild of this one, but a fresh builder there needs to know the pair is not the whole set.
- [ ] `handleLayoutMenuSelect` accepts `new-layout`, `rename-layout` and `delete-layout` whatever `isEditing` says, while `handleEditStart` was given a defensive re-check of `canEdit` on the reasoning that "a template gate is not a guarantee about a handler". The same reasoning applies to the Tier 2 entries and was not applied. The visible cost today is in the suite: every Tier 2 test in `describe("switching between layouts")` dispatches those select events out of edit mode, where the `lightning-menu-item`s are absent from the DOM, so they no longer prove a user can reach the act they test. Low priority — nothing is reachable that should not be — but the tests read as user paths and are not.
- [x] false positive — that the `recordFocusMoves()` spy on `HTMLElement.prototype.focus` leaks into later tests. It is installed with `jest.spyOn` and `jest.restoreAllMocks()` was added to `afterEach`, so it is restored. Checked harder: deleting that `restoreAllMocks()` line leaves all 181 tests green, because the two tests that install the spy are the last two in the file. The line is correct and currently carries no load.
- [x] false positive — that the focus assertions do not prove focus landed where the design says. Verified by mutation: deleting the `this.focusEditTransition()` call from `renderedCallback` reddens both focus tests, and repointing `EDIT_ENTRY_FOCUS_SELECTOR` at `.rstk-nav-edit-save` reddens the entry one. The assertions discriminate on element identity, not on "some focus happened".
- [x] false positive — that `resnapshotEdit()` misses a Tier 2 path that replaces `storedLayout`. The complete set of assignments is `applyLayout` (Tier 1, must not resnapshot), `restoreEditSnapshot` (Cancel), `createNewLayout` and both branches of `adoptFromStore` (all three call it), plus `adoptActiveLayout` and the `getLayouts` catch. The last two run only before `hasLoadedLayout` is true, and `canEdit` is `hasItems && !hasLayoutLoadError` where `hasItems` requires `!isLoading` requires `hasLoadedLayout` — so edit mode cannot have been entered when either runs. Mutation agrees: dropping either call reddens the create test or the delete test. The rename gap filed above is about `wasStored`, not about a canvas replacement.
- [x] false positive — that the nine adjusted existing tests were weakened. Read before and after on all ten adjusted spots. Four that drove "New section" through a bare `querySelector("lightning-button")` now enter edit mode first and keep every assertion. The two readiness tests were retargeted from `NEW_SECTION_BUTTON` absence — which is vacuous out of edit mode on any build — to the edit affordance, which is the only control whose absence still carries the claim, and both gained a positive assertion the originals did not have. The two menu-inventory tests dropped the three Tier 2 labels only, and those are re-asserted by the new `keeps New, Rename and Delete layout out of the switcher until edit mode is entered`. Nothing lost an assertion that is still true of the gated build.
- [x] false positive — that the suppression is more than one guard, or that a call site bypasses it. `scheduleSave()` has exactly one caller, `applyLayout` at line 1646, and every Tier 1 mutation reaches the store through `applyLayout`; the single `if (this.isEditing) return;` therefore covers all ten call sites, and dropping it reddens the mid-edit autosave test. `captureSaveTarget()` is shared by `scheduleSave` and `commitLayoutNow`, so the debounced and immediate writes cannot disagree about their target. `rstk-dry-enforcement.md` is satisfied.
- [x] false positive — that the builder overstated the two guards it declared unreachable. Both are genuinely dead: removing the `isEditing` branch from `disconnectedCallback`, and removing `discardPendingSave()` from `handleEditCancel`, each leave all 181 tests green. A third of the same kind that the Deviations do not name — the `!this.canEdit || this.isEditing` early return in `handleEditStart` — is dead on the same argument and also leaves the suite green. `rstk-preserve-defensive-checks.md` covers all three; none is a finding. Criterion 9 is met by `scheduleSave`'s suppression rather than by the disconnect branch, and the mutation confirms the flush-on-entry that makes the branch dead is itself live: dropping it reddens the pre-edit commit test.
