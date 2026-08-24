---
depends_on:
  - dev-path/personal-navigator-layouts/slices/03-sections-and-columns.md
touches:
  - force-app/main/default/lwc/navigatorLayoutModel/navigatorLayoutModel.js
  - force-app/main/default/lwc/navigatorLayoutModel/__tests__/navigatorLayoutModel.test.js
  - force-app/main/default/lwc/navigatorItem/navigatorItem.js
  - force-app/main/default/lwc/navigatorItem/navigatorItem.html
  - force-app/main/default/lwc/navigatorItem/navigatorItem.css
  - force-app/main/default/lwc/navigatorItem/__tests__/navigatorItem.test.js
  - force-app/main/default/lwc/navigatorSection/navigatorSection.js
  - force-app/main/default/lwc/navigatorSection/navigatorSection.html
  - force-app/main/default/lwc/navigatorSection/navigatorSection.css
  - force-app/main/default/lwc/navigatorSection/__tests__/navigatorSection.test.js
  - force-app/main/default/lwc/salesforceNavigator/salesforceNavigator.js
  - force-app/main/default/lwc/salesforceNavigator/salesforceNavigator.html
  - force-app/main/default/lwc/salesforceNavigator/__tests__/salesforceNavigator.test.js
done: true
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
- [x] met — A keyboard-only user can do both: Space to grab, arrow keys to move, Space to drop, Escape to
      cancel and leave the item where it started.
- [x] met — A screen reader announces the grab, each move, the drop and the cancel, including the item's new
      position in the list.
- [x] met — The instruction text is associated with the item only while it is grabbed, not permanently.
- [x] met — Tab does not move focus out of a grabbed item mid-drag.
- [x] met — `aria-grabbed` and `aria-dropeffect` do not appear anywhere — both are deprecated.
- [x] met — The placement maths lives in a plain module with no component in it, unit-tested directly, and both
      the mouse path and the keyboard path call the same function.
- [ ] Dragging still works when the item's clickable link is the drag source — a drag does not navigate,
      and a click still does.

## Deviations

None of the *what* changed. Three criteria are left unticked, and this section says exactly what was
established for each and what remains beyond jsdom's reach. Everything was built; nothing was
skipped.

### The three unticked criteria, and why

Each of the three contains a half that jsdom cannot reach, and only that half. The build is complete
and deployed; what is missing is the evidence, not the code.

**Criterion 1 — dragging an item within a section, surviving a reload.** jsdom 20.0.3 defines no
`DragEvent`, no `DataTransfer` and no `PointerEvent`; `getBoundingClientRect()` returns zeros and
`elementFromPoint` throws. The browser's own `dragstart → dragover → drop` sequence therefore cannot
be simulated at all, and no test here claims to. **What is verified:** the anchor reflects
`draggable === true`; a hand-rolled `CustomEvent('dragstart')` with a `dataTransfer` attached via
`defineProperty` fires the declarative binding; the section keeps the source index in JS rather than
reading `dataTransfer` back (which returns `""` during `dragover` in every browser); the resulting
payload is written; and a **second Navigator mounted on the payload that was actually written**
renders the new order — which is what a reload is, since nothing else survives. **What remains
unverifiable here:** that a real browser fires those events on this markup at all. That needs a
browser driver against a real org, which the spec's *Test entry points* places outside it.

**Criterion 2 — reordering the sections by dragging a section card.** Identical position. The card
carries `draggable="true"`, the handlers move the right card, the payload is written, and a remount
on that payload shows the new order. The gesture itself is unverifiable for the same reason.

**Criterion 9 — the clickable link as the drag source.** Two halves. **Verified:** the anchor is the
drag source (`draggable` on the anchor itself, not on a handle beside it); `dragstart` does not
navigate and does not `preventDefault()` — which would cancel the drag outright; a plain click after
a completed drag still navigates with the stored `pageReference` unmodified; and a click or Enter
while an item is grabbed from the keyboard does not navigate. **Unverifiable here:** that the browser
suppresses `click` after a drag. That is the HTML specification's behaviour rather than this
component's, and jsdom implements neither the drag nor the suppression.

The six ticked criteria are verified end to end in jsdom, including the whole keyboard path driven
by real `KeyboardEvent`s from the anchor through to the written payload — so *"it stays there after a
reload"* is proven outright for the keyboard route on both axes. Only the mouse gesture is unproven.

### Decisions taken during the build

- **The deploy reported a conflict on all four bundles and was run with `--ignore-conflicts`.** Before
  overriding, the org's own copies of the four bundles were retrieved to a temporary directory and
  diffed against `git HEAD`: the only difference on any file was a stripped trailing newline, which
  the platform does on retrieve. The org content was identical to the last commit, so the conflict was
  source-tracking noise from slice 03's deploy and nothing in the org was lost.
- **Section-reorder state lives in `salesforceNavigator`, not in `navigatorSection`.** A section
  reorder changes every section's index and therefore its `key`, so LWC rebuilds the cards on each
  arrow press. State held in a card would not survive the first keystroke, and neither would the
  announcement or the focus. Item-reorder state does live in `navigatorSection`, because reordering
  within a section changes no card's identity.
- **Each arrow press is applied to the layout as it happens, so Escape is a real move back to the
  origin** rather than the discarding of an uncommitted preview. The autosave's one-second debounce
  coalesces a grab-move-move-Escape burst into a single write of the original order. `reorder` is its
  own inverse, which is what makes this exact; there is a test pinning that.
- **A drop landing on an item when no item drag is in flight is forwarded upward as a section drop.**
  An item covers most of a card's surface, so without this a section dragged onto another card would
  land on nothing. The parent, the only component that sees both kinds of drag, decides what it means.
- **An item dragged into a *different* section is deliberately ignored.** Cross-section movement is
  slice 05 and uses a different pattern (a Move-to menu, not arrow keys). A test pins that attempting
  it changes nothing rather than corrupting either section.

### Progress log

- `reorder`, `moveItemWithinSection` and `moveSection` added to `navigatorLayoutModel` — 20 tests
  written first, watched fail with `is not a function`, then made green. Purity assertions match the
  two the section operations already carry.
- `navigatorItem`: drag source and keyboard drag source. 16 tests watched red first.
- `navigatorSection`: item reordering by mouse and keyboard, its own live region, and the card as a
  draggable/focusable thing in its own right. 13 tests watched red first.
- `salesforceNavigator`: both placement call sites, section-drag state, section keyboard drag, the
  section live region and focus restoration. 9 tests watched red first.
- 102 pre-existing jest tests still pass; the suite is 193.

### The mutation table

Each mutation was applied to shipped code, the whole suite run, then reverted.

| # | Mutation | Suite noticed |
| --- | --- | --- |
| 1 | `reorder` made a no-op | 25 failed |
| 2 | `reorder` mutates its input (`list` not `slice()`d) | 13 failed |
| 3 | Escape commits instead of cancelling — item | 2 failed |
| 3b | Escape commits instead of cancelling — section | 1 failed |
| 4 | Announcement omits the new position | 5 failed |
| 5 | Instruction node and idref attached permanently | 1 failed |
| 6 | Keyboard path uses a second placement function | 5 failed |
| 7 | Tab no longer held during a keyboard drag | 1 failed |
| 8 | `aria-grabbed` reintroduced on the anchor | 3 failed |
| 9 | Mouse drop always moves from index 0 | 7 failed |
| 10 | `moveItemWithinSection` stops delegating to `reorder` | **green at first — see below** |

**Mutation 10 is the one worth reading.** Replacing the delegation with a hand-inlined splice that
behaved identically in range left the suite fully green: a behaviourally identical copy is
undetectable by any test, and no amount of black-box testing closes that. What *is* detectable is a
copy that drifts, and the inlined version had drifted already — it skipped `reorder`'s clamp, so it
diverged the moment a destination reached past either end, which is the keyboard path's ordinary
edge. The two "agrees with reorder exactly" tests were extended to destinations `-2, -1, 0, 1, 2, 3,
9` and the mutation was then caught. **The residue, stated plainly: a duplicate that is exactly
correct forever would still pass.** That is a code-review matter, not a testable one.

## Critique findings
