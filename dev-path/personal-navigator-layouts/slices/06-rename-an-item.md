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
  - force-app/main/default/lwc/navigatorSection/__tests__/navigatorSection.test.js
  - force-app/main/default/lwc/salesforceNavigator/salesforceNavigator.js
  - force-app/main/default/lwc/salesforceNavigator/salesforceNavigator.html
  - force-app/main/default/lwc/salesforceNavigator/__tests__/salesforceNavigator.test.js
done: true
---

# Call a tab what you call it

> Watch a new test go red before you make it green.
> _Why: a test written before the code cannot be written to hit a coverage number — there is nothing to
> cover yet. Retires when Apex gets mutation testing._

## What to build

A user renames an item to their own wording, and it still takes them to the same place.

## Acceptance criteria

- [x] met — A user renames an item from its overflow menu and the new wording is displayed in place of the
      Salesforce label.
- [x] met — Clicking the renamed item navigates to exactly the same tab it did before the rename. A jest test
      sets a rename and asserts both the rendered text and an unchanged `pageReference` in one go.
- [x] met — The rename survives a page reload and a fresh login.
- [x] met — The rename is local to this user's layout — no other user's view of that tab changes, and the org's
      own tab label is untouched.
- [x] met — Clearing the rename returns the item to its Salesforce label.
- [x] met — An item with no rename picks up a subsequent change to the org's tab label without any write.
- [x] met — A rename is stored in a different field from the item's identity, so that renaming cannot alter what
      the item points at.

## Deviations

None of the *what* changed, everything was built and deployed, and all seven criteria are ticked.
This slice has no gesture ceiling: unlike the two drag slices before it, every route here is a menu
entry, an input and a commit — ordinary DOM and ordinary events — so each criterion is driven end to
end through the whole chain (item handler → section → parent → model → payload) and, where the
criterion says so, through a remount on the payload that was actually written.

Two things are recorded here rather than left to be re-derived.

**What "a page reload and a fresh login" is taken to mean (criterion 3).** A remount of the Navigator
on the JSON `updateLayout` was actually called with, which is what a reload is — nothing else survives
one. The half beyond that, that a *fresh login* re-reads the same row, is `getLayouts`'s own: it
filters on `OwnerId = :UserInfo.getUserId()` and the store is one record per user, both settled in
slice 03 and tested there under `System.runAs`. This slice adds no server-side behaviour at all and
touches no Apex — the rename rides in the same `Layout_JSON__c` payload every other item property
already does, under the contract slice 03 published.

**What criterion 4 rests on.** Both halves are structural rather than careful. *The org's own tab label
is untouched:* nothing on this path writes tab metadata — the only call a rename makes is
`updateLayout`/`createLayout` on this user's own layout row, and the payload it sends carries no
labels at all, which is the same fact criterion 6 turns into a feature. *No other user's view changes:*
the wording lives only in that row, and the store is per-user, OWD Private and owner-filtered (slice
03). Driven here as far as jsdom can: a Navigator that reads no layout of its own — which is what any
other user's first open is — shows `Accounts` for the same tab a renamed layout shows as `Clients`.
The residual exposure through reports and the API, and the admin step that closes it, is the spec's
own *What an administrator must do*, item 3; it is unchanged by this slice.

**What the fix pass changed about what two ticked criteria claim.** Both stay ticked and both claim
*more* than they did, but the boundary moved and that is worth stating rather than leaving to be
re-derived. **Criterion 5** (clearing returns the item to its Salesforce label) now has two routes
into it rather than one: emptying the box, and typing the wording the tab already carries. The second
is a consequence of the rule findings 4 and 5 were fixed by, not an interaction that was designed —
but it is the same end state, so it stores the same thing. **Criterion 6** (an item with no rename
picks up an org relabelling without a write) now holds for every item *stored without a rename*,
whichever route reached that state — including the item a user renamed to its own platform label,
which before the fix stored that wording and stopped following the org. The cost, accepted
deliberately: a user cannot pin the current platform wording against a future relabelling. Criterion
6 is the promise that they cannot.

**The boundary of that, stated rather than left to be found.** The rule is a *write*-path rule and
only a write-path rule. `renameItem` will not store wording equal to the live platform label, so no
gesture this Navigator ships can produce such a row again — but a row that already holds one keeps it
until the item is next edited. That is not a gap left open by oversight: **the read path cannot close
it.** Normalising at render time would compare `rename` against the *current* label, and by the time
the org has relabelled the tab the two no longer match, so the redundancy is undetectable at exactly
the moment it starts to matter; the information that the wording was ever the platform's is gone.
Repairing such a row would take a *write* at adoption time, on a payload the user has not touched —
which is the hazard slice 03's own criterion, and this slice's unchanged-commit rule, both exist to
prevent. Rows written by the pre-fix build and deployed to the org therefore render under their
stored wording and stop following a later relabelling, until their owner renames that item again.
`resolveLayout` renders such a row exactly as it renders one with no rename while the label stands,
which is asserted, along with what it does after a relabel.

### Decisions taken during the build

- **A cleared rename is the key's absence, not an empty string.** `renameItem` builds the stored item
  through `storedItem`, which is the same single definition the serialiser and the payload reader use,
  and it emits no `rename` for an empty one. The criterion is asserted as an *exact key set* on the
  written payload, not with `toEqual` alone, because `{id}` and `{id, rename: undefined}` are the same
  object to a structural comparison and very different things once they are JSON.
- **Emptying the box is how a user clears a rename, and that is the one place this parts company with
  the section rename it otherwise follows.** `navigatorSection` refuses an all-whitespace name and this
  does not — because the *job* differs, not the interaction. A section with no name has no header text
  and no way back to the menu that could fix it; an item with no rename has the label Salesforce gives
  it, which is where it started. Everything else is that component's pattern applied to an item: an
  inline `lightning-input`, committed on Enter or blur, abandoned on Escape, focus moved to the box on
  the render that opens it, and nothing dispatched while the user is still typing.
- **Wording committed unchanged reports nothing at all.** Opening the menu and pressing Enter is not an
  edit. Treating it as one would schedule a write, and on an item with *no* rename would freeze the
  platform label into the payload — quietly costing that item criterion 6, which is the one criterion
  whose whole point is that it costs nothing.
- **The rename box takes the anchor's place rather than sitting beside it.** The anchor is what carries
  navigation, the drag source and Space-to-grab, and all three are exactly what must not happen while
  someone is typing a name into a box. The surest way to keep a Space out of the drag pattern is for
  the thing that reads it not to be on screen; that is asserted rather than assumed.
- **The overflow menu is now always present, where before it appeared only when there was somewhere to
  move to.** This is the one deliberate change to shipped behaviour from slice 05, and it is
  load-bearing: **the seeded layout is a single section**, so a menu gated on having a destination
  would put renaming out of reach of exactly the user who has never customised anything — every user,
  on first open. What comes and goes is the *destination list*, so nobody is still offered a list that
  opens onto nothing. Restoring the old gate now fails 12 tests.
- **The announcement is made by the parent, not by the section.** Announcements about one item inside
  one section otherwise belong to the section, and nothing is rebuilt by a rename — but when a rename
  is *cleared*, the wording the item goes back to is the platform's, which the section does not know
  until after the parent has applied the change. Reading the resolved label on either side of
  `applyLayout` names both: `"Clients renamed to Accounts."`
- **`renameItem` takes `(layout, tabs, …)` like every other move function, and reads its index as a
  resolved one.** The invariant from slice 05's critique holds: there is still no exported function in
  `navigatorLayoutModel` that takes a stored index. It reuses `renderedPositions` and `storedSource`
  rather than repeating the translation, and it writes only the one item — an id the running user
  cannot reach keeps its stored position through a rename of its neighbour, which is asserted.
- **The deploy reported the same four-bundle conflict the previous slices did.** All 14 org-side files
  were retrieved to a scratchpad with `--target-metadata-dir … --unzip` — the form that cannot touch
  the working tree — and diffed against `git show HEAD:<path>`. **Every one differs only by the
  trailing newline the platform strips on retrieve**, the same source-tracking signature slices 03–05
  recorded and no org-side edit, so `--ignore-conflicts` was used. The deploy then reported all 14
  files `Changed`, `Status: Succeeded`.

### Progress log

- `renameItem` added to `navigatorLayoutModel`. 9 tests written first and watched fail with
  `renameItem is not a function`.
- `navigatorItem`: the Rename… entry, the inline input, and the commit/abandon rules. 11 tests watched
  red first.
- `navigatorSection`: `itemrename` forwarded with the section it belongs to — 2 tests watched red
  first, the first of them driven from a section built at **index 1**, per slice 05's row 13.
- `salesforceNavigator`: the single `renameItem` call site and the announcement. 11 tests watched red
  first; the two that were green on arrival are noted below.
- **Four pre-existing `it` blocks were adjusted, none weakened, and no `it` was deleted** — three in
  `navigatorItem.test.js` (`lists every destination…`, `offers no menu at all…` →
  `offers nowhere to move to…`, `reports the chosen destination upward…`) and one in
  `salesforceNavigator.test.js`. The count read "three" until the fix pass; only the count was wrong.
  All four
  selected menu entries with a bare `lightning-menu-item` query, which stopped being a list of
  destinations the moment the menu grew a second kind of entry; each now filters on the `move-to-`
  prefix and its assertions are otherwise untouched. The fourth —
  `shows no menu at all when the layout has only one section` — is the one whose *behaviour* this slice
  deliberately changes, and it was rewritten as
  `offers no destination at all when the layout has only one section`, asserting the same fact it
  always did (no destinations without a second section) plus the new one it must now allow (the menu is
  still there, because Rename… is in it).
- **Two of this slice's own tests passed the moment they were written, and that is the honest result
  rather than a gap.** `shows the user's own wording and still navigates to exactly the same tab` and
  `picks up a change to the org's own tab label, with no write at all` assert properties slices 01–03
  had already built — `resolveLayout` has rendered `rename ?? platformLabel` against a separately
  resolved `pageReference` since slice 03, and the payload has never stored a label. They are here
  because they are criteria 2 and 6, they are what this slice must not break, and both are caught by
  the mutation table below.
- 274 pre-existing jest tests all still pass. The suite was **307 across 5 suites** at build; the fix
  pass added five and took it to **312**; the second fix pass added the one `resolveLayout` test the
  last finding asked for and it is **313 across 5 suites**.
- Invariants re-checked by reading: `grep -rn 'splice' force-app` outside `__tests__` returns exactly
  two lines, both inside `reorder`; `aria-grabbed` and `aria-dropeffect` appear nowhere outside the
  tests asserting their absence; `navigatorLayoutModel` imports nothing and mutates nothing; the only
  CSS added is two layout rules carrying no colour. `npm run lint`, `npm run lint:slds-gate` and
  `npm run prettier:verify` are all clean.

### The mutation table

Each mutation was applied to shipped code by a runner that **fails loudly when its pattern does not
match**, the whole suite was run, and the file was restored. The suite is 312 and green either side of
every row. Rows 1–5 are the five the brief named; 6–17 are mine; 18 is the seam the fix pass turned
into a row of its own, and 19–22 are the four fixes, each mutated back to the defect the critic found.

The **Re-run** column is the fix pass. Every row still bites and nothing survived; the counts that
moved are named under the table.

| # | Mutation | Suite noticed | Re-run |
| --- | --- | --- | --- |
| 1 | The rename is written to `id` instead of to `rename` | 16 failed | 12 failed |
| 2 | The rendered label ignores `rename` and always uses the platform label | 19 failed | 20 failed |
| 3 | Clearing a rename leaves the old one in place | 5 failed | 7 failed |
| 4 | The rename applies the rendered index to the stored list, so an inaccessible earlier item makes it hit the wrong one | 3 failed | 3 failed |
| 5 | A cleared rename survives in the payload as `rename: ""` | 3 failed | 6 failed |
| 6 | The section forwards `sectionIndex: 0` instead of its own index | 2 failed | 2 failed |
| 7 | The item reports `index: 0` instead of its own position | 7 failed | 7 failed |
| 8 | The committed wording is not trimmed | 2 failed | 2 failed |
| 9 | A rename is dispatched on every keystroke | 7 failed | 6 failed |
| 10 | Escape commits the draft instead of abandoning it | 1 failed | 2 failed |
| 11 | An unchanged commit is reported as a rename | 1 failed | 1 failed |
| 12 | An empty commit is refused, so a rename cannot be cleared | 5 failed | 5 failed |
| 13 | `renameItem` drops `copySection` and hands back the caller's own items | 1 failed | 1 failed |
| 14 | The announcement names the old wording twice | 2 failed | 2 failed |
| 15 | The whole menu is gated on having somewhere to move to again | 12 failed | 14 failed |
| 16 | The Rename… entry is removed from the menu | 2 failed | 2 failed |
| 17 | The rename is applied to state but never written | 6 failed | 7 failed |
| 18 | The anchor renders alongside the input during a rename, rather than being replaced by it | 1 failed | 2 failed |
| 19 | `handleRenameCommit` loses its `isRenaming` guard, so a commit after Escape clears the rename | — | 1 failed |
| 20 | Wording equal to the platform label is stored as a `rename` | — | 2 failed |
| 21 | A commit that changes the payload not at all is applied and announced anyway | — | 1 failed |
| 22 | Focus does not follow the rename into the input | — | 1 failed |

**Nothing survived**, in either column.

**The second fix pass re-ran all 22 again, at 313.** Nothing survived and **exactly one count moved:
row 2 went 20 → 21.** It is the new `resolveLayout` test, and it is the same bite twice rather than a
new fact — that test's discriminating assertion is that a stored `rename` still renders after the org
relabels the tab, and row 2's mutation (`label: tab.label`) is precisely what makes it render the new
label instead. Every other row matched the Re-run column exactly: 1 **12**, 3 **7**, 4 **3**, 5 **6**,
6 **2**, 7 **7**, 8 **2**, 9 **6**, 10 **2**, 11 **1**, 12 **5**, 13 **1**, 14 **2**, 15 **14**,
16 **2**, 17 **7**, 18 **2**, 19 **1**, 20 **2**, 21 **1**, 22 **1**. No count fell, so nothing was
traded.

**The counts that moved, and the one that is a real trade.** Rows 2, 3, 5, 10, 15, 17 and 18 all went
*up*, which is the five new tests biting rows beyond their own.

**Row 1 is a different mutation, not a weaker suite.** The critic recorded two numbers for the same
property — 16 in the table and 12 in its `id` false-positive box — because there are two ways to
write it. This pass ran `storedItem(wording || item.id, undefined)` and got 12; the strict
`storedItem(wording, undefined)` was run separately in this session and fails **19**, up from the
build's 16. Neither formulation lost anything.

**Row 9 is a real trade, and here it is in full.** It fell from 7 to 6, and the movement is two
changes rather than one: it gains the new `reports nothing when a commit arrives after the rename was
abandoned`, and it loses the parent's two announcement tests. The loss was diagnosed by running row 9
with and without the finding-4 guard: with the guard, 6 failures, all in `navigatorItem`; with the
guard removed, 9. Under row 9 the keystrokes have already applied the rename by the time the commit
arrives, so the commit is a no-op — and before the fix that no-op announced `"People renamed to
People."` over the correct announcement, which is what those two tests were catching. The guard now
suppresses it, so the correct announcement survives the mutation and the tests pass. That is the
guard doing exactly what finding 4 asked for, and it masks row 9 for those two as a side effect. Row
9 is still pinned six ways, including `does not fire a rename while the user is still typing`, which
is the test that names the property rather than catching it in passing.

Two more rows are worth reading rather than counting.

**Row 16 was a survivor at 1 until a test was added for it, and the reason generalises.** Every test
that renames drives the menu's own `select` event — which is what a click or a keypress on the entry
produces — and a `lightning-button-menu` with nothing in it emits that just as happily as a full one.
So the entry could be deleted outright and only the one test that looks for it by value noticed. The
end-to-end test in the parent's suite now asserts the entry is *there* before using it, because "the
user can find this" and "the handler does the right thing when told" are two facts and the suite was
only pinning the second. It fails 2 now. This is the same shape as slice 05's note that its eight
div-menu failures were one fact asserted eight times, read from the other end.

**Row 4 is the one the fixtures were built for.** It fails 3 — one model test and two end to end —
and all three are fixtures where a stored id is *absent* from `getNavItems`, which slice 05's critique
established the previous 257 had nowhere. A rename is a per-item write and so has exactly the same
resolved-versus-stored hazard the two move axes had; it is closed the same way, by going through the
same two private helpers rather than by getting it right here.

## Critique findings

- [x] fixed — added `puts focus on the input it opened, so the rename is not a mouse-only gesture` to
      `navigatorItem.test.js`, using the critic's own `jest.spyOn(HTMLElement.prototype, "focus")`
      (restored in a `finally`, so a failure cannot leak the mock into the rest of the suite). Shipped
      code passes; the mutation — the `isRenaming` branch replaced with a bare `return` — was applied
      and watched red first:
      `expect(received).toContain(expected) // indexOf / Expected value: "LIGHTNING-INPUT" / Received
      array: []`. Shipped code was then restored from a scratchpad copy and the suite is green.
      `navigatorSection`'s identical block is still uncovered; it belongs to the slice that added it.
      **The focus-follows-rename block in `navigatorItem.renderedCallback` is not tested at all, and
      deleting it leaves the suite green at 307.** Replacing the body of the `isRenaming` branch with
      a bare `return` — so the input never receives focus when the menu entry opens it — fails
      nothing. The comment above it states the consequence exactly: the menu entry that opened the
      input is gone from the DOM by the time it renders, so without the focus call a keyboard user is
      left with focus on nothing and the rename is a mouse-only gesture. This is row 16's shape
      again: every rename test drives the input by holding a reference to it, which pins "the handler
      does the right thing when told" and not "a keyboard user can get there". **It is testable in
      jsdom** — the stub's own `focus()` does not move `shadowRoot.activeElement`, but
      `jest.spyOn(HTMLElement.prototype, "focus")` before the `select` event records the call and the
      assertion `expect(focused).toContain("LIGHTNING-INPUT")` passes on shipped code and fails on
      the mutation. Verified both ways. `navigatorSection`'s identical block is uncovered too, from
      an earlier slice; this slice added the second instance.
- [x] fixed — the test now asserts the property its name claims: the anchor is **absent** during a
      rename (`expect(anchorOf(element)).toBeNull()`), and so is any other drag source
      (`querySelector("[draggable]")`), before the Space is dispatched. The Space assertions are kept
      — with the anchor gone they say the box takes the key — and the comment now records why the
      Space alone pins nothing. Watched red under the critic's own mutation, the `lwc:else` wrapper
      removed so the anchor renders alongside the input (removing only the `lwc:else` *directive* is
      not a usable mutation — it is `LWC1077: Invalid template tag`, a setup error and not a red
      test, so the wrapper tags were removed instead):
      `expect(received).toBeNull() / Received: <a aria-describedby="rstk-nav-hint-standard-OurSite-0"
      aria-label="Our Site" class="rstk-nav-item" ... draggable="true" ...>`. That mutation now fails
      2 rather than 1, and the second is this test rather than an incidental line in another.
      **`does not navigate, grab or drag while the wording is being edited` cannot fail.** It
      dispatches `keydown(" ")` on the `lightning-input` and asserts no `itemgrab`. The grab handler
      is bound to the anchor, and a keydown raised on the input never reaches it whether or not the
      anchor is on screen — sibling nodes in one shadow root, no ancestor handler. Verified by
      mutation: with the `lwc:else` wrapper removed so the anchor renders *alongside* the input
      during a rename, exactly one test fails — `opens an input on the wording the item is currently
      shown under`, on its incidental `expect(anchorOf(element)).toBeNull()`. The property is
      therefore pinned only by that other test's one line, and the test that claims it in its name
      pins nothing. To bite, it should assert against the anchor being absent, or drive the Space at
      the item host / at whatever node a user's focus would actually be on.
- [x] fixed — `handleRenameCommit` now returns early when `isRenaming` is already false, so a commit
      that arrives after Escape is a no-op. The guard is on the *state* and not on the value
      deliberately: an empty commit is a legitimate clear for an item, so `navigatorSection`'s
      empty-name refusal could not be borrowed without giving up the clear. New test
      `reports nothing when a commit arrives after the rename was abandoned` (Escape, then `commit`)
      was watched red first:
      `expect(jest.fn()).not.toHaveBeenCalled() / Expected number of calls: 0 / Received number of calls: 1`.
      **`handleRenameCommit` has no `isRenaming` guard, and `handleRenameKeydown` blanks `draftName`
      on Escape — so any commit that arrives after Escape clears the user's rename.** Verified by
      driving the component: Escape, then a `commit` event, dispatches one `itemrename` carrying
      `rename: ""`, which for an item is destructive (the wording is dropped and the key is removed
      from the payload) rather than a no-op. `navigatorSection` has the same Escape-blanks-the-draft
      shape and is safe from it only because `handleRenameCommit` there refuses an empty name — the
      one place this slice deliberately parts company with that component is exactly what removes
      that protection. `commit` is what `lightning-input` fires on blur as well as on Enter, and
      Escape removes a focused input from the DOM; whether a given browser delivers a blur-driven
      commit on removal is browser-dependent and could not be settled in jsdom, but the handler is
      unguarded either way. Cheap fix direction: return early from `handleRenameCommit` when
      `isRenaming` is already false, or stop blanking `draftName` on Escape.
- [x] fixed — **the rule, which findings 4 and 5 now both follow: a commit stores the item's
      *effective* label, and the platform label's stored form is the key's absence — whichever route
      reached it; and a commit that changes the payload not at all is neither applied nor announced.**
      Two edits. `renameItem` reads the target's live platform label from the `tabs` it already takes
      and treats wording equal to it exactly as it treats an empty box (finding 5).
      `handleItemRename` compares `serializeLayout(next)` against `serializeLayout(this.layout)` and
      returns before `applyLayout` when they match, which closes finding 4 for every route at once
      rather than adding a second wording rule that would have to agree with the model's.
      **The consequence, judged and accepted:** typing the platform label into a renamed item is now
      a second way to clear the rename, and pinning the current platform wording against a future org
      relabelling is not on offer — which is what criterion 6 promises, so the alternative was to
      break criterion 6 for exactly the items that had been renamed once.
      New test `creates no layout row when an empty box is committed on an item with no rename`
      watched red: `expect(jest.fn()).not.toHaveBeenCalled() / Expected number of calls: 0 / Received
      number of calls: 1 / 1: {"layoutJson": "{\"schemaVersion\":2,\"sections\":[{\"name\":\"All
      Items\",\"columns\":3,\"items\":[{\"id\":\"Account\"}]}]}", "makeActive": true, ...}` — the row
      being created for a user who had only looked, visible in the payload.
      **Committing an empty box on an item that has *no* rename schedules a write that stores
      nothing.** Verified: the item dispatches `itemrename` with `rename: ""` (the unchanged-commit
      guard compares the trimmed draft against `this.label`, and `"" !== "Accounts"`), and
      `salesforceNavigator.handleItemRename` calls `applyLayout` unconditionally, so `scheduleSave`
      runs — for a user who has never changed anything that *creates* their layout row to persist a
      payload identical to the seeded one. The live region also says `"Accounts renamed to
      Accounts."`. This is the same hazard the slice's own "wording committed unchanged reports
      nothing at all" decision exists to close, reached by the other door.
- [x] fixed — same rule as finding 4 above; the model half is this one. `renameItem` now looks the
      target id's platform label up in `tabs` through a new private `platformLabelOf` and folds
      wording equal to it into the same branch as an empty box, so `{id: "A", rename: "Clients"}`
      renamed to `"Accounts"` stores `{id: "A"}` and a later relabelling to `"Accts"` reaches it
      again. New model test `clears the rename when the wording committed is the platform label
      itself` watched red: `expect(received).toEqual(expected) // deep equality / Object { "id":
      "Contact", + "rename": "Contacts" }`. Its end-to-end twin
      `clears the rename when the user types the platform label into a renamed item` was written at
      the same time and was green once the model change landed — recorded honestly rather than
      claimed as a second red.
      **Renaming an item to the exact text of the platform label, when it already has a rename,
      stores that text and quietly costs the item criterion 6.** Verified against the model: an item
      stored as `{id: "A", rename: "Clients"}` renamed to `"Accounts"` (the live label) is stored as
      `{id: "A", rename: "Accounts"}`, and a later org relabelling to `"Accts"` no longer reaches it
      — `resolveLayout` still renders `"Accounts"`. The unchanged-commit guard compares against the
      wording currently *displayed*, so the identical keystrokes on an item with no rename correctly
      store nothing. Whether a user who types the platform label means "pin this word" or "put it
      back" is a product call, but the two paths disagree today and neither the code nor the slice
      says which is intended.
- [x] fixed — the Progress log entry now reads "Four pre-existing `it` blocks were adjusted" and
      names all four with their files, keeping the rest of the record as written. Nothing about the
      edits themselves changed; only the count was wrong, as the finding says.
      **The slice records "Three pre-existing tests were adjusted"; four `it` blocks were edited.**
      Three in `navigatorItem.test.js` (`lists every destination…`, `offers no menu at all…` →
      `offers nowhere to move to…`, `reports the chosen destination upward…`) and one in
      `salesforceNavigator.test.js` (`shows no menu at all…` → `offers no destination at all…`).
      Read old against new: none is weakened. The two `menuItemsOf` → `destinationsOf` /
      `menuEntries` changes are strictly narrowing filters that select the same nodes they selected
      before the menu grew a second entry kind, with the assertions untouched; the two rewritten
      ones trade `menu is null` for `menu is not null` plus `destinations are empty` plus (in the
      item's case) `no subheader`, which is more assertions, not fewer, about the behaviour that
      deliberately changed. Only the count in the record is wrong.
- [x] false positive — "a rename can reach `id` or the `pageReference` by some path". Mutating
      `renameItem` to write the wording into `id` fails 12 tests; the sharpest test the spec names
      exists and bites (`shows the user's own wording and still navigates to exactly the same tab`,
      which asserts the rendered text is `Clients` *and* that clicking it hands
      `ACCOUNT_ITEM.pageReference` to the navigation mock, plus its live twin that renames in-session
      and re-clicks). `renameItem` builds through `storedItem`, which takes the id it was already
      holding and emits only `{id, rename?}`, and `resolveLayout` reads the target from the live tab
      by `id`. There is no path.
- [x] false positive — "the resolved-versus-stored seam is closed only for the fixture shape the
      build happened to write". Probed `renameItem` with the inaccessible item last, several
      consecutive inaccessible at the front, inaccessible interleaved through the middle, and a
      rendered index past the end of what is reachable: the wording lands on the item the user can
      see in every case, the unreachable ids keep their stored positions, and an index that names
      nothing on screen returns the layout unchanged. Mutating `storedSource(positions, itemIndex)`
      to `itemIndex` fails 3.
- [x] false positive — "a cleared rename survives as `\"\"`, `null`, or an own property with an
      undefined value". `storedItem` gates on truthiness, so the key is absent; the payload is
      asserted as an exact key set (`Object.keys(...)` `["id"]`) in both the model suite and end to
      end, and a `serializeLayout`/`deserializeLayout` round trip preserves the distinction.
      Mutating the gate to `rename !== undefined` — the version that would leave `rename: ""` in the
      payload — fails 3.
- [x] false positive — "always rendering the overflow menu breaks a slice 05 criterion, its keyboard
      path, or `hasMoveTargets`". No slice 05 criterion mentions withholding the menu; the two it
      ticks that touch the menu (destinations listed, move announced) are unaffected, and its three
      unticked ones are gesture-ceiling ones. `hasMoveTargets` is unchanged and now gates only the
      divider, the subheader and the destination list. An *empty* menu is not reachable, because
      Rename… is unconditional — the pre-change hazard of a button that opens onto nothing is
      strictly reduced, not reintroduced. Restoring the gate fails 12.
- [x] false positive — "the announcement can name the wrong thing". `before` is read from the
      resolved list before `applyLayout` and the destination label from the same getter after it, so
      a clear names the platform label it returns to and a set rename names both wordings. Mutating
      it to read `before` after the change, and separately to name `before` on both sides, each
      fails 2. The label is re-read from `this.sections` on every call rather than captured, so a
      platform label that changed between renders is picked up.
- [x] false positive — "the rename could reach a stored index through a new exported function".
      `navigatorLayoutModel` still exports no function that takes a stored item index —
      `renameItem(layout, tabs, sectionIndex, itemIndex, rename)` takes `(layout, tabs, …)` like the
      two move axes and translates through the same private `renderedPositions` / `storedSource`.
      `splice` still appears exactly twice outside `__tests__`, both inside `reorder`; `aria-grabbed`
      and `aria-dropeffect` appear nowhere outside the tests asserting their absence; no `if:true` /
      `if:false` anywhere.
- [x] fixed — **route 2, and route 1 was ruled out by running it rather than by judgement.** The
      prose was narrowed: criterion 6 now claims what the write path actually delivers — every item
      *stored without a rename*, whichever route reached that state — and a new paragraph states
      plainly that a row written before this fix keeps its redundant `rename` until the item is next
      edited, and why. **Route 1 is not merely the weaker fix, it is a no-op.** Applied it exactly
      as the finding describes it — `resolveLayout`'s label became
      `item.rename && item.rename !== tab.label ? item.rename : tab.label` — and ran the whole
      suite: **313 passed across 5 suites, nothing failed and nothing changed.** It cannot change
      anything, and the reason is the finding's own parenthesis read to its conclusion: the
      comparison is against the *current* label, so after the org relabels `Accounts` to `Accts` the
      stored `"Accounts"` matches nothing and renders as before; while the label still stands, the
      row renders identically with or without the normalisation. There is no render-time state in
      which dropping the key is both detectable and useful. The only rule that would self-heal such
      a row is a *write* at adoption time on a payload the user has not touched — which is what
      `resolveLayout`'s settled "the access filter must never leak into stored state" forbids, and
      what this slice's own finding 4 was raised about. So the code is right and the sentence was
      wrong. On the second question the finding asks: with the write path folding it away, "pin the
      current wording" is not an expressible intent through any shipped gesture, so normalising on
      read could not have lost a deliberate one either — it simply had nothing to act on.
      The critic's discriminating test exists as a `resolveLayout` test,
      `keeps a stored rename equal to the platform label when the org relabels the tab`, with the
      relabel happening *after* the payload is stored, per the finding's own instruction. Being a
      prose fix it was green on arrival — recorded honestly rather than dressed up as a red — so it
      was checked for vacuity instead: under row 2's mutation (`label: tab.label`) it fails with
      `expect(received).toBe(expected) // Object.is equality / Expected: "Accounts" / Received:
      "Accts"`. It asserts three things a future change would have to notice: the row is
      indistinguishable from an unrenamed one while the label stands, it renders the stored wording
      and *not* the new one after the relabel, and a `serializeLayout`/`deserializeLayout` round
      trip preserves the key. **No production file changed**; the box is closed by correcting a
      claim, not by changing behaviour.
      **Criterion 6, as reworded above, is over-claimed for a payload that already stores a `rename`
      equal to the platform label.** The Deviations section now says criterion 6 "holds for every
      item *shown under the platform label*, not only for those that never had a rename". It does
      not. The fix is on the *write* path only — `renameItem` refuses to store wording equal to the
      live platform label — and nothing on the *read* path normalises a `rename` that is already
      there. Driven against the shipped module: a stored
      `{sections: [{name: "S", columns: 3, items: [{id: "Account", rename: "Accounts"}]}]}` with
      `Account` labelled `Accounts` resolves to the label `Accounts`, so it *is* "shown under the
      platform label"; relabel the tab to `Accts` and `resolveLayout` still renders `Accounts`. A
      `serializeLayout`/`deserializeLayout` round trip preserves the `rename` key untouched, so
      neither `adoptActiveLayout` nor the serialiser drops it. That payload shape is reachable: it is
      exactly what the pre-fix build wrote, and the pre-fix build was deployed to the org (Deploy ID
      recorded under *Decisions taken during the build*) before this fix pass deployed over it — so
      any user who renamed an item to its own platform label in that window has an item frozen
      against org relabelling, with nothing to tell them and no gesture that repairs it short of
      renaming to something else and back. It is also what a hand-edited row can carry. Note the
      *acceptance criterion's own words* ("an item with **no rename** picks up a subsequent change to
      the org's tab label") are still satisfied and its tick is honest; it is the widened claim in
      the Deviations prose that outruns the code. Two ways to close it, and the choice is a product
      call rather than a mechanical one: **either** narrow the prose back to what the write-path fix
      actually delivers (items *stored* without a rename, whichever route reached that state),
      **or** normalise on read — drop `item.rename` when it equals the live platform label, which
      has to happen where `tabs` is available, so in `resolveLayout` (render-time, no write, but it
      only takes effect for the *current* label and cannot repair an item after the org has already
      relabelled) or in `adoptActiveLayout` (which would need `this.items`, and would schedule a
      write for a user who has only ever looked — the hazard slice 03's criterion and this slice's
      own finding 4 both exist to prevent). If the read-side route is taken it needs a test with the
      relabelling happening *after* the payload is adopted, because a test that relabels first cannot
      tell the two rules apart.
- [x] false positive — "the fix pass's account of the operator error is unverified, and the finding-5
      fix may not be in the committed tree". It is. `git show HEAD:...navigatorLayoutModel.js`
      contains `platformLabelOf` at line 307 and its call inside `renameItem` at line 532, and the
      working tree matches HEAD exactly. Mutating the fold-into-empty branch away
      (`typed === platformLabelOf(...) ? "" : typed` → `typed`) fails 2; mutating `platformLabelOf`
      to always return `""` — the shape it would take if the lookup could not find the tab — also
      fails 2, so both directions are pinned.
- [x] false positive — "a rename can be silently cleared because the platform label could not be
      found, the lost-access shape". Unreachable by construction rather than by care: `renameItem`
      only ever renames the item at `storedAt`, and `storedAt` comes from
      `storedSource(renderedPositions(items, accessibleIdsOf(tabs)), itemIndex)`, so the id it then
      hands to `platformLabelOf` is drawn from the accessible set the same call built. There is no
      input on which `platformLabelOf` returns `""` for the item being renamed. The neighbouring
      inaccessible ids are untouched, which the model test
      `renames the item the user picked when an earlier one is out of reach` and its end-to-end twin
      both assert on the written payload.
- [x] false positive — "the `serializeLayout` comparison in `handleItemRename` is an unsound stand-in
      for *did anything change*". Checked on all four grounds the brief names. **Key order:** the
      serialiser builds every object literal itself — `{schemaVersion, sections}`, then
      `{name, columns, items}`, then `storedItem`'s `{id}` with `rename` appended only when truthy —
      so the input's own key order never reaches `JSON.stringify`; driven directly, a layout whose
      section keys are written `{items, columns, name}` and whose item is `{rename, id}` serialises
      byte-identically to the canonical one. **Determinism:** no `Map`/`Set` iteration, no `Date`, no
      floats — `clampColumns` truncates and `textOf` stringifies. **`undefined` versus absent:**
      `storedItem` gates on truthiness, so `{id}` and `{id, rename: undefined}` both emit `{"id":…}`,
      which is the *correct* answer here because the payload is what is being compared. **Two
      materially different layouts colliding:** the serialised form *is* the stored contract — a
      collision means the two layouts persist identically, so skipping the write is right by
      definition; and `renameItem` can only ever alter `rename`, so equality is exactly "the rename
      did not change". Also checked that the guard does not swallow a *pending* save: a no-op commit
      made 400ms into another change's debounce leaves that debounce running and the earlier change
      is still written. Replacing the payload comparison with a wording comparison still fails 1, so
      the guard is pinned rather than incidental.
- [x] false positive — "the `isRenaming` state guard leaks under a real interleaving". Six sequences
      driven against the shipped component, all correct: Escape then commit dispatches nothing and
      leaves the wording on screen; commit then Escape dispatches once and puts the anchor back; two
      commits in a row dispatch once, not twice; a commit re-fired on the detached input after the
      component has re-rendered dispatches nothing; Escape then a *second* rename opens on the live
      label rather than on the blanked draft and commits normally, so the blanking does not leak
      forward; and a platform relabel arriving while the box is open is reported as a change rather
      than swallowed. The item-that-has-moved case cannot arise — a cross-section move destroys the
      item component in the section it left, so there is no open box to commit from — and the
      item-gone-inaccessible case destroys it the same way, because `resolveLayout` drops the id on
      the next render. A stale *index* cannot arise either: `navigatorSection.html` keys items on
      `item.id`, so a component with an open box keeps its identity across a list change and has its
      `index` reassigned, and the commit carries the current rendered position.
- [x] false positive — "row 9's fall from 7 to 6 is coverage lost rather than the trade the fix pass
      diagnosed". The diagnosis is exact. Row 9 re-run alone: **6 failed**, every one in
      `navigatorItem` — `reports the wording upward with its own position, on commit`,
      `does not fire a rename while the user is still typing`,
      `keeps the wording it had when a rename is abandoned with Escape`, both
      `asks for the rename to be cleared when the input is committed as …` cases, and
      `reports nothing when a commit arrives after the rename was abandoned`. Row 9 re-run with the
      finding-4 guard removed from `handleItemRename` at the same time: **9 failed**, the extra three
      being the parent's. So the three the guard masks are masked because under that mutation the
      commit is genuinely a no-op, which is the property finding 4 asked the guard to enforce. The
      claim that the row is still pinned by the test that names the property holds — it is the second
      of the six.
- [x] false positive — "criterion 6 is over-claimed for an item whose rename was *cleared* by typing
      the platform label". That half is sound and was driven end to end: open the renamed `Account`
      shown as `Clients`, type `Accounts`, commit — the payload written is `{id: "Account"}` with no
      `rename` key, and a subsequent `getNavItems` emission relabelling `Account` to `Accts` and
      `Contact` to `Ppl` renders both under the new wording with no `updateLayout` and no
      `createLayout`. The cleared item and the item that never had a rename behave identically
      afterwards, which is what the criterion promises. (The shape that *is* over-claimed is a
      `rename` already stored equal to the platform label — recorded as the open finding above.)
- [x] false positive — "the fix silently killed a row of the 22-row table, as a correct fix has twice
      before on this spec". All 22 rows were re-applied to the committed tree by a pattern-checked
      runner that fails loudly on a non-unique or missing match, the whole suite run, and every file
      restored from an in-memory original. **Every row still bites and every count matches the
      Re-run column exactly:** 1 **12**, 2 **20**, 3 **7**, 4 **3**, 5 **6**, 6 **2**, 7 **7**,
      8 **2**, 9 **6**, 10 **2**, 11 **1**, 12 **5**, 13 **1**, 14 **2**, 15 **14**, 16 **2**,
      17 **7**, 18 **2**, 19 **1**, 20 **2**, 21 **1**, 22 **1**. The strict form of row 1
      (`storedItem(wording, undefined)`) fails **19**, as the fix pass recorded. Deleting the
      focus-follows-rename branch of `renderedCallback` outright — not merely stopping the `focus()`
      call — still fails 1, so finding 1's new test covers the whole block and not just its last
      line. `npm test` is 312 passed across 5 suites either side of every row; `npm run lint`,
      `npm run lint:slds-gate` and `npm run prettier:verify` are clean;
      `grep -rn splice force-app | grep -v __tests__` returns exactly the two lines inside `reorder`;
      and `git status` shows no production file modified.
- [x] false positive — "the no-op argument for ruling out route 1 is unverified, and the slice may
      have closed on a mistake". Ran it independently, exactly as the finding described it:
      `resolveLayout`'s label became
      `item.rename && item.rename !== tab.label ? item.rename : tab.label`, the whole suite ran, and
      the file was restored — **313 passed across 5 suites, nothing failed**. Ran it a second time as
      a separate probe with the same result. The fix pass's argument is not merely correct, it is
      weaker than the truth: the normalisation is a **tautology**, not a rule that happens to be
      untested. Case by case on the three inputs — `rename` falsy, both forms yield `tab.label`;
      `rename` truthy and unequal to the label, both yield `rename`; `rename` truthy and *equal* to
      the label, the old form yields `rename` and the new yields `tab.label`, which is the same
      string. `resolveLayout` therefore returns a byte-identical result for every possible input, so
      no test anywhere could distinguish the two versions. The reason the fix pass gives — that after
      a relabel the stored wording matches nothing, so the normalisation cannot fire at the moment it
      would be needed — is also correct, and it is the reason the *other* read-side placements fail
      too. Confirmed independently that the settled rule the fix leans on is really settled: slice 03
      criterion at line 48, `No layout record exists for a user who has only ever looked`.
- [x] false positive — "a green-on-arrival test is inadequate here, and it may pin nothing". It bites
      under three independent mutations, none of which is the same fact twice. Row 2 (`label:
      tab.label`) fails it on its post-relabel assertion. A mutation the table does not carry —
      `serializeLayout` emitting `storedItem(item.id, undefined)`, so the serialiser drops the
      wording — fails 17 including this test, on its round-trip assertion. And
      `deserializeLayout` reading `storedItem(textOf(rawItem.id), undefined)` fails 19, again
      including this test. So two of the three properties the pass claims for it are pinned by
      distinct mutations rather than by one. The third — indistinguishable from an unrenamed row
      while the label stands — is the weak one, and it is weak for the reason above rather than by
      omission: no read-side rule can make that assertion fail, because a read-side rule is a
      tautology. Green on arrival was the only possible outcome for a pass that changed no production
      file, and the pass checked vacuity instead of dressing it up, which is the right move.
- [x] false positive — "row 2's move from 20 to 21 hides coverage traded away somewhere". Rebuilt all
      22 mutations from the table's own wording against the committed tree, in a runner that aborts
      when its pattern is not unique, running the whole suite per row and restoring every file from
      an in-memory original. **All 22 still bite and every count matches to the digit:** 1 **12**,
      2 **21**, 3 **7**, 4 **3**, 5 **6**, 6 **2**, 7 **7**, 8 **2**, 9 **6**, 10 **2**, 11 **1**,
      12 **5**, 13 **1**, 14 **2**, 15 **14**, 16 **2**, 17 **7**, 18 **2**, 19 **1**, 20 **2**,
      21 **1**, 22 **1**. Nothing survived, no count fell, and row 2 at 21 is the new test biting —
      confirmed by name in the failure list. This was reconstructed independently rather than read
      off the previous pass's runner.
- [x] false positive — "there is a third route that self-heals such a row without a write the user did
      not ask for". There is a third *placement*, and it is worse rather than better, so it is not a
      finding. Normalising at **serialize** time — `serializeLayout(layout, tabs)` dropping `rename`
      where it equals `platformLabelOf(tabs, id)` — would ride a write the user already caused rather
      than adding one, and would widen the repair window from "until that item is next edited" to
      "until anything is next saved". It fails on the rule this spec already settled: it makes the
      stored bytes a function of the running user's live accessible tab set, which is exactly the
      leak of `resolveLayout` into stored state that slice 03 forbids and that the module's own
      comment above `moveItemWithinSection` states as an invariant. `serializeLayout` is also the
      equality oracle in `handleItemRename`, so the guard would begin comparing normalised forms. And
      it inherits the same detection window as every other route: after the org relabels, nothing is
      detectable. No placement escapes that, because the relabel destroys the only evidence. The fix
      pass's conclusion stands.
- [x] false positive — "the accepted state causes user-visible harm beyond the one stated". Walked all
      five states for an item stored as `{id: "Account", rename: "Accounts"}` while `Account` is
      labelled `Accounts`. **Today:** renders `Accounts`, indistinguishable from an unrenamed row.
      **After a relabel to `Accts`:** renders `Accounts` — the stated harm, and the menu button's
      `alternative-text` reads `Actions for Accounts`, which is a consequence of it rather than a
      second one. **They edit it:** `renameItem` rebuilds that item through `storedItem`, so any new
      wording is stored and the redundant row is repaired; typing `Accts` clears it. **They clear
      it:** the box opens on `Accounts`, an empty commit is not equal to it so it dispatches,
      `renameItem` stores `{id}`, and the announcement reads `Accounts renamed to Accts.` — correct
      on both sides. **A cross-section move:** `moveItemBetweenSections` carries the item object
      verbatim, `rename` included, so the row moves in the state it was in and gains nothing new.
      Every route out of the state repairs it; none makes it worse.
- [x] false positive — "there are tests here that cannot fail, as every previous round on this spec
      found". Scanned all five suites for the signatures that produce one — `toBeDefined`,
      `toBeTruthy`, `not.toThrow`, `toBeGreaterThanOrEqual(0)`, `expect.any`, and assertions guarded
      by an `if` — across 6203 lines. Exactly one hit, `expect(call[0].layoutId).toBeTruthy()`, and
      it belongs to an earlier slice's save path rather than to this one. Read the whole of
      `renameItem`'s model block and the whole of the parent's `renaming an item` block: every test
      asserts rendered text, an exact payload key set, or a named announcement string, and the
      end-to-end ones drive the menu's own `select` after asserting the entry is there. Nothing
      vacuous.

**Verification.** Every mutation above was applied to shipped code by a runner that exits non-zero
when its pattern does not match, the whole suite was run, and the file was restored from the
in-memory original. `npm test` is 307 passed across 5 suites before and after; `npm run lint`,
`npm run lint:slds-gate` and `npm run prettier:verify` are clean; `git status` shows only this slice
file modified, no production file was left changed and no deploy was needed.

**Verification, fix pass.** `npm test` is **312 passed across 5 suites**. All 22 mutation rows were
re-run by the same kind of runner — pattern-checked, suite run, file restored — and nothing survived
in either column. `npm run lint`, `npm run lint:slds-gate` and `npm run prettier:verify` are clean.
`grep -rn 'splice' force-app | grep -v __tests__` returns exactly the two lines in `reorder`;
`aria-grabbed`, `aria-dropeffect`, `if:true`, `if:false`, `--slds-c-` and `prefers-color-scheme`
appear nowhere outside the tests asserting their absence. `sf project deploy start` reported the same
three-bundle source-tracking conflict every slice on this spec has; all 10 org-side files were
retrieved with `--target-metadata-dir <scratchpad> --unzip` — the form that cannot touch the working
tree — and diffed against `git show HEAD:<path>`. **Every one differs only by the trailing newline
the platform strips on retrieve**, so `--ignore-conflicts` was used; the deploy then reported all 10
files `Changed`, `Status: Succeeded`, Deploy ID `0AfO800000ZSJZpKAP`.

**Verification, second fix pass.** `npm test` is **313 passed across 5 suites**. All 22 rows were
re-run by the same pattern-checked runner — it aborts on a non-unique or missing match, and every file
is restored from an in-memory original — nothing survived, and the one moved count is diagnosed under
the table. `npm run lint`, `npm run lint:slds-gate` and `npm run prettier:verify` are clean;
`grep -rn 'splice' force-app | grep -v __tests__` returns exactly the two lines in `reorder`.
`sf project deploy start` reported **`No changes to deploy`** — no source-tracking conflict and no
retrieve-and-diff needed, because this pass changed no production file at all: the only edits are one
`it` block in `navigatorLayoutModel.test.js` and this slice. `git status` shows exactly those two.

One operator error is recorded rather than hidden: a `git checkout` on
`navigatorLayoutModel.js`, used mid-session to undo a probe, reverted the finding-5 fix along with
it. It was caught immediately by the suite (2 failed), reapplied, and re-verified — but the lesson is
that `git checkout` is the wrong restore tool while a fix is uncommitted in the same file. The
mutation runner's own scratchpad-copy restore, used everywhere else, has no such hazard.

**Verification, slice pass.** `npm test` is **313 passed across 5 suites** before and after every
mutation. All 22 rows were rebuilt from the table's own wording rather than reused, run through a
runner that aborts on a non-unique or missing match and restores from an in-memory original, and
every count matched. `npm run lint`, `npm run lint:slds-gate` and `npm run prettier:verify` are
clean; `grep -rn 'splice' force-app | grep -v __tests__` returns exactly the two lines in `reorder`.
No production file was changed and none was left changed — `git status` shows only this slice file
modified, alongside the untracked `sketches/` directory that belongs to a parallel session.
**Nothing real remains open on this slice.**

fix_cycles: 2
