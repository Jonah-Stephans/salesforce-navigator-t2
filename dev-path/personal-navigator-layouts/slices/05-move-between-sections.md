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

### What the fix pass changed about slice 04's claims

Finding 1 was not a slice 05 regression. `moveItemWithinSection` has run a *rendered* index into the
*stored* layout since slice 04, so **slice 04's within-section reorder was wrong in the same way**
whenever a section stored an id the running user could not reach: the wrong item moved, and the item
they could not see was relocated and persisted. Slice 04's own file is not edited — this is the
trace a reviewer follows instead.

What slice 04 can no longer claim as written: that its reorder moves the item the user picked. It
did not, in that one case. What it *can* claim, from this commit onward, is stronger than what it
claimed then — the fix is at the seam rather than in either mover, so **there is no exported
function in `navigatorLayoutModel` that takes a stored index at all**, and the next operation cannot
reintroduce the shape. Slice 04's `moveItemWithinSection(layout, sectionIndex, from, to)` signature
is gone; it is `(layout, tabs, sectionIndex, from, to)`, and the 22 call sites in that slice's model
tests were updated to pass the accessible tab list. Their assertions are untouched. The new
regression test on this axis lives in this slice's suite —
`reorders the item the user picked up when an earlier one is out of reach` — because this is where
the fixture that can see it was written.

The suite is **267 across 5 suites** after the fix pass: all 257 still pass, plus ten new tests —
four in `navigatorLayoutModel` and one in `salesforceNavigator` for the seam on each axis and each
route, one apiece for the double announcement and the duplicate id, and two model tests pinning that
an unreachable id keeps its stored position across a move. The settled invariants were re-checked by
reading rather than assumed: `grep -rn "splice("` over `force-app` outside `__tests__` still returns
**exactly two lines, both inside `reorder`**, and `aria-grabbed` / `aria-dropeffect` appear only in
the tests that assert their absence. The deploy reported the same three-bundle conflict the previous
slices did; all ten org-side files were retrieved to a scratchpad with
`--target-metadata-dir ... --unzip` and diffed against `git show HEAD:<path>`, and every one differs
only by the trailing newline the platform strips, so `--ignore-conflicts` was used.

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

- [x] fixed — the translation was put in `navigatorLayoutModel`, and the seam was closed by removing
      the thing that could be got wrong rather than by getting it right at each call site.
      `moveItemWithinSection` and `moveItemBetweenSections` now take `(layout, tabs, ...)` — the same
      two arguments `resolveLayout` takes, in the same order — and read every index they are given as
      a position in the *resolved* list. **There is no exported function left that takes a stored
      index**, so a caller cannot pass a resolved one into a stored-layout function by forgetting
      something: there is nothing to pass it to. Three private helpers do the work —
      `renderedPositions` (entry `n` is the stored index of the item rendered at position `n`, so the
      array *is* the translation), `storedSource` and `storedDestination` — and the clamp is applied
      on the *resolved* list before translating, because that is the list the gesture counted along:
      ArrowUp on the first item the user can see must stay at the top of what they can see, not jump
      above an entry that is not on screen. `resolveLayout` still does not leak into stored state:
      the accessible set decides only *which entry a position names*, never what is written, and an
      unreachable id is neither moved nor dropped nor renumbered. `salesforceNavigator` passes
      `this.items` alongside `this.layout` at both call sites; `itemLabelAt` already read the
      resolved list with the resolved index, so the announcement became true for free. Five
      reproductions were written first and watched fail against shipped code — the menu route
      (`expect(received).toEqual(expected)`: `[["Action Plans","Contacts"],[]]` received where
      `[["Contacts"],["Action Plans"]]` was expected — the screen did not change), the drag route
      (identically), and the within-section keyboard reorder, whose payload assertion is the
      slice 04 half. Every one of them stores `Account` in `Selling` while `getNavItems` returns only
      `standard-ActionHub` and `Contact`, which is the fixture shape the 257 had nowhere.

      The critic's finding, kept verbatim:

      **A cross-section move acts on the item's *stored* index while the user chose its *rendered*
      one, so when any earlier item in the source section is inaccessible the wrong item moves — and
      the announcement names the item that did not.** `resolveLayout` drops stored ids the running
      user cannot reach, so `navigatorSection.renderItems` is indexed over the *filtered* list, and
      that filtered index is what `itemmoveto` / `itemdrop` carry upward. `salesforceNavigator`
      then hands it to `moveItemBetweenSections(this.layout, ...)`, and `this.layout` is the
      **unfiltered stored** layout. The two indices agree only when nothing was filtered.
      Reproduced in jsdom against the shipped code: a stored `Selling` of
      `[Account, standard-ActionHub, Contact]` with `Account` absent from `getNavItems` renders as
      `["Action Plans", "Contacts"]`; choosing "Move to Support" on the *first item on screen*
      leaves the screen at `[["Action Plans","Contacts"],[]]` — visibly nothing happens — while the
      payload written is
      `Selling: [standard-ActionHub, Contact]`, `Support: [Account]`, and the live region says
      `"Action Plans moved to Support."`. So: the user's chosen item does not move, an item they
      cannot even see is relocated and persisted, and the screen reader is told something untrue.
      The relocation is not recoverable by restoring access — the spec's own promise that a
      lost-access item comes back *in its original position* is broken by an unrelated gesture.
      The identical shape is on the drag route (`drop` on the destination card moves `Account`, not
      the dragged item) and — pre-existing from slice 04 — on `moveItemWithinSection`
      (`handleItemMove` passes the same filtered index into `this.layout`), so the fix belongs at
      the seam, not in `moveItemBetweenSections`. Fix direction: carry the item's **id** upward
      alongside or instead of its index and resolve it against the stored section, or have the
      parent translate a resolved index into a stored one in one place that all three call sites
      go through. Nothing in the 257 can see this: every fixture's stored ids are all present in
      `getNavItems`, so filtered index and stored index are the same number everywhere — the same
      shape of blind spot as row 13's all-section-0 fixtures, one level down.
- [x] fixed — the grab is released on the way into `handleItemMoveTo`, which is the half of the
      critic's own fix direction that makes the distinction *knowable* rather than guessed at.
      `releaseGrabIfItemGone` is left exactly as it was: it cannot tell "withdrawn" from "moved
      away" and should not have to, so instead the section is told. A new
      `releaseGrabForDepartingItem(index)` ends the grab, silently, before the `itemmoveto` is
      dispatched — silently because the parent announces the move itself, and a second sentence
      about the same gesture is the problem being fixed. It releases only when the departing item
      *is* the grabbed one: another item leaving is not this drag's business, and dropping a grab
      the user is still holding would strand them mid-move with nothing said. By the time the
      section re-renders there is no grab for the vanish-detection to trip over, so the section's
      region is left reading what it last said and only the parent speaks.
      Watched red first:
      `expect(received).toBe(expected)` — `Expected: "Action Plans grabbed. Position 2 of 2."`,
      `Received: "Move cancelled. Action Plans is no longer available."`. The test also asserts the
      parent still says `"Action Plans moved to Support."` and that no item is left grabbed, so the
      fix cannot be mistaken for silencing both regions.

      The critic's finding, kept verbatim:

      **A cross-section move made while that item is keyboard-grabbed fires two assertive live
      regions at once, saying contradictory things.** Reachable with a mouse: `handleClick` blocks
      navigation mid-grab but not focus, and the Move to… menu button is a sibling of the anchor,
      so a grabbed item can still have its menu clicked. Driven in jsdom: Space on `Accounts` in
      `Selling`, then choosing "Support" from its menu, leaves the *section's* region reading
      `"Move cancelled. Accounts is no longer available."` (from `releaseGrabIfItemGone`, which
      cannot tell "the tab was withdrawn" from "the item moved to another section") while the
      *parent's* region reads `"Accounts moved to Support."`. Both are `aria-live="assertive"`.
      The move itself is correct and no stale grab is left behind — the defect is only the second,
      false sentence, and it is the more alarming of the two. Note this is **not** the collision
      slice 04's critic disproved: that check predates the cross-section route, and it was true then
      that the two axes never fired together. Fix direction: `releaseGrabIfItemGone` needs to
      distinguish an item that left this section by a move it was told about from one that stopped
      being accessible, or the grab needs releasing on the way into `handleItemMoveTo`.
- [x] fixed — guarded now rather than recorded, and by dropping the stale copy rather than by
      refusing the move. Refusing would make the gesture a silent no-op, which is the exact shape of
      the defect above it; dropping means the user gets what they asked for — the item in the
      destination, at the position they chose, once. `moveItemBetweenSections` filters the moved id
      out of the destination list before appending, so the surviving copy is the one that was moved
      and it carries **the user's own `rename`**, not the abandoned entry's. The resolved-to-stored
      translation is computed over the deduplicated list, so a position chosen against a list one
      entry longer simply clamps. **What the user sees:** the item arrives where they asked, the
      section shows one copy where a hand-edited payload had shown two, and the announcement
      (`"Accounts moved to Support."`) is unchanged and true. Watched red first at both levels — the
      model's `expect(received).toEqual(expected)` on the source section, and end to end
      `["Accounts","Contacts","Accounts"]` received where `["Contacts","Accounts"]` was expected,
      with the `[LWC error]: Duplicated "key" attribute value ... "14:Account" appears more than
      once` on the console exactly as reported.

      The critic's finding, kept verbatim:

      **Moving an item into a section that already holds the same tab id produces a within-section
      duplicate, an LWC duplicated-`key` error, and a duplicated entry in the written payload.**
      `moveItemBetweenSections` removes from the source by index (correct) and appends to the
      destination unconditionally, with no check that the destination already lists that id. Driven
      in jsdom from a stored layout holding `Account` in both `Selling` and `Support`: moving the
      `Selling` copy to `Support` renders `Support` as `["Accounts","Contacts","Accounts"]`, logs
      `[LWC error]: Duplicated "key" attribute value ... A key with value "14:Account" appears more
      than once`, and writes `Support: [{id: Account}, {id: Contact}, {id: Account}]`. The
      precondition — one id in two sections — is not producible by any gesture this Navigator ships
      today, so this is a latent rather than a live defect; it becomes live the moment a payload
      arrives with one (a hand-edited row, or a later slice's add-an-item picker). Recording it
      because this is the first operation in the codebase that can turn a cross-section duplicate
      into a within-section one. Fix direction: drop the moved id from the destination list before
      appending, or refuse the move when the destination already lists it.
- [x] false positive — that the append-then-`reorder` trick hides an off-by-one, or that `reorder`'s
      clamp masks one. Every destination `-2, -1, 0, 1, 2, 3, 9` from every source position lands
      exactly where `reorder` puts the appended item; position 0, the end, and an empty destination
      all behave; a destination past either end lands at that end because `appended.length` is
      `N + 1`, so the clamp's ceiling *is* the end slot rather than one short of it. Replacing the
      block with a hand-inlined `splice` that skips the clamp is caught (1 failed, on the `-1` case
      — `splice` counts a negative index from the end). Prepending instead of appending while still
      moving from `last` — the "wrong end" mutation — is caught (18 failed).
- [x] false positive — that the destination list is copied shallowly and shares the source's array,
      or that the returned layout hands back the caller's own objects. Dropping `copySection` from
      `moveItemBetweenSections` fails 5 tests, including `hands back copies, not the caller's own
      section and item objects`, which asserts non-identity per section, per `items` array and on
      the moved item, then writes a `rename` onto the returned item and checks the input is
      untouched.
- [x] false positive — that the `filter` removes from the source by index where it should remove by
      identity. It removes by index, which is the correct choice: identity by `id` would delete
      every copy when a section holds two, and identity by reference is what `copySection` has just
      broken. Mutating it to `item.id !== moved.id` survives the suite, but in the wrong direction —
      the shipped code is the safe one, and what survives is a test gap on a case the app cannot
      currently produce (recorded as the duplicate-id finding above). Skipping the removal entirely
      is caught (8 failed).
- [x] false positive — that a Move to… menu can act on a stale section index after a section is
      deleted or the sections are reordered. `moveTargets` is recomputed inside the `sections`
      getter on every render from the current resolved list, so both the entry values and their
      labels are rebuilt whenever the layout changes. Driven end to end in jsdom: delete section
      `Alpha`, then move from the new section 0 to `Gamma` — the surviving item's menu already reads
      `[["move-to-1","Gamma"]]` and the move lands correctly; then keyboard-reorder the sections
      and move again — the menu reads `[["move-to-1","Beta"]]` and the move lands correctly. No
      stale index is reachable.
- [x] false positive — that the drop-target `dragDepth` counter conceals an untested *defect*.
      Rewriting it as a boolean (`= 1` on enter, `= 0` on leave) does survive the suite, but the
      shipped counter is the correct implementation and the difference it makes — the flicker as the
      pointer crosses from the card onto one of its own items — needs a real `dragenter`/`dragleave`
      pair from a real drag, which jsdom cannot produce. The build states this outright under
      *Decisions taken during the build*. Its two siblings are not defects at all: removing
      `this.dragDepth = 0` from `handleItemDrop` and from `handleItemDragEnd` also survives, because
      in both cases the parent's `clearDrag()` has already turned `itemDragActive` off and
      `isDropTarget` is an `&&`. They are correctly-preserved redundant guards, not dead code — the
      card-drop reset is the one that is independently pinned (removing it fails 1).
- [x] false positive — that criterion 7 is dishonestly ticked because its failure mode is
      indistinguishable from "the gesture never fired". It is not: the tick does not rest on the
      layout being unchanged, it rests on **no write happening**, which is a positive signal a
      missing guard would emit. Deleting the parent's `from === to` short-circuit fails `writes
      nothing when an item is dropped back into the section it came from` with a real
      `updateLayout` call, and deleting the model's `fromSection === toSection` refusal fails its
      own model test. The slice's own argument for the tick actually undersells this. The only
      unreachable half is whether a browser fires the drop on this markup, which is the ceiling
      criteria 1 and 5 are unticked for, and it is symmetric here rather than one-sided.
- [x] false positive — that "replacing the menu with a `div` fails 8 tests" is inflated. Re-applied
      independently (`lightning-button-menu` → `div`, same class, same `onselect`, closing tag
      swapped): **8 failed, 249 passed**, exactly as reported. The caveat is worth stating even
      though it does not change the count: all eight fail for one reason — every one of them selects
      the menu by tag name — so it is one fact asserted eight times, not eight independent facts.
      That is adequate for the narrow claim the slice actually makes (the route is a base component,
      not a hand-rolled div) and is not evidence that a keyboard user can open the menu and walk it,
      which is precisely why criterion 3 is left unticked. The claim and the tick are both honest.
- [x] false positive — that criterion 3's second clause is over-claimed. `never asks to cross a
      section boundary with an arrow key` does press all four arrows on a grabbed item and does
      assert four `itemkeymove`s and zero `itemmoveto`s; disabling `ARROW_DELTAS` fails 14 tests
      including that one. (Wording note only, not a finding: what the test pins is that arrows *do
      not* cross. That they are *not required* to cross is a property of the menu, which is the
      first clause — so the two halves are not as independent as the sentence reads.)
- [x] false positive — that the shared placement claim is now false, or that a second copy of the
      maths crept in. Re-checked by reading: `grep -rn "splice("` over all of `force-app` outside
      `__tests__` returns exactly two lines, both inside `reorder`. `moveItemBetweenSections` is one
      of its three call sites and `moveItemBetween` is the parent's single cross-section call site.
- [x] false positive — an SLDS 2 violation in the new `_droptarget` rule. It uses
      `--slds-g-color-surface-container-2`, `--slds-g-sizing-border-2`,
      `--slds-g-color-border-accent-1` and `--slds-g-spacing-1`, all in `var(--hook, fallback)`
      form, all present in `@salesforce-ux/sds-metadata`'s `SLDSStylingHooks.csv`, none from the 38
      non-`light-dark()` families, and no `prefers-color-scheme`, `--slds-c-*` or `--lwc-*`. The
      `outline` is a drop-target indicator rather than focus indication, so the focus-ring rule does
      not apply to it. `npm run lint`, `npm run lint:slds-gate` and `npm run prettier:verify` are
      all clean.
- [x] false positive — that the whole 18-row mutation table might not still hold. All eighteen were
      re-applied independently to shipped code and reverted, and every failure count matches what
      the build recorded, row 13's closed survivor included (**2 failed**: the section-level test
      built at index 1 and the parent-level move out of section 1). Twelve further mutations of my
      own were applied; the survivors are accounted for above.

- [x] fixed — the grab now follows the item rather than the position, by extending the identity
      `releaseGrabIfItemGone` already tracked rather than by adding a second mechanism. That method
      is now `reseatOrReleaseGrab`: it finds `grabbedItemId` in the current list, **re-seats**
      `grabbedItemIndex` onto it when it has moved, and releases only when it is genuinely gone —
      which is the one case that is still announced. `grabbedItemOrigin` moves by the same shift,
      because Escape means "back to the slot it was picked up from" and that slot renumbers with
      everything else. It runs from an `@api set section(...)` rather than from `renderedCallback`,
      and that is the load-bearing half: the setter fires exactly when the list is replaced, whereas
      a render also happens for this component's own state changes and would compare a
      freshly-assigned index against a list that had not caught up with it — re-seating a keyboard
      move back onto the position it had just left. This covers all three of the critic's outcomes
      and the destination-section mirror with one rule, and nothing about the departing-item release
      changed: `releaseGrabForDepartingItem` still releases only the grabbed item's own departure,
      silently, so the parent stays the only voice on a cross-section move.
      Four tests written first and watched fail: `keeps a keyboard grab on the item it was placed on
      when a sibling leaves` (`expect(received).toEqual(expected)` — `Expected: ["Our Site"]`,
      `Received: ["Shield"]`), `does not report a grab cancelled when it is a sibling that left`
      (`expect(received).toBe(expected)` — `Expected: "Our Site grabbed. Position 3 of 3."`,
      `Received: "Move cancelled. Our Site is no longer available."`), `keeps a keyboard grab on its
      own item when another arrives above it` (`Expected: ["Contacts"]`, `Received: ["Accounts"]`),
      and `still returns a walked item to where it was picked up after a sibling leaves`
      (`Expected: {from: 0, sectionIndex: 0, to: 1}`, `Received: ... to: 2`), plus the end-to-end
      `keeps a grab on the item being held when a sibling is moved out from under it`
      (`Expected: ["Contacts"]`, `Received: []` — the grab dropped altogether). The critic's
      unasserted-condition note is closed: replacing `releaseGrabForDepartingItem`'s
      `grabbedItemIndex === index` with an unconditional `releaseGrab()` now **fails 3**. Dropping
      the origin shift fails 1.

      The critic's finding, kept verbatim:

      **A keyboard grab is silently transferred to a different item, or falsely cancelled, when
      *another* item leaves the same section.** This re-opens finding 2 above: that fix released the
      grab only when the departing item *is* the grabbed one ("another item leaving is not this
      drag's business"), but another item leaving renumbers the very list `grabbedItemIndex` counts
      along, and nothing re-seats it. `navigatorSection.grabbedItemIndex` is a position in the
      resolved list; `releaseGrabIfItemGone` tests the grabbed item's *identity* but only ever
      *releases* — it never corrects the index — so an earlier item departing shifts every later
      position down by one underneath a live grab. Three outcomes, all driven end to end in jsdom
      against `3baba04` and all three failing:
      (a) `Selling` = `[Account, Contact, standard-ActionHub, standard-ShieldHome]`, grab
      `Action Plans` (rendered index 2), then choose `Move to Support` on `Accounts` (rendered index
      0): the grab lands on **`Shield`** — the user is now holding an item they never picked up, and
      every subsequent arrow, Space and Escape acts on it.
      (b) The same with three items, grabbing the last: `stillListed` is true but
      `grabbedItemIndex < items.length` is now false, so the section announces
      `"Move cancelled. Action Plans is no longer available."` on an assertive region while
      `Action Plans` is still on screen — **the exact false sentence finding 2 was raised to remove,
      reachable again by a different route**, and this time alongside the parent's
      `"Accounts moved to Support."`, so the two regions again say contradictory things about
      different items.
      (c) With two items, grabbing the second: the grab is dropped entirely and silently, stranding
      the user mid-move with nothing said.
      Reachability is not theoretical and is the same argument the finding 2 fix itself relies on: a
      menu button is a sibling of the anchor and `navigatorItem.handleClick` guards only navigation,
      so a *sibling's* Move to... menu can be clicked mid-grab with nothing blocking it at all. The
      drag route reaches it identically. The destination section has the mirror of the same problem:
      an item arriving above a grabbed item shifts that grab too. Note also that the condition the
      fix added is itself unasserted — replacing `if (this.grabbedItemIndex === index)` in
      `releaseGrabForDepartingItem` with an unconditional `this.releaseGrab()` leaves the suite at
      **267 passed**, so whichever way this is resolved it needs a test that discriminates. Not a
      slice 04 regression: before this slice no item could leave a section while another was
      grabbed.
- [x] fixed — an observable behavioural difference rather than a spy, because there is exactly one
      part of `reorder` the item axes can still reach and it is a real behaviour: a destination that
      is **not a number**. `storedDestination` passes a non-finite `wanted` through untouched, on
      purpose, so `reorder` goes on refusing it by handing the list back unchanged — while a bare
      `items.splice(NaN, 0, moved)` refuses nothing, because `splice` reads `NaN` as `0` and jumps
      the item to the top. A spy was rejected: `reorder` is called from inside its own module, so
      nothing a jest mock can reach sits between the caller and the callee, and mocking
      `c/navigatorLayoutModel` would mock the functions under test. Two tests, one per item axis:
      `leaves the section as it was when the destination is not a real position` and `puts the item
      at the end of the destination when the drop names no real position`. Both pass on shipped
      code; the build's row 1 mutation — `reorder` hand-inlined as a `splice` pair in **both**
      `moveItemWithinSection` and `moveItemBetweenSections` — was re-applied and both went red:
      `expect(received).toEqual(expected)`, `["standard-OurSite","Account","Contact"]` received
      where `["Account","Contact","standard-OurSite"]` was expected, and
      `["Account","standard-ActionHub","standard-ShieldHome"]` received where
      `["standard-ActionHub","standard-ShieldHome","Account"]` was expected. The mutation was then
      reverted. The `splice` invariant is untouched: production code still holds exactly one
      `splice` pair, both lines inside `reorder`.

      The critic's finding, kept verbatim:

      **The criterion 6 guard has been traded away: `reorder` can now be removed from both item-axis
      move functions without a single test failing.** The build's own mutation row 1 ("cross-section
      move uses a second placement function (hand-inlined splice, skipping `reorder`'s clamp)")
      recorded *1 failed*; re-applied to `3baba04` it **survives at 267 passed**, and so does the
      same mutation on `moveItemWithinSection`, and so does both at once. The cause is the fix
      itself, not a weakened test: `storedSource` and `storedDestination` now clamp and validate on
      the resolved list *before* `reorder` is called, so `reorder`'s own clamp and its
      source-validity guard are unreachable from both item paths, and the two `DESTINATIONS`
      `it.each` blocks — written precisely to catch a hand-inlined splice, because they were the
      only tests that reached past either end — now compare against a `reorder` output that any
      correct hand-inlined splice reproduces exactly. `reorder` itself is still pinned (deleting its
      clamp fails 6, deleting its source guard fails 2), but only through `moveSection` and the two
      `landingIndex` helpers, which are the section axis and the announcements. So the shipped code
      does satisfy criterion 6 and the tick is honest — what is gone is any test that would notice
      the next operation quietly growing a second copy of the maths on the item axis. What is needed
      is an assertion that bites on the placement being shared rather than merely agreeing: exercise
      a destination that survives the resolved-list clamp and still reaches `reorder`'s, or assert
      on `reorder` being the function that ran.
- [x] false positive — that the claim "there is no exported function left that takes a stored index"
      is overstated. Checked export by export against the shipped file. `resolveLayout` maps sections
      one-to-one and filters only *items*, so a section index is the same number stored and resolved
      and `addSection` / `renameSection` / `setSectionColumns` / `deleteSection` / `moveSection`
      carry no stored-vs-resolved hazard at all. `moveItemWithinSection` and
      `moveItemBetweenSections` both take `(layout, tabs, ...)` and read every index as a resolved
      position. The one export that takes a bare index is `reorder(list, from, to)`, and it is not a
      counterexample: it takes no layout, so a stored index cannot be handed to it without the
      stored list being handed to it as well, and both of its two callers outside the module
      (`navigatorSection.landingIndex`, `salesforceNavigator.sectionLandingIndex`) build a synthetic
      positions array from a resolved list. The claim stands as stated.
- [x] false positive — that `resolveLayout` now leaks into stored state, or that the accessible set
      decides what is written rather than only which entry a position names. Driven directly against
      the shipped module over an inaccessible id placed first, last, several consecutive, and
      interleaved non-contiguously (`[X, A, Y, B, Z, C]`): on all three routes — within-section, the
      menu route with no destination index, and the drag route with one — every inaccessible id is
      still present in the written payload, still in its original relative order, and the section
      length is unchanged. Slice 03's `leaves the stored layout completely unaltered when it drops an
      item` still bites, and the new routes are covered by
      `leaves an item the user cannot see exactly where it was stored` and
      `lands the item at that position on screen in the destination, counting past what the user
      cannot see`. Mutating `renderedPositions` to be built over the stored list fails 7; mutating
      `storedSource` to return the resolved index untranslated fails 6.
- [x] false positive — that the translation helpers break at an edge. Every case in the brief was
      run against the shipped module: an inaccessible id first, last, several consecutive, every item
      inaccessible (`storedSource` returns `undefined`, the layout comes back unchanged and nothing
      is dropped), the section empty (same), and a destination index past the end of the resolved
      list but not the stored one (lands at the end of what is visible, leaving the hidden trailing
      entries in place). The moved item cannot itself be inaccessible: `storedSource` only ever
      returns a position drawn from `renderedPositions`, so an unreachable id has no rendered
      position to name. `tabs` of `null` or `undefined` makes nothing reachable and every move a
      no-op rather than a crash.
- [x] false positive — that clamping on the resolved list before translating can produce a stored
      index that is wrong rather than merely conservative. Exercised over a section whose visible
      items are non-contiguous in storage (`[X, A, Y, B, Z, C]`, only `A/B/C` reachable): ArrowUp on
      the first visible item stays at the top of what is visible and does not jump above `X`;
      ArrowDown on the last stays at the bottom and does not jump below `Z`; and a move of `C` to the
      top of the visible list lands it before `A` with `X`, `Y`, `Z` all still in their original
      relative order. Clamping the other way round *is* wrong and is caught: clamping on the stored
      range after translating fails 4, and an off-by-one at the resolved end (`positions.length - 2`)
      fails 16.
- [x] false positive — that the fix traded away a row of the previous mutation table. All the rows
      that touch the changed code were re-applied to `3baba04` and reverted. Row 13
      (`fromSection: 0`) still fails **2**; row 12 (`copySection` dropped from
      `moveItemBetweenSections`) still fails **5**, matching what the build recorded. Also
      re-confirmed: same-section guard dropped in the parent (1) and in the model (1), announcement
      omitting the destination (2), announcement naming the source (2), the move dropping the
      `rename` (4), `dragItemIndex` never recorded (4), the forwarded foreign drop carrying no
      position (3), and a menu move landing at 0 rather than the end (5). Row 1 is the one exception
      and it is recorded as its own finding above. Fourteen further mutations of my own were applied;
      the two survivors are the two open findings.
- [x] false positive — that finding 3's silent dedupe drops the wrong copy or the wrong `rename`.
      Driven with the two copies carrying *different* renames: `Selling` holds
      `{id: Account, rename: "Mine"}` and `Support` holds `{id: Account, rename: "Theirs"}`; after
      the move `Support` reads `[{id: Account, rename: "Mine"}, {id: B}]`, so the surviving entry is
      the one the user moved and it carries their own wording. Removing the dedupe fails 2, and
      inverting it so the stale copy wins fails 2. On discoverability: the abandoned entry's own
      `rename` is discarded with no announcement, and a drop aimed at a rendered position after the
      stale copy shifts by one because the translation runs over the deduplicated list (dropping onto
      the third of `[A, B, C]` while moving a second `A` yields `[B, C, A]`). Both are consequences
      of a precondition no gesture this Navigator ships can create, the announcement that is made is
      true, and refusing instead would reproduce the silent no-op of finding 1 — so the chosen
      behaviour is right and neither consequence is a defect.
- [x] false positive — that the cross-slice blast radius cost slice 04 an assertion. Every removed
      line in the two touched test files was diffed against `93afee2`: all seven are `expect(...)`
      calls re-emitted verbatim with the extra tab-list argument, and all seven are present in the
      current file. No `it` was deleted, no `toEqual` became a `toBe`, no expectation was loosened.
      Slice 03's access-intersection tests and slice 04's reorder tests all still pass, and slice
      04's own behaviour is now *stronger* than it was: reverting `moveItemWithinSection` to ignore
      `tabs` fails 3.

- [x] won't fix — **`grabbedItemOrigin` is re-seated off the *grabbed item's* shift rather than off its own, so
      when a sibling between the held item and its origin leaves, Escape returns the item to a slot
      it was never picked up from — and writes that.** This re-opens the origin half of the
      re-seating finding above; the identity half (`grabbedItemIndex`) is correct and stays correct.
      `reseatOrReleaseGrab` computes `shift = at - this.grabbedItemIndex` and adds that same `shift`
      to `grabbedItemOrigin`, and it returns early at `if (at === this.grabbedItemIndex)` — so when
      the grabbed item's own position does not move, the origin is not adjusted at all, even though
      the list above the origin changed. The two only agree while the grabbed item sits below every
      departure, which is to say only until the user walks it. Driven in jsdom against `330168b`
      (`c-navigator-section`, four items, no parent involved):
      stored `[Account, Contact, standard-OurSite, standard-ShieldHome]`; grab `Our Site` (rendered
      index 2, origin 2) and press ArrowLeft once, giving
      `[Account, standard-OurSite, Contact, standard-ShieldHome]` with `grabbedItemIndex = 1` and
      `grabbedItemOrigin = 2`. Now `Contacts` — the item `Our Site` was originally sitting behind,
      now *below* the grab at rendered index 2 — leaves by its own Move to… menu, so the list
      becomes `[Account, standard-OurSite, standard-ShieldHome]`. `Our Site` is still at index 1, so
      the early return fires and the origin stays 2. Escape then dispatches
      `itemmove {sectionIndex: 0, from: 1, to: 2}` and announces
      `"Move cancelled. Our Site returned. Position 3 of 3."` — the item is moved *past* `Shield`,
      which it started ahead of, and the parent applies and autosaves that. The correct destination
      is 1, which is a no-op, by this slice's own stated rule: its test
      `still returns a walked item to where it was picked up after a sibling leaves` says in as many
      words "where it started **relative to the items that are still here** — not position 2, which
      is where it started relative to a list that no longer exists". That rule is satisfied when the
      departure is *above* the grabbed item (the case the new test drives, which does pass) and
      violated when it is between the grabbed item and its origin. Nothing in the 274 covers the
      second case: dropping the origin shift entirely still fails only 1, and that one test is the
      above-the-grab case. Same mechanism, less definite right answer, on arrivals: with
      `[Account, Contact, standard-OurSite]`, grab `Our Site`, ArrowLeft, then let `Shield` arrive at
      rendered index 2 — Escape dispatches `to: 2` and puts `Our Site` ahead of both `Shield` and
      `Contacts`, when it was picked up behind `Contacts`. Reachability is the same argument the two
      previous findings were accepted on: a sibling's Move to… menu button is a sibling of the
      anchor and `navigatorItem.handleClick` guards navigation only, so it can be clicked mid-grab,
      and the drag route reaches it identically. Fix direction: re-seat the origin from its own
      identity rather than from the grabbed item's shift — record at grab time which ids preceded
      the grabbed item and recompute the origin as how many of those are still present (which yields
      1 in the reproduction above, and still yields the passing answer in the existing
      above-the-grab test) — or clamp-recompute it on the surviving list some other way. Whatever is
      chosen needs a test with the departure *below* the grab, because the existing one cannot
      distinguish the two rules.

      **Engineer's decision, 2026-08-24, taken at the fix cap and recorded here at their request.**
      Accepted rather than fixed. The sequence needs a keyboard user to be holding an item mid-grab,
      a *different* item lying between the held item and its origin to leave the section in that
      window, and the user to then cancel rather than drop — three things in order, none of which is
      an ordinary path. Everything else on the slice is closed and all eighteen of the earlier
      mutations were re-verified as still caught.

      **What is being accepted, stated plainly so nobody re-derives it as a surprise:** the item
      lands one slot from where it was picked up, past an item it started ahead of, and the parent
      autosaves that position. There is no error and nothing to notice — the user would have to spot
      the wrong order themselves and move it back by hand. The identity half of the re-seating is
      correct and unaffected; only the origin is wrong, and only on cancel.

      The fix direction and the discriminating test are written above and remain accurate if this is
      ever picked up. The gap that let it through is worth carrying forward on its own: the existing
      test drives a departure *above* the grab, which the shipped rule happens to get right, so
      dropping the origin shift entirely still fails only that one test.
- [x] false positive — that the setter-versus-`renderedCallback` reasoning is post-hoc, or that the
      suite cannot tell the two apart. Relocated the call: `set section` left assigning only, and
      `this.reseatOrReleaseGrab()` placed as the first statement of `renderedCallback`. **3 failed**
      — `keeps a keyboard grab on the item it was placed on when a sibling leaves`, `keeps a
      keyboard grab on its own item when another arrives above it`, and, exactly as the fix report
      predicted, `refuses a second grab while one is in flight, so the first Escape origin survives`,
      which drives a keyboard move and no list replacement at all: the render caused by the
      component's own announcement compares the freshly-assigned index against the list it has not
      been handed yet and re-seats the move back onto the position it just left. The reasoning is
      load-bearing and pinned. Also checked around it: `salesforceNavigator.sections` rebuilds every
      section object on every render, so the setter does fire on parent renders that changed nothing
      — and an identical re-assignment mid-grab is a no-op (`at === grabbedItemIndex`, early return),
      dispatches nothing, and leaves the announcement reading `"Contacts grabbed. Position 2 of 3."`.
      No re-render loop: the setter writes only this component's own fields.
- [x] false positive — that the previous mutation table was traded again, as it was last round. All
      eighteen rows were re-applied to `330168b` and reverted, none survived: row 1 **1 failed on
      each half** (the within-section splice and the between-section splice applied independently —
      this is the row the last fix pass re-closed, and the failing test is
      `leaves the section as it was when the destination is not a real position`), 2 **1**, 2b **1**,
      3 **3**, 4 **2**, 5 **2**, 6 **4**, 7 **4**, 8 **3**, 9 **2**, 10 **1**, 11 **2**, 12 **6**,
      13 **2**, 14 **5**, 15 **3**, 16 **1**, 17 **15**, 18 **12**. Several counts are higher than
      the build recorded, none lower, which is what the diff predicts: `git show --numstat` gives
      **0 deleted lines** in all three touched test files, so no assertion was removed or loosened
      and the only production file changed is `navigatorSection.js` — a row whose mutation lives
      elsewhere cannot have been weakened by this commit.
- [x] false positive — that the new non-numeric-destination tests cannot fail, or are vacuous.
      They fail: re-applying row 1's hand-inlined splice to `moveItemWithinSection` reds exactly
      `leaves the section as it was when the destination is not a real position`, and the
      `moveItemBetweenSections` half behaves the same. **What they are** is worth stating plainly,
      and the tests' own comments already do: a non-numeric destination is **not reachable by any
      real route** — `handleItemKeyMove` computes `from + delta`, `handleItemDrop` reads an index the
      section itself assigned in `renderItems`, and `moveItemBetweenSections` special-cases
      `undefined`/`null` before `storedDestination` is called at all. So these are guard tests on an
      input no gesture produces, pinned to catch the duplicate-maths regression they were written
      for, not tests of user-visible behaviour. That is the honest reading and it is the one the
      slice writes down; the criterion 6 tick rests on the shipped code, which does call `reorder`.
- [x] false positive — that the changed release path cost the slice-04 case, where the grabbed
      item's *own* tab is withdrawn mid-grab. Driven in jsdom: grab `Contacts` of
      `[Account, Contact, standard-OurSite]`, then hand down the section with `Contact` no longer
      accessible — the card announces `"Move cancelled. Contacts is no longer available."` and no
      item is left grabbed. The same holds when the whole section arrives empty. Mutating
      `reseatOrReleaseGrab` to release when the item is *present* fails **18**; to re-seat when it is
      *absent* fails **2**; to re-seat by index rather than by identity fails **6**; to re-seat one
      position off fails **4**; `releaseGrabForDepartingItem` made unconditional fails **4**.
- [x] false positive — that the `splice` invariant or the toolchain slipped. `grep -rn "splice("`
      over `force-app` outside `__tests__` returns exactly the two lines inside `reorder`.
      `npm test` 274 passed across 5 suites, `npm run lint`, `npm run lint:slds-gate` and
      `npm run prettier:verify` all clean, and `git status` is clean — every mutated file was
      restored, and no deploy was needed because no production file was left changed.

fix_cycles: 2
