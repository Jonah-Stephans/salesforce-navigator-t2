---
depends_on:
  - devpath/edit-mode-gate/slices/01-enter-and-leave-edit-mode.md
done: true
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

- [x] met Out of edit mode a section renders no "Add items" button.
- [x] met Out of edit mode a section renders no overflow menu, so renaming it, changing its column count and deleting it are all unreachable.
- [x] met In edit mode all of those are present and behave exactly as they do today, including the 1-6 column-count entries.
- [x] met The controls are absent from the DOM rather than hidden by CSS, so neither the tab order nor a screen reader can reach them out of edit mode.
- [x] met A section takes the mode as an `@api editing` property set by the Navigator, and renders correctly for both values of it when mounted on its own.

## Deviations
- [ ] excess — force-app/main/default/lwc/salesforceNavigator/__tests__/salesforceNavigator.test.js, +1565 -180 against `main` as this branch found it; committed by `git add -A` and outside this slice's `touches`. Most of that figure is slices 01 and 03 together — this branch has rewritten this suite across seven prior commits — and this slice's own share is the ~48 tests the section gate broke, retargeted rather than deleted.
- [ ] excess — force-app/main/default/lwc/salesforceNavigator/__tests__/salesforceNavigator.smallFormFactor.test.js, +11 -0 against `main` as this branch found it; committed by `git add -A` and outside this slice's `touches`. A local `enterEditMode` helper this suite did not have, added because gating the section header broke it too.

- The section's transient `isRenaming` state is not itself named by any acceptance criterion, but it is only ever entered through the now-gated overflow menu. Its setter for `editing` resets `isRenaming` to `false` whenever `editing` turns off, so a rename left open when edit mode ends (e.g. via the parent's Save/Cancel) cannot leave a `lightning-input` on screen with no menu left to close it. Covered by a new test ("cancels an in-progress rename when edit mode ends…") in `navigatorSection.test.js`. This is a `how` decision within the same header-control gate this slice builds, not a new control or a new criterion.
- This slice's own production code and `navigatorSection.test.js` changes were built directly, single-writer. Fixing the collateral fallout in `salesforceNavigator.test.js` and `salesforceNavigator.smallFormFactor.test.js` (48 tests broken by gating the section, most having nothing to do with this slice's five criteria — they exercised the section's overflow menu or "Add items" button as an incidental vehicle for testing unrelated save-chain/debounce/layout-switch behaviour) was delegated to a spawned fork running in parallel with this session's own direct edits to the same file. The two writers collided on `salesforceNavigator.test.js`: the fork detected a concurrent edit, stopped, and returned; both sets of edits were already interleaved on disk. Recovered by treating the file as it stood as the shared starting point, re-reading fresh before every subsequent edit, checking for and finding no duplicated helpers, and re-verifying every retargeted assertion end to end — full jest run (504/504) and lint (0 problems) after reconciliation. No further subagents were spawned after the collision; the remaining ~15 test fixes were done serially by this session alone.

## Critique findings
