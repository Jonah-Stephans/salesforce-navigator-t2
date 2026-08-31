---
depends_on:
  - devpath/edit-mode-gate/slices/03-gate-the-section-header-controls.md
done: true
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

- [x] met Out of edit mode an item renders no overflow menu, so renaming it, removing it and moving it to another section are all unreachable.
- [x] met In edit mode the menu is present and its entries behave exactly as they do today, including "Move to…" appearing only when there is somewhere to move to.
- [x] met The menu is absent from the DOM rather than hidden by CSS.
- [x] met The item's link still renders, is still clickable and still navigates to the right place out of edit mode.
- [x] met An item takes the mode as an `@api editing` property passed down by its section, and renders correctly for both values of it when mounted on its own.

## Deviations
- [ ] excess — force-app/main/default/lwc/navigatorSection/navigatorSection.js, +48 -3 against `main` as this branch found it; committed by `git add -A` and outside this slice's `touches`. Almost all of that figure is slice 03, which owns this file; this slice's own share is one doc comment recording that the section passes `editing` through to each item.
- [ ] excess — force-app/main/default/lwc/salesforceNavigator/__tests__/salesforceNavigator.test.js, +1704 -188 against `main` as this branch found it; committed by `git add -A` and outside this slice's `touches`. Cumulative across slices 01, 03 and 04 — nine prior commits have rewritten this suite. This slice's own share is the fourteen save-chain tests re-vehicled onto a direct `itemrename` dispatch, plus explicit `enterEditMode` calls added to 26 tests across two behavioural describes that drove the item menu without it.

- The fourteen `renameFirstItem`/`burstItemRename`-driven tests in `salesforceNavigator.test.js` (their real subject is the save chain — debounce, leading-edge capture, coalescing, create/update id handling, layout-switch races) keep their vehicle but change how it fires: `renameFirstItem` now dispatches the `itemrename` `CustomEvent` directly on the `c-navigator-item` element instead of opening its (now edit-mode-only) menu and typing into the revealed input. This works unchanged in every fixture the fourteen use, including the two `canEdit`-false ones, because it never touches the item's own rendered UI — only the event the section's and the page's listeners already respond to regardless of what produced it — and it keeps every one of the fourteen running *out* of edit mode, which is the only state `scheduleSave` arms in at all. Verified by mutation: deleting `scheduleSave`'s `hasLayoutLoadError` early return reddened both `canEdit`-false tests with the new helper in place.
- Gating the item's menu broke far more than the fourteen: two whole behavioural describes in `salesforceNavigator.test.js` — "moving an item into another section" (11 of its 18 tests, the ones driven through the item's own Move to… menu rather than drag) and "renaming an item" (12 of its 15 tests) — plus 3 tests in "removing an item and adding it back", all drove the item's menu directly and had no `enterEditMode` call. Fixed by adding `await enterEditMode(element);` at each affected call site (or, for "renaming an item", baking it into that describe's own local `navigatorOn` mount helper, since every test in that describe needs the menu at some point and none of them cares about being out of edit mode). Left the "moving" describe's shared `navigatorWithTwoSections`/`navigatorWithAWithdrawnTab` helpers alone rather than baking `enterEditMode` into them, because they are also the mount helpers for that describe's drag tests, which must stay out of edit mode (drag surfaces are slice 05's).
- Everywhere one of the above tests also asserted a persisted payload (`updateLayout`/`createLayout` calls, `savedIds`/`savedItems`/`lastSavedLayout`, or a remount on a written payload), `settleAutosave()` was replaced with `saveEdits(element)` — autosave is suppressed by `scheduleSave`'s `isEditing` guard, so the debounce cannot write in edit mode; an explicit Save is the only route left to persist a real change made there. One exception: "creates no layout row when an empty box is committed on an item with no rename" in "renaming an item" was *not* moved into edit mode like its neighbours, and was rewritten to dispatch `itemrename` directly (the same technique as `renameFirstItem`) and to keep asserting via `settleAutosave()` out of edit mode. The guard it pins (`handleItemRename`'s payload-equality check, `salesforceNavigator.js:1425`) leaves the serialised layout byte-identical for a no-op, so `handleEditSave`'s own `hasUnsavedCanvasChanges` check would report "nothing to write" whether or not that guard exists — pressing Save there would have been exactly the vacuous-pass shape trap 273 warns about, proven by mutation (see below).

## Critique findings
