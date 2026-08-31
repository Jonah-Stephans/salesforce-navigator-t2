---
depends_on:
  - devpath/edit-mode-gate/slices/03-gate-the-section-header-controls.md
  - devpath/edit-mode-gate/slices/04-gate-the-item-menu.md
done: true
touches:
  - force-app/main/default/lwc/salesforceNavigator/salesforceNavigator.js
  - force-app/main/default/lwc/navigatorSection/navigatorSection.js
  - force-app/main/default/lwc/navigatorSection/navigatorSection.html
  - force-app/main/default/lwc/navigatorSection/__tests__/navigatorSection.test.js
  - force-app/main/default/lwc/navigatorItem/navigatorItem.js
  - force-app/main/default/lwc/navigatorItem/navigatorItem.html
  - force-app/main/default/lwc/navigatorItem/navigatorItem.css
  - force-app/main/default/lwc/navigatorItem/__tests__/navigatorItem.test.js
---

# Out of edit mode nothing can be dragged or grabbed

> Watch a new test go red before you make it green.
> _Why: a test written before the code cannot be written to hit a coverage number — there is nothing to
> cover yet. Retires when Apex gets mutation testing._

## What to build

Out of edit mode a user cannot rearrange the Navigator by any route — sections and items are not
draggable by pointer and cannot be grabbed from the keyboard — while clicking a link goes on working
exactly as it does today.

## Acceptance criteria

- [x] met Out of edit mode a section card and an item anchor both report `draggable="false"`.
- [x] met Out of edit mode pressing Space on a section or an item does not grab it, and no announcement is made.
- [x] met Out of edit mode a section card is not a tab stop, so a keyboard user moving through the panel stops only on links.
- [x] met In edit mode pointer dragging and the full keyboard grab-move-drop-cancel path both work exactly as they do today, announcements included.
- [x] met Clicking a link out of edit mode navigates, and a Ctrl-, Cmd- or Shift-click still reaches the browser instead of being intercepted.
- [x] met Leaving edit mode clears any keyboard grab that was in flight, so focus restoration cannot chase a card that is no longer grabbable.
- [x] met The comment in `navigatorItem.css` asserting that there is no edit mode is replaced with one recording what superseded it, not deleted.

## Deviations
- [ ] excess — force-app/main/default/lwc/salesforceNavigator/__tests__/salesforceNavigator.test.js, +1798 -174 against `main` as this branch found it; committed by `git add -A` and outside this slice's `touches`. Cumulative across slices 01, 03, 04 and 05 — twelve prior commits have rewritten this suite, and boxes on slices 03 and 04 carry the earlier figures for the same path. This slice's own share is the six composed-level drag and keyboard tests brought to the gated build, two net-zero-write rewrites, and `enterEditMode` baked into the `navigatorWithThree` and `navigatorWithSections` mount helpers.

- The trap 274 scan, run myself before writing any closing claim: a text-level scan of `salesforceNavigator.test.js` for a payload assertion (`savedIds`/`savedItems`/`lastSavedLayout`/`updateLayout.mock`/`createLayout.mock`) with no literal `enterEditMode` in the `it` body returned **18** candidates at the start of this slice, not the 4-6 the prior record implied. Read individually: 6 are the `renameFirstItem`/`burstItemRename` debounce-vehicle tests slice 04 already documented as deliberately outside edit mode (false positives — they pin the save chain, not a reachable rename route, since renaming is menu-gated as of slice 04); 7 are inside "renaming an item" and mount through that describe's own `navigatorOn` helper, which calls `enterEditMode` internally (false positives — the literal string just isn't in the `it` body); and the remaining 5 were the real, then-ungated drag/keyboard-reorder surfaces: item pointer drag (`:1574`), item keyboard reorder (`:1604` and `:2285`), section pointer drag (`:1766`), section keyboard reorder (`:1790`). That confirms the four-surface, two-per-component inventory slice 04 handed down — item and section, pointer and keyboard — with the item axis carrying two pinning tests for its keyboard route rather than one. Re-run at the end of this slice: 17 candidates, all of them the same 6 debounce-vehicle and 7 `navigatorOn`-mounted false positives plus 4 more that are now false positives for the identical helper-embedded reason (`navigatorWithThree`/`navigatorWithSections`, below, now call `enterEditMode` themselves). Zero real surfaces remain.
- `enterEditMode` was baked into the shared mount helpers `navigatorWithThree()` (item-axis "reordering" describe, 9 tests) and `navigatorWithSections()` (section-axis "the sections themselves" describe, 15 tests after this slice's addition) rather than added to each test individually, on the same reasoning as slice 04's `navigatorOn`: essentially every test in each describe drives the card or the anchor as a draggable or keyboard-grabbable thing, so the shared helper is the one place to say so, per `rstk-dry-enforcement.md`. The "moving an item into another section" describe's shared helpers (`navigatorWithTwoSections`, `navigatorWithAWithdrawnTab`) were deliberately left alone, exactly as slice 04 left them — they are also the mount helpers for that describe's pointer-drag tests, which must stay representative of the out-of-edit-mode state they exercise at the JS-handler level (see below) — and `enterEditMode` was added inline to the one keyboard test that needed it instead ("reorders the item the user picked up when an earlier one is out of reach").
- Every test moved behind edit mode that also checked a persisted payload had its `settleAutosave()` replaced with `saveEdits(element)`, for the same reason slice 04's fix pass gives: `scheduleSave`'s `isEditing` guard suppresses the debounce entirely while editing, so autosave is no longer a route to a write and Save is the only one left.
- Three tests whose net effect was a cancelled/abandoned gesture landing back on the edit session's own entry state needed more than a mechanical swap, because Save's `hasUnsavedCanvasChanges` guard means a byte-identical canvas now writes **nothing**, where the old debounce would have written the identical-content payload anyway: "puts the item back where it started when the drag is cancelled with Escape" (item axis) and "reorders the sections from the keyboard, and cancels on Escape" (section axis) each asserted `savedItemIds`/`savedSectionNames` equal to the original order; both now assert `saveEdits` calls neither `createLayout` nor `updateLayout`. "Moves no card the user never picked up after an abandoned section drag" and "writes nothing when a section card is dropped back on itself" already asserted no write, but only via `settleAutosave` — under edit mode that assertion is satisfied by `scheduleSave`'s own suppression regardless of whether the abandon/self-drop guard fired, which is the vacuous-retarget shape trap 273 names; both were changed to `saveEdits` + `not.toHaveBeenCalled()` on both Apex calls so the assertion is back to discriminating the guard it names.
- Pure pointer-drag tests (a hand-rolled `dragstart`/`dragover`/`drop` `CustomEvent` dispatched directly on the anchor or the card) are **not** gated at the JS-handler level, matching `## Design`'s explicit choice to rely on the browser refusing to start a drag on `draggable="false"` rather than adding a second, redundant guard in `handleDragStart`/`handleCardDragStart` etc. Per `lwc-jest-ceilings.md`, jsdom enforces no such thing, so these tests were already green before this slice's gating code existed and stayed green after it, whether or not they were wrapped in `enterEditMode` — wrapping them (via the shared helpers above) makes what they exercise consistent with the state the design says pointer dragging is now confined to, but the wrap itself proves nothing a jsdom test can prove; the `draggable` attribute-value assertions are what actually discriminates the pointer-drag gate, and those are new, targeted unit tests (see below), not the existing drag-forwarding tests.
- `navigatorSection.test.js`'s "reordering its items" and "reordering its items from the keyboard" describes dispatch `itemgrab`/`itemkeymove`/etc. as raw `CustomEvent`s straight onto the `c-navigator-item` host, bypassing the item's own `handleDragKeydown` entirely — they test `navigatorSection`'s handling of an event it has already received, not whether the item would produce that event out of edit mode. Left unchanged (all still pass with `editing` at its default `false`): the origin-side gating they don't exercise is pinned separately, in `navigatorItem.test.js`'s own keyboard-drag-source tests and in the two new composed-level negative tests below.
- Added two composed-level negative tests not named by the slice brief, to close the loop between the unit-level gate and the assembled component: "does not grab an item on Space out of edit mode, and writes nothing" (item axis) and "does not grab a section card on Space out of edit mode, and writes nothing" (section axis), both in `salesforceNavigator.test.js`, mounted without `enterEditMode`.
- `navigatorItem.js`'s `handleDragKeydown` returns `false` (not merely `undefined`/no-op) when not editing, matching its existing "returns whether the key was consumed" contract, so `handleKeydown`'s own fallback-Enter branch is undisturbed by the new guard.

## Critique findings
