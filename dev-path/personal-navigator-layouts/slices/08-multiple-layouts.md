---
depends_on:
  - dev-path/personal-navigator-layouts/slices/03-sections-and-columns.md
touches:
  - force-app/main/default/classes/NavigatorLayoutController.cls
  - force-app/main/default/classes/NavigatorLayoutControllerTest.cls
  - force-app/main/default/lwc/salesforceNavigator/salesforceNavigator.js
  - force-app/main/default/lwc/salesforceNavigator/salesforceNavigator.html
  - force-app/main/default/lwc/salesforceNavigator/salesforceNavigator.css
  - force-app/main/default/lwc/salesforceNavigator/__tests__/salesforceNavigator.test.js
done: true
fix_cycles: 0
---

# Keep more than one layout and switch between them

> Watch a new test go red before you make it green.
> _Why: a test written before the code cannot be written to hit a coverage number — there is nothing to
> cover yet. Retires when Apex gets mutation testing._

## What to build

A user keeps several named layouts for different kinds of work and switches which one they are looking
at.

## Acceptance criteria

- [x] met A user creates a second named layout, and the Navigator header lists both with the active one
      marked.
- [x] met Switching layouts re-renders the sections, items, column counts and renames belonging to the
      selected layout, and leaves the other layout untouched.
- [x] met The chosen layout is still the active one after a page reload and a fresh login.
- [x] met A user can rename a layout and delete one.
- [x] met Exactly one layout is active at a time — activating one deactivates the previously active one in the
      same transaction, and no sequence of switches leaves two active or none active.
- [x] met Deleting the active layout leaves the user with a sensible active layout rather than an empty
      screen.
- [ ] The same active layout is shown on the Navigator tab, on an App page placement and on a Home page
      placement — switching on one is reflected on the others.
- [x] met A user's layouts are theirs alone; a second user's list is independent.

## Deviations

### What "a sensible active layout" was decided to mean, and why

Deleting the active layout activates **the layout that takes its place in the user's own ordering** —
the one after it, or the one before it when the deleted layout was last. That is what a list does
when a row is removed from the middle of it, so the user's next screen is the layout their eye was
already next to rather than an arbitrary one. It is decided in `NavigatorLayoutController.deleteLayout`
and not in the client, so the two cannot disagree about it.

Deleting the **only** layout deliberately leaves **no row at all**. That is not an empty screen: it is
exactly the first-open state — every tab the user can reach in one seeded section, computed and not
written. Writing a replacement row would put back the thing the user just asked to be rid of, and
would create a row for a user who now has no customisation to store.

### Three new Apex methods rather than reusing `updateLayout`

`activateLayout`, `renameLayout` and `deleteLayout` were added, and **none of them takes a payload**.
Switching through `updateLayout` would have meant the client sending the layout it is looking at
along with the id of the layout it is switching *to* — which is the previous project's bug rebuilt
out of new parts. A switch and a rename now have nothing to write onto the wrong row even if they
named one.

### One defect found and fixed during the mutation pass, not present before this slice

`persist` sent `makeActive: true` on every autosave. With one layout that was harmless; with several,
a save queued before a switch and resolving after it **dragged the active flag back** to the layout
the user had just left. Fixed at both ends: the client asks "is this still the layout on screen?" as
late as possible (`makeActive: isCurrent`) while the *row* stays captured at queue time, and
`updateLayout` now reads `makeActive == false` as **"leave the flag as it is"** rather than "clear
it" — so no ordinary save can leave a user with no active layout. Pinned by
`anUpdateThatDoesNotClaimTheActiveFlagLeavesEveryFlagAlone` (Apex) and
`a change made while a switch is still in flight is written to the layout it was made on` (jest).

The jest test had to hold the switch open (`store.deferNextActivation`) to see it. Every other test in
the block resolves Apex instantly, and instant resolution ends the switch before the change is made —
another instance of *a fixture that cannot distinguish two rules will pass both*.

### The deploy's source-tracking conflict

`sf project deploy start` reported a conflict on all four components. Retrieved to a temp dir with
`--target-metadata-dir` (never the working tree) and diffed each file against `git show HEAD:<path>`.
The `.cls`, `.js`, `.html` and `.css` files differed **only** by the trailing newline. The two
`.cls-meta.xml` files differed by that and by **one space in the XML prolog** —
`encoding="UTF-8" ?>` locally against `encoding="UTF-8"?>` from the server — which is Prettier's XML
writer against the Metadata API's serialiser, the same class of artifact as the newline and not a
content change. No content differed anywhere, so `--ignore-conflicts` was used. Recorded here because
the rule as written names only the newline.

### Criterion 7 — the three placements — is NOT ticked

**What was established.** Layouts are global to the user and there is no seam at which a placement
could scope one. `getLayouts()` takes no argument and the client passes none; `salesforceNavigator.js-meta.xml`
declares all three targets (`lightning__Tab`, `lightning__AppPage`, `lightning__HomePage`) and
**declares no `<property>` at all**, which is not a preference — `lightning__Tab` rejects `<property>`
outright, server-enforced, as `## Current state` → *Outcome 2* records. A jest test mounts a second
component instance standing for a second placement and asserts it shows the same active layout after a
switch made in the first, and that the read is called with no argument at all.

**What remains.** The three placements *themselves* — the component rendered on a real Navigator tab,
on a real Lightning App page and on a real Home page in a running org, with a switch made on one and
observed on the others. jsdom renders one component in one document and has no Lightning page context;
`lightning__Tab` in particular gives no `recordId` and no FlexiPage wrapper to stand up. This needs a
browser driver against a live org with the tab placed in an app and the component dropped on both page
types — the two admin steps in `## Out of scope` are prerequisites, so it cannot be reached from
source either. It is the same ceiling slices 04–07 recorded for their gesture-level halves.

### Mutation results

Each mutation was applied to the shipped code, the suite run, and the mutation reverted. **Nothing
survived.**

| # | Mutation | Caught by | Failing tests |
| --- | --- | --- | --- |
| 1 | `save()` stops capturing the layout id; `persist` reads `this.layoutId` at write time | jest | 1 — *a change made while a switch is still in flight…* |
| 2 | New layout calls `updateLayout` on the active layout instead of `createLayout` (the original bug, verbatim) | jest | 1 — *a new layout sits beside the existing ones…* |
| 3 | `deleteLayout` never activates a successor — delete leaves nothing active | Apex | 3 |
| 4 | `deactivations` returns nothing — activation leaves two (or 200) active | Apex | 6 |
| 5 | `layoutChoices` lists only the active layout | jest | 1 — *lists every layout the user owns…* |
| 6 | Opening any layout dialog calls `applyLayout`, so the menu writes | jest | 3 |
| 7 | Switching strips `rename` out of the adopted payload | jest | 18 |

Mutation 1 **survived the first attempt** and the gap was real: no test held a switch open, so no
fixture could distinguish "captured at queue time" from "read at write time". The test written to
close it then found the `makeActive` defect above. Mutation 6 was not seen by
*opening the menu … writes nothing*, which fired a bare `open` event that reaches no handler; that
test now opens all three dialogs and would catch it on its own.

## Critique findings

- [ ] **A change made while a switch is in flight is silently discarded when the switch lands before
      the debounce, and the stale timer then writes the switched-to layout back over itself.** The
      fix recorded in `## Deviations` closes only the ordering its own test exercises. `save()`
      captures `{layoutId, name, layoutJson}` when the *debounce fires*, not when the *change is
      made*; `adoptFromStore` replaces `this.storedLayout` unconditionally when the switch resolves.
      So if the activation round trip completes inside the 1s `AUTOSAVE_DELAY_MS` window — which is
      the ordinary case, not the rare one — the user's edit is gone from state before `save()` ever
      reads it. Reproduced against the shipped code by adding this to the `switching between
      layouts` block of `salesforceNavigator.test.js`: defer the activation with
      `store.deferNextActivation()`, select `layout:${THIRD_ID}`, `await flush()`, make a change
      (`selectSectionMenuItem(element, 0, "columns-6")`), `await flush()`, then `releaseSwitch()`
      followed by **two `await flush()` calls before** `settleAutosave()`. Result: `SECOND_ID` still
      holds `columns: 4` — the change was never written anywhere — and the only `updateLayout` call
      made is `{layoutId: THIRD_ID, layoutJson: <Admin's own unchanged payload>, makeActive: true}`,
      i.e. a pointless write to the layout the user did *not* edit. The build's own test passes only
      because `settleAutosave` advances the timer before flushing the deferred promise's microtasks
      (see the next finding). Two fixes are possible and the choice is a design decision: capture the
      target at `applyLayout`/`scheduleSave` time rather than at timer-fire time, or have
      `switchToLayout` flush the pending save into the chain the way it flushes an already-elapsed
      one. The same root cause applies to `createNewLayout` (change lost, then written to the new
      layout) and to `deleteCurrentLayout` (change lost, then written to the successor).

- [ ] **`anUpdateThatDoesNotClaimTheActiveFlagLeavesEveryFlagAlone` cannot distinguish "leave the
      flag as it is" from "clear it", so the `makeActive == false` semantics are not pinned.** The
      test updates `First`, which is *not* the active layout in `seedThree()` — `Second` is. Setting
      `First.Is_Active__c = false` is a no-op, so both rules pass it. Verified by reverting
      `NavigatorLayoutController.updateLayout` to `row.Is_Active__c = makeActive == true;` and
      deploying: **all 38 Apex tests still pass.** This is the exact trap the slice names ("a fixture
      that cannot distinguish two rules will pass both"), recurring inside the test written to close
      the defect. A discriminating test — `updateLayout(secondId, 'Second', <payload>, false)` then
      `Assert.areEqual(1, activeCount(), ...)` and `Assert.areEqual('Second', activeName(), ...)` —
      passes on the shipped code and fails on the reverted code; it was run both ways to confirm.
      Note the fix itself is correct; it is the pin that is missing.

- [ ] **`settleAutosave()` advances the fake timers *before* flushing microtasks, so no test in the
      `switching between layouts` block can observe an Apex call resolving before a pending
      debounce.** `settleAutosave` is `jest.advanceTimersByTime(...)` then `flush()` twice, so a
      queued save always fires while `this.layoutId` still holds its pre-switch value. Evidence that
      this blinds the block: deleting the `this.flushPendingSave();` line from `switchToLayout`
      leaves all 146 tests in the file passing, even though "a change still in the debounce is
      written to the layout it was made on, not to the one switched to" exists to cover exactly
      that. Any test that wants to pin an ordering has to interleave microtask flushes and timer
      advances explicitly rather than reach for `settleAutosave`.

- [ ] **`adoptFromStore` and `adoptActiveLayout` disagree about a store that has rows but none
      active, and neither branch is tested.** `adoptActiveLayout` (the load path) falls back with
      `readable.find((row) => row.isActive) || readable[0]`; `adoptFromStore` (the switch/delete
      path) has no fallback and treats it as the first-open state — clearing `layoutId`,
      `layoutName` and `storedLayout` while `this.layouts` still lists the rows, so the menu shows a
      phantom `My Navigator` entry beside layouts the user owns. Changing `adoptFromStore` to match
      `adoptActiveLayout` leaves all 146 tests passing. The state is reachable through the
      `@AuraEnabled` surface — `createLayout(name, json, false)` on a user with no other active row
      produces it, and nothing but `activateLayout` can ever set a flag again — so decide which
      behaviour is intended and pin it.

- [ ] **`discardPendingSave` on the delete path is untested.** Replacing `this.discardPendingSave()`
      with `this.flushPendingSave()` in `deleteCurrentLayout` leaves all 146 tests passing, so the
      documented reason for the distinction ("a payload written to a row that is about to be deleted
      is work with no reader") is unpinned. A test that makes a change, deletes the layout inside
      the debounce window, and asserts `updateLayout` was never called would close it.

- [ ] **`rememberSaved`'s create-adoption guard is untested and may be unreachable.** Replacing
      `if (!target.layoutId && this.layoutId === undefined) { this.layoutId = savedId; }` with a bare
      `this.layoutId = savedId;` leaves all 146 tests passing. The comment calls both conditions
      required; I could not construct an interleaving that reaches the difference, because
      `saveChain` serialises the create ahead of anything that could move `this.layoutId`. Either
      write the test that distinguishes it or record it as defence that no fixture can reach.

- [ ] **`renameCurrentLayout` mutates `this.layoutName` and `this.layouts` before the call and never
      rolls back.** When `renameLayout` rejects, the save-error alert appears but the menu button and
      the menu entry keep showing a name the store does not hold, and the next autosave sends that
      name to `updateLayout` — so a rename that the server refused gets written by the next unrelated
      edit. Every other path in this file adopts the store's answer rather than the request; this one
      does not.

- [x] false positive — *the three new controller methods duplicate setup and violate
      `rstk-dry-enforcement.md`*. Each is a null guard, `ownLayouts()` and `findOwned(...)`: three
      lines, under the rule's ">5 consecutive lines" threshold, and the parts that could genuinely
      drift are already extracted — `activation`, `applyActivation`, `deactivations`, `toDtos`,
      `findOwned`, `identityDto`. The mirror pair `activation`/`applyActivation` is the strongest
      evidence against the charge: one place decides who is active and both the write and the reply
      read it from there.

- [x] false positive — *the payload-free signatures are an under-specified API*. Judged and upheld.
      `activateLayout(Id)`, `renameLayout(Id, String)` and `deleteLayout(Id)` have nothing to write
      onto the wrong row, and `renameLayout` writes an `Id`/`Name` stub rather than the queried row,
      so `Layout_JSON__c` is not even in the DML. Confirmed by mutation: making `findOwned` return
      the first owned row instead of the one named fails 9 tests, and
      `activatingALayoutChangesNoPayloadAtAll` asserts all three payloads are untouched. The claim
      that switching, renaming and deleting are changes to identity and flags holds.

- [x] false positive — *`deleteLayout`'s successor choice is arbitrary or unstable*. It is
      `remaining[Math.min(removedAt, remaining.size() - 1)]` over `ownLayouts()`' deterministic
      `ORDER BY Sort_Order__c NULLS LAST, CreatedDate`, and `nextSortOrder` places new rows after the
      highest sort order in use rather than after the count, so two rows do not collide after a
      delete. Mutating the successor to `remaining[0]` fails 3 tests, so the fixture can tell "the
      one that takes its place" from "the first one". Deleting the last row, deleting when only one
      exists, and deleting a non-active row each have their own test and each asserts what the
      database holds afterwards.

- [x] false positive — *the deploy override on the `.cls-meta.xml` prolog was unjustified*. Verified
      independently: retrieved `ApexClass:NavigatorLayoutController` to a temp dir and compared bytes
      against `git show HEAD:`. The server holds `encoding="UTF-8"?>` and the working tree holds
      `encoding="UTF-8" ?>` — one space, Prettier's XML writer against the Metadata API's serialiser
      — and the `.cls` differs only by the trailing `\n`. No content differs. Overriding was right
      and recording it was right; the rule as written names only the newline.

- [x] false positive — *the new DML omits `allOrNone = false` and the new methods lack
      `@description`/`@param` ApexDoc tags*. Both are literal readings of `rstk-apex-standards.md`
      that are wrong here. Atomicity is the invariant this class exists to hold — a partially applied
      `activation` is precisely the "two active" state — so all-or-nothing is required, not
      forgotten; and the tag-form ApexDoc rule is scoped to new classes, while this file has carried
      prose ApexDoc through seven prior slices. `rstk-security.md` is satisfied: the class is
      `with sharing`, the one query is `WITH USER_MODE` *and* predicated on `OwnerId`, and every new
      `Database.update`/`Database.delete` passes `AccessLevel.USER_MODE`. Dropping the `OwnerId`
      predicate fails `sharingCanNeverBecomeTheFilterForWhoseLayoutsComeBack`.
