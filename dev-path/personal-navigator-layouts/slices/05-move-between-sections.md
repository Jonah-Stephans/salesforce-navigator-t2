---
depends_on:
  - dev-path/personal-navigator-layouts/slices/04-reorder-within-a-section.md
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

# Move an item into a different section

> Watch a new test go red before you make it green.
> _Why: a test written before the code cannot be written to hit a coverage number — there is nothing to
> cover yet. Retires when Apex gets mutation testing._

## What to build

A user moves an item out of one section and into another, by dragging it or by picking the destination
from a menu on the item.

## Acceptance criteria

- [ ] A user drags an item from one section into another, drops it at a chosen position, and both
      sections show the right contents after a page reload and a fresh login.
- [x] met — Each item offers a "Move to…" menu listing the other sections; choosing one moves the item there.
- [ ] A keyboard-only user can complete a cross-section move using that menu — arrow keys are not
      required to cross a section boundary, and are not expected to.
- [x] met — The move is announced to a screen reader, naming the destination section.
- [ ] The section an item is dragged over is visually distinguishable as the drop target while the drag is
      in progress.
- [x] met — The cross-section move uses the same placement function as the within-section reorder from slice 04
      rather than a second implementation.
- [x] met — Dropping an item back into the section it came from leaves the layout unchanged.

## Deviations

None of the *what* changed. Everything was built and deployed. Three criteria are left unticked, each
because it contains a half jsdom cannot reach and only that half; this section says exactly what was
established for each and what remains. This is the same discipline slice 04 used, and for the same
reason: jsdom 20.0.3 defines no `DragEvent`, no `DataTransfer` and no `PointerEvent`,
`getBoundingClientRect()` returns zeros and `elementFromPoint` throws, so the drag gesture cannot be
simulated at all.

### The three unticked criteria, and why

**Criterion 1 — dragging an item from one section into another, at a chosen position, surviving a
reload.** The browser's own `dragstart → dragover → drop` sequence cannot be simulated, and no test
here claims to. **What is verified:** an item drag that begins in one section and ends on another
section's item moves the item into that section *at the position it landed on*
(`drops the item at the position it was dropped at, not at the end`); ending on the card rather than
on an item appends instead (`puts the item at the end when it is dropped on the card rather than on
an item`); the source index is kept in JS on the parent rather than read back out of `dataTransfer`,
which returns `""` during `dragover` by the HTML spec's protected mode; and both sections' contents
are asserted per section rather than flattened, because *which section the item ended up in* is the
entire question. **What remains unverifiable here:** that a real browser fires those events on this
markup at all. That needs a browser driver against a real org, which the spec's *Test entry points*
places outside it. Note that the reload half *is* closed on the menu route —
`still shows a menu-moved item in its new section after a reload` mounts a second Navigator on the
payload that was actually written and asserts what that second Navigator renders — and both routes
end at the same `moveItemBetweenSections` and the same serialiser.

**Criterion 3 — a keyboard-only user completing a cross-section move using the menu.** Two halves,
and they are in different positions. **Verified:** the second clause outright — arrow keys are not
required to cross a boundary and do not, pinned by
`never asks to cross a section boundary with an arrow key`, which presses all four arrows on a
grabbed item and asserts four `itemkeymove`s and zero `itemmoveto`s. Also verified: the menu lists
every other section and never the item's own, choosing an entry moves the item there, the move is
written, and a remount on that payload renders it — all driven through the menu's own `select`
event, which is the same event whether it was clicked or keyed. **What remains unverifiable here:**
that `lightning-button-menu` opens on Enter and walks its entries on the arrow keys. sfdx-lwc-jest
stubs base components, so their key handling is not present in this environment at all — the same
class of gap as the drag gesture, and outside this component either way. What *is* pinned in its
place is the choice the criterion rests on: `puts the cross-section route in a base menu component
rather than a hand-rolled one` asserts the route is a real `lightning-button-menu` and not a div with
a click handler, and replacing it with a div fails 8 tests.

**Criterion 5 — the section being dragged over is visually distinguishable as the drop target.**
**What is verified:** the class is computed from two facts and only appears when both hold — an item
drag is in flight *and* the pointer is inside this card (`looks like a drop target while an item is
dragged over it, and only then`, walking the state in both directions); it goes away on drop
(`stops looking like a drop target once the drop has happened`); the parent tells the sections an
item drag is in flight and clears it on `dragend`, and does *not* set it for a section-card drag, so
dragging a whole card over a section does not light it up as an item drop target; and the class means
something, because jsdom applies no CSS —
`gives the drop target a real appearance that works in both colour modes` reads the stylesheet that
ships and pins that the `_droptarget` rule exists, takes its indication from `--slds-g-*` semantic
hooks, and carries no `prefers-color-scheme`, `--slds-c-*` or `--lwc-*`. **What remains unverifiable
here:** that a real browser fires `dragenter`/`dragleave` on this markup during a drag, and that the
rule renders as intended in either colour mode. Both are browser-driver questions.

### Why criterion 7 *is* ticked even though it names a drop

Criterion 7 is a negative — dropping an item back into the section it came from leaves the layout
unchanged — and a negative is not exposed by the gesture ceiling the way criteria 1 and 5 are: if the
browser never fired the drop, the layout would also be unchanged. So the unreachable half cannot
falsify it. What is pinned is the guard itself, at both levels and independently: the parent refuses
the move and, the part that matters, schedules no save
(`writes nothing when an item is dropped back into the section it came from` asserts on the *write*,
because the order is identical either way and a missing guard would otherwise be invisible), and
`moveItemBetweenSections` refuses it structurally so no caller has to remember to. The menu route
cannot reach the case at all, because a section is never listed on its own items' menus.

### Decisions taken during the build

- **The cross-section move is `reorder`, not a second copy of it.** The moved item is appended to a
  copy of the destination's list and then `reorder`ed from that last slot to where it is wanted. So
  the two axes are one function applied to one kind of list, `reorder`'s clamp applies here for free
  — a destination past either end lands at that end, exactly as within a section — and the removal
  from the source is a `filter`, not a splice. Verified by reading as well as by test, per the
  brief: a repo-wide grep finds **exactly one `splice` pair in all of `force-app`**, inside `reorder`,
  and `moveItemBetweenSections` is one of its three call sites.
- **The Move to… menu names a section, not a slot, so the item goes to the end of it.** A menu that
  offered "Support, position 2 of 5" would be a worse gesture than the drag it exists to replace.
  The drag path, which *does* name a position, passes one; the menu passes none.
- **A drop that lands on one of the destination's items carries that item's index upward; a drop on
  the card does not.** That is the whole difference between "put it here" and "put it in there", and
  it is why `sectiondrop` grew an optional `itemIndex` rather than a second event.
- **The drop-target highlight needs a fact from the parent and a fact from the section, and neither
  can supply the other's.** Only the parent knows an *item* drag is in flight rather than a section
  drag — it is the only component that sees both — and only the section knows the pointer is over it.
  So `itemDragActive` comes down as an `@api` and `dragDepth` stays local.
- **`dragDepth` is a counter, not a boolean.** `dragleave` fires on the element being left before
  `dragenter` fires on the one being entered, and an item covers most of a card's surface, so a
  boolean would flicker off every time the pointer crossed from the card onto one of its own items.
  Counting the pairs makes "the pointer is somewhere inside this card" one fact rather than a race.
  jsdom cannot show the flicker, which is exactly why it is worth writing down.
- **`sectionAnnouncement` / `announceSection` were renamed to `announcement` / `announce`.** The
  Navigator's live region now carries two kinds of announcement — the section axis and the
  cross-section item move — and the old names said it carried one. Both belong there rather than in a
  section for the same reason: a section reorder rebuilds every card and a cross-section move
  destroys the item component in the section it left, so an announcement made from either place would
  be destroyed as it was made. Announcements about an item's position *within* one section stay in
  that section, where nothing is rebuilt. No test referenced either name.
- **One slice 04 test was replaced rather than kept.** `leaves an item dragged into another section
  alone — that is a later slice` asserted the deliberate non-behaviour this slice removes. Its
  replacement, `moves a dragged item into the section it was dropped on, not the card it was dropped
  on`, drives the same gesture and asserts the positive — including that no card the user never
  picked up moved. Nothing else in the 217 was touched; the suite is 257.
- **The deploy reported a conflict on all four bundles and was run with `--ignore-conflicts`.** Before
  overriding, the org's own copies were retrieved to a scratchpad directory with
  `--target-metadata-dir ... --unzip` — the form that cannot touch the working tree — and all 14
  files diffed against `git show HEAD:<path>`. **Every one is byte-identical apart from the trailing
  newline the platform strips on retrieve**, the same source-tracking signature the previous three
  slices recorded, and no org-side edit.

### Progress log

- `moveItemBetweenSections` added to `navigatorLayoutModel`. **The placement is `reorder`** — the
  moved item is appended to a copy of the destination's list and then `reorder`ed from that last slot
  to where it is wanted, so the cross-section move and the within-section reorder are one function
  applied to one kind of list, and `reorder`'s clamp applies for free. There is still exactly one
  `splice` pair in all of `force-app`; the removal from the source is a `filter`. 16 tests written
  first and watched fail with `moveItemBetweenSections is not a function`.
- `navigatorItem`: the Move to… menu. 4 tests watched red first (3 on a real assertion, 1 vacuous
  until the menu existed).
- `navigatorSection`: `moveTargets` passed through, `itemmoveto` forwarded with the section it is
  leaving, the drop position carried on a forwarded foreign drop, and the drop-target affordance.
  6 tests watched red first — two of those first failed on a missing test helper rather than on the
  behaviour, so the shipped `isDropTarget` was independently replaced with `false` and both were
  confirmed to fail on their own assertions before being restored.
- `salesforceNavigator`: the `moveTargets` computation, the single cross-section call site, the
  same-section guard, the announcement, and `isItemDragActive`. 9 tests watched red first.
- 216 of the 217 pre-existing jest tests are untouched and still pass; the 217th was replaced (see
  the decision above). The suite is **257 across 5 suites**.

### The mutation table

Each mutation was applied to shipped code, the whole suite run, then reverted. The suite is 255 (257
after the last two tests were added) and green either side of every row.

| # | Mutation | Suite noticed |
| --- | --- | --- |
| 1 | Cross-section move uses a second placement function (hand-inlined splice, skipping `reorder`'s clamp) | 1 failed |
| 2 | Same-section guard dropped in the parent, so the drop writes | 1 failed |
| 2b | Same-section guard dropped in the model as well | 1 failed |
| 3 | Announcement omits the destination section | 1 failed |
| 4 | Move-to menu lists the item's own section | 2 failed |
| 5 | Drop-target highlight never applies (`isDropTarget` returns `false`) | 2 failed |
| 6 | The move drops the item's `rename` | 3 failed |
| 7 | `dragItemIndex` never recorded | 3 failed |
| 8 | Forwarded foreign drop carries no position, so a cross-section drag can only append | 3 failed |
| 9 | `isItemDragActive` always true, so a section drag lights up drop targets | 2 failed |
| 10 | `menuLabel` is a constant, so every item's menu is announced identically | 1 failed |
| 11 | `hasMoveTargets` always true, so a one-section layout shows menus onto nothing | 2 failed |
| 12 | `moveItemBetweenSections` drops `copySection` and returns shared references | 5 failed |
| 13 | Section forwards `fromSection: 0` instead of its own index | **survived at first — see below** |
| 14 | Menu move lands at position 0 instead of the end of the destination | 4 failed |
| 15 | Announcement names the source section rather than the destination | 1 failed |
| 16 | `dragDepth` never reset on drop, so the card stays lit after the drop | 1 failed |
| 17 | Arrow keys stop producing `itemkeymove` | 14 failed |
| 18 | The menu replaced by a `div` with the same handler | 8 failed |

**Row 13 is the one worth reading, and it is the same shape of blind spot slice 04 found in row 10.**
Replacing `navigatorSection`'s `fromSection: this.sectionIndex` with the constant `0` left the suite
fully green. Every fixture that drove the Move to… menu had the item in section 0, so "its own index"
and "zero" were the same string everywhere, and a card that reported a constant was indistinguishable
from one that reported itself. Two tests were added rather than one, because the gap existed at both
levels: `forwards a chosen destination upward with its own section index` was rewritten to use a
section built at **index 1**, and `moves an item out of the second section as readily as out of the
first` drives the whole parent chain from section 1 into section 0. The mutation is now caught
(**2 failed**). The general lesson, which is worth carrying: a single-section or first-section
fixture cannot tell "reports itself" from "reports a constant", on any axis.

Rows 17 and 18 are the two written to check that criterion 3's own new assertions discriminate,
rather than being documentary.

## Critique findings
