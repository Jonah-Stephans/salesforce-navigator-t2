---
depends_on:
  - devpath/navigator-test-system-mode/slices/01-declare-system-mode-on-verification-queries.md
touches:
  - force-app/main/default/classes/NavigatorLayoutControllerTest.cls
---

# Route the duplicated active-layout queries through helpers

> Watch a new test go red before you make it green.
> _Why: a test written before the code cannot be written to hit a coverage number — there is nothing to
> cover yet. Retires when Apex gets mutation testing._

## What to build

`NavigatorLayoutControllerTest` asks "which layout is active" through one helper per question, so
someone reasoning about access mode on that query has a single site to find rather than three, and no
block of ten or more lines is repeated across its methods.

## Acceptance criteria

- [x] met `activeId()` exists beside `activeName()` in the helper block, declares `WITH SYSTEM_MODE`, and
      returns `null` rather than throwing when no layout is active — matching `activeName()`
- [x] met `activatingOneLayoutClearsTheFlagOnTheOthers` and
      `activationStaysOneUpdateAcrossTwoHundredLayouts` obtain the active count from `activeCount()`
      and the active id from `activeId()`; neither method still contains an inline
      `Navigator_Layout__c` query
- [x] met every `Assert` call in those two methods keeps its own message string, unchanged and at the call
      site — the messages are the only thing that distinguished the two duplicated blocks
- [ ] no block of ten or more lines appears in more than one method anywhere in
      `NavigatorLayoutControllerTest.cls`, per `.claude/rules/rstk-dry-enforcement.md`
- [x] met the owner-scoped queries in `activatingOneUsersLayoutDoesNotDisturbAnother` are unchanged and
      still inline, with their pointer comments intact — they are not duplicated and are deliberately
      out of scope (`spec.md`, `## Open questions`)
- [x] met every query in Groups C and D of `spec.md`'s `## Current state` is unchanged
- [x] met `sf project deploy start --test-level RunLocalTests` succeeds against a freshly created scratch
      org with no permission set assigned to the org's default admin, and every local test passes. The
      org is named and `Salesforce_Navigator_User` is confirmed absent from it — a green run against an
      org whose admin holds the permission set proves nothing here (`spec.md`, `## Traps`)

## Deviations

- [x] fixed — **Criterion 2's closing clause is read as "no inline copy of the two routed
      active-layout shapes remains", not literally.** Both methods still open with a setup query —
      `[SELECT Id FROM Navigator_Layout__c WHERE Name = 'Becoming active' LIMIT 1].Id` in
      `activatingOneLayoutClearsTheFlagOnTheOthers`, the same shape on `'Layout 1199'` in
      `activationStaysOneUpdateAcrossTwoHundredLayouts` — so "neither method still contains an inline
      `Navigator_Layout__c` query" is false read word for word. Both of those are Group D queries
      (`Id` and `Name` only, no access-mode declaration, safe as they stand), and criterion 6 requires
      every Group D query to be unchanged, so the two criteria cannot both hold literally. Resolved in
      favour of criterion 6 and of `spec.md` `## Design`, which names exactly two shapes to route and
      says "Nothing moves into the helper except the query". Worth recording for whoever revisits it:
      a helper for that shape already exists — `layoutIdNamed(String)`, whose query is byte-identical
      to both inline copies — so the literal reading could be satisfied with no new helper at all, at
      the cost of deleting two Group D queries. Either way, no change to which queries this slice
      touches; the two routed shapes are the same set.

- [ ] **Criterion 4 is stated file-wide, and a 14-line duplicated block in this file predates the
      spec entirely. Does this slice extract that too, or is criterion 4 about the blocks this spec
      created? Design decision needed.**

      The duplication this slice was cut to remove is gone, verified. But criterion 4 says "no block
      of ten or more lines appears in more than one method **anywhere in**
      `NavigatorLayoutControllerTest.cls`", and `## Outcomes` bullet 2 says the same of the whole
      file. Scanned mechanically over every method in the file, that property does not hold and did
      not hold before this spec started:

      `anUnreadableFutureSchemaVersionIsReportedOnItsOwnRowRatherThanGuessedAt` and
      `aStoredPayloadThatIsNotJsonIsReportedOnItsOwnRowRatherThanFailingTheRead` share a
      **byte-identical 14-line block** — the tail of the two-row `insert`, then

      ```apex
      List<NavigatorLayoutController.LayoutDTO> layouts;
      Test.startTest();
      System.runAs(owner) {
        layouts = NavigatorLayoutController.getLayouts();
      }
      Test.stopTest();

      Assert.areEqual(
        2,
        layouts.size(),
      ```

      diverging only at the assertion message. Ten-line windows of the same block also appear in
      `getLayoutsReturnsTheOwnersRowsInSortOrder` and `aV1RowIsUpgradedToV2OnRead`, so it is four
      methods, not two. Confirmed present in `git show main:` at exactly the same five windows —
      neither slice 01 nor this slice touched any of it, and no pass of this spec ever surveyed it.
      The critique finding that put helper-routing in scope described only the two 24-line blocks the
      access-mode fix created; those are what `## Design`'s routing section addresses, and they are
      what is now fixed.

      Why this is not mine to decide. Removing it means extracting a third helper that no part of
      this spec names, in four test methods the slice describes as untouched, and the block's shared
      body is the `Test.startTest()` / `System.runAs` / `Test.stopTest()` sandwich — so the helper
      would have to take `Test.startTest()` and `Test.stopTest()` inside itself. That contradicts
      `## Design`'s own rule for this routing, "Nothing moves into the helper except the query", and
      it moves the governor-limit window out of the test body where every reader of these tests
      currently sees it. It also runs against
      `.claude/rules/rstk-legacy-boyscout.md` ("Do NOT refactor code you are not modifying for your
      current task"). That is a design choice about what gets built, not a choice about how, so it
      is a pause rather than a decision I take.

      Two ways it can be closed, for whoever owns the design:

      1. Criterion 4 and `## Outcomes` bullet 2 mean the duplication this spec created. Restate both
         to say so, and this slice is complete as it stands — nothing further to build.
      2. Criterion 4 means what it says, and a third slice extracts the `getLayouts()` sandwich
         across those four methods. Then `## Design`'s "nothing moves into the helper except the
         query" has to be revised to permit `Test.startTest()` / `Test.stopTest()` moving with it.

      There is no cheaper third option, and this was measured rather than assumed. Trimming the
      block at either end alone does not clear the threshold: dropping its three leading
      `insert`-tail lines leaves exactly 10, and collapsing its trailing
      `Assert.areEqual(` / `2,` / `layouts.size(),` into a single message-carrying call leaves 11.
      The leading end cannot be extracted anyway — the two methods insert different second rows, so
      only the closing braces coincide. Extracting the sandwich is the one change that takes the
      longest identical run to 9, which is why option 2 is the only alternative to option 1.

      Criterion 4 is left unticked and `done: true` is not written. Everything else in this slice is
      built, deployed and green.

- [ ] excess — `.prettierignore`, outside this slice's `touches`. Changed deliberately by the
      orchestrator before the pause commit, not swept in by `git add -A`: one line adding `devpath/`
      beside the existing `dev-path/` entry. Verified first — `prettier --write` on a copy of these
      two slice files adds four spaces of continuation indent per pass and does not converge, and at
      ten spaces slice 02's ` ```apex ` fence reparses as a nested indented code block. Committing
      through `lint-staged` without this line would therefore have corrupted the pause box that this
      commit exists to preserve. Reviewer's call whether the one-line repo-config change belongs in
      this spec's pull request or its own.

**Verification evidence** — not a deviation, recorded here because criterion 7 requires the verifying
org to be named. Scratch org `sysmode-verify-02` / `test-oj3vfo8h6fyw@example.com`, org id
`00Ddh00000CKfDMEA1`, created fresh 2026-08-27 from
`config/rstk-min-edition-developer-project-scratch-def.json`. Before the deploy the org held zero
`PermissionSet` rows named `Salesforce_Navigator_User`, zero `ApexClass` rows matching `Navigator%`,
and its default admin held exactly one `PermissionSetAssignment`, profile-owned. After the deploy the
admin still held only that one profile-owned assignment — `Salesforce_Navigator_User` deployed as
metadata and was never assigned to anyone but the two `@TestSetup` users. `sf project deploy start
--test-level RunLocalTests --target-org sysmode-verify-02` returned `Status: Succeeded`;
`DeployRequest` `0Afdh000009p97KCAQ`, 15 components deployed, 40 tests completed, 0 test errors.
Slice 01's org `sysmode-verify` was still alive and still permission-set-free, but it already holds
this spec's metadata from that slice's deploy, so it is no longer a freshly created org and a new one
was created instead.

**`.prettierignore` does not cover `devpath/`** — not a deviation either, recorded because it damages
every artifact this spec writes. The entry reads `dev-path/`, with a hyphen, under the comment
"dev-path bookkeeping"; the live directory is `devpath/` and `dev-path/` is a separate, older tree
that still exists in the repo root. So `npm run precommit` → `lint-staged` → `prettier --write` runs
over these slice files on every commit, and prettier's markdown printer re-indents blank-line-separated
continuation paragraphs inside a `- [ ]` item to ten spaces. At ten spaces they are indented code
blocks, not prose, so the next pass indents them again — it never reaches a fixed point. That is the
mechanism behind slice 01's `## Deviations` and `## Critique findings` boxes, whose nested paragraphs
sit at absurd depths and render as code. Both slice files are left at the correct six-space
continuation indent and both therefore report `[warn]` under `prettier --check`; the fix is one line
in `.prettierignore`, deliberately not taken here because it is outside anything this spec designed.

## Critique findings
