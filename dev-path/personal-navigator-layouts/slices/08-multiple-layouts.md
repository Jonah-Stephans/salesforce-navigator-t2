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
fix_cycles: 2
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
- [x] won't fix — The same active layout is shown on the Navigator tab, on an App page placement and on a Home page
      placement — switching on one is reflected on the others.
      **Engineer's disposition, 2026-08-25: accepted unverified rather than closed.** The code side is
      complete and evidenced — see `## Deviations`, *Criterion 7*: layouts are global to the user and
      there is no seam at which a placement could scope one, `getLayouts()` takes no argument and the
      client passes none, the `js-meta.xml` declares all three targets and no `<property>` at all
      (which `lightning__Tab` rejects outright, server-enforced), and a jest test mounts a second
      component instance standing for a second placement and asserts it shows the same active layout
      after a switch made in the first. What is missing is not code but org state: seeing the three
      placements side by side requires the tab to be **placed in an app**, which is admin step 1 in
      `spec.md` → `## Design`, *What an administrator must do*, and which cannot ship as source —
      `CustomApplication` deploys as a full replace of an app's nav list. That step has not been
      performed, and the engineer's scratch-org session covered dragging, not placement. Accepted as
      pending an admin action rather than as unfinished work.
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

### Two decisions taken on the critique fix pass

**A change belongs to a layout from the moment it is made.** The critic offered two fixes for the
lost-change defect and called the choice a design decision. Capturing the target in `scheduleSave`
was taken over having `switchToLayout` flush into the chain, because it is one change in one place
that fixes all three callers — a switch, a create and a delete all move `this.layoutId` and
`this.storedLayout` — where the other option would have needed the same care repeated at each, and
would still not have covered a change made *after* the call was already in flight. `flushPendingSave`
on the switch path is kept and still earns its place; what it now prevents is a pending change being
*superseded* rather than misdirected.

**"Exactly one active", enforced by the controller.** Criterion 5 admits no reading in which a user
can end with none, so `createLayout` claims the flag when nothing else holds it rather than the
client learning to cope. The client's two adoption paths were made to agree anyway, through one
shared `activeRowIn`, because the *unreadable active row* case produces readable-rows-with-no-flag on
that side and no server rule can reach it.

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

The `re-run` column is the same seven mutations applied again after the critique fix pass, to check
that a fix had not silently killed coverage a mutation used to catch. **No count fell.**

Run a third time after the delete-round-trip fix below, against the shipped code and the org.
**Nothing survived and no count fell.** Measured: 1 → 3 (read fully literally, `persist` taking
`this.layoutId` for both the branch *and* the field, which is the reading the last pass recorded at
3); 2 → 2; 3 → 3; 4 → 6; 5 → 2; 6 → 6; 7 → 1 applied to `adoptFromStore` alone, which is the same
figure and the same caveat the last pass recorded for that cell. 3 and 4 were deployed to the org,
run, and the shipped class redeployed; 41/41 Apex green afterwards and `--dry-run` reports no
changes.

| # | Mutation | Caught by | Failing tests | Re-run |
| --- | --- | --- | --- | --- |
| 1 | `save()` stops capturing the layout id; `persist` reads `this.layoutId` at write time | jest | 1 — *a change made while a switch is still in flight…* | 2 — and *…survives the switch landing before the debounce fires* |
| 2 | New layout calls `updateLayout` on the active layout instead of `createLayout` (the original bug, verbatim) | jest | 1 — *a new layout sits beside the existing ones…* | 2 |
| 3 | `deleteLayout` never activates a successor — delete leaves nothing active | Apex | 3 | 3 |
| 4 | `deactivations` returns nothing — activation leaves two (or 200) active | Apex | 6 | 6 |
| 5 | `layoutChoices` lists only the active layout | jest | 1 — *lists every layout the user owns…* | 2 |
| 6 | Opening any layout dialog calls `applyLayout`, so the menu writes | jest | 3 | 6 |
| 7 | Switching strips `rename` out of the adopted payload | jest | 18 | 18 |

Mutation 1 **survived the first attempt** and the gap was real: no test held a switch open, so no
fixture could distinguish "captured at queue time" from "read at write time". The test written to
close it then found the `makeActive` defect above. Mutation 6 was not seen by
*opening the menu … writes nothing*, which fired a bare `open` event that reaches no handler; that
test now opens all three dialogs and would catch it on its own.

## Critique findings

- [x] fixed — **at the cause, in one place, so it reaches all three callers.** Of the two options the
      critic named, the first was taken: the target is captured when the change is *made*
      (`scheduleSave` now sets `this.pendingSave = {layoutId, name, layoutJson}`) rather than when
      the debounce fires, and `save()` takes that value rather than reading `this.layoutId` and
      `this.layout` afresh. `discardPendingSave` clears it. Nothing about `createNewLayout` or
      `deleteCurrentLayout` needed touching — both already route through `flushPendingSave` /
      `discardPendingSave`, so a change made while *their* call is in flight now carries its own
      layout's id too. `persist` still asks `isCurrent` as late as possible, which is unchanged and
      still right: *where* a payload goes is settled at change time, *whether that layout is on
      screen* is a fact about now.
      Pinned by *a change made while a switch is in flight survives the switch landing before the
      debounce fires*, written to the critic's reproduction and interleaved in the order a browser
      uses — microtasks for the released activation first, `jest.advanceTimersByTime` after, never
      `settleAutosave`. Against the shipped-then code it failed with
      `expect(received).toBe(expected) // Expected: 6, Received: 4` on
      `JSON.parse(store.payloadOf(SECOND_ID)).sections[0].columns` — the edit written nowhere. The
      build's own *…is written to the layout it was made on* stayed green throughout, exactly as the
      critic said it would.
      **A note on the interaction with the next finding:** yes, this changed what that pin can
      assert. Deleting `flushPendingSave()` from `switchToLayout` no longer loses the payload on its
      own, because the pending change now carries its own id whenever it fires. What it still loses
      is a change *superseded* by a later one — `scheduleSave` overwrites `pendingSave` — so the
      pin was written on that instead. See below.
      **A change made while a switch is in flight is silently discarded when the switch lands before
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

- [x] fixed — wrote the discriminating test the critic described,
      `anUpdateOnTheActiveLayoutThatClaimsNoFlagLeavesItActive`: it updates `Second`, which *is* the
      active row in `seedThree()`, then asserts `activeCount()` is 1 and `activeName()` is `Second`.
      Reverted `updateLayout` to `row.Is_Active__c = makeActive == true;`, deployed, and watched it
      go red with `System.AssertException: Assertion Failed: An ordinary autosave on the layout the
      user is looking at must never leave them with no active layout: Expected: 1, Actual: 0` —
      while `anUpdateThatDoesNotClaimTheActiveFlagLeavesEveryFlagAlone` passed alongside it, exactly
      as the critic reported. Restored, redeployed, 41/41 green. The fix itself was left untouched;
      only the pin was missing. **`anUpdateThatDoesNotClaimTheActiveFlagLeavesEveryFlagAlone` was
      kept**: it still pins that an update on a *non-active* row writes its payload without stealing
      the flag, which is a different half of the same rule.
      **`anUpdateThatDoesNotClaimTheActiveFlagLeavesEveryFlagAlone` cannot distinguish "leave the
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

- [x] fixed — the two new orderings-sensitive tests interleave `await flush()` and
      `jest.advanceTimersByTime` explicitly and never reach for `settleAutosave`, which is left alone
      for the 140-odd tests that do not care about ordering. `flushPendingSave()` in `switchToLayout`
      is now pinned by *a change still in the debounce is written before the switch, so a change made
      on the layout switched to cannot displace it*: a change on `Support`, a switch to `Admin` that
      lands inside the debounce window, then a change on `Admin` still inside that same window. The
      second change overwrites `pendingSave`, so an unflushed first change is not merely late — it
      is gone with no trace and no error. Deleting the line turned it red with
      `expect(received).toBe(expected) // Expected: 6, Received: 4` on `payloadOf(SECOND_ID)`.
      **`settleAutosave()` advances the fake timers *before* flushing microtasks, so no test in the
      `switching between layouts` block can observe an Apex call resolving before a pending
      debounce.** `settleAutosave` is `jest.advanceTimersByTime(...)` then `flush()` twice, so a
      queued save always fires while `this.layoutId` still holds its pre-switch value. Evidence that
      this blinds the block: deleting the `this.flushPendingSave();` line from `switchToLayout`
      leaves all 146 tests in the file passing, even though "a change still in the debounce is
      written to the layout it was made on, not to the one switched to" exists to cover exactly
      that. Any test that wants to pin an ordering has to interleave microtask flushes and timer
      advances explicitly rather than reach for `settleAutosave`.

- [x] fixed — **decided both halves.** The invariant is **"exactly one active"**, and criterion 5
      settles it: "at most one" cannot satisfy *no sequence leaves none active*, because a row
      created with no flag on an owner with nothing else active is unreachable forever —
      `activateLayout` is the only thing that sets a flag and it can only be reached from a menu that
      needs an active layout to render beside. So the **controller no longer permits the state**:
      `createLayout` stores `Is_Active__c = makeActive == true || isOnlyCandidate`, where
      `isOnlyCandidate` is `!anyActiveIn(existing)`. Pinned by a *pair* of Apex tests, because either
      alone would confuse the rule with "a create always steals the flag":
      `aCreateThatClaimsNoFlagStillLeavesTheUserWithAnActiveLayout` and
      `aCreateThatClaimsNoFlagDoesNotTakeItFromTheLayoutThatHasIt`. Reverting to
      `Is_Active__c = makeActive == true` turned the first red with `System.AssertException:
      Assertion Failed: A user whose only layout was created without claiming the flag must still
      have an active layout: Expected: 1, Actual: 0` and left the second green — which is the point
      of the pair. `aColumnCountOutsideTheContractRangeIsBroughtBackIntoIt` still passes; its row is
      now active, which its assertions do not speak to.
      **The two client paths were reconciled anyway**, because one route to
      readable-rows-with-no-flag is not the server's to close: when the *active* row is one this
      package cannot read, it is filtered out on this side before the flag is looked for. So the
      selection is now one shared `SalesforceNavigator.activeRowIn(readable)` —
      `readable.find(isActive) || readable[0]` — called by both `adoptActiveLayout` and
      `adoptFromStore`, one definition rather than two that can drift. `readable[0]` is undefined for
      an empty list, so `adoptFromStore`'s first-open branch after deleting the only layout is
      untouched. Pinned by *a store whose active layout is one this version cannot read still shows a
      layout the user owns, not the seeded one*, which drives it through `deleteLayout`; removing the
      fallback turns it red with `- "Selling" / + "All Items"` (and takes two pre-existing load-path
      tests with it, which is the point of sharing the definition).
      **`adoptFromStore` and `adoptActiveLayout` disagree about a store that has rows but none
      active, and neither branch is tested.** `adoptActiveLayout` (the load path) falls back with
      `readable.find((row) => row.isActive) || readable[0]`; `adoptFromStore` (the switch/delete
      path) has no fallback and treats it as the first-open state — clearing `layoutId`,
      `layoutName` and `storedLayout` while `this.layouts` still lists the rows, so the menu shows a
      phantom `My Navigator` entry beside layouts the user owns. Changing `adoptFromStore` to match
      `adoptActiveLayout` leaves all 146 tests passing. The state is reachable through the
      `@AuraEnabled` surface — `createLayout(name, json, false)` on a user with no other active row
      produces it, and nothing but `activateLayout` can ever set a flag again — so decide which
      behaviour is intended and pin it.

- [x] fixed — wrote the test the critic described: *a change still in the debounce when its layout is
      deleted is dropped rather than written* makes a change to `Support`, deletes `Support` inside
      the debounce window, and asserts `updateLayout` was never called (plus that the delete itself
      happened, or "nothing was written" would be true of a test that deleted nothing). Swapping
      `discardPendingSave` for `flushPendingSave` turned it red with `expect(jest.fn()).not
      .toHaveBeenCalled() — Expected number of calls: 0, Received number of calls: 1`.
      **`discardPendingSave` on the delete path is untested.** Replacing `this.discardPendingSave()`
      with `this.flushPendingSave()` in `deleteCurrentLayout` leaves all 146 tests passing, so the
      documented reason for the distinction ("a payload written to a row that is about to be deleted
      is work with no reader") is unpinned. A test that makes a change, deletes the layout inside
      the debounce window, and asserts `updateLayout` was never called would close it.

- [x] fixed — **wrote the test; it is reachable, and the fix to the first finding is what made it
      reachable.** The critic's reasoning was right about the shipped code: `saveChain` serialises,
      so nothing could move `this.layoutId` between a create being queued and its reply. What it
      could not anticipate is that capturing the target at change time opens the interleaving —
      a change made *while a create is in flight* is captured with no `layoutId` (the user owned no
      row when they made it), and by the time it lands the layout on screen is the one *New layout*
      created. So it correctly creates a row of its own, and adopting that row's id would point every
      later save at a layout the change was never made on. The fixture gained
      `store.deferNextCreate`, mirroring `deferNextActivation`; the test is *a change made while a
      new layout is being created gets its own row, and the new layout stays the one on screen*, and
      it reads which entry the menu has checked. Replacing the guard with a bare
      `this.layoutId = savedId;` turned it red with `- "Weekly review" / + "My Navigator"`.
      **`rememberSaved`'s create-adoption guard is untested and may be unreachable.** Replacing
      `if (!target.layoutId && this.layoutId === undefined) { this.layoutId = savedId; }` with a bare
      `this.layoutId = savedId;` leaves all 146 tests passing. The comment calls both conditions
      required; I could not construct an interleaving that reaches the difference, because
      `saveChain` serialises the create ahead of anything that could move `this.layoutId`. Either
      write the test that distinguishes it or record it as defence that no fixture can reach.

- [x] fixed — the optimistic write stays (a rename that waited a round trip to appear would feel
      broken), but it is now **taken back when the store refuses it**, and the store's own answer is
      adopted when it does not — which is what every other path in this file does. Both ends go
      through one new `adoptLayoutName(layoutId, name)`, which updates `this.layouts` and moves
      `this.layoutName` **only while that layout is still the one on screen** — if the user switched
      while the rename was in flight, `this.layoutName` is another layout's name and neither the
      success nor the rollback may touch it. Pinned by *a rename the store refuses is taken back off
      the screen, and the next unrelated change does not carry it*, which asserts the button, the
      whole menu, and then makes an unrelated column-count change and asserts `updateLayout` was
      called with `name: "Support"` — the second half being the part the critic identified as the
      real damage. Dropping the rollback turned it red with
      `expect(received).toBe(expected) — Expected: "Support", Received: "Cases"`.
      **`renameCurrentLayout` mutates `this.layoutName` and `this.layouts` before the call and never
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

- [x] fixed — **the write is refused rather than the alert suppressed, and the thing it is checked
      against is the store's own answer rather than a new note-to-self.** Of the three routes the
      finding named, the third was rejected outright — suppressing an alert leaves a doomed call
      still being made — and the choice was between refusing to *schedule* while a delete is in
      flight and refusing to *send*. Refusing to send won, for two reasons. First, `saveChain`
      serialises, so a delete is always ahead of anything a later timer queues: by the time the
      write is decided the store has already answered, which means a delete the store **refused**
      leaves the change written normally instead of silently dropped — refusing at schedule time
      cannot tell those apart, because at the gesture nobody yet knows whether the delete will
      succeed. Second, and this is the "hardest to express" half: the check needs no new state at
      all. `persist` now asks `stillExists(target.layoutId)` — *is this layout still one the store
      says the user owns* — against `this.layouts`, which is replaced wholesale after every switch
      and every delete and is the very list the menu is drawn from. So the rule is **a write is only
      addressed to a layout the menu still lists**, there is no second piece of bookkeeping to fall
      out of step with the first, and no number of deletes, in any order, weakens it. It sits beside
      `isCurrent` and shares its asymmetry: *where* a payload goes was settled at change time,
      *whether that row still exists* is a fact about now.
      Pinned by *a change made while its layout is being deleted is written nowhere and reports no
      save error*, written to the critic's reproduction with a new `store.deferNextDelete` seam
      mirroring `deferNextActivation` and `deferNextCreate`, and interleaved by hand — microtasks
      for the released delete first, `jest.advanceTimersByTime` after, never `settleAutosave`.
      Against the shipped-then code it failed with `expect(jest.fn()).not.toHaveBeenCalled() —
      Expected number of calls: 0, Received number of calls: 1`, the one call being
      `{layoutId: <SECOND_ID>, layoutJson: <the columns-6 edit>, makeActive: false, name: "Support"}`
      — `SECOND_ID` being the row the delete had just removed. It also asserts
      `[role="alert"]` is absent from the whole component, so the misleading message is pinned and
      not only the pointless call.
      **The fix was mutated in both directions.** Weakening `stillExists` to
      `this.layouts.length > 0 && Boolean(layoutId)` — "some layout exists, so write" — fails the new
      test alone (1). Over-broadening the guard to `target.layoutId !== this.layoutId` — "drop any
      write not aimed at the layout on screen", which would also close this instance — fails the two
      switch-in-flight tests (2) and leaves the new one green, which is what shows the guard is
      about *existence* and not about *currency*, and that the two settled rules have not been
      merged into one.
      **A change made *while the delete of that layout is in flight* is sent to the deleted row, and
      the user is shown a save error about a layout that no longer exists — beside a screen already
      showing a different layout.** `deleteCurrentLayout` calls `discardPendingSave()` at the moment
      of the gesture, which covers a change made *before* it. It does not cover the round trip:
      `scheduleSave` goes on capturing `layoutId: this.layoutId`, and until `deleteLayout` resolves
      and `adoptFromStore` runs, `this.layoutId` is still the layout being deleted. So a change made
      during the call is captured against a doomed id, the debounce fires after the row is gone, and
      `persist` calls `updateLayout({layoutId: <the deleted id>})`, which the controller refuses via
      `findOwned`. Reproduced against the shipped code with a `deferNextDelete` seam mirroring
      `deferNextActivation`: install `threeRows()`, open Delete layout…, click `Delete layout`,
      `await flush()`, then `selectSectionMenuItem(element, 0, "columns-6")` and `await flush()`,
      then release the delete, flush, and advance the timer. Result: exactly one `updateLayout` call,
      naming `SECOND_ID` which is no longer in the store; the store ends `["Selling", "Admin"]`; the
      screen shows `Admin`; and `[role="alert"]` reads *"We could not save your layout. Your last
      change may not be kept."* That is precisely the failure `discardPendingSave`'s own doc comment
      says the discard/flush distinction exists to prevent — *"a failure would report a save error
      about a layout that no longer exists"* — so the rationale is honoured on one side of the call
      and not the other. **Severity is low: no data is lost.** The change was made on the layout the
      user had just asked to delete, and the fix to the first finding is what keeps it off the
      successor row, so the damage is a misleading alert rather than a wrong write. A fix would keep
      the doomed id for the duration of the call — record it when `deleteCurrentLayout` queues, and
      have `save()` (or `scheduleSave`) drop a target whose `layoutId` matches it — and clear it when
      `adoptFromStore` runs. A test that makes a change while the delete is deferred and asserts
      `updateLayout` was never called, plus that no `[role="alert"]` is shown, would pin it.

- [x] false positive — *`pendingSave` is new mutable state on the hot path that leaks or goes stale*.
      Five interleavings driven against the shipped code, each with the relevant call held open:
      a change during a switch that then **fails** (the change lands on the layout it was made on,
      `columns: 6` on `SECOND_ID`, the user stays on `Support`, `activeName()` stays `Support`);
      two changes in one window (one `updateLayout`, carrying the **latest** payload, `columns: 3` —
      the debounce contract, not a loss); a rejected save with a further change behind it (two calls,
      final payload correct, and the alert clears when the second succeeds); a change during a create
      (its own row, and the created layout stays checked in the menu). The field is set only in
      `scheduleSave`, consumed and cleared only in `save()`, and cleared in `discardPendingSave` —
      so it is never set without a live timer and never survives its own write. The one interleaving
      that does misbehave is the delete round trip, recorded above as a finding in its own right.

- [x] false positive — *`makeActive == true || isOnlyCandidate` is a fourth meaning on the same
      boolean that can end with two active or none*. Driven by mutation in **both** directions
      against the org, which is what proves the pair discriminates rather than agrees.
      Reverting to `Is_Active__c = makeActive == true` fails only
      `aCreateThatClaimsNoFlagStillLeavesTheUserWithAnActiveLayout` (*Expected: 1, Actual: 0*) and
      leaves `aCreateThatClaimsNoFlagDoesNotTakeItFromTheLayoutThatHasIt` green; forcing
      `Is_Active__c = true` fails only the second (*Expected: 1, Actual: 2*) and leaves the first
      green. So neither "a create never claims the flag" nor "a create always steals it" passes the
      pair. `anyActiveIn` reads `ownLayouts()`, which is already `OwnerId`-predicated, so the
      candidacy test is per-owner; and the client never reaches the `false` branch anyway —
      `createNewLayout` and `persist` both send `makeActive: true`.

- [x] false positive — *the `store.deferNextCreate` seam is production code, or a test seam bolted
      onto the store*. It is neither. Both `deferNextCreate` and `deferNextActivation` are defined
      inside `installStore` in `salesforceNavigator.test.js` — a fixture-local helper on the jest
      fake, wrapping `createLayout.mockImplementationOnce`. Nothing in `salesforceNavigator.js` or
      `NavigatorLayoutController.cls` knows they exist.

- [x] false positive — *a mutation count fell on the re-run, or mutation 1 is overstated*. Re-ran all
      seven against the shipped code. Nothing survived and no count fell. Apex, measured in the org:
      mutation 3 (`deleteLayout` never activates a successor) fails 3; mutation 4 (`deactivations`
      returns nothing) fails 6 — both exactly as tabled. jest: mutation 2 fails 2, mutation 5 fails 2,
      mutation 6 fails 6 — exactly as tabled. Mutation 1 read literally (`persist` takes
      `this.layoutId` at write time rather than `target.layoutId`) fails **3**, one more than the
      table's 2: *…is written to the layout it was made on*, *…survives the switch landing before the
      debounce fires*, and *a change made while a new layout is being created…*. Mutation 7 is the
      one cell I could not reproduce at 18, because "strips `rename` out of the adopted payload" does
      not say which adoption path; applied to `adoptFromStore` alone it fails 1 (*switching
      re-renders … and renames*), and applied to both paths it would take the load-path tests with
      it. Caught either way, so the claim stands. Separately verified that each fix's own pin goes
      red when that fix is undone: the create-adoption guard (1 red), `flushPendingSave` in
      `switchToLayout` (1), `discardPendingSave` in `deleteCurrentLayout` (1), the rename rollback
      (1), and `activeRowIn`'s `|| readable[0]` (3, including the two pre-existing load-path tests).

- [x] false positive — *the failed-delete claim is reasoning rather than evidence: a delete the store
      refuses leaves the change queued behind it silently dropped, exactly as refusing at gesture time
      would.* Driven, because nobody had. Held the delete open with a `deleteLayout.mockImplementationOnce`
      that gates and then **rejects**, made a `columns-6` change on `Support` while it was in flight,
      released, then advanced the timer. Result: the store still holds all three rows
      (`["Selling", "Support", "Admin"]`), `SECOND_ID`'s payload is `columns: 6`, and the single
      `updateLayout` call is `{layoutId: SECOND_ID, name: "Support", makeActive: true}` — the change
      written **normally**, on the layout it was made on, still active, still on screen at 6 columns.
      `saveChain` does serialise the delete ahead of the timer-queued write, so `stillExists` reads a
      store that has already answered, and a refused delete leaves the row listed. The stated advantage
      of refusing to *send* over refusing to *schedule* is real and now measured.

- [x] false positive — *`stillExists` reads `this.layouts`, which can be stale, so a legitimate save
      can be refused.* Every route that populates `this.layouts` was walked and each named window
      checked. Between a delete resolving and adoption there is no window at all: `adoptFromStore`
      replaces the list inside the same `.then` that receives the rows, before any later chain link
      runs. A rejected `getLayouts` leaves the list `[]` but also sets `layoutLoadErrorMessage`, and
      `scheduleSave` returns before capturing anything, so no target exists to refuse. First open
      before any fetch, and a user with no rows, both leave `this.layoutId` undefined, which makes
      `target.layoutId` falsy and short-circuits the guard ahead of `stillExists` — the create path is
      untouched, and *a change made while a new layout is being created* still passes. The list is also
      never a subset of what the user owns: `getLayouts`, `activateLayout` and `deleteLayout` all
      return `toDtos` over the whole of `ownLayouts()` / `remaining` with no `LIMIT`
      (`NavigatorLayoutController.cls` lines 119, 263, 342). No refusal of a legitimate save was
      reachable.

- [x] false positive — *refusing to send leaves the change on screen and in `this.layout` with the
      store never told and the user never informed, which is inconsistent.* It leaves nothing on
      screen. When the delete succeeds, `adoptFromStore` reassigns `this.storedLayout` from the
      successor's payload, so the change made on the doomed layout is gone from the display in the same
      turn it is refused — the shipped test's own `expect(sectionNames(element)).toEqual(["Admin"])`
      is that fact. There is no surviving state for the store to be out of step with, and nothing to
      tell the user about, which is why the absent `[role="alert"]` is the right outcome rather than a
      suppressed message. Contrasted against a genuinely failed save, which keeps the user's work on
      screen and does raise the alert — the two are different situations and are treated differently.

- [x] false positive — *the new test `a change made while its layout is being deleted is written
      nowhere and reports no save error` could pass vacuously, or its `[role="alert"]` assertion has no
      teeth.* Both halves checked by running. Vacuity: added
      `expect(renderedColumns(element, 0)).toBe(6)` immediately after the `columns-6` gesture and
      before the delete is released — green on the shipped code, so the change really is made and
      really is queued. Teeth: with the `stillExists` guard deleted from `persist` and the
      `expect(updateLayout).not.toHaveBeenCalled()` line temporarily removed, the alert assertion fails
      on its own with `Received: <div class="rstk-nav-error" role="alert"><p>We could not save your
      layout. Your last change may not be kept.</p></div>`. The two assertions pin different halves and
      each can fail independently. (The test does not carry its own vacuity guard, but mutation shows
      it is not vacuous in fact.)

- [x] false positive — *a delete the store refuses tells the user, and then a later successful autosave
      wipes the message, so the refusal goes unreported.* Observed in the refused-delete drive above —
      `[role="alert"]` is absent at the end because `persist`'s success path clears
      `saveErrorMessage`. It is not this fix's doing: the identical drive run against
      `git show e673a8e^` of `salesforceNavigator.js` produces byte-identical output — same store, same
      single `updateLayout` call, same absent alert. One shared transient `saveErrorMessage` cleared by
      any success is this file's settled behaviour across every path, and the refused delete is still
      visible to the user as a layout that is plainly still on screen and still in the menu.

- [x] false positive — *a mutation count fell on the re-run, or the fix silently killed coverage a
      mutation used to catch.* All seven re-run against the shipped code and the org. **Nothing
      survived and no count fell.** jest, measured: 1 -> 3 (read literally, `persist` taking
      `this.layoutId` for the branch and the field — the reading the last two passes recorded, and row
      1's recorded wording ambiguity still bites); 2 -> 2; 5 -> 2; 6 -> 6; 7 -> 1 applied to
      `adoptFromStore` alone, the same figure and the same recorded caveat as the last pass, so row 7's
      ambiguity also still bites. Apex rows 3 and 4 were not re-deployed: `e673a8e` touches no `.cls`
      at all (`git show --stat` lists only the slice file and the two LWC files), and
      `NavigatorLayoutController.cls` / `...Test.cls` were last modified at `0db4376`, which is the
      commit the previous pass measured 3 and 6 against — so those two cells provably cannot have
      moved, and deploying a mutation into the engineer's open scratch org would have bought no
      information. Confirmed instead that the org is unchanged and green: `--dry-run` reports
      *No changes to deploy*, and `NavigatorLayoutControllerTest` runs 41/41 at 100%.

- [x] false positive — *the guard merges "does this row still exist" with "is this row on screen",
      collapsing two rules into one.* Reproduced the fix report's own second mutation independently.
      Over-broadening `persist`'s guard to `target.layoutId !== this.layoutId` fails exactly
      *a change made while a switch is still in flight is written to the layout it was made on* and
      *a change made while a switch is in flight survives the switch landing before the debounce
      fires*, and leaves the new delete test **green** — so a currency test cannot stand in for the
      existence test. Weakening `stillExists` to `this.layouts.length > 0 && Boolean(layoutId)` fails
      the new delete test **alone**. The two mutations fail disjoint sets, which is the evidence that
      existence and currency were kept as separate rules rather than merged. The asymmetry the code
      claims — the row settled at change time, its continued existence asked at call time — is the one
      the fixture actually discriminates.
