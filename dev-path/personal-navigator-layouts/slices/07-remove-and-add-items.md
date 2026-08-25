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
fix_cycles: 0
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

**Verification.** `npm test` is **393 passed across 6 suites**, before and after every mutation and
after the deploy. `npm run lint`, `npm run lint:slds-gate` (all six assertions ok) and
`npm run prettier:verify` are clean. `grep -rn 'splice' force-app | grep -v __tests__` returns
exactly the two lines inside `reorder`. `sf project deploy start` reported the four-bundle
source-tracking conflict, the retrieve-and-diff found only the stripped trailing newline on all 14
files, and `--ignore-conflicts` then deployed 18 files `Succeeded`, Deploy ID `0AfO800000ZSNyPKAX`.
`git status` shows the touched files, the new `navigatorItemPicker` bundle, the new modal mock and
this slice — and the untracked `sketches/` directory belonging to a parallel session, which was
neither edited nor staged.

## Critique findings

- [ ] **The Add items button has the same accessible name on every card, so criterion 2's one verified
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
- [ ] **Two guards this slice's Deviations calls load-bearing are asserted by nothing — both survive
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
- [ ] **Row 30's general form is still open on two older model functions, which is the direct answer to
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
- [ ] **The picker tells a screen-reader user nothing about what the search found.** There is no live
      region anywhere in `navigatorItemPicker.html`. Typing narrows the list silently, and both empty
      states — `{noMatchMessage}` and "Every tab you can reach is already in this layout." — are plain
      `<p>`s that appear and disappear with no announcement. A sighted user watches 174 entries become
      one; a screen-reader user gets no feedback from the one control the criterion says makes 174 items
      usable and has to tab into the list to find out whether anything matched. Add a polite live region
      carrying the match count and, when there are none, the relevant empty-state sentence. Assert it as
      a region a user is *told* about, the way the section and navigator announcers are asserted, not
      merely as text present in the shadow root.
- [ ] **A picker resolved after the Navigator is disconnected schedules an autosave timer nothing will
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
- [ ] **The modal mock silently drops two of the three config values the parent passes it, and one of
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
