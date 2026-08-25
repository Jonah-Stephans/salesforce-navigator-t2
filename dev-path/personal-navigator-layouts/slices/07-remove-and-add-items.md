---
depends_on:
  - dev-path/personal-navigator-layouts/slices/03-sections-and-columns.md
touches:
  - force-app/main/default/lwc/navigatorLayoutModel/navigatorLayoutModel.js
  - force-app/main/default/lwc/navigatorLayoutModel/__tests__/navigatorLayoutModel.test.js
  - force-app/main/default/lwc/navigatorItemPicker/navigatorItemPicker.js
  - force-app/main/default/lwc/navigatorItemPicker/navigatorItemPicker.html
  - force-app/main/default/lwc/navigatorItemPicker/navigatorItemPicker.css
  - force-app/main/default/lwc/navigatorItemPicker/navigatorItemPicker.js-meta.xml
  - force-app/main/default/lwc/navigatorItemPicker/__tests__/navigatorItemPicker.test.js
  - force-app/main/default/lwc/navigatorItem/navigatorItem.js
  - force-app/main/default/lwc/navigatorItem/navigatorItem.html
  - force-app/main/default/lwc/navigatorItem/__tests__/navigatorItem.test.js
  - force-app/main/default/lwc/navigatorSection/navigatorSection.js
  - force-app/main/default/lwc/navigatorSection/navigatorSection.html
  - force-app/main/default/lwc/navigatorSection/__tests__/navigatorSection.test.js
  - force-app/main/default/lwc/salesforceNavigator/salesforceNavigator.js
  - force-app/main/default/lwc/salesforceNavigator/salesforceNavigator.html
  - force-app/main/default/lwc/salesforceNavigator/__tests__/salesforceNavigator.test.js
  - test/jest-mocks/lightning/modal.js
  - jest.config.js
  - eslint.config.js
fix_cycles: 2
done: true
---

# Prune the layout down, and put things back

> Watch a new test go red before you make it green.
> _Why: a test written before the code cannot be written to hit a coverage number — there is nothing to
> cover yet. Retires when Apex gets mutation testing._

## What to build

A user removes items they never use, and adds any of them back later from a searchable list of everything
they can reach.

## Acceptance criteria

- [x] met — A user removes an item from its overflow menu and it disappears from the layout; the removal
      survives a page reload.
- [ ] A section header offers "Add items", opening a picker listing every tab the user can reach that is
      not already in the layout.
- [x] met — The picker has a search box, and finds an item by typing part of its label — with 174 items a
      scrolling list alone fails this.
- [x] met — Adding an item from the picker places it in the section the picker was opened from.
- [x] met — An item removed earlier appears in the picker and can be added back.
- [x] met — Deleting a section returns its items to the picker rather than discarding them.
- [x] met — The picker lists items under their Salesforce label, and never lists a tab the user cannot reach.
- [x] met — A user who removes every item from a section sees something that explains the section is empty and
      how to add to it, not a blank card.
- [ ] The picker is operable from the keyboard alone, and closing it with Escape adds nothing.

## Deviations

None of the *what* changed. Everything was built and deployed, and seven of the nine criteria are
ticked. **Two are left unticked, and they are the two whose substance runs through the platform's
own modal machinery** — which is not merely stubbed in this environment, it is absent. This section
says exactly what was established for each and what remains, the same discipline slices 04, 05 and
06 used for the drag gesture.

### The one thing a reader has to know before reading anything else: there is no `lightning/modal` stub

`@salesforce/sfdx-lwc-jest`'s `lightning-stubs` directory ships `modalBody`, `modalFooter` and
`modalHeader` — and **no `modal`**. So the resolver falls through and
`import LightningModal from "lightning/modal"` does not resolve at all: without a mock the picker
bundle cannot be imported by a test, never mind driven by one. This is a category worse than the
`lightning-button-menu` ceiling slice 05 recorded. There, Salesforce ships a stub carrying the real
component's property and event surface, so a test drives a contract the toolchain vouches for. Here
the contract in play is **ours**, written at `test/jest-mocks/lightning/modal.js`.

**What the mock does, and why it is that rather than a spy.** It *mounts the real component*:
`open(config)` creates the picker, applies the config as properties, appends it to the document and
returns a promise that settles with whatever the instance hands `close()`. A mock whose `open()`
merely recorded its arguments and returned a controllable promise would have left every assertion
about what the picker *lists*, what the search *finds* and what a click on an entry *does* running
against a component nothing ever rendered — the exact blind spot this spec has now found three
times, and the one the brief names: "the handler does the right thing when told" and "the user can
find this" are two different facts. So the picker's contents, its search, its entries, its two empty
states and its focus behaviour are all driven against the component that ships.

**What is therefore unverified, stated once and referred to below.** Three behaviours are the
platform's and are asserted only against our reading of its documented contract: that `open()` puts
the component on screen as a modal dialog; that Escape closes it with `undefined`; and that the
promise settles exactly once. Nothing about the picker's own code is unverified — only the base it
extends.

### Criterion 2 — a section header offers "Add items", opening a picker listing every reachable tab not already in the layout

Three clauses, and only the middle one is out of reach.

**Verified:** the header offers the button, as something a user can *find* rather than as a handler
that responds when told — it is a real `lightning-button` in the section's own header with the
section named on it, deleting it fails **22** tests, and it is clicked (not synthesised at the
parent) in every end-to-end test below. And the list is right: `availableTabs` is built by filtering
the *accessible* tab list, so there is no input on which it can name a tab the user cannot reach;
it excludes ids placed in **any** section, driven with the two placed ids in *different* sections so
"across the layout" and "in this section" are distinguishable; making it stop excluding placed ids
fails **16**, and making it list ids rather than labels fails **14**.

**What remains unverifiable here:** that `LightningModal.open()` mounts the picker as a modal in a
real browser. That is the base component's, and it is the one step the mock supplies.

**Amended by the fix pass — what "with the section named on it" was actually worth.** The claim
above was true of the button's `title` and false of its accessible name. A `<button>`'s name comes
from its content before its `title` (HTML-AAM), so the section name sat in a mouse tooltip and every
card in the layout announced the identical "Add items"; the test that looked like it covered this
asserted `.title`. So this clause is *verified again* — but it was not before the fix. Criterion 2
stays unticked for the reason it always was: `open()` mounting a real modal is the platform's.

**Amended again by the second fix pass — where the name lives now, and what it cost.** The first fix
put the section name in `lightning-button`'s `label`, which is both the visible text and the
accessible name, and that changed what a sighted user reads from "Add items" to "Add items to
&lt;section&gt;" — the section's name printed twice in a row in a header that already carries it in
its `<h2>`, in a card that does not grow. **The engineer's decision was to take the route the critic
named: a hand-rolled `<button>` whose visible text is "Add items" and whose accessible name is
completed by an assistive-text span inside it, `` ` to ${cardLabel}` ``.** An assistive-text span is
still the button's *content*, so it contributes to the accessible name exactly as `label` did, while
`slds-assistive-text` keeps it off the screen. That is the same hand-rolled-`<button>` pattern the
picker's own entries use, and for the same reason.

So the earlier sentence "`label` is the only place the name can go" was true only of a
`lightning-button`, and is superseded: what is genuinely forced is that `title` cannot carry an
accessible name, not that the name has to be visible. **The accepted cost, taken deliberately and
not by oversight: this one control stops being a base component, so its SLDS 2 adoption is ours
rather than inherited.** It is styled as the neutral button in `navigatorSection.css` from
`--slds-g-*` semantic hooks in `var(--hook, fallback)` form — surface-container background,
on-surface-2 text, the *functional* `border-2` because it is interactive, the dense 4px radius,
semibold — with `--slds-g-shadow-outline-focus-1` for the focus ring rather than a hand-rolled
outline, and no `prefers-color-scheme` and no colour-mode branch in JS. A stylesheet test pins all
of that, because jsdom applies no CSS and the class assertions alone cannot see an empty rule.

**Two things travelled with it.** The `title` is gone: with the name in the button's content, a
`title` would have been byte-identical to what the button already announces, and where an AT voices
`title` as the accessible *description* the user hears the same sentence twice — it is not paying
for itself on a control whose own words are already on screen and whose section is named in the same
header. And the empty-section message and the button's wording now come from a single `ADD_ITEMS`
constant: they drifted apart once already, when the button's wording changed under a sentence that
still said "Use Add items", and the test that was supposed to catch it asserted only that the button
*existed*. It now asserts that the sentence quotes the button's own visible text.

**The header truncates now, which is right independently of the label.** `justify-content:
space-between` over an `<h2>`, the button and the menu, with no `min-width: 0` anywhere, cannot
shrink any of them below its own content — so a long stored section name pushes the header wider
than its card, worst at six columns where the card is narrowest. The heading is the part that gives
way (`flex: 1 1 auto; min-width: 0` and an ellipsis); the button and the menu do not, because a
button whose words clipped would be worse than a truncated name. The full name stays reachable: a
`title` on the heading for a pointer, and the card's own `aria-label`, which was already there, for
a screen reader.

**Also amended: the dialog's own name.** `handleSectionAddItems` passes `label: "Add items to
&lt;section&gt;"`, which in the real platform is the dialog's accessible name — and it travelled a
path the mock could not carry, because `element[key] = config[key]` reaches an LWC component only
for `@api` properties and `label` is the base's. It was neither delivered nor asserted. The mock now
carries the base's config properly and a test reads it back, so what the parent asks for is pinned
on this side; that the platform turns that `label` into the dialog's name remains the base's.

### Criterion 9 — operable from the keyboard alone, and closing with Escape adds nothing

Two halves and both are partly the base's, which is why this one is not ticked at all.

**Verified on the keyboard half:** every control in the picker is a natively focusable element and
this component writes **no key handler whatsoever** — the entries are real `<button type="button">`s
(in the tab order, firing `click` on Enter and Space for free), the search is a `lightning-input`
and the cancel is a `lightning-button`. That is asserted as a property rather than assumed:
replacing an entry `<button>` with a `<div>` carrying the same `onclick` fails **22** tests, which
is the distinction between a control a click-driven test is happy with and one a keyboard user can
reach. Focus is put on the search box on open, pinned with
`jest.spyOn(HTMLElement.prototype, "focus")` — dropping the call fails **1**.

**Verified on the Escape half:** the picker neither handles Escape itself nor leaves a chosen id
behind when the base closes it, driven both with and without a search term typed; and end to end, a
close carrying `undefined` reaches no `applyLayout` and no save — treating that `undefined` as a
choice fails **1**.

**What remains unverifiable here:** that a real `lightning-modal` traps focus inside the dialog, and
that a real Escape closes it with `undefined`. The second is in the mock, which is our reading of
the documented contract and not the platform's code; the first is not modelled at all. Both are
browser-driver questions against a real org, which the spec's *Test entry points* places outside it.

### Decisions taken during the build

- **`addItemToSection` takes an id, not an index, and that is the point.** The settled rule from
  slice 05's critique is that no exported function may take a stored index. This one goes further:
  the picker names a *tab*, never a position, so there is no index to translate and no way to get one
  wrong. `tabs` is still taken, for a different job — it is the accessible set, and an id not in it
  is refused, because adding an id the running user cannot reach would put an item in their layout
  that never renders, which is the render-time intersection working backwards.
- **`removeItem` is the one place the resolved-versus-stored seam bites hardest**, and it takes
  `(layout, tabs, …)` like every other per-item operation, translating through the same private
  `renderedPositions` / `storedSource`. Removing "the item at visible position 2" removes the item
  the user can see; a stored id they cannot currently reach is neither moved nor dropped nor
  renumbered. The fixture that discriminates — an unreachable id sitting *before* the one being
  removed — exists at both levels, and running the resolved index into the stored list fails **3**.
- **Nothing records a removed item anywhere, and nothing needs to.** An item lives in a layout and
  nowhere else, so one that is in no section is simply one `availableTabs` offers back. That is why
  criterion 6 needed **no code change at all**: slice 03's `deleteSection` already drops the section
  outright, so the ids it held stop being anywhere, which is exactly the condition `availableTabs`
  selects on. It was checked rather than assumed, and it is now asserted at the model level and end
  to end — delete a section, open the picker, its items are on offer, add one back and it is written.
- **The picker lists Salesforce's own labels because there is nowhere for a rename to come from.** A
  rename is a property of a layout *entry*, and by definition everything on this list has no entry —
  that is what "not already in the layout" means. The criterion is structural rather than a rule
  someone has to remember. The test that discriminates keeps a rename in the payload (visible on
  screen) while asserting the picker's wording is the platform's.
- **Opening and cancelling reach no `applyLayout` at all**, guarded twice: on the resolved value
  being falsy, and on the payload-equality comparison `handleItemRename` established in slice 06.
  *(Fix pass: both guards are now asserted, and the first turns out to have a job the second cannot
  do — an empty id is in the accessible set, so without `if (!tabId)` the layout would gain an
  `{id: ""}` and the equality comparison would let the write through. A third guard joined them, on
  the component still being attached; see finding 5.)*
  Slice 03's criterion — no layout record for a user who has only ever looked — is driven against a
  user with *no* layout, so a write would be a `createLayout`, which is the row that must not exist.
  Making `open()` schedule a save fails **3**.
- **Remove abandons an open rename on its way out.** The menu is a sibling of the rename box and
  stays clickable while it is open, and removing the item destroys the input, which `lightning-input`
  blurs and therefore `commit`s — an unabandoned edit would arrive at the parent as a rename of a
  position that by then names a different item. Abandoning first is what makes slice 06's existing
  `isRenaming` guard swallow it. Removing the abandonment fails **1**.
- **The section releases a keyboard grab for a departing item on this axis too**, silently, exactly
  as `handleItemMoveTo` does. Without it `reseatOrReleaseGrab` finds the item gone on the next render
  and announces "Move cancelled. X is no longer available." assertively, while the parent announces
  "X removed from Selling." — two regions contradicting each other, and the false one the more
  alarming. This is slice 05's finding 2 reached by a third route. A *sibling* being removed does not
  release the grab, which `reseatOrReleaseGrab` already re-seats across.
- **The empty-section message names the way out.** It said "This section has no items yet." since
  slice 03, which is the "blank card" half of the criterion and not the "how to add to it" half. It
  now names the Add items button in the same card's header, and the test asserts both halves *and*
  that the route it names is actually on screen. Dropping the second half fails **2**.
- **One repo-level change beyond the mock: `eslint.config.js`'s `jest-mocks` block gained
  `globals.browser`.** These mocks run under jsdom and this one mounts a component into the document,
  so `document` is as much a global there as `jest` is. Nothing about the SLDS entries or the
  `**/lwc/**` scoping was touched, and `npm run lint:slds-gate` passes all six of its assertions.
- **The deploy reported the same four-bundle conflict every slice on this spec has.** All 14 org-side
  files were retrieved to a scratchpad with `--target-metadata-dir … --unzip` — the form that cannot
  touch the working tree — and diffed against `git show HEAD:<path>`. **Every one differs only by the
  trailing newline the platform strips on retrieve**, the same signature slices 03–06 recorded and no
  org-side edit, so `--ignore-conflicts` was used. The deploy then reported 14 `Changed` and 4
  `Created` (the new `navigatorItemPicker` bundle), `Status: Succeeded`, Deploy ID
  `0AfO800000ZSNyPKAX`.

### Progress log

- `removeItem`, `availableTabs` and `addItemToSection` added to `navigatorLayoutModel`. **24 tests
  written first and watched fail** with `removeItem is not a function` /
  `availableTabs is not a function` / `addItemToSection is not a function`. The settled seam holds:
  `removeItem(layout, tabs, sectionIndex, itemIndex)` takes `(layout, tabs, …)` like every other
  per-item operation and reads its index as a *resolved* one through the same private
  `renderedPositions` / `storedSource`; `addItemToSection(layout, tabs, sectionIndex, tabId)` takes
  an **id and not an index at all**, so there is no position to translate and no way to get one
  wrong. There is still no exported function that takes a stored index.
- **A jest mock for `lightning/modal`, at `test/jest-mocks/lightning/modal.js`, plus the
  `moduleNameMapper` entry beside the `lightning/navigation` one.** This module has **no stub at all**
  in `@salesforce/sfdx-lwc-jest` — its `lightning-stubs` directory ships `modalBody`, `modalFooter`
  and `modalHeader` and no `modal` — so without it the picker bundle cannot be imported by a test at
  all, never mind driven by one. The mock **mounts the real component** rather than standing in for
  it; see the deviation below for what it does and does not establish.
- `navigatorItemPicker`, a `lightning-modal` composed from `lightning-modal-header/body/footer`,
  `lightning-input type="search"` and `lightning-button`. 19 tests written first and watched fail
  (`Cannot find module 'c/navigatorItemPicker'`), then 7 still red on real assertions after the
  bundle existed.
- `navigatorItem`: the **Remove** entry in the existing overflow menu, unconditional for the same
  reason Rename… is. 6 tests watched red first. Remove abandons an open rename on its way out, so a
  `lightning-input` blurred out of existence cannot commit stale wording against a position that by
  then names a different item.
- `navigatorSection`: the **Add items** button in the header, `itemremove` forwarded with the section
  it belongs to, the grab released for a departing item on this axis too, and the empty-section
  message rewritten to name the way out. 8 of 9 tests watched red first — the ninth
  (`keeps a grab on its own item when a *sibling* is removed`) was green on arrival because
  `reseatOrReleaseGrab` already covers it, recorded honestly rather than claimed as a red; it is
  caught by the mutation table below.
- `salesforceNavigator`: `handleItemRemove`, `handleSectionAddItems` and the single `addChosenItem`
  call site, both announcements, and the two template wirings. 22 tests written first and watched
  fail; 17 of them stayed red on real assertions after the handlers existed.
- **313 pre-existing jest tests all still pass and not one `it` was deleted or weakened.** The suite
  is **393 across 6 suites** — 80 new: 27 in `navigatorLayoutModel`, 19 in `navigatorItemPicker`, 6
  in `navigatorItem`, 9 in `navigatorSection`, 22 in `salesforceNavigator`. Two pre-existing test
  files gained a `describe` block each; nothing existing was edited.
- Invariants re-checked by reading rather than assumed: `grep -rn 'splice' force-app | grep -v
  __tests__` returns exactly two lines, both inside `reorder`; `aria-grabbed`, `aria-dropeffect`,
  `if:true` and `if:false` appear nowhere in `force-app` outside the tests asserting their absence;
  `navigatorLayoutModel` still imports nothing and mutates nothing.

### The mutation table

Each mutation was applied to shipped code by a runner that **aborts loudly when its pattern is
missing or non-unique**, the whole suite was run, and the file was restored from an in-memory
original. The suite is 393 and green either side of every row. Rows 1–8 are the eight the brief
named; 9–31 are mine.

| # | Mutation | Suite noticed |
| --- | --- | --- |
| 1 | The picker lists items already in the layout (`availableTabs` stops excluding placed ids) | 16 failed |
| 2 | Search matches nothing | 7 failed |
| 3 | Search matches everything (the filter is a no-op) | 8 failed |
| 4 | Escape commits a selection (the base's `undefined` treated as a chosen id) | 1 failed |
| 5 | Add places the item in the wrong section (a constant 0, not the one opened from) | 3 failed |
| 6 | Remove takes the stored index instead of the resolved one | 3 failed |
| 7 | A deleted section's items fail to return (its ids stay "placed") | 5 failed |
| 8 | Opening the picker triggers a save | 3 failed |
| 9 | The Remove entry is deleted from the item's overflow menu | 3 failed |
| 10 | The Add items button is deleted from the section header | 22 failed |
| 11 | The section forwards `sectionIndex: 0` on a removal instead of its own | 4 failed |
| 12 | The section asks for the picker with index 0 instead of its own | 5 failed |
| 13 | The item reports `index: 0` on Remove instead of its own position | 2 failed |
| 14 | The empty-section message loses the half that says how to add | 2 failed |
| 15 | A picker entry becomes a `div` with the same click handler | 22 failed |
| 16 | `addItemToSection` stops refusing a tab the user cannot reach | 1 failed |
| 17 | `addItemToSection` stops refusing an id already in the layout | 1 failed |
| 18 | `addItemToSection` stores a label and an empty rename alongside the id | 5 failed |
| 19 | `availableTabs` lists ids rather than the platform label | 14 failed |
| 20 | The picker adds the first item of the *unfiltered* list, not the one clicked | 3 failed |
| 21 | `removeItem` takes out every item rather than the one named | 7 failed |
| 22 | The removal announcement names the wrong container | 1 failed |
| 23 | The addition announcement names the section but not the item | 1 failed |
| 24 | Focus does not follow the picker into its search box | 1 failed |
| 25 | A removal does not release the grab on the departing item | 1 failed |
| 26 | Remove no longer abandons an open rename on its way out | 1 failed |
| 27 | The picker's body is a plain `div` rather than `lightning-modal-body` | 1 failed |
| 28 | The picker's search box is dropped entirely | 13 failed |
| 29 | The entry's accessible name loses the section it would add to | 1 failed |
| 30 | `removeItem` drops `copySection` and hands back the caller's own item objects | **survived at first — see below** |
| 31 | `addItemToSection` drops `copySection` and hands back the caller's own item objects | 1 failed |

**Nothing survives now. Row 30 is the one worth reading, and the lesson generalises.** Replacing
`removeItem`'s body with `{...section, items: section.items.filter(...)}` left the suite fully
green. The `hands back copies` test asserted non-identity **per section and per `items` array** and
stopped there — and a `filter` over the caller's own list produces a new array holding *the caller's
own item objects*, so both assertions passed while every surviving item was shared. Writing to one
of them reaches back into the layout the caller still holds. The test now also asserts non-identity
per *item*, and writes a `rename` onto a returned item and checks the input is untouched; the same
gap was closed on `addItemToSection` at the same time, which is why row 31 exists and bites. The
general form: **an assertion on the container's identity says nothing about the contents', and a
`filter`/`map`/`concat` over the caller's list is exactly the shape that passes the first and fails
the second.**

**Row 27 is worth one sentence too, on method rather than on coverage.** Applied first as a
replacement of the opening tag only, it left the template malformed and the runner reported a count
that could not be trusted. Re-applied as a well-formed pair — `<lightning-modal-body>` and its
closing tag both becoming a `div` — it fails **1**, and that one failure is a single fact asserted
once (the picker composes from the base modal's own header, body and footer). That is adequate for
the narrow claim the design makes about composing from base components, and it is *not* evidence
that a real modal renders — which is precisely why criteria 2 and 9 are left unticked.

**The fix pass re-ran all 31 rows against the fixed code.** The suite is now **407 across 6 suites**
and green either side of every row; the runner still aborts loudly on a pattern that is missing or
non-unique, and it aborted three times before the patterns were widened (rows 6, 11 and 25 each
match a second, unrelated call site — `renameItem`'s `storedSource`, `itemdragstart`'s
`sectionIndex`, and `handleItemMoveTo`'s grab release — so each is now anchored on its own
surrounding statement). **No count fell.** Every row bites at or above the number the table records:

| # | recorded | now | | # | recorded | now | | # | recorded | now |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 16 | 16 | | 12 | 5 | 6 | | 23 | 1 | 1 |
| 2 | 7 | 25 | | 13 | 2 | 2 | | 24 | 1 | 1 |
| 3 | 8 | 10 | | 14 | 2 | 2 | | 25 | 1 | 1 |
| 4 | 1 | 2 | | 15 | 22 | 24 | | 26 | 1 | 1 |
| 5 | 3 | 4 | | 16 | 1 | 2 | | 27 | 1 | 1 |
| 6 | 3 | 4 | | 17 | 1 | 1 | | 28 | 13 | 15 |
| 7 | 5 | 13 | | 18 | 5 | 5 | | 29 | 1 | 1 |
| 8 | 3 | 5 | | 19 | 14 | 14 | | 30 | 1 | 1 |
| 9 | 3 | 3 | | 20 | 3 | 4 | | 31 | 1 | 1 |
| 10 | 22 | 26 | | 21 | 7 | 7 | | | | |
| 11 | 4 | 4 | | 22 | 1 | 1 | | | | |

The rises are the fourteen tests this pass added biting on rows they overlap — rows 10 and 15 gain
the new accessible-name and live-region assertions, rows 2, 3 and 28 gain the four live-region
tests, rows 5, 8, 12 and 20 gain the two write-guard tests and the dialog-name test, and row 7 gains
the two new model purity tests. Rows 2, 4 and 7 also differ from the build's numbers for the reason
the critic recorded: the mutation is worded differently (a hard `() => false` filter, Escape applied
in the mock, a memo inside `availableTabs`), not because coverage moved.

**Verification.** `npm test` was **393 passed across 6 suites** at build; it is **407** after this
fix pass, before and after every mutation and
after the deploy. `npm run lint`, `npm run lint:slds-gate` (all six assertions ok) and
`npm run prettier:verify` are clean. `grep -rn 'splice' force-app | grep -v __tests__` returns
exactly the two lines inside `reorder`. `sf project deploy start` reported the four-bundle
source-tracking conflict, the retrieve-and-diff found only the stripped trailing newline on all 14
files, and `--ignore-conflicts` then deployed 18 files `Succeeded`, Deploy ID `0AfO800000ZSNyPKAX`.
`git status` shows the touched files, the new `navigatorItemPicker` bundle, the new modal mock and
this slice — and the untracked `sketches/` directory belonging to a parallel session, which was
neither edited nor staged.

**The fix pass re-deployed.** `sf project deploy start` (no `--target-org`) reported the same
source-tracking conflict, on the three bundles this pass touched. All 12 org-side files were
retrieved to a scratchpad with `--target-metadata-dir … --unzip` — the form that cannot touch the
working tree — and diffed against `git show HEAD:<path>`. Every one differs only by the trailing
newline the platform strips on retrieve, so `--ignore-conflicts` was used; the deploy reported 12
`Changed`, `Status: Succeeded`, Deploy ID `0AfO800000ZSPFSKA5`. `npm run lint`,
`npm run lint:slds-gate` (all six assertions ok) and `npm run prettier:verify` are clean;
`grep -rn 'splice' force-app | grep -v __tests__` still returns exactly the two lines inside
`reorder`; and `aria-grabbed`, `aria-dropeffect`, `if:true` and `if:false` still appear nowhere in
`force-app` outside the tests asserting their absence. The untracked `sketches/` directory was again
neither edited nor staged.

**The second fix pass — the assistive-text button — re-ran all 31 rows and no count fell.** The
suite is now **409 across 6 suites** (407 plus the two stylesheet tests this pass added; the three
pre-existing button assertions were rewritten onto the accessible name and the visible text rather
than removed, so no `it` was deleted or weakened). Two rows had to be re-anchored because this pass
changed the code they mutate — row 10 now deletes the hand-rolled `<button>` block, and row 14 now
empties the `emptyMessage` getter, since the sentence moved out of the template into JS — and the
runner still aborts loudly on a pattern that is missing or non-unique. Every row bites at or above
the number the previous pass recorded: 1:16, 2:25, 3:10, 4:2, 5:4, 6:3, 7:13, 8:5, 9:3, 10:26,
11:4, 12:6, 13:2, 14:2, 15:24, 16:2, 17:1, 18:5, 19:14, 20:4, 21:7, 22:1, 23:1, 24:1, 25:1, 26:1,
27:1, 28:15, 29:1, 30:1, 31:1. **Row 6 is the only one below its "now" column (3 rather than 4), and
it is not a fall in coverage:** this runner is the previous critic's, whose row 6 runs the resolved
index into the `filter` predicate rather than into `storedSource` — the wording difference that
critic already recorded, and the 3 it already measured, which is still the number the build
recorded. Five further rows were added for this pass's own fix and are itemised in the finding
above.

`sf project deploy start` (no `--target-org`) reported the source-tracking conflict on the one
bundle this pass touched. All four org-side files were retrieved to a scratchpad with
`--target-metadata-dir … --unzip` — the form that cannot touch the working tree — and diffed against
`git show HEAD:<path>`: every one differs only by the trailing newline the platform strips on
retrieve, so `--ignore-conflicts` was used and the deploy reported 4 `Changed`, `Status: Succeeded`,
Deploy ID `0AfO800000ZSTMHKA5`. `npm test` is 409 passed across 6 suites before and after every
mutation and after the deploy; `npm run lint`, `npm run lint:slds-gate` (all six assertions ok) and
`npm run prettier:verify` are clean; `grep -rn 'splice' force-app | grep -v __tests__` is still the
two lines inside `reorder`; and `aria-grabbed`, `aria-dropeffect`, `if:true` and `if:false` still
appear nowhere in `force-app` outside the tests asserting their absence. The untracked `sketches/`
directory was neither edited nor staged.

### The last fix pass was not re-reviewed by a critic

Engineer's decision, 2026-08-24, taken at the fix cap when asked. That pass added one test and changed
no production code, and the engineer chose to skip the critic pass that would normally follow it. This
is the same route they took on slice 02, and it is recorded here for the same reason: it is a departure
from the build-review loop, and a reviewer should know which change did not get an independent read.

The orchestrator verified the added test in place of a critic, by hand rather than on the worker's
account: it applied the mutation the finding named — `addItemsAssistive` interpolating `this.name`
instead of `this.cardLabel` — ran the full suite, and saw `1 failed, 409 passed`, the single failure
being the new test. It then restored the getter from a backup taken before the mutation, confirmed line
304 reads `` return ` to ${this.cardLabel}`; `` again, and re-ran to `410 passed`.

That establishes the test bites on the defect it was written for. It is **not** equivalent to a critic
pass, which would also have looked for what the test does not cover — and on this slice the previous
three critic passes each found exactly that.

## Critique findings

- [x] fixed — the section name moved into the button's `label` (`label={addItemsLabel}`, `title`
      retained for the pointer tooltip), and a new test
      `names the section in the button's own label, which is what a screen reader reads` asserts it
      there. It was watched red first:
      `expect(received).toBe(expected) … Expected: "Add items to Support" / Received: "Add items"`
      at `navigatorSection.test.js:1150`. The pre-existing
      `offers an Add items button in its header` then failed with
      `Expected: "Add items" / Received: "Add items to Selling"` and its assertion was updated to the
      new name rather than removed. The `.title` assertion is kept — the tooltip is still set. See
      `## Deviations` for what this does to criterion 2's *verified* clause.
      **The Add items button has the same accessible name on every card, so criterion 2's one verified
      clause is weaker than it reads.** `navigatorSection.html` gives it `title={addItemsLabel}` while
      its visible text is the literal `label="Add items"`. A `<button>`'s accessible name comes from
      its content before its `title` (HTML-AAM), so `title` is a mouse tooltip and nothing else: every
      section in the layout announces "Add items", which is exactly the failure the comment above the
      button and the Deviations section ("with the section named on it") both say has been avoided.
      The test that appears to cover it, `navigatorSection.test.js:1136` "names the section on the Add
      items button", asserts `.title` — it pins the tooltip, not the name. The picker's own entries get
      this right with `aria-label={item.assistiveLabel}`, which is why row 29 is a real row and this is
      not. Fix by putting the section name into the button's `label` (or by rendering a plain `<button>`
      with an `aria-label`, as the picker entries do); `lightning-button` exposes no `aria-label`
      passthrough, so `title` cannot be made to do this job. Re-assert on the computed accessible name,
      not on `title`: mutating `title={addItemsLabel}` to a constant `title="Add items"` fails exactly
      1 test today, which is the tooltip assertion and not an accessibility one.
- [x] fixed — both guards now have a test, and both were watched red by applying the deletion.
      (a) `writes nothing when the picker closes with a falsy value that is not undefined` drives an
      entry whose `data-id` is `""` — the shape the payload-equality guard *cannot* swallow, because
      an empty id is in the accessible set and `addItemToSection` would store `{id: ""}`. Deleting
      `if (!tabId) { return; }` fails exactly that test:
      `expect(received).toEqual(expected) … - Expected - 0 / + Received + 1` on
      `itemLabelsBySection`, with `createLayout`/`updateLayout` then called. It is driven against a
      *stored* layout rather than a seeded one because `buildSeededLayout` places every reachable
      tab, so a user with no layout is offered nothing at all and the route cannot exist for them.
      (b) `writes nothing when a removal names no item on screen` fires `itemremove` with
      `{sectionIndex: 0, index: 9}` against a user `getLayouts` returns nothing for. Deleting
      `if (serializeLayout(next) === serializeLayout(this.layout))` from `handleItemRemove` fails it:
      `expect(jest.fn()).not.toHaveBeenCalled() … Expected number of calls: 0 / Received number of
      calls: 1` on `createLayout`. Each mutation failed exactly 1 test; both were restored and the
      suite is green.
      **Two guards this slice's Deviations calls load-bearing are asserted by nothing — both survive
      deletion with the suite fully green at 393.** (a) `salesforceNavigator.addChosenItem`'s
      `if (!tabId) { return; }`: removing it leaves 393 passing, because `addItemToSection` refuses an
      id absent from `tabs` and the payload-equality comparison then swallows the no-op. The Deviations
      say opening and cancelling are "guarded twice … on the resolved value being falsy, and on the
      payload-equality comparison"; only the second guard is exercised. (b) `handleItemRemove`'s
      `if (serializeLayout(next) === serializeLayout(this.layout)) { return; }`: removing it also leaves
      393 passing. That is the more consequential of the two — its own comment says it is what keeps a
      removal that stores nothing from creating a layout row for a user who has only ever looked, which
      is slice 03's criterion. Nothing in the suite drives a removal that names no item on screen. Two
      tests are wanted, both against a user `getLayouts` returns nothing for, both asserting
      `createLayout` is never called: one firing `itemremove` with an index that names no rendered item,
      and one closing the picker with a falsy-but-not-`undefined` value.
- [x] fixed — `deleteSection` and `addSection` each gained the same three-level assertion `removeItem`
      carries: per section, per `items` array, per *item* (`expect(source.items).not.toContain(item)`,
      which is what catches a container-identity-only check), plus a write-through. Both were watched
      red under the deletion. Dropping `.map(copySection)` from `deleteSection`'s `filter` fails
      `deleteSection hands back copies …` with
      `expect(received).not.toBe(expected) … Expected: not {"columns": 3, "items": [{"id": "Contact"}],
      "name": "Second"}`. Dropping it from `addSection`'s spread fails
      `addSection hands back copies …` with
      `Expected: not {"columns": 2, "items": [{"id": "Account"}], "name": "First"}`. The item-level
      mutation — `copySection` returning `items: itemsOf(section).slice()` — now fails **8** rather
      than the 6 the critic measured, which is these two joining it. Production code unchanged; the
      hole was in the suite.
      **Row 30's general form is still open on two older model functions, which is the direct answer to
      "do the older purity assertions share the hole".** The per-*item* half is now closed — making
      `copySection` return `items: itemsOf(section).slice()` (new array, the caller's own item objects)
      fails 6. But `deleteSection` and `addSection` have no `hands back copies` test at all, and each
      drops `copySection` with the suite fully green: `sections.filter((_section, at) => at !== index)`
      without `.map(copySection)` → **0 failed**, and `[...sectionsOf(layout), {…}]` without
      `.map(copySection)` → **0 failed**. Both then hand the caller's own section objects straight back.
      No live defect today (nothing mutates a layout in place), but it is the same latent aliasing row 30
      found, and this slice raises the stakes on `deleteSection` specifically: criterion 6 routes its
      output into `applyLayout` and into `availableTabs`. Give each of them the same three-level
      assertion `removeItem` now carries — per section, per `items` array, and per item, plus a
      write-through check.
- [x] fixed — the picker's body gained a polite atomic live region
      (`span.rstk-nav-picker__announcer`, `aria-live="polite"`, `aria-atomic="true"`) fed by a new
      `searchStatus` getter: "174 items available." with no term, "11 items match “Tab 13”." /
      "1 item matches “Tab 137”." with one, and each empty state's own sentence when there is nothing
      to list. The nothing-left-to-add wording moved out of the template into an `emptyLayoutMessage`
      getter so the `<p>` and the region cannot drift apart. Four tests, watched red first; the
      region-shape one is the clean red —
      `expect(received).not.toBeNull() … Received: null` on
      `element.shadowRoot.querySelector("[aria-live]")` — and the three wording ones failed off the
      same missing element. They assert the region's `aria-live`/`aria-atomic` the way the section
      and navigator announcers are asserted, not merely that the text is somewhere in the shadow root.
      **The picker tells a screen-reader user nothing about what the search found.** There is no live
      region anywhere in `navigatorItemPicker.html`. Typing narrows the list silently, and both empty
      states — `{noMatchMessage}` and "Every tab you can reach is already in this layout." — are plain
      `<p>`s that appear and disappear with no announcement. A sighted user watches 174 entries become
      one; a screen-reader user gets no feedback from the one control the criterion says makes 174 items
      usable and has to tab into the list to find out whether anything matched. Add a polite live region
      carrying the match count and, when there are none, the relevant empty-state sentence. Assert it as
      a region a user is *told* about, the way the section and navigator announcers are asserted, not
      merely as text present in the shadow root.
- [x] fixed — an `isAttached` field, set in `connectedCallback` and cleared in
      `disconnectedCallback`, now guards `addChosenItem` as its first statement, so a choice arriving
      after the user has left the tab reaches no `applyLayout` and starts no timer. The new test
      `schedules no autosave when the picker resolves after the Navigator has gone` removes the
      Navigator from the document between `open()` and the entry click and asserts on
      `jest.getTimerCount()` as well as on the Apex mocks — the hazard is the orphaned timer, not
      only the call. It was watched red: `expect(received).toBe(expected) … Expected: 0 / Received: 1`
      at `salesforceNavigator.test.js:3239`, which is exactly the 1s `setTimeout` left running.
      **A picker resolved after the Navigator is disconnected schedules an autosave timer nothing will
      flush.** `LightningModal.open` mounts the picker outside this component's tree, so it outlives the
      Navigator; `handleSectionAddItems`'s `.then((tabId) => this.addChosenItem(sectionIndex, tabId))`
      has no connected check and no `.catch`. A user who leaves the Navigator tab with the picker open
      and then chooses an item runs `applyLayout` → `scheduleSave` on a destroyed instance, starting a
      1s `setTimeout` that `disconnectedCallback` has already come and gone for. Every other write path
      in this file is driven by a template event and therefore cannot fire after disconnect; this is the
      first that can, and it is the exact hazard the `@lwc/lwc/no-async-operation` disable comment in
      `scheduleSave` argues is closed. No test covers it. Guard `addChosenItem` (or the `.then`) on the
      component still being connected, and add a test that disconnects the element between `open()` and
      the click.
- [x] fixed — the mock now separates the base's own config (`label`, `size`, `description`,
      `disableClose`) from the subclass's `@api` properties: `open()` records the four in a `configs`
      WeakMap keyed on the host instead of assigning them onto it, and `connectedCallback` adopts
      them onto the instance. That is the same bridge shape `handles` already uses, and for the same
      parser reason `@api` cannot be written in this file. A new `configOf(host)` export lets a test
      read what a component asked for. Three tests in the picker suite plus one in the navigator
      suite (`names the dialog after the section it was opened from`, driven on section **1** so
      "names the section" is distinguishable from "names the first one"). Watched red:
      `expect(received).toHaveLength(expected) … Expected length: 1 / Received length: 0` — Escape
      closed the modal despite `disableClose: true`, exactly as the critic demonstrated. Dropping
      `label` from `handleSectionAddItems` now fails 1.
      **The modal mock silently drops two of the three config values the parent passes it, and one of
      them is the dialog's accessible name.** `open()` applies config with `element[key] = config[key]`,
      which in LWC only reaches the component for `@api` properties. `availableItems` and `sectionName`
      are `@api` on the picker and do reflect; `label`, `size` and `disableClose` are plain fields on the
      mock's base class, so they land as unknown own-properties on the host (LWC logs "Unknown public
      property" for each) and the component never sees them. Demonstrated rather than reasoned:
      `open({ disableClose: true })` followed by Escape still closes the modal. The consequence for this
      slice is that `handleSectionAddItems` passes `label: "Add items to <section>"` — the dialog's
      accessible name in the real platform — through a path that could not carry it and that no test
      asserts, so criterion 2's dialog naming is unverified in a second way beyond the one the
      Deviations already own. Declare `label`, `size`, `description` and `disableClose` as `@api` on the
      mock base (or assert them off the host in a test), so a future `disableClose` is not silently
      ignored under test while working in the org.
- [x] false positive — that `removeItem`'s resolved index could renumber, move or drop an id the running
      user cannot reach. Probed directly against the shipped module with twelve fixtures: unreachable
      first, unreachable last, two consecutive unreachable at the head, two consecutive in the middle,
      the interleaved `X A Y B Z` with each of the two visible positions removed, everything
      unreachable, and indices past the end, `-1` and `0.5`. In every case the item the user can see is
      the one that goes and every unreachable id keeps its exact stored position; the out-of-range and
      non-integer cases return the layout unchanged. Row 6 (`removeItem` reading the stored index) bites
      at 3 and row 21 (taking out every item) at 7.
- [x] false positive — that `addItemToSection` taking an id rather than an index leaves a hole somewhere
      else. Probed with the id already in that same section, in a *different* section, absent from
      `tabs`, `""`, `undefined`, `null`, numeric `0` and an object: all eight return the layout
      unchanged. A successful add stores `{id}` and nothing else, and it neither reads nor writes a
      `rename` on any item — an existing rename elsewhere in the layout is untouched. Rows 16, 17 and 18
      all bite.
- [x] false positive — that criterion 6 being "satisfied by accident" means it could regress unnoticed.
      Verified rather than accepted: `deleteSection` is not touched by this commit, it drops the section
      outright, and `availableTabs` collects `placed` across every section of the layout, which is the
      condition that makes the ids reappear. It is asserted at the model level
      (`navigatorLayoutModel.test.js:1443`) and end to end twice
      (`salesforceNavigator.test.js:3089` and `:3103`, the second of which also checks the payload that
      is written). Making a deleted section's ids stay "placed" fails 12.
- [x] false positive — that opening, cancelling or escaping the picker could reach a write from some
      direction slice 06's finding suggests. All three are driven against a user `getLayouts` returns
      nothing for, so any write would be a `createLayout`, and both `createLayout` and `updateLayout` are
      asserted uncalled after the autosave has been settled. Select-then-cancel is unreachable rather
      than untested: `close()` in the mock is idempotent and the entry click removes the element.
      Row 8 (opening triggers a save) bites at 3.
- [x] false positive — that `resetModals()` leaks a still-mounted picker into the next test. It does
      leave the element in `document.body` and its `open()` promise pending, but both suites that use it
      clear `document.body` in their own `afterEach` (`navigatorItemPicker.test.js:89`,
      `salesforceNavigator.test.js:198`), so nothing crosses a test boundary. Worth knowing if a third
      suite ever imports the mock without that hook.
- [x] false positive — that the new operations could put `resolveLayout`'s output into stored state.
      Neither `removeItem` nor `addItemToSection` builds an item from a resolved one: `removeItem`
      filters the stored list by position and `addItemToSection` appends `storedItem(tabId, undefined)`.
      The end-to-end reload tests re-mount a Navigator on the payload that was actually written and get
      `{id}` / `{id, rename}` back, with unreachable ids still in place
      (`salesforceNavigator.test.js:2888`).
- [x] false positive — that the 31-row table might not reproduce. Re-run independently, every row bites.
      Row 27 reproduces the build's own note exactly: applied as a single tag it breaks the template and
      the picker suite fails to compile (the run reports 253 tests, not 393, so the count cannot be
      trusted); applied as a well-formed pair it fails **1**, as recorded. Rows whose counts differ from
      the table differ only because my wording of the mutation differs — row 4 (Escape commits a
      selection, applied in the mock) 3 rather than 1, row 5 (a constant destination section) 4 rather
      than 3, row 7 (a deleted section's ids stay placed, applied as a memo inside `availableTabs`) 12
      rather than 5, row 16 2 rather than 1. All the rest reproduce at the recorded count, including
      10 at 22, 15 at 22, 19 at 14, 28 at 13, 21 at 7, 1 at 16 and 30/31 at 1.
- [x] fixed — **the engineer chose the assistive-text route, and its cost was accepted with it.**
      The button is now a hand-rolled `<button type="button" class="rstk-nav-section__add">` reading
      `{addItemsText}<span class="slds-assistive-text">{addItemsAssistive}</span>`, so the visible
      text is back to "Add items" while the accessible name is still "Add items to &lt;section&gt;".
      It differs from the critic's sketch in two places, both deliberate: no `slds-button
      slds-button_neutral`, because the picker's own hand-rolled entries carry no `slds-button`
      either and take their appearance from `--slds-g-*` hooks in their own stylesheet — following
      the pattern this repo already has rather than introducing a second one; and the assistive text
      comes from a getter rather than being written inline, because template whitespace either side
      of an expression is collapsed by the compiler and a name reading "Add itemsto Selling" is the
      failure that would follow. The leading space is in the JS string, where nothing collapses it.
      **The accepted cost is recorded in `## Deviations`: this control is no longer a base
      component, so SLDS 2 on it is ours** — neutral-button styling from semantic hooks and a
      `--slds-g-shadow-outline-focus-1` focus ring, pinned by a stylesheet test.
      Six assertions were watched red first, all genuine assertion failures rather than setup
      errors (the old `lightning-button` stub renders an empty template, so its content read as
      `""`): `expect(received).toBe(expected) … Expected: "Add items" / Received: ""` on the visible
      text; `Expected: "Add items to Support" / Received: ""` on the accessible name computed from
      the whole button's content; the same `Expected: "Add items"` on the short-wording test;
      `expect(received).toContain(expected) … Expected substring: "Use  to" / Received string:
      "This section has no items. Use Add items to put tabs you can reach into it."` on the
      empty-message test now quoting the button's own text; `expect(received).not.toBeNull() …
      Received: null` for the missing `.rstk-nav-section__add` stylesheet rule; and
      `expect(received).toMatch(expected) … Expected pattern: /min-width:\s*0/` against the
      untruncated `.rstk-nav-section__title` rule.
      Then the fix was mutated against itself, five rows, each restored afterwards: deleting the
      assistive-text span fails **2** (the accessible-name test and the short-wording test's span
      assertion); making the span visible fails **3**; making the visible wording carry the section
      name again fails **4**; dropping `min-width: 0` and the ellipsis from the heading fails **1**;
      and taking the focus ring off the hand-rolled button fails **1**.
      **The three ripples the critic named are closed.** (a) `title` is dropped rather than kept —
      it would have been byte-identical to the accessible name, and an AT that voices `title` as the
      description reads the same sentence twice; the tooltip assertion that pinned it is not deleted
      but rewritten onto the accessible name, which is the fact worth pinning. (b) The header
      truncates: the heading is `flex: 1 1 auto; min-width: 0` with an ellipsis and a `title`, the
      button and the menu do not shrink — judged right independently of the label's length, because
      a long name at six columns overflowed either way. (c) The empty-section message is correct
      again *and* pinned: both it and the button's wording come from one `ADD_ITEMS` constant, and
      the test no longer asserts merely that the button exists but that the sentence quotes what the
      button actually reads.
      **The Add items button now prints the section name a second time in the same header, and the
      fix that put it there was sufficient rather than necessary.** This re-opens the *downstream half*
      of finding 1 only — the accessible-name defect finding 1 named is genuinely fixed, and mutating
      `label={addItemsLabel}` to a constant fails 2 tests where the old `title`-only mutation failed 1
      that was a tooltip assertion. What the fix did not have to do is change what a sighted user reads.
      `navigatorSection.html`'s header is `display:flex; justify-content:space-between` holding
      `<h2>{name}</h2>`, the button and the overflow menu, with no `min-width:0` and no truncation on
      any of them; the button's content is now `Add items to <section>`, so the header reads
      "Selling   Add items to Selling   [menu]" and a long stored section name roughly doubles the
      header's intrinsic width against a card that does not grow. Three smaller consequences travel
      with it: (a) `title={addItemsLabel}` is now byte-identical to the button's own content, so it is
      a tooltip that repeats the visible text and, where an AT voices `title` as the accessible
      *description*, the same sentence twice — dropping the `title` attribute entirely today fails
      exactly 1 test, the tooltip assertion at `navigatorSection.test.js:1136`; (b) the empty-section
      message still says "Use Add items to put tabs you can reach into it.", which no longer matches
      the wording on the control it names, and the test at `navigatorSection.test.js:1185` asserts only
      that the button *exists*, not that what it reads is what the sentence points at; (c) the sentence
      "Add items to X" is now built independently in three files —
      `navigatorSection.addItemsLabel`, `navigatorItemPicker.heading` and
      `salesforceNavigator.handleSectionAddItems`'s `label` — where before the fix the section's copy
      was a tooltip rather than a visible label. The route that was available: a plain
      `<button class="slds-button slds-button_neutral">Add items<span class="slds-assistive-text"> to
      {name}</span></button>`, which gives the accessible name "Add items to <section>" from its own
      content while the visible text stays "Add items". That is the same hand-rolled-`<button>` pattern
      the picker's own entries already use, and for the same reason. It costs the base component's
      automatic SLDS 2 adoption on this one control, which is a real trade and is why this is a
      judgement to make rather than a defect to correct blindly — but it was not weighed, and
      `## Deviations` records the visible-text change as forced ("`label` is the only place the name
      can go") when what is forced is only that `title` cannot carry it. Either take the
      assistive-text route and restore the visible "Add items", or keep the current label and close
      (a), (b) and the header's overflow behaviour deliberately.
- [x] false positive — that the fix pass's re-run of the 31-row table might not reproduce, or that a
      row might have started surviving. Re-run independently against HEAD with a runner that aborts on
      a pattern that is missing or non-unique: **nothing survives, every row bites at or above the
      number the fix pass recorded**, and 30 of the 31 land on its "now" column exactly — 1:16, 2:25,
      3:10, 4:2, 5:4, 7:13, 8:5, 9:3, 10:26, 11:4, 12:6, 13:2, 14:2, 15:24, 16:2, 17:1, 18:5, 19:14,
      20:4, 21:7, 22:1, 23:1, 24:1, 25:1, 26:1, 27:1, 28:15, 29:1, 30:1, 31:1. Only row 6 differs (3
      rather than 4) and only because my wording of it differs — the resolved index is run into the
      `filter` predicate rather than into `storedSource` — which is still above the 3 the build
      recorded. The claimed rises were sanity-checked rather than accepted: row 10's 26 is the 22
      itemised, plus `names the section in the button's own label`, `writes nothing when the picker
      closes with a falsy value that is not undefined`, `schedules no autosave when the picker resolves
      after the Navigator has gone` and `names the dialog after the section it was opened from` —
      exactly the four new tests that touch that button. Row 8's 5 and row 12's 6 decompose the same
      way. The suite is 407 across 6 suites, `lint`, `lint:slds-gate` (six assertions ok) and
      `prettier:verify` are clean, and `grep -rn 'splice' force-app | grep -v __tests__` is still the
      two lines inside `reorder`.
- [x] false positive — that `addChosenItem`'s `if (!tabId)` guards nothing the equality check cannot,
      or that the two new write-guard tests are decorative. Both claims are wrong and both were run
      rather than reasoned. Deleting `if (!tabId) { return; }` fails exactly 1 test, `writes nothing
      when the picker closes with a falsy value that is not undefined` — so without it the layout
      genuinely changes, which is only possible because `""` is in the accessible set
      (`normalizeNavItems` maps `developerName` straight through and filters nothing, so a blank
      developer name really does reach `availableTabs` as `{id: ""}`) and `storedItem("")` yields
      `{id: ""}`. Deleting `if (serializeLayout(next) === serializeLayout(this.layout))` from
      `handleItemRemove` fails exactly 1, `writes nothing when a removal names no item on screen`.
      Deleting the `isAttached` guard fails exactly 1, `schedules no autosave when the picker resolves
      after the Navigator has gone`. Three guards, three tests, one failure each.
- [x] false positive — that finding 3's fix changed behaviour, or that the item-level count was
      overstated. Confirmed: no production file changed for it, and making `copySection` return
      `items: itemsOf(section).slice()` now fails **8** — the six that failed before plus
      `deleteSection hands back copies` and `addSection hands back copies` — where the previous critic
      measured 6. Rows 30 and 31 each still bite at 1.
- [x] false positive — that `isAttached` guarding `addChosenItem` alone leaves other post-disconnect
      paths open. Every asynchronous continuation in `salesforceNavigator` was walked: the autosave
      `setTimeout` is cleared *and flushed* in `disconnectedCallback`; `connectedCallback`'s
      `getLayouts().then/.catch` can land after disconnect but assigns reactive fields only — no Apex
      call, no timer, and no render to run against — and the same is true of `persist`'s `.then/.catch`;
      the `@wire` is unsubscribed by the framework on disconnect, so a re-emission is not a path.
      `addChosenItem` really is the only continuation that can reach `applyLayout` and therefore
      `scheduleSave`, which is the only one that can leave a timer running.
- [x] false positive — that the modal mock's new machinery models the platform wrongly, or that the
      picker suite now tests a contract of its own invention. `configs`/`BASE_CONFIG_KEYS` make the
      mock *less* divergent, not more: in the real platform `open(config)` does set `label`, `size`,
      `description` and `disableClose` on the base instance, and `element[key] = config[key]` reached
      none of them, so the WeakMap-plus-`connectedCallback` adoption restores platform behaviour rather
      than inventing it. Nowhere is the mock stricter than the platform — `disableClose` here suppresses
      only Escape, where the platform also suppresses the X and the backdrop, so it is still the more
      permissive of the two and cannot manufacture a failure. `configOf` is imported by the two test
      files and by nothing under `force-app`: it is a test seam of exactly the kind
      `@salesforce/sfdx-lwc-jest`'s own `lightning/navigation` mock ships as `getNavigateCalledWith`,
      not production coupling. The one behaviour the mock still asserts on its own authority — Escape
      closing with `undefined` — is unchanged by this pass and is already owned by `## Deviations`.
- [x] false positive — that `searchStatus`, being user-facing prose built by concatenation, is wrong
      on some input. Walked every case: pluralisation agrees on both axes ("1 item matches", "11 items
      match", "174 items available"); an empty or all-whitespace query trims to `term === ""` and takes
      the "N items available." branch, so the quoted form is never rendered around nothing; a query
      matching everything is just the unfiltered count; count 0 with no term is unreachable, because an
      empty filter term passes every item, so `count === 0` implies `!hasAvailable` and the
      nothing-left-to-add sentence; a query carrying quotes or markup is safe because `{searchStatus}`
      is an LWC text binding, and the U+201C/U+201D smart quotes are deliberate — `noMatchMessage` has
      used them since the build and the new sentence matches it rather than introducing a second
      convention. `aria-live="polite"` with `aria-atomic="true"` is the right pair for a status that
      narrows as you type: assertive would interrupt the keystroke the user is still making, and
      non-atomic risks a reader voicing only the digit that changed.
- [x] fixed — one test added and no production code touched. `still names the button's target when
      the section name is blank`, in the `adding and removing items` describe beside the other two
      accessible-name tests, builds a section with `name: "   "` and asserts
      `accessibleNameOf(addButtonOf(element))` — the computed name, via the helper already in the
      file, not the span's text — is `"Add items to Unnamed section"`. It passes on the shipped code,
      as it must. **Then the mutation was applied to confirm it can fail:** `addItemsAssistive`
      changed to `` ` to ${this.name}` `` fails exactly this one test with
      `expect(received).toBe(expected) // Object.is equality / Expected: "Add items to Unnamed
      section" / Received: "Add items to"` at `navigatorSection.test.js:1173` — the control named
      after nothing, exactly as the critic described. The getter was restored and the suite is green
      at **410 across 6 suites**.
      **The card's own `aria-label` does not share the gap**, checked rather than assumed with the
      adjacent mutation: emptying `cardLabel`'s fallback to a bare `return this.name;` fails **2** —
      the pre-existing `still names a card whose section name is empty` with
      `Expected: "Unnamed section" / Received: "   "`, and the new button test. So the fallback is
      now pinned at its source and on both of its two consumers, and no widening of this fix was
      needed. `npm test` 410 passed, `npm run lint` and `npm run prettier:verify` clean; no deploy,
      because a test file is not deployed metadata.
      **The engineer chose to skip the critic re-review on this pass** — a deliberate decision, not
      an omission: the scope was a single test file, production code is provably unchanged
      (`git diff --stat` shows only `navigatorSection.test.js`, +13), and the finding's own mutation
      is the acceptance check, which was run.
      The Add items button's accessible name silently loses the "Unnamed section" fallback under
      mutation: changing `navigatorSection.addItemsAssistive` from `` ` to ${this.cardLabel}` `` to
      `` ` to ${this.name}` `` leaves the suite fully green at **409**. The shipped code is correct —
      it reads `cardLabel`, which is the slice 04 fallback — but nothing asserts it, so the one input
      shape the fallback exists for is uncovered on the very control this whole thread exists to
      protect. A stored layout can arrive with a blank or all-whitespace section name
      (`navigatorSection.js:213-217` says so in as many words, and `handleRenameCommit` only refuses
      *new* blank names), and on that layout the regressed getter announces the button as
      "Add items to" with nothing after it — a control named after nothing, which is the same defect
      class finding 1 was raised for. Every neighbouring branch of this fix *is* pinned: dropping the
      assistive span fails 2, making it visible fails 3, putting the section name back in the visible
      wording fails 4, and dropping the leading space from the getter fails 1. Only the blank-name
      branch is not. Add a test in `navigatorSection.test.js`'s `adding and removing items` describe
      that creates a section with `name: ""` (or `"   "`) and asserts the button's computed
      accessible name — `accessibleNameOf(addButtonOf(element))`, the helper already in that file —
      is `"Add items to Unnamed section"`. The existing blank-name test at
      `navigatorSection.test.js:898` covers only the card's `aria-label`, which is why this survives.
- [x] false positive — that the button wanting `slds-button slds-button_neutral` is a real gap,
      given that "a button that looks like a button" differs from a list entry. Checked against the
      shipped stylesheet rather than reasoned: `.rstk-nav-section__add` is a *complete* neutral-button
      recipe from semantic hooks — padding, `border-2` (the functional colour, which is the right one
      for an interactive control), the dense `radius-border-1`, `surface-container-1` background,
      `on-surface-2` text, `font-scale-1`, `font-weight-6`, a hover on `surface-container-2` and a
      `--slds-g-shadow-outline-focus-1` focus ring. Adding `slds-button_neutral` on top would layer a
      second, independently-versioned definition of the same six properties over it, which is a
      conflict rather than an improvement; and `navigatorItemPicker.css` establishes exactly this
      pattern for the repo's other hand-rolled buttons. Every hook used is `--slds-g-*` in
      `var(--hook, fallback)` form with the fallback the linter itself suggests, and not one of them
      is in the 38 that carry no `light-dark()` — no `palette-*`, no `*-base-50`/`*-base-100`, no
      `accent-container-1`, no `disabled`, no `accent-light-*`/`accent-dark-*` — so the control
      resolves per colour mode with no `prefers-color-scheme` and no JS branch, and the stylesheet
      test's negative assertion pins that. `npm run lint`, `npm run lint:slds-gate` (six assertions
      ok) and `npm run prettier:verify` are clean.
- [x] false positive — that the `addItemsAssistive` getter is "indirection for nothing" because the
      whitespace claim behind it is false. The claim as *worded* is imprecise, but the getter is the
      right call for a reason the comment does not give, and the critic's inline sketch would have
      been worse. Verified by compiling rather than by reading docs: `@lwc/template-compiler` 8.28.2,
      fed the real `navigatorSection.html` with the span rewritten to the sketch's
      `<span class="slds-assistive-text"> to {name}</span>`, emits
      `api_static_part(3, null, " to " + api_dynamic_text($cmp.name))` — **the single inline leading
      space survives**, and `npx prettier --write` leaves that line byte-identical rather than
      reflowing it. So "template whitespace either side of an expression is collapsed by the
      compiler" is false for a plain inline space. What *is* true, and is presumably what the
      sentence was reaching for: whitespace containing a **newline** is dropped outright — the same
      probe with `{addItemsText}\n<span …>to {name}</span>` emits `"to "` with no leading space and
      no trailing space on the part before it, so the moment Prettier has cause to break that line
      the space is gone silently. The decisive point against the sketch is different again and is not
      about whitespace at all: the sketch interpolates `{name}`, and the getter interpolates
      `cardLabel`, which is the only thing that keeps a blank stored name from producing
      "Add items to". The getter is therefore load-bearing, not indirection. The rationale in
      `navigatorSection.js` and in `## Deviations` overstates its case, which is a wording matter and
      not a defect in the control. The template file was restored byte-identically — `git status`
      shows no modification to it.
- [x] false positive — that dropping the button's `title` while keeping `title={cardLabel}` on the
      `<h2>` is inconsistent, since the heading's `title` is byte-identical to its own text whenever
      the name is non-blank and therefore repeats it the same way. The two cases genuinely differ.
      The `<h2>` is non-interactive and its `title` is there for a *pointer* over text the stylesheet
      now clips with an ellipsis — the standard idiom for CSS-truncated content, and the only way a
      mouse user reads a name they can no longer see in full. The button's `title` was on an
      interactive control that is focused, whose accessible name is computed from its content and
      whose `title` is then voiced as the *description* on that focus — two announcements of one
      sentence on one Tab stop. Nothing on the `<h2>` is focused, so there is no second announcement
      to collide with, and a screen reader user already has the full name on the card's own
      `aria-label`. Checked in the shipped template: the `title` is on the `lwc:else` branch only, so
      it is absent while the rename input is up, and `.rstk-nav-section__title` really does carry
      `overflow: hidden; white-space: nowrap; text-overflow: ellipsis`, which is what makes the
      tooltip earn its place.
- [x] false positive — that the truncation change breaks the rename input, the overflow menu or the
      drag affordance, or that the two new stylesheet tests are written so they cannot fail. Read the
      whole header: `.rstk-nav-section__rename` gained the matching `min-width: 0` in the same pass,
      so the input shrinks exactly as the heading it replaces does; `lightning-button-menu` has no
      rule at all and so keeps its default `flex-shrink: 1` with a min-content floor set by its own
      fixed-size icon, which is why it does not squash; `.rstk-nav-section__add` is explicitly
      `flex: 0 0 auto` with `white-space: nowrap`. The card's `draggable`/`tabindex` are on the
      `<article>` and untouched. On the tests: they were mutated rather than trusted — deleting
      `min-width: 0` and the ellipsis from `.rstk-nav-section__title` fails **1**, and replacing the
      focus-ring `box-shadow` with `opacity: 1` fails **1**, so both bite on the property they
      claim. `expect(base[0]).toContain("--slds-g-")` on its own is weak, but it is not the load
      the rule carries: `npm run lint:slds-gate` and `no-slds-var-without-fallback` police hook
      policy, and the negative `expect(css).not.toMatch(/prefers-color-scheme|--slds-c-|--lwc-/)` is
      the assertion that catches the dark-mode escape hatch nothing else can.
- [x] false positive — that the hand-rolled button stops behaving like a button. It is a native
      `<button type="button">`, so Enter and Space fire `click` with no key handler of this
      component's, and it sits in DOM order between the `<h2>` and the overflow menu, which is its
      tab order. The one interaction worth checking is that Space on it does not also grab the whole
      card: `handleCardKeydown` is bound on the `<article>` and returns immediately unless
      `event.currentTarget === event.target`, and for a `<button>` in this same shadow root the
      target is the button, so the guard holds and the section is not grabbed. It is never disabled,
      and the hit area is ~27px tall (0.875rem text plus `spacing-1` top and bottom plus the 1px
      border), which clears the 24x24 CSS-pixel target-size floor. `type="button"` itself survives
      deletion with the suite green, but there is no `<form>` anywhere in this component tree for a
      default `submit` to reach, so that is untested defensiveness rather than an untested behaviour.
- [x] false positive — that a row of the mutation table has started surviving, or that row 6's
      explanation for landing at 3 rather than 4 does not hold. Re-run against HEAD with a runner
      that aborts on a pattern matching other than exactly once. Row 6's two wordings are not the
      same mutation, which is the whole explanation: anchoring on `storedSource` (`const storedAt =
      itemIndex;`) *also* deletes the `if (storedAt === undefined) return unchanged;` out-of-range
      guard, so it takes down one extra test — and that pattern is non-unique in
      `navigatorLayoutModel.js` (`renameItem` carries the identical statement), which is why the
      runner aborted on it here exactly as the previous critic recorded. The narrower wording, the
      resolved index run into `removeItem`'s own `filter` predicate, fails **3**, which is the number
      the build recorded and above nothing. The rows this pass's fix actually rewrote all still bite
      at or above their recorded counts: row 10 (the hand-rolled `<button>` block deleted) **26**,
      row 14 (the `emptyMessage` getter emptied of its second half) **2**, row 29 (a picker entry's
      `aria-label` dropped) **1**. So does the pass's own five: the assistive span deleted **2**, the
      span made visible **3**, the section name put back in the visible wording **4**, the heading's
      truncation dropped **1**, the focus ring taken off **1**. Two further mutations of my own on
      this pass's code: the leading space dropped from the getter fails **1** (so the space is
      pinned, and pinned on the computed name rather than on the string), and the `<button>` turned
      into a `<div>` carrying the same `onclick` fails **20**. The only survivor found is the
      blank-name fallback, raised above. `npm test` is 409 across 6 suites before and after every
      mutation, and every file was restored — `git status` shows only this slice modified.
