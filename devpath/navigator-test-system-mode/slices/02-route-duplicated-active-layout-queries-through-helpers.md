---
depends_on:
  - devpath/navigator-test-system-mode/slices/01-declare-system-mode-on-verification-queries.md
touches:
  - force-app/main/default/classes/NavigatorLayoutControllerTest.cls
done: true
fix_cycles: 0
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
      and the active id from `activeId()`; neither method still contains an inline copy of either
      routed shape. Restated at the design gate on 2026-08-27: the earlier closing clause read "neither
      method still contains an inline `Navigator_Layout__c` query", which was false word for word —
      both methods open with a `WHERE Name = …` setup query, and those are Group D queries that the
      criterion below requires to stay unchanged, so the two could not both hold literally
- [x] met every `Assert` call in those two methods keeps its own message string, unchanged and at the call
      site — the messages are the only thing that distinguished the two duplicated blocks
- [x] met neither block this spec's access-mode fix created still appears in more than one method:
      `activatingOneLayoutClearsTheFlagOnTheOthers` and
      `activationStaysOneUpdateAcrossTwoHundredLayouts` share no run of ten or more identical lines,
      per `.claude/rules/rstk-dry-enforcement.md`. **Scoped to this spec's own duplication**, restated
      at the design gate on 2026-08-27 — the `getLayouts()` `Test.startTest()` / `Test.stopTest()`
      sandwich shared by the read-path tests predates this spec, was never covered by any pass of it,
      and is excluded on the record (`spec.md`, `## Out of scope`). The earlier file-wide wording was
      false of this file before the fix and after it
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

      Superseded in text at the design gate on 2026-08-27: `devpath:slice` restated criterion 2 to say
      what was built, so the reading no longer has to be carried here. Kept on file as the record of
      how it was decided, and because the `layoutIdNamed(String)` observation is still the thing anyone
      revisiting that clause would want.

- [x] fixed — **Resolved at the design gate on 2026-08-27: option 1. Criterion 4 and `## Outcomes`
      bullet 2 mean the duplication this spec created, and this slice is complete as it stands.** The
      engineer took the narrow scope on all three grounds the pause laid out, and the pre-existing
      `getLayouts()` sandwich is now recorded under `spec.md`'s `## Out of scope` with those grounds
      written down, rather than absorbed silently — a later reader finding a ten-line duplicate in this
      file lands on that paragraph. `## Current state` and `## Design`'s routing section were updated to
      match, `## Design`'s "nothing moves into the helper except the query" rule stands unrevised, and
      the general question the two repo rules disagree on — whether touching a legacy file means owning
      its pre-existing DRY violations — is on file under `## Open questions`, unanswered on purpose and
      owned by whoever maintains `rstk-dry-enforcement.md` and `rstk-legacy-boyscout.md`. Criterion 4 is
      restated by `devpath:slice` in the same session. Nothing further is built for this slice; what
      remains is the deploy, the tick and `done: true`. Original pause text follows.

      **Criterion 4 is stated file-wide, and a 14-line duplicated block in this file predates the
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

**Default-org deploy, and the source-tracking conflict it hit first** — not a deviation, recorded
because the command run was not the bare one. `sf project deploy start` against the project default
org (`sfnav-t2` / `test-u85wlgi5uild@example.com`) failed on the CLI's own conflict check: source
tracking reported `NavigatorLayoutControllerTest` changed in the org. The org's stored body was
fetched through the Tooling API and diffed before anything was overwritten. It is a mid-spec snapshot
— slice 01's four Group A helpers carry `WITH SYSTEM_MODE`, but none of Group B's inline sites do and
neither `activeId()` nor the routed call sites exist. It matches no commit on this branch and not
`main`. Every line it holds that the branch does not is a line the branch deliberately changed, so
overwriting it discards no work. Deployed with `--ignore-conflicts` on that basis, and with
`--test-level RunLocalTests` so the tests actually ran: `Status: Succeeded`, deploy id
`0AfO800000ZaCuXKAV`, 40 passing, 0 failing. **That green proves nothing about this spec's bug** —
`Salesforce_Navigator_User` is assigned to two users in this org, one of them the default admin
`test-u85wlgi5uild@example.com`, which is the exact wrong org shape `spec.md`'s `## Traps` names.
Criterion 7's `sysmode-verify-02` run above is the one that carries weight; no code changed between
the two runs.

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

Slice pass, 2026-08-27. Code under review is `a848111`
(`git diff a848111~1 a848111 -- force-app/`); `git diff a848111 HEAD -- force-app/` is empty, so the
committed code is what was read. Every claim below was checked against the file or the org, not against
the diff alone.

- [x] fixed — extended the enumeration in the `WITH SYSTEM_MODE` comment above `storedLayouts()`
      (`NavigatorLayoutControllerTest.cls:113-121`) so it names `activeId()` and counts five: it now
      reads "this and the four verification helpers that follow — sectionNameOf, activeCount,
      activeName, activeId" and "Reverting these five to WITH USER_MODE reintroduces 'No such
      column'". Nothing else in the comment changed, no query or access-mode declaration was
      touched, and no code moved.

      The two `spec.md` sites that generate this comment were updated with it, on the same grounds
      as slice 01's fix passes: `## Design`'s worked sketch said "these four methods" and the prose
      under it said "the other three helpers", so a reader regenerating the comment from the sketch
      would have reproduced the defect verbatim. The sketch now carries the five-name enumeration,
      and `## Design`'s routing section states outright what the critic established — the
      enumeration is the only route by which the revert warning reaches `activeId()`, and adding a
      helper to that block without extending it leaves the new helper unwarned. `## Current state`
      Group A already listed all five helpers and needed no change; no acceptance criterion,
      `## Out of scope` text or other comment was touched.

      Deployed to the project default org `sfnav-t2` / `test-u85wlgi5uild@example.com` with
      `sf project deploy start --test-level RunLocalTests` — no `--target-org`, and no
      `--ignore-conflicts`: `Status: Succeeded`, deploy `0AfO800000ZaEwMKAV`, 1 component, 40
      passing, 0 failing. The source-tracking conflict the previous worker hit did not recur, and
      that was checked rather than assumed — the `NavigatorLayoutControllerTest` body stored in that
      org was fetched through the Tooling API before deploying and is byte-identical to the
      committed file apart from the trailing newline the API strips, so the mid-spec snapshot is
      gone and there was nothing in the org left to discard. **That green is a regression check
      only** — `Salesforce_Navigator_User` is assigned to that org's default admin, the exact wrong
      org shape `spec.md` `## Traps` names — and criterion 7's `sysmode-verify-02` run remains the
      load-bearing verification. No code changed in this pass, only comment text.

      Finding as raised:
      **The `WITH SYSTEM_MODE` comment above `storedLayouts()` still names a closed set of four
      helpers, and this slice added a fifth without extending it.**
      `force-app/main/default/classes/NavigatorLayoutControllerTest.cls:113-120` reads "this and the
      three verification helpers that follow — sectionNameOf, activeCount, activeName" and "Reverting
      **these four** to WITH USER_MODE reintroduces 'No such column' against exactly that org shape".
      `activeId()` (line 1088) is a fifth `WITH SYSTEM_MODE` helper and appears in neither the
      enumeration nor the count. It also carries no pointer comment of its own, correctly, because
      `spec.md` `## Design` justifies omitting one on the grounds that the routed shapes "live in the
      helper block, directly under the full comment above `storedLayouts()`" — so the enumeration is
      the *only* route by which the warning was ever going to reach `activeId()`, and it excludes it.
      `spec.md` `## Traps` designates this comment as the thing that "carries the same warning at the
      code site". Confirmed by mutation rather than argued: reverting **only** `activeId()` to
      `WITH USER_MODE` and validating against `sysmode-verify-02`
      (`sf project deploy start --dry-run --test-level RunLocalTests`, deploy `0Afdh000009pUzpCAE`)
      runs 40 tests and fails exactly two — `activatingOneLayoutClearsTheFlagOnTheOthers` and
      `activationStaysOneUpdateAcrossTwoHundredLayouts`, both
      `System.QueryException: No such column 'Is_Active__c' on entity 'Navigator_Layout__c'`. That is
      precisely the mutation the comment exists to warn a reader off, in precisely the helper the
      comment does not name. Also `.claude/rules/rstk-preserve-documentation.md` §1: documentation a
      refactor makes inaccurate is updated, not left standing. One clause in one comment; no code moves.
      Worth noting for whoever writes it: the comment also sits 947 lines above the helper block it
      describes, so the enumeration is doing more work than proximity is.

- [x] false positive — **criterion 4 ticked against code that does not satisfy it.** Re-derived
      mechanically over exactly the two named methods (`activatingOneLayoutClearsTheFlagOnTheOthers`,
      lines 863-901; `activationStaysOneUpdateAcrossTwoHundredLayouts`, lines 1705-1766): the longest
      run of identical consecutive lines they share is **five** — `Test.stopTest();`, blank,
      `Assert.areEqual(`, `1,`, `activeCount(),` — diverging at the assertion message, which is what
      criterion 3 intends. The next longest runs are four (`LIMIT 1` / `]` / `.Id;` / blank, and `);` /
      `Assert.areEqual(` / `targetId,` / `activeId(),`). A file-wide scan for any 10-line window
      occurring more than once returns only the pre-existing `getLayouts()` sandwich, at lines 186-198,
      340, 407-419 and 468-480. Nothing this spec created is duplicated anywhere in the file.

- [x] false positive — **the `getLayouts()` sandwich left duplicated across four methods violates
      `.claude/rules/rstk-dry-enforcement.md`'s file-wide pre-PR scan, so criterion 4's narrow scope
      buries a live violation.** Raised, checked against `spec.md` `## Out of scope`, and all three
      recorded grounds hold on inspection. The repeated lines really are the `Test.startTest()` /
      `System.runAs(owner)` / `getLayouts()` / `Test.stopTest()` sandwich (read at 186-198), so a
      helper would have to swallow the governor-limit window — in a file whose bulk test measures
      inside exactly that window (`Limits.getQueries()` at line 1728). `.claude/rules/rstk-legacy-boyscout.md`
      really does list "Do NOT refactor code you are not modifying for your current task" in its danger
      zone, and slice 02 modifies none of those four methods. And the block is confirmed present on
      `main`, so no pass of this spec created it. The rule-versus-rule conflict is on file under
      `## Open questions` with a named owner, which is the right place for it. Nothing to fix here.

- [x] false positive — **criterion 7 ticked on evidence only the slice author could see.**
      Independently re-checked against the live org rather than taken on the slice's word, because
      `spec.md` `## Traps` says a green run against the wrong org shape proves nothing. Scratch org
      `sysmode-verify-02` / `test-oj3vfo8h6fyw@example.com` / `00Ddh00000CKfDMEA1` exists and is active.
      Its default admin holds exactly one `PermissionSetAssignment` and it is profile-owned
      (`X00ex00000018ozh_128_09_04_12_1`); `Salesforce_Navigator_User` is assigned to no user in the org
      at all. `DeployRequest 0Afdh000009p97KCAQ` reads `Succeeded`, `CheckOnly false`, `TestLevel
      RunLocalTests`, 15 components deployed, 40 tests completed, 0 test errors. The
      `NavigatorLayoutControllerTest` body stored in that org is byte-identical to the committed file
      except for the trailing newline the Tooling API strips — so the green run was against this slice's
      code, not a mid-spec snapshot like the one the default org was holding. Criterion 7 stands.

- [x] false positive — **`activeId()`'s `active.isEmpty() ? null : active[0].Id` null branch is never
      executed, so criterion 1 is ticked against an unexercised path.** It is unexercised by
      construction, and symmetrically so: across all 31 `activeCount()` / `activeName()` / `activeId()`
      call sites in the file, none asserts `0` active and none asserts a `null` name, so `activeName()`'s
      identical branch has never run either — which is exactly the "matching `activeName()`" the
      criterion asks for. `spec.md` `## Design` states the consequence outright: "Neither form changes
      whether a test passes, only how it reads when it fails." A branch that by definition only changes
      failure text cannot be asserted on by a suite that passes.

- [x] false positive — **the four `// WITH SYSTEM_MODE is deliberate here — see the note above
      storedLayouts().` pointer comments deleted at the routed call sites, against
      `.claude/rules/rstk-preserve-documentation.md` §3 ("do not remove `//` comments that explain
      … non-obvious behavior").** Each pointer explained a `WITH` clause on a query that no longer
      exists at that site — both queries moved into `activeCount()` and `activeId()` — so keeping them
      would leave four comments pointing at nothing. The three inline sites that kept their queries kept
      their pointers, verified in the file at lines 374, 920 and 931. `spec.md` `## Design` authorises
      the removal in as many words. What the removal did leave stale is the comment those pointers
      pointed *at*, which is the open finding above and a different defect.

- [x] false positive — **`activeId()` carries no ApexDoc.**
      `.claude/rules/rstk-apex-standards.md` requires ApexDoc on "all public methods and constructors in
      **new** Apex classes", and for pre-existing files says to add it "only to methods you modify or
      add". `activeId()` is `private`, in a pre-existing class, and its four sibling verification
      helpers — `storedLayouts()`, `sectionNameOf()`, `activeCount()`, `activeName()` — carry none
      either. Documenting one of five would read as an inconsistency rather than a fix, and the rule's
      stated reason for the pre-existing-file clause is to keep diff noise down.

- [x] false positive — **routing two call sites into shared helpers weakens the access-mode
      protection, because one reverted helper now breaks two tests instead of two sites breaking one
      each.** Backwards: fewer sites carrying the declaration means fewer places to get it wrong, and
      the mutation run above shows a single-helper revert still fails loudly and names both callers.
      Checked the related `## Traps` hazard too — neither routed call site sits inside a `System.runAs`
      block (both are after `Test.stopTest()`, lines 891-900 and 1742-1751), so no access-mode
      declaration moved into a `runAs` context and Outcome 5 is untouched. The one place a routed helper
      *is* called from inside a `runAs` — `activeCount()` / `activeName()` at lines 1159-1173 — predates
      this slice and is unchanged by it.

**Criteria 1, 2, 3, 5 and 6, checked and standing.** `activeId()` sits directly below `activeName()` at
lines 1088-1097 with `WITH SYSTEM_MODE` and the null-safe return; both named methods take their count
from `activeCount()` and their id from `activeId()` with no inline copy of either shape left; all seven
`Assert` calls across the two methods — two in `activatingOneLayoutClearsTheFlagOnTheOthers`, five in
`activationStaysOneUpdateAcrossTwoHundredLayouts` — keep their own message strings at the call site,
unchanged word for word from the pre-slice file; the two owner-scoped queries in
`activatingOneUsersLayoutDoesNotDisturbAnother` are untouched at lines 920-943 with both pointer comments
intact; and the diff touches no Group C or Group D query — `layoutIdNamed()` at line 1047 and both
`WHERE Name = …` setup queries are byte-for-byte as they were.
