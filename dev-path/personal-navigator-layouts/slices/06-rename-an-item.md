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
- **Three pre-existing tests were adjusted, none weakened, and no `it` was deleted.** All three
  selected menu entries with a bare `lightning-menu-item` query, which stopped being a list of
  destinations the moment the menu grew a second kind of entry; each now filters on the `move-to-`
  prefix and its assertions are otherwise untouched. The third —
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
- 274 pre-existing jest tests all still pass. The suite is **307 across 5 suites**.
- Invariants re-checked by reading: `grep -rn 'splice' force-app` outside `__tests__` returns exactly
  two lines, both inside `reorder`; `aria-grabbed` and `aria-dropeffect` appear nowhere outside the
  tests asserting their absence; `navigatorLayoutModel` imports nothing and mutates nothing; the only
  CSS added is two layout rules carrying no colour. `npm run lint`, `npm run lint:slds-gate` and
  `npm run prettier:verify` are all clean.

### The mutation table

Each mutation was applied to shipped code by a runner that **fails loudly when its pattern does not
match**, the whole suite was run, and the file was restored. The suite is 307 and green either side of
every row. Rows 1–5 are the five the brief named; the rest are mine.

| # | Mutation | Suite noticed |
| --- | --- | --- |
| 1 | The rename is written to `id` instead of to `rename` | 16 failed |
| 2 | The rendered label ignores `rename` and always uses the platform label | 19 failed |
| 3 | Clearing a rename leaves the old one in place | 5 failed |
| 4 | The rename applies the rendered index to the stored list, so an inaccessible earlier item makes it hit the wrong one | 3 failed |
| 5 | A cleared rename survives in the payload as `rename: ""` | 3 failed |
| 6 | The section forwards `sectionIndex: 0` instead of its own index | 2 failed |
| 7 | The item reports `index: 0` instead of its own position | 7 failed |
| 8 | The committed wording is not trimmed | 2 failed |
| 9 | A rename is dispatched on every keystroke | 7 failed |
| 10 | Escape commits the draft instead of abandoning it | 1 failed |
| 11 | An unchanged commit is reported as a rename | 1 failed |
| 12 | An empty commit is refused, so a rename cannot be cleared | 5 failed |
| 13 | `renameItem` drops `copySection` and hands back the caller's own items | 1 failed |
| 14 | The announcement names the old wording twice | 2 failed |
| 15 | The whole menu is gated on having somewhere to move to again | 12 failed |
| 16 | The Rename… entry is removed from the menu | 2 failed |
| 17 | The rename is applied to state but never written | 6 failed |

**Nothing survived.** Two rows are worth reading rather than counting.

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
