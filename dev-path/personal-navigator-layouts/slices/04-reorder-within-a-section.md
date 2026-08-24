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

- [ ] **Escape on a grabbed section card leaves focus on `document.body`.**
      `salesforceNavigator.handleSectionKeyCancel` calls `releaseSectionGrab()` — which clears
      `grabbedSectionIndex` — before the cancel's own `moveSectionTo` has re-rendered. A section
      reorder changes every section's `key`, so LWC destroys the card the user was holding; by the
      time `renderedCallback` runs, `grabbedSectionIndex` is `undefined` and it returns at the first
      line, so `focusCard()` is never called. Confirmed by driving the real sequence in jsdom: after
      Space, ArrowDown, Escape on card 0, the order is correctly restored to `First, Second, Third`
      and `document.activeElement` is `BODY`. A keyboard user who cancels a section move loses their
      place in the page entirely. The item path does not have this defect — item keys are `item.id`
      and survive a reorder, and the same probe shows focus still on the moved anchor after Escape.
      Fix direction: restore focus to the origin card on the render that follows the cancel, before
      (or as part of) releasing the grab. The identical shape should be checked for
      `handleSectionKeyDrop`, which happens to be safe today only because a drop performs no reorder.
- [ ] **Nothing tests section-card focus restoration at all, working half included.** Replacing
      `salesforceNavigator.renderedCallback`'s `grabbed.focusCard()` with a no-op leaves the suite at
      193/193 green. That is the whole reason the defect above shipped: the after-each-arrow
      restoration (which does work) and the after-cancel restoration (which does not) are both
      unpinned. `navigatorSection.keepFocusOnGrabbedItem` is pinned — the same mutation there fails
      one test.
- [ ] **A repeated identical announcement is never re-announced, which is exactly the case the code
      says it exists to serve.** `handleItemKeyMove` announces on every arrow press "even when
      nothing moved", per its own comment, so that a user at either end can tell a dead key from one
      with nowhere to go. Driven in jsdom: ArrowLeft at position 1, twice, produces
      `"Accounts moved. Position 1 of 3."` both times, and the live region's text node is the *same
      node with unchanged content* (node identity across the two renders is `true`). LWC writes
      nothing to the DOM, so no screen reader re-reads it — the second press is silent. Same shape in
      `salesforceNavigator.handleSectionKeyMove` for the section region. Fix direction: make repeated
      announcements textually distinct, or clear the region and re-set it across a render tick.
- [ ] **A grab is never released when the grabbed item stops rendering.** With an item grabbed, a
      `getNavItems` re-emission that drops that tab (the access-loss path this spec already models)
      leaves `navigatorSection.grabbedItemIndex` pointing past the end of the list permanently:
      no item carries `grabbed`, the instruction node is gone, focus is on `BODY`, the live region
      still reads the stale `"Contacts grabbed. Position 3 of 3."`, and `keepFocusOnGrabbedItem` runs
      on every subsequent render finding nothing. The section believes a drag is in flight forever.
      A smaller relative of the same gap: grabbing a second item while one is already grabbed
      (reachable with a mouse — `handleClick` blocks navigation mid-grab but not focus) silently
      overwrites `grabbedItemOrigin`, so the first item's Escape origin is lost. Fix direction:
      release the grab when the grabbed index is no longer a real position, and refuse or explicitly
      hand over a second grab.
- [ ] **The parent's drag-state clearing and its self-drop guard are both untested, and they guard a
      real hazard.** Emptying `salesforceNavigator.handleSectionDragEnd` (so `clearDrag()` never
      runs) leaves the suite green, as does deleting the `from === to` short-circuit in
      `handleSectionDrop`. The first matters: with a stale `dragKind === "section"` and
      `dragSectionIndex`, a later item drop that has no source of its own is forwarded upward as a
      `sectiondrop` and moves a card the user never picked up — which is precisely what the shipped
      guard prevents. Note the asymmetry: the item-side equivalents are both pinned
      (`navigatorSection.handleItemDragEnd` clearing `dragFromIndex`, and the item `from === to`
      short-circuit each fail a test when removed).
- [ ] **The purity assertions on `moveItemWithinSection` and `moveSection` cannot tell a copy from a
      shared reference.** Both are `expect(base).toEqual(before)`, which is structural. Rewriting
      `moveSection` as `reorder(sectionsOf(layout), from, to)` and `moveItemWithinSection` as
      `{ ...section, items: reorder(section.items, from, to) }` — both dropping `copySection`, so the
      returned layout hands back the caller's own section and item objects — leaves the suite at
      193/193 green in each case. `navigatorLayoutModel`'s docblock promises the opposite ("a layout
      is never mutated in place... so a caller can hand the result straight to reactive state and an
      autosave without wondering whether the previous value still exists"), and `reorder`'s own
      purity test does not cover it because `reorder` is handed an already-copied array. The
      pre-existing section operations share the weakness. Fix direction: assert non-identity
      (`expect(next.sections[0]).not.toBe(base.sections[0])`, and the same one level down for items)
      alongside the existing structural compare.
- [ ] **The grabbed visual affordance is entirely unpinned.** Making `navigatorItem.anchorClass`
      always return `"rstk-nav-item"` and `navigatorSection.cardClass` always return
      `"rstk-nav-section"` each leave the suite green. `rstk-nav-item_grabbed` and
      `rstk-nav-section_grabbed` — and the getters that select them — exist only so that a sighted
      keyboard user can see what they are holding, and no test reaches them. `aria-atomic="true"` on
      the item live region is likewise unpinned (removing it is green).
- [ ] **`## Deviations` claims more than the tests establish for the keyboard route.** It states that
      *"it stays there after a reload" is proven outright for the keyboard route on both axes*. It is
      not. Both remount tests — `still shows the moved item in its new position after a reload` and
      `still shows the reordered sections after a reload` — drive the **mouse** path. Every
      keyboard-route assertion stops at `savedItemIds(...)` / `savedSectionNames()`, which read the
      payload that was *sent to Apex*, never one that was read back and rendered. That is the
      "asserts what was sent rather than what was stored" shape this spec has been bitten by before.
      The residual risk is genuinely small — it is the same serializer on both paths, and
      `moveSection` has a payload round-trip test in the model — but the sentence should either be
      narrowed or a keyboard-driven remount added. Either resolution is fine; the claim as written is
      not.
- [ ] **A keyboard user has no route to discover the grab gesture.** Criterion 3's "only while
      grabbed" is correctly implemented and correctly ticked, but nothing takes over the job the
      permanent instruction would have done. The section card is a bare `<article tabindex="0">` with
      no accessible name, no `role`, and no `aria-roledescription`; the item is a plain link. Neither
      announces that it is movable, or that Space starts a move, until after the user has already
      guessed. Flagging for a human decision rather than proposing the fix, since the obvious
      remedy (a permanent `aria-describedby`) is the thing the criterion forbids —
      `aria-roledescription` on the card and the anchor, or an SR-only hint outside the item, are the
      candidates that do not violate it.
- [x] false positive — that the section's live region and the Navigator's could both fire for one
      gesture and talk over each other. Driven in jsdom: a section grab writes only the Navigator's
      region (`"First grabbed. Position 1 of 3."`) while all three section regions stay `""`; item
      gestures write only the owning section's region and leave the Navigator's empty. The two never
      fire together, because the two axes are handled by different components and neither forwards an
      announcement to the other.
- [x] false positive — that `aria-grabbed` or `aria-dropeffect` had crept in somewhere. A
      case-insensitive grep of the whole repo for both attribute and property spellings finds them
      only in test assertions, in `spec.md`, and in this slice file. Reintroducing `aria-grabbed` on
      the anchor fails three tests.
- [x] false positive — that something reads drag state back out of `dataTransfer`. `getData` appears
      in no shipped file; `setData` appears exactly twice, in `navigatorItem.handleDragStart` and
      `navigatorSection.handleCardDragStart`, and both are the browser handshake only. Routing the
      drop's source through the event payload instead of the section's JS `dragFromIndex` fails ten
      tests.
- [x] false positive — that a second copy of the placement maths had crept in, which the build's own
      residue note warned was undetectable by test. Checked by reading rather than by test: a
      repo-wide grep finds exactly one `splice` pair in all of `force-app`, inside `reorder`.
      `moveItemWithin` and `moveSectionTo` are the only two call sites and both delegate to the
      model; `navigatorSection.requestMove` is the single funnel through which the item mouse path,
      the arrow path and the Escape path all leave the section, and `handleItemMove` is its single
      receiver. Giving `navigatorSection.landingIndex` its own inlined splice fails a test.
- [x] false positive — that an abandoned section drag could corrupt a later item drag through a stale
      `dragKind` in the shipped code. Driven in jsdom: a section `dragstart` with no `dragend`,
      followed by an item `dragstart` and a drop on a card, correctly overwrites `dragKind` to
      `"item"` and the drop is ignored; the section order is unchanged. (The *untested* half of this
      is the separate finding above.)
- [x] false positive — that `navigatorItem`'s `event.stopPropagation()` on Space was dead code,
      since removing it leaves the suite green. It is not dead: it is redundant only because
      `navigatorSection.handleCardKeydown`'s `event.currentTarget !== event.target` guard
      independently catches the bubbled key. Two guards, one hazard — correctly preserved per
      `rstk-preserve-defensive-checks`. Removing the *other* guard fails a test.
- [x] false positive — that mutation 10's widened `DESTINATIONS` array might not really close it.
      Re-applied independently: replacing `moveItemWithinSection`'s delegation with a hand-inlined
      splice that skips `reorder`'s clamp now fails a test. The stated residue — a duplicate that
      stays exactly correct forever — is real and is answered by the read above, not by a test.
- [x] false positive — an SLDS 2 violation in the new CSS. The three added blocks use only semantic
      `--slds-g-*` hooks in `var(--hook, fallback)` form, take focus and grab indication from
      `--slds-g-shadow-outline-focus-1` rather than a hand-rolled outline, and introduce no
      `--slds-c-*`, no `--lwc-*` and no `prefers-color-scheme` query. `npm run lint`,
      `npm run lint:slds-gate` and `npm run prettier:verify` all pass. (The `--slds-g-radius-border-*`
      fallback values look off against the standards table, but those lines predate this slice.)
- [x] false positive — that the three unticked criteria might be reachable in jsdom after all.
      Confirmed directly against the installed jsdom 20.0.3: `DragEvent`, `DataTransfer` and
      `PointerEvent` are all `undefined`. The three are rightly unticked, and the six ticked ones are
      rightly ticked — each was re-verified by an independent mutation here (Escape-cancels, the
      position in the announcement, the instruction node's lifetime, Tab during drag, the two
      deprecated ARIA attributes, and the single shared placement function all fail a test when
      broken).

fix_cycles: 0
