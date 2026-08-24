---
done: true
depends_on:
  - dev-path/personal-navigator-layouts/slices/02-tab-and-navigation.md
touches:
  - force-app/main/default/objects/Navigator_Layout__c/Navigator_Layout__c.object-meta.xml
  - force-app/main/default/objects/Navigator_Layout__c/fields/Is_Active__c.field-meta.xml
  - force-app/main/default/objects/Navigator_Layout__c/fields/Layout_JSON__c.field-meta.xml
  - force-app/main/default/objects/Navigator_Layout__c/fields/Schema_Version__c.field-meta.xml
  - force-app/main/default/objects/Navigator_Layout__c/fields/Sort_Order__c.field-meta.xml
  - force-app/main/default/classes/NavigatorLayoutController.cls
  - force-app/main/default/classes/NavigatorLayoutControllerTest.cls
  - force-app/main/default/permissionsets/Salesforce_Navigator_User/Salesforce_Navigator_User.permissionset-meta.xml
  - force-app/main/default/permissionsets/Salesforce_Navigator_User/objectSettings/Navigator_Layout__c.objectSettings-meta.xml
  - force-app/main/default/lwc/navigatorLayoutModel/navigatorLayoutModel.js
  - force-app/main/default/lwc/navigatorLayoutModel/navigatorLayoutModel.js-meta.xml
  - force-app/main/default/lwc/navigatorLayoutModel/__tests__/navigatorLayoutModel.test.js
  - force-app/main/default/lwc/navigatorSection/navigatorSection.js
  - force-app/main/default/lwc/navigatorSection/navigatorSection.html
  - force-app/main/default/lwc/navigatorSection/navigatorSection.css
  - force-app/main/default/lwc/navigatorSection/navigatorSection.js-meta.xml
  - force-app/main/default/lwc/navigatorSection/__tests__/navigatorSection.test.js
  - force-app/main/default/lwc/salesforceNavigator/salesforceNavigator.js
  - force-app/main/default/lwc/salesforceNavigator/salesforceNavigator.html
  - force-app/main/default/lwc/salesforceNavigator/salesforceNavigator.css
  - force-app/main/default/lwc/salesforceNavigator/__tests__/salesforceNavigator.test.js
---

# Group tabs into named sections that survive a reload

> Watch a new test go red before you make it green.
> _Why: a test written before the code cannot be written to hit a coverage number — there is nothing to
> cover yet. Retires when Apex gets mutation testing._

## What to build

A user groups their tabs into named sections at a column count they choose, and finds those sections
still there tomorrow.

## Acceptance criteria

- [x] met — A user opening the Navigator for the first time sees every tab they can reach in one section named
      "All Items". It is **computed, not written**: `navigatorLayoutModel.buildSeededLayout` builds it
      from the tabs `getNavItems` reports, and `salesforceNavigator.layout` returns it whenever
      `storedLayout` is undefined, so the seeding never occupies state that a later reader could
      mistake for stored data. `firstOpen › shows every reachable tab in one section named All Items`
      asserts the section count, the header text and every item label in order.
- [x] met — No layout record exists for a user who has only ever looked — the first record is written on their
      first actual change.
      `first open › writes no layout record for a user who has only ever looked` renders, waits past
      the whole autosave debounce and asserts **neither** `createLayout` **nor** `updateLayout` was
      called, while the seeded items are on screen. Mutation-checked: making `adoptActiveLayout`
      persist the seeded layout when the user owns none turned it red.
      `autosave › saves the seeded arrangement along with the first change` covers the other half —
      the first write carries the seeded sections *plus* the change, so nothing is lost by not having
      been written earlier.
- [x] met — A user can create a section, give it a name, rename it, and delete it.
      Create is the card's **New section** button; name and rename are the section's own
      *Rename section…* menu item and inline `lightning-input`, committed on Enter or blur; delete is
      the menu's *Delete section*. Each is a pure function in `navigatorLayoutModel` — `addSection`,
      `renameSection`, `deleteSection` — driven end to end by
      `sections, names and column counts › creates a new section on request…`, `…renames the section
      the user renamed, and saves the new name` and `…deletes the section the user deleted, and saves
      the layout without it`, each asserting both the rendered header and the payload that reached
      Apex. `c-navigator-section`'s own suite holds down the edges the parent cannot see: a rename
      does not fire per keystroke, Escape abandons it, and an all-whitespace name is refused rather
      than leaving a card with no header and no way back to the menu.
- [x] met — A user can set a section's column count to any value from one to six, and the section renders its
      items in that many columns.
      The count is a **computed class**, `cols-1` … `cols-6`, each a CSS Grid
      `repeat(N, minmax(0, 1fr))` in `navigatorSection.css` — not `lightning-layout`, whose `size` is
      a 1–12 integer span and cannot express five columns, and not an inline style, which would mean
      `width` and would be flagged by the SLDS linter while `grid-template-columns` is not on its
      validated-property list. Two tests per count rather than one, because a class-name assertion on
      its own cannot tell a meaningful class from a typo: the parameterised
      `renders the section in %i columns once the user chooses that count, and stores it` drives the
      real menu and asserts the rendered grid class *and* the stored `columns`, and
      `defines a real CSS Grid template for every column count the menu offers` reads the shipped
      stylesheet and pins that each of the six is a grid of that many equal tracks — the half jsdom
      applies no stylesheet for. `offers exactly one column choice per supported count, and no others`
      pins the menu to the model's own `MIN_COLUMNS`/`MAX_COLUMNS`, and the range is clamped inside
      `navigatorLayoutModel` so no route can compute a `cols-12` no stylesheet defines.
- [x] met — Sections, names and column counts survive a page reload and a fresh login.
      They survive because they are in `Navigator_Layout__c`, owned by the user, and nothing about the
      layout lives in the browser. `surviving a reload › renders the stored sections, names and column
      counts rather than the seeded layout` is the reload: a fresh component instance, a `getLayouts`
      returning a stored payload, and assertions on both section headers, both grid classes and the
      **stored item order** rather than the platform's alphabetical one — the last of which is what
      distinguishes a genuinely restored layout from a re-seeded one that happens to look similar.
      `prefers the user's active layout over the first one they own` pins which row is restored.
- [x] met — A change is saved without the user pressing anything; a burst of rapid changes results in one save,
      not one per change.
      One `setTimeout` at `AUTOSAVE_DELAY_MS = 1000`, cleared and reset on every change, and a
      `saveChain` promise so two saves cannot overlap. `coalesces a burst of rapid changes into one
      save carrying the last of them` makes five changes 100ms apart and asserts **one** call *and*
      that its payload carries the fifth change — a leading-edge debounce would pass a call-count
      assertion alone and lose four changes. `saves nothing at all until the debounce elapses`
      advances to one millisecond short. There is no unsaved state to lose: `disconnectedCallback`
      runs a pending save rather than dropping it (`flushes a pending save when the component goes
      away`), and a refused save leaves the change on screen and the layout id untouched, so a failed
      update never becomes a create (`keeps the user's change on screen, and its id, when the save is
      refused`).
      The controller's two-method split is honoured on this side and asserted three ways:
      `updates the record the first change created rather than creating a second one` (a create then
      an update against **the id the create returned** — the exact overwrite the split exists to
      prevent), `updates the layout it loaded, by that layout's own id, and never creates`, and
      `never asks the controller to update a null id`.
- [x] met — A second user opening the Navigator sees their own sections, never the first user's, and
      cannot reach the first user's layout through ordinary record access.
      `NavigatorLayoutControllerTest.peerCannotReadAnotherUsersLayouts` proves the read half and
      `aUserCannotUpdateAnotherUsersLayout` the write half — holding another user's record id is not
      enough, and the refusal does not distinguish "not yours" from "does not exist". Both run under
      `System.runAs` a genuine Standard User. The query is `WITH USER_MODE` *and* explicitly
      predicated on `OwnerId = :UserInfo.getUserId()`; sharing is defence in depth, never the filter.
- [ ] A user whose manager sits above them in the role hierarchy is not visible to that manager — the
      object grants no access through hierarchies.
- [x] met — An item whose tab the user has lost access to stops rendering, and the stored layout is unchanged:
      restoring access restores the item to its original position.
      `navigatorLayoutModel.resolveLayout` intersects the stored ids against the live accessible set
      on **every** render and returns new objects; it never writes and never mutates its input. Four
      tests, and the third is the one that matters most. In the model:
      `stops rendering an item whose tab the user has lost access to`, and
      `leaves the stored layout completely unaltered when it drops an item`, which deep-compares
      against a copy taken beforehand so an in-place splice is caught and not merely a reassignment.
      In the component: `leaves the stored layout carrying the lost item, even across a save` —
      the item is unrendered, the user then changes something *else*, the autosave fires, and the
      payload that reaches Apex still carries all three ids in their original order. Without that
      one, a render-time prune that had leaked into stored state would pass every other assertion
      here and silently delete the user's item on their next unrelated edit.
      `restores the item in its original position when access returns` re-emits a wider accessible
      set against the same stored layout and asserts the item is back **between** its neighbours, not
      appended. Mutation-checked: making the intersection return everything turned five tests red.
- [x] met — The stored payload carries no tab labels — an org relabelling a tab is reflected on the
      next render with no write.
      `theStoredPayloadCarriesNothingDerivableFromThePlatform` hands the controller a payload
      carrying `label`, `iconUrl` and `pageReference`, then re-queries the row and asserts none of
      the three is in `Layout_JSON__c` while `id` and `rename` survive. They are dropped by
      construction rather than by a rule someone has to remember: the normalising walk emits `name`,
      `columns`, `id` and `rename` and nothing else, and it is the only route into the blob.
      _The rendering half of this criterion is the LWC pass's — nothing can relabel until something
      draws a label._ **Done in the UI pass.** `navigatorLayoutModel.resolveLayout` is the only place
      a label is attached to a stored item, and it takes it from the live tab source every render:
      `renders each stored item under its live platform label and pageReference`. The client half of
      the payload contract matches the Apex half by construction — `serializeLayout` emits
      `schemaVersion`, and per section `name`, `columns` and `{id, rename?}`, and nothing else, so a
      label that reaches it is dropped (`drops a label, an icon and a pageReference that reached it by
      accident`; `seeds a layout that stores nothing derivable from the platform`). Mutation-checked:
      making the serialiser spread the item through instead turned that test red.
- [x] met — The stored payload carries a schema version, and the code that reads it dispatches on
      that version. `Schema_Version__c` is stamped on every write and `schemaVersion` is written into
      every payload including an empty one. Four tests hold it down:
      `aV1RowIsUpgradedToV2OnRead` (a v1 row's bare-string items come back as `{id}` objects, column
      counts intact, **and the row is still at v1 afterwards** — reading never writes),
      `savingAlwaysStampsAndWritesTheCurrentVersion` (a v1 payload handed to a save is written back
      at v2), `anUnreadableFutureSchemaVersionIsRefusedRatherThanGuessedAt` (a v99 row raises and the
      message names the version) and `anEmptyPayloadIsStoredAsALayoutWithNoSections`.
- [x] met — Apex tests cover the controller under `System.runAs` for a non-administrator, and at the
      bulk volume the repository's testing rule requires. All 18 methods run under `System.runAs` a
      user on the genuine **Standard User** profile, not an admin;
      `activationStaysOneUpdateAcrossTwoHundredLayouts` is the 200-record bulk test. It is written to
      earn its place rather than to satisfy the hook: it seeds all 200 layouts active so the
      activation clearing does real work, then asserts exactly one survives, that it is the right
      one, and that the cost stayed O(1) — `dmlUsed <= 2` and `queriesUsed <= 3` regardless of
      volume. 18/18 pass; `NavigatorLayoutController` is at 92% coverage.

## Deviations

- [x] **"Grant Access Using Hierarchies" cannot be shipped as source, and the design assumes it can.**
      `## Design` → _The store_ specifies the object as "OWD Private, Grant Access Using Hierarchies
      OFF" and one acceptance criterion turns on it. **The flag is not expressible in the Metadata
      API**, established against the live scratch org at API 67.0 rather than from documentation:

      1. Deployed `Navigator_Layout__c`, then retrieved it back. The server round-trips
         `<sharingModel>`, `<externalSharingModel>` and `<enableSharing>` and emits **no** hierarchy
         element — and it does emit defaults, so absence is not suppression.
      2. `Settings:Sharing` (`SharingSettings`) carries thirteen org-wide switches, none per-object
         and none about hierarchies. `SharingRules:Navigator_Layout__c` came back an empty element.
      3. Tooling `EntityDefinition` exposes only `InternalSharingModel` / `ExternalSharingModel`;
         Tooling `CustomObject` exposes only `SharingModel`.
      4. Dry-run deploys of `<enableHierarchicalSharing>`, `<grantAccessUsingHierarchies>`,
         `<enableGrantAccessUsingHierarchies>` and `<sharingModelHierarchy>` each failed with
         `Element {…}<name> invalid at this location in type CustomObject` — **the identical error a
         deliberately bogus `<totallyBogusElementXyz>` control produced.** The server does not
         recognise the concept on `CustomObject` under any spelling.

      So the toggle is Setup-only: Setup → Sharing Settings → Organization-Wide Defaults → untick
      **Grant Access Using Hierarchies** on Navigator Layout. That is a third documented admin step,
      alongside the two the spec already carries in `## Out of scope` (placing the tab in an app,
      assigning the permission set) — but unlike those two it is **load-bearing for an Outcome**, not
      just for reach. Until it is performed, every manager above a user in the role hierarchy can
      read that user's layouts, and the isolation Outcome is not met in the org.

      This is a design question, not a build one, so this pass did not decide it.

      **Resolved. Engineer's decision, 2026-08-24, taken in the `dev-path:build` session when asked and
      recorded here at their request: accept it as a third documented admin step**, alongside the two
      the spec already carries. `spec.md` → `## Out of scope` and `## Design` → *What an administrator
      must do* have been updated to carry it, with the note that this third step differs from the other
      two in being load-bearing for an Outcome rather than only for reach.

      The acceptance criterion below stays unticked, because the criterion is a claim about the org and
      the org is not in that state until an admin acts. It is not a defect and not deferred work: the
      object ships at OWD Private, which is the half source can deliver, and the remaining half is a
      documented Setup action. What makes this tolerable rather than a hole is the paragraph following
      — the Navigator itself is safe either way.

      The peer-isolation half of the Outcome — a second user cannot reach the first user's layout —
      **is** met and is asserted by `NavigatorLayoutControllerTest.peerCannotReadAnotherUsersLayouts`.

- **The JSON payload declares its own version, and the save path reads it.** _How_, not _what_ — the
      slice still ships one versioned deserialiser reading v1 and writing v2; this is how it decides
      which version it is looking at.

      The first green run had exactly one failure, and it was the test catching a real gap rather
      than the test being wrong. The write path parsed incoming payloads at the current version, so a
      client holding a v1 payload was rejected outright. That is not hypothetical: during a package
      upgrade a user with a browser tab still running the previous bundle keeps autosaving in the
      previous shape, and every drag they make would throw.

      So the version is now resolved from two different authorities, one per direction, because each
      is the only reliable one in its own situation:

      | Direction | Authority | Why |
      | --- | --- | --- |
      | Read | the row's `Schema_Version__c` | the queryable, reportable record of what was written; the only trustworthy thing about a blob from an older package, including one written before the payload carried a version |
      | Write | the payload's own `schemaVersion` key, defaulting to 1 when absent | there is no column yet; a payload declaring no version is by definition from before the key existed |

      `schemaVersion` is therefore written into every payload including an empty one, and the two
      entry points (`fromStored`, `fromClient`) share one normalising walk so they cannot drift.

- **Six mutations were run against this pass's own tests, and the suite caught all six.** Green is not
      done, and four critics on slice 02 found tests that could not fail — so each of the three the
      brief named was run, plus three more, and each was reverted immediately after:

      | Mutation | Tests turned red |
      | --- | --- |
      | `scheduleSave` saves immediately as well as on the timer (debounce broken) | 5 |
      | `resolveLayout` stops filtering and synthesises a tab for a missing id (intersection returns everything) | 5 |
      | `adoptActiveLayout` persists the seeded layout when the user owns no record (writes on mount) | 2 |
      | `persist` always calls `updateLayout`, id or no id (the null-id trap reintroduced) | 14 |
      | `columnClass` pinned to `cols-3` regardless of the count | 18 |
      | `serializeLayout` spreads the item through instead of emitting an explicit key set | 1 |

      The last one is the thinnest margin on the board — a single test stands between the payload
      contract and a client that writes labels into the store — and it is deliberate: that test
      asserts the *whole* section object equals an exact three-key shape, so it fails on anything
      extra rather than on one named key someone remembered to check for.

- **The autosave is asserted on what reached the callee, never on the fact that a call happened.** _How_,
      not _what_ — this is the trap the brief flagged as live on this slice, and every save assertion
      is written against it. `lastSavedLayout()` parses `layoutJson` back out of the mock call, so the
      tests read the layout the controller was given: the column count it stored, the section names it
      stored, the item ids still present in it. Call counts appear only where the count *is* the
      claim (one save per burst, one create per user), and never on their own — the burst test asserts
      one call **and** that it carries the fifth change, because a leading-edge debounce satisfies the
      first half and loses four changes.

      The three Apex methods needed a virtual `jest.mock` each. `@lwc/jest-transformer` otherwise
      substitutes a plain function returning `Promise.resolve()` that records nothing — the same
      shape of gap the repo already closed for `lightning/navigation`, and it would have made every
      assertion above unwritable while leaving the suite green.

- **Saves are serialised through a promise chain, not fired in parallel.** _How_, not _what_. Two
      changes a second apart, on a user with no record yet, would each see a null `layoutId` and each
      call `createLayout` — leaving the user with two layouts and the second silently deactivating the
      first, since the controller clears `Is_Active__c` on the others. `saveChain` means the id the
      create returns is already recorded when the next save chooses between create and update.
      `updates the record the first change created rather than creating a second one` is the test.

- **The seeded section, and every new section, opens at three columns.** _How_, not _what_ — the
      criterion fixes the *range* (one to six) and that the section renders in the count the user
      chose; it says nothing about where an uncustomised section starts. One column would make the
      seeded card a 174-row strip, which is the All Items list this component exists to improve on;
      six would make it unreadable in a narrow App page region. `DEFAULT_COLUMNS = 3` lives in
      `navigatorLayoutModel` beside `MIN_COLUMNS`/`MAX_COLUMNS` so the three cannot drift, and it is
      also the fallback `clampColumns` uses for a section whose count is missing entirely.

- **The six existing `salesforceNavigator` jest tests now reach items through `c-navigator-section`.**
      _How_, not _what_. Slice 02 rendered items in a flat `<ul>` on the navigator's own template, so
      those tests could reach them with `element.shadowRoot.querySelectorAll("c-navigator-item")`.
      This slice puts items inside section cards, and under `@lwc/synthetic-shadow` — which the jest
      preset loads, so retargeting reproduces faithfully — a parent's `shadowRoot` query cannot see
      into a child's. **Every assertion in those six tests is unchanged**; only the traversal is, via
      one `queryItems(element)` helper that walks each `c-navigator-section`'s shadow root. The
      alternative, keeping the flat list, would have been the criterion unbuilt.

- **`sf project deploy start` reported a source-tracking conflict on `Salesforce_Navigator_User` and
      was re-run with `--ignore-conflicts`.** Checked before overriding rather than after: the
      permission set was retrieved from the org and is byte-identical to what slice 02 committed. The
      conflict is tracking noise — deploying the new `CustomObject` touched the permission set's
      server-side timestamp. Nothing in the org was lost.

      **The UI pass hit the same thing on `salesforceNavigator` and checked it the same way before
      overriding.** All four files of the bundle were retrieved from the org and diffed against
      committed `HEAD`; the only difference in any of them is the trailing newline the platform
      strips. The data pass's own `CustomTab` and permission-set deploy had touched the bundle's
      server-side timestamp. Re-run with `--ignore-conflicts`, `Status: Succeeded`, 3/3 components,
      `navigatorLayoutModel` and `navigatorSection` created and `salesforceNavigator` changed.

      Worth recording as evidence rather than as housekeeping: the deploy is the only check in this
      pass that the three `@salesforce/apex/NavigatorLayoutController.*` imports name methods that
      actually exist. Jest cannot tell — it mocks them virtually by module path — so a typo'd or
      renamed Apex method would pass 95 tests and fail at runtime. The server compiles the bundle and
      resolves those imports, and it accepted them.

## Critique findings

- [ ] **A change made before `getLayouts` resolves is silently discarded.**
      `connectedCallback` fires `getLayouts()` without awaiting it, and the `New section` button and
      every section menu are already live while it is in flight. `adoptActiveLayout` then assigns
      `this.storedLayout` **unconditionally**, overwriting whatever the user changed in the meantime.
      Reproduced with a `getLayouts` mock held open: the user clicks *New section*, the headers read
      `["All Items", "New section"]`; the fetch lands and they read `["Daily work"]`; the autosave
      then fires and writes the **pre-change** stored layout back. The change the user made and saw
      is gone with no message. `adoptActiveLayout` needs to refuse to clobber state the user has
      already touched (a "user has changed something" flag set in `applyLayout`, or resolve the
      fetch before the layout is interactive). No test covers the in-flight window at all — every
      existing test lets `getLayouts` settle inside `flush()` before it interacts.
- [ ] **A failed `getLayouts` tells the user nothing and lets their next change displace their real
      layout.** Reproduced with `getLayouts.mockRejectedValue(...)`: no `[role="alert"]` is rendered
      (`errorMessage` is never set on that path — only the wire's failure sets it), so the user sees
      a seeded Navigator that looks like a first open. Their next change then calls
      `createLayout({... makeActive: true})`, and `NavigatorLayoutController.createLayout` clears
      `Is_Active__c` on every other layout the owner has. Their real layout is therefore
      **deactivated**, and with no layout switcher in this slice it is unreachable — `adoptActiveLayout`
      will prefer the new active row on every future load. The comment on that `.catch` says "What
      must not happen is a save overwriting a stored layout we failed to read, and it cannot"; that
      is true of overwrite and false of displacement, which costs the user the same thing. Either
      surface the failure and suppress autosave until a read succeeds, or do not pass
      `makeActive: true` on a create made without a successful read.
- [ ] **`New section` is live before the tab list is complete, so a click mid-pagination freezes a
      partial seed into the store.** The button sits in `slot="actions"` and is rendered
      unconditionally — outside the `lwc:if={isLoading}` / `lwc:elseif={hasItems}` chain that gates
      the sections. `this.layout` on a first change is `buildSeededLayout(this.items)`, and
      `this.items` holds only the pages received so far. Reproduced: with 100 tabs on page 1 and 2
      more on page 2, clicking *New section* after page 1 stores an `All Items` section of **100 of
      the 102** reachable tabs; the remaining two are then in no section, there is no item picker in
      this slice, and they never render again. This contradicts the first acceptance criterion
      ("sees every tab they can reach in one section") for any org past one page. Gate the button on
      `hasItems`, or seed only once the tab list is complete.
- [ ] **One unreadable row makes every layout that user owns unreadable.** `getLayouts` maps `toDto`
      over the whole result and `normalise` throws on the first row it cannot read, so a single row
      at an unknown `Schema_Version__c`, or with a `Layout_JSON__c` an admin edited by hand (the
      permission set grants `allowEdit` on the object), takes down the read for all of that user's
      layouts — and, by the finding above, then becomes a rival active layout. Two gaps in the
      suite: `anUnreadableFutureSchemaVersionIsRefusedRatherThanGuessedAt` seeds exactly one row and
      so never shows that the user's *other, readable* layouts are lost with it, and there is no
      Apex test at all for a stored payload that is not valid JSON on the **read** path
      (`aPayloadThatIsNotJsonIsRefusedRatherThanStored` covers only the write path). Consider
      skipping and reporting the unreadable row rather than failing the whole call.
- [ ] **The two halves of the payload contract disagree on a missing `columns`.**
      `NavigatorLayoutController.columnsOf` falls back to `MIN_COLUMNS` (1); `navigatorLayoutModel`'s
      `clampColumns` falls back to `DEFAULT_COLUMNS` (3). A section object carrying no `columns` key
      is therefore stored as a 1-column section by Apex and read as a 3-column section by the
      client. It is latent today only because every read is normalised by Apex before the client
      sees it — but both files document themselves as two halves of one contract that match "by
      construction", and on this key they do not. Pick one fallback and state it in both.
- [ ] **The last acceptance criterion says "All 18 methods run under `System.runAs`" and "18/18
      pass"; `NavigatorLayoutControllerTest` has 17 test methods.** The count of 18 is the number of
      `@IsTest` annotations in the file, which includes the class-level one. The claim itself holds
      — all 17 do run under `System.runAs` a Standard User, and `activationStaysOneUpdateAcrossTwoHundredLayouts`
      is a genuine 200-record bulk test — only the number is wrong.
- [ ] **`setSectionColumns` is the one section operation with no purity assertion of its own.**
      `addSection`, `renameSection` and `deleteSection` each assert `expect(base).toEqual(before)`
      against a copy taken beforehand; the two `setSectionColumns` tests do not. Mutating it to
      write `section.columns` in place turns exactly one test red, and that test
      (`clamps a column count outside one to six rather than storing it`) only catches it by
      accident, because it happens to reuse `base` across three calls. Add the same explicit
      before/after deep-compare the other three have.
- [ ] **The explicit `OwnerId = :UserInfo.getUserId()` predicate is not held down by any test.**
      Both the class header and the sixth acceptance criterion rest on the predicate and
      `WITH USER_MODE` being present *together* as defence in depth, but with the object at OWD
      Private, `WITH USER_MODE` alone already hides a peer's rows — so deleting the predicate leaves
      `peerCannotReadAnotherUsersLayouts` and the whole suite green. The code is correct and the
      security rule is satisfied; the claim that the pair cannot be quietly reduced to one is not.
- [ ] **`Sort_Order__c = existing.size() + 1` collides after a delete.** A user with layouts at sort
      order 1 and 2 who deletes the first (the permission set grants `allowDelete`) gets 2 again on
      the next create, and `ownLayouts`' `ORDER BY Sort_Order__c NULLS LAST, CreatedDate` then
      orders the pair arbitrarily-but-stably rather than as the user left them. Latent in this
      slice, which ships no delete path — flagging it before the switcher slice builds on it. Use
      `MAX(Sort_Order__c) + 1` rather than a count.
- [x] false positive — that the lost-access intersection leaks into stored state. Mutated `save()`
      to serialise `{ sections: this.sections }` (the resolved layout) instead of `this.layout` (the
      stored one). `losing and regaining access to a tab › leaves the stored layout carrying the
      lost item, even across a save` went red on precisely the missing `{ id: "Contact" }`. The test
      bites, and it is the only one that does — the margin is one test, as the build pass says.
- [x] false positive — that a path can call `updateLayout` with a null id, or create a second record
      for a user who already has one. Mutated `persist`'s branch both ways: forcing `createLayout`
      turned 3 red, forcing `updateLayout` turned 14 red. `saveChain` genuinely serialises the
      create so the returned id is recorded before the next save chooses, and Apex's
      `updateRefusesANullLayoutId` covers the server half.
- [x] false positive — that the debounce is leading-edge, or drops the last change. Mutated
      `scheduleSave` to fire `this.save()` on the first call as well as on the timer: 5 tests red.
      The burst test asserts one call *and* that its payload carries the fifth change, so a
      call-count-only pass is not available. A save in flight when the next debounce fires is
      chained, not raced, and `disconnectedCallback` clears the timer and runs the pending save.
- [x] false positive — that the serialiser could let a label through. Mutated `serializeLayout` to
      spread the item (`{ ...item }`) instead of emitting an explicit key set: 2 tests red, because
      `drops a label, an icon and a pageReference that reached it by accident` asserts the whole
      section object equals an exact three-key shape rather than checking named keys.
- [x] false positive — that `resolveLayout` mutates its input. Added an in-place prune of
      `section.items` alongside the existing filter: 5 tests red, including the deep-compare against
      a copy taken beforehand. `navigatorLayoutModel` also imports nothing from `lwc` — confirmed by
      grep, not by reading the file header.
- [x] false positive — that the column range is not genuinely clamped. `clampColumns` is the single
      choke point and both `resolveLayout` and `setSectionColumns` go through it; `gridClass`'s
      no-section fallback is `cols-1`, which the stylesheet defines. All six `cols-N` classes exist
      as `repeat(N, minmax(0, 1fr))` and the shipped stylesheet is read and pinned by a test.
- [x] false positive — SLDS 2 violations. Grepped the changed CSS for `--slds-c-*`, `--sds-*`,
      `--lwc-*`, bare `var(--slds-g-…)` with no fallback, `prefers-color-scheme`, and the 38 colour
      hooks with no `light-dark()` (`palette-*`, `*-base-50/100`, `accent-container-1`, `disabled`,
      `accent-light-*`/`accent-dark-*`): none present. Every hook used is semantic
      (`surface-container-1`, `on-surface-1/3`, `error-container-1`, `on-error-1`, the spacing,
      radius, shadow and font scales) and carries a fallback. No inline `style` and no
      `lightning-layout` anywhere in the two templates. Own class names are `rstk-nav-` prefixed and
      no custom properties are authored at all.
- [x] false positive — that a slice-02 assertion was weakened. Diffed the six pre-existing
      `salesforceNavigator` tests across `HEAD~1..HEAD`: exactly one line was removed, and it is the
      `element.shadowRoot.querySelectorAll("c-navigator-item")` traversal replaced by
      `queryItems(element)`. Every `expect` and every expected value is byte-identical.
- [x] false positive — Apex testing-rule violations. No `System.assert*` anywhere in
      `force-app/main/default/classes`; every `Assert.*` call carries a descriptive message as its
      last parameter; `activationStaysOneUpdateAcrossTwoHundredLayouts` is a real 200-record bulk
      test that seeds all 200 active so the clearing does work; all test methods run under
      `System.runAs` a user on the genuine `Standard User` profile. The write tests re-query via
      `storedLayouts()` and assert what the database holds, not what was sent.
- [x] false positive — governor and DRY violations in the controller. No SOQL or DML inside any
      loop: `ownLayouts()` is the class's single query and both write paths share it, `deactivations`
      builds a list for one bulk `Database.update`, and `normalise` is the single walk both
      `fromStored` and `fromClient` go through. No block of 10+ lines appears in more than one
      method in either the controller or its test class.
- [x] false positive — that `Is_Active__c` exclusivity can break. No route through the controller
      leaves two rows active: `deactivations` clears every other active row of the owner in the same
      `Database.update` as the target, and a `makeActive: false` call adds no active row. Confirmed
      under bulk by the 200-layout test, which asserts exactly one survivor, that it is the right
      one, and that the cost stayed at `dmlUsed <= 2` / `queriesUsed <= 3`. `activatingOneUsersLayoutDoesNotDisturbAnother`
      covers the cross-user half. Zero-active is reachable only via `makeActive: false`, which the
      LWC never sends, and `adoptActiveLayout` falls back to `layouts[0]` regardless.

fix_cycles: 0
