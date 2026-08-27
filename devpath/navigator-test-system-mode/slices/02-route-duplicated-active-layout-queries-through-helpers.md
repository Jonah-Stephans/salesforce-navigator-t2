---
depends_on:
  - devpath/navigator-test-system-mode/slices/01-declare-system-mode-on-verification-queries.md
touches:
  - force-app/main/default/classes/NavigatorLayoutControllerTest.cls
done: true
fix_cycles: 2
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

---

Slice pass, re-review of the fix above, 2026-08-27. Code under review is `2a1da02`; the fix under review
is `git diff 186329d 2a1da02` — three files, comment and prose only. Working tree clean.
**Line numbers below are as of `2a1da02`, not `a848111`.** The fix grew the `storedLayouts()` comment
from eight lines to nine, so every number recorded in the pass above is one lower than the same line is
today; those numbers are still correct against the baseline that pass declares, and are left alone.

**The fix closes its finding, and that was tested rather than read.** Two checks, neither of them
reading the comment and agreeing with it.

Mutation, re-run independently rather than taken from the record above. `activeId()` alone reverted to
`WITH USER_MODE` in a scratch copy — one line, 1094, with `diff` against the committed file confirming
nothing else moved — then dry-run deployed against `sysmode-verify-02` (`sf project deploy start
--dry-run --test-level RunLocalTests`, deploy `0Afdh000009pLtJCAU`). `Status: Failed`, 40 tests, 38
completed, **2 test errors**: `activatingOneLayoutClearsTheFlagOnTheOthers` and
`activationStaysOneUpdateAcrossTwoHundredLayouts`, both `System.QueryException: No such column
'Is_Active__c' on entity 'Navigator_Layout__c'`, both with `Class.NavigatorLayoutControllerTest.activeId:
line 1090` at the head of the stack. The org shape was re-confirmed first rather than assumed:
`sysmode-verify-02` holds one `PermissionSet` row named `Salesforce_Navigator_User`, deployed as
metadata, and **zero** `PermissionSetAssignment` rows for it. So the clause the fix added — "Reverting
these five to WITH USER_MODE reintroduces 'No such column'" — is now verified true of the fifth rather
than asserted of it.

Exhaustiveness, which is the stronger check and the one the finding actually turns on. The finding was
not "one name is missing" but "the enumeration is the *only* route by which the warning reaches a
helper, and it excludes one". Derived mechanically over every `WITH SYSTEM_MODE` **query** site in the
file, asking of each whether it is named in the enumeration or carries a pointer comment above it.
Eight sites, all reached: 133 `storedLayouts`, 1060 `sectionNameOf`, 1074 `activeCount`, 1083
`activeName`, 1094 `activeId` — enumerated; 381, 928, 939 — pointered, from the three pointer comments
at 375, 921 and 932. **No site is unreached, and the enumerated set is exactly the set of helpers that
declare `WITH SYSTEM_MODE`** — five named, five present, no sixth. The count and the membership both
hold, so the finding is closed and closed generally rather than by patching the one name.

**Checked what the fix might have broken or weakened; on the code side it broke nothing.** The
`NavigatorLayoutControllerTest` hunk is nine comment lines replacing eight. No query, no `WITH` clause,
no assertion, no assertion message, no method and no brace moved — confirmed by reading the file rather
than the diff. The DRY properties were re-derived from scratch and are unchanged: the longest run of
identical consecutive lines shared by the two routed methods is six, and a file-wide scan for a 10-line
window occurring more than once returns only the pre-existing `getLayouts()` sandwich, at the same five
window regions it occupies on `main`. On `spec.md`, the three hunks all land inside `## Design` — no
Outcome, no `## Out of scope` paragraph, no `## Traps` entry, no `## Current state` line and no
`## Open questions` entry was touched. On this file, the only change is inside `## Critique findings`.
No acceptance criterion moved. **What the fix did weaken is `## Design`'s own internal consistency**, in
the two sentences it rewrote — the two findings below.

- [x] fixed — rewrote the sentence to drop the count and state the property instead. It now reads
      "Every Group B site that remains inline after the routing does need a pointer, and gets one —
      `## Current state`'s Group B table is the roster:". **Not "three"**, which was the obvious
      one-word fix: `## Current state` is the section that holds this spec's figures, and `## Outcomes`
      bullet 1 already refuses to carry a count on the stated grounds that "the number changes whenever
      a query is routed through a helper, and re-deriving it has already been wrong twice". Three would
      have been true today and exactly as fragile as seven was. Deferring to the Group B table is true
      whatever the membership becomes, and it sends the reader to the roster rather than to a number
      they then have to reconcile. Three was verified anyway before choosing, by counting pointer
      comments in the file mechanically: 375, 921, 932, and no others.

      A second `## Design` sentence was making the same claim and is corrected with it, because fixing
      one and leaving a sibling standing is precisely how this finding came to exist. The
      correction-to-its-own-reasoning paragraph still said in the present tense that "the seven that
      were not **are written** inline mid-assertion" — a reader counting Group B from that sentence
      lands on seven just as surely as from the one the critic named. It now reads "the seven it missed
      **were written** inline mid-assertion … That seven is the first inventory's miss, not Group B's
      membership today — four of the seven have since been routed into helpers, and `## Current state`
      holds the current roster." The historical count of seven is left standing: seven queries really
      were left out of the first inventory, and that is a fact about the past rather than a claim about
      the file. The two sentences the critic names as already consistent — "except the two shapes that
      are routed into helpers instead" and "Every Group B site that remains inline after the routing
      gets a one-line pointer back to it" — needed no change, and the rewritten sentence was worded to
      match the second of them word for word.

      Checked by re-grepping the whole of `## Design` for every count and proximity claim afterwards,
      not by re-reading the sentences I had just edited: the only surviving "seven" is the historical
      one above, and no sentence in the section now states a Group B membership at all. All hunks land
      inside `## Design`; no acceptance criterion, `## Out of scope` paragraph, `## Traps` entry,
      `## Current state` figure or `## Open questions` entry was touched. No code changed, so nothing
      was deployed.

      Finding as raised:
      **`spec.md` `## Design` still reads "Group B's seven do need a pointer, and get one", and after
      this slice's routing Group B is three.** The fix pass rewrote that literal sentence — `git diff
      186329d 2a1da02` shows "Group B's seven do, and get one:" becoming "Group B's seven do need a
      pointer, and get one:" — in the same edit that corrected "the other **three** helpers" to "the
      other **four** helpers" one clause earlier. One count in the sentence was brought up to date and
      its neighbour in the same sentence was not. Seven is the pre-routing membership: `## Current
      state`'s Group B table now holds **three** rows and says "Each of the three appears exactly once
      and stays inline, with its pointer comment", above a paragraph headed "**Four further inline
      sites were routed into helpers by slice 02 and no longer exist**". The file agrees — exactly
      three pointer comments, at 375, 921 and 932, counted mechanically. `## Design` also contradicts
      itself twice over: "The fix" paragraph says Group B takes a pointer "**except the two shapes that
      are routed into helpers instead**", and "Comment placement" says "Every Group B site **that
      remains inline after the routing** gets a one-line pointer back to it". This is the same defect
      class the fix pass existed to close — a `## Design` count that the routing invalidated — and it
      matters for the same reason that pass gave in its own justification: `## Design` is what a reader
      regenerates the code from. A reader regenerating pointers from this sentence looks for seven
      inline sites, finds three, and the obvious way to reconcile the difference is to restore pointers
      to the four routed shapes — which `## Design`'s own routing section says must not have them. One
      word in one sentence; no code involved.

- [x] fixed — **dropped the appeal to proximity rather than restating the distance.** The sentence now
      reads "The other four helpers need no pointer of their own because that comment's enumeration
      names each of them, and an enumeration reaches a helper wherever in the file it sits. **Not
      proximity** — an earlier draft justified this by distance instead ("within 900 lines"), and that
      figure was false of all four helpers it covered; `## Current state` records why this spec stopped
      quoting line figures at all."

      Why dropped rather than restated, on three grounds. `## Design`'s routing section already states
      outright that the enumeration is "the only route by which the revert warning reaches
      `activeId()`", so the proximity clause was not carrying the justification it appeared to — it was
      a second, weaker reason for a conclusion the enumeration already establishes, and it happened to
      be false. A restated figure would be the third stale number in this section's history:
      `## Current state` abandoned line numbers entirely after they "went stale twice — the second time
      inside the very commit that was correcting them", and a distance measured from a comment block
      that has grown twice in two passes will rot on the next edit that grows it again. And "within 900
      lines" was never a claim of proximity in any useful sense even when someone believed it — 900
      lines is not "nearby" to a reader, so the clause bought nothing it could lose. The retraction
      keeps "within 900 lines" visible as a quoted, labelled falsehood, so the correction is legible to
      the next reader rather than silently disappeared.

      Re-measured against the file as it stands at `d6ffa41` rather than trusting the recorded figures,
      per the instruction, and they reproduce exactly. From the `storedLayouts()` declaration at 122:
      `sectionNameOf` (1053) is 931 lines below, `activeCount` (1069) 947, `activeName` (1078) 956,
      `activeId` (1089) 967. None is within 900 — the clause was false of all four, as raised.

      **The same false proximity claim appeared twice more in `## Design`, and both are corrected**,
      because fixing one and leaving a sibling standing is the defect this pass exists to close.
      "Comment placement" read "The helpers need no pointer, **sitting under the comment already**" —
      they sit 931 to 967 lines from it — and now reads "being named one by one in that comment's own
      enumeration". The routing section read "the routed shapes now live in the helper block,
      **directly under** the full comment above `storedLayouts()`, so a pointer back to a comment
      **four lines up** would be noise" — `activeId()` is 967 lines below that comment, not four — and
      now reads "live in the helper block, and the full comment above `storedLayouts()` covers that
      block by naming its members one by one, so a second pointer at the call site would be noise".
      All three now give the same reason, and it is the true one.

      One proximity figure in `## Design` is deliberately left alone: "the existing convention two
      lines up is the null-safe one", about `activeName()` relative to `activeId()`. `activeName()`
      really is the method directly above `activeId()`, and its null-safe return (1086) sits three
      lines above `activeId()`'s declaration (1089) — adjacent and true, in the way the three
      corrected claims were not. Editing it would be scope creep with no defect behind it.

      No code changed — all four hunks are `## Design` prose — so nothing was deployed.

      Finding as raised:
      **`spec.md` `## Design`'s "the other four helpers sit within 900 lines of it" is false of all
      four, and that number is the sentence's own justification for why they need no pointer.**
      Measured at `2a1da02` from the `storedLayouts()` declaration at 122: `sectionNameOf` 931 lines
      below, `activeCount` 947, `activeName` 956, `activeId` **967**. None is within 900. Lower weight
      than the finding above and **not created by the fix** — it was already false at `a848111~1`,
      where the furthest of the then-three was 970 lines down — but the fix pass rewrote this exact
      clause, "other three" to "other four", without checking the number it was left holding, and the
      new fourth is the furthest of them. The previous pass had already measured the true distance and
      written it down ("the comment also sits 947 lines above the helper block it describes, so the
      enumeration is doing more work than proximity is"), so the correction was on file at the moment
      the clause was edited. Either restate the distance or drop the appeal to proximity; the
      enumeration is what actually carries the warning, as `## Design`'s routing section now says
      outright.

- [ ] **Commit `2a1da02` is typed `fix(test):` for a change that is documentation only, which
      `.claude/rules/rstk-conventional-commits.md` types `docs`.** The rule lists `docs` as
      "Documentation only changes" and `fix` as "A bug fix". All three files in the commit are prose:
      nine comment lines in the `.cls`, three `## Design` paragraphs, one slice-file disposition. The
      slice file says so itself, in this section — "No code changed in this pass, only comment text."
      This spec's other commits follow the rule (`docs(spec):` on the four spec-only commits,
      `refactor(test):` on the one that changed code), so `fix(test):` is the outlier rather than the
      house style. **Raised rather than disposed, because the disposal is a judgment I do not own:**
      the branch is already pushed — `origin/navigator-test-system-mode` is at `2a1da02` — so
      correcting it means `--amend` and a force-push over a published commit, and a reviewer may well
      judge a commit-message type not worth rewriting shared history for. Recording it so that call is
      made rather than missed.

- [x] false positive — **the `## Design` sketch and the code comment have drifted, so a reader
      regenerating the comment from the sketch reproduces the defect.** This is the failure mode the
      fix pass's own rationale names, so it was checked word for word rather than assumed closed. They
      agree on everything load-bearing: the same opening clause, the same "this and the four
      verification helpers that follow", the same four names in the same order, the same "Reverting
      these five to WITH USER_MODE reintroduces 'No such column'". The single divergence is a trailing
      ", which is the shape this project's own CI deploy gate creates" that the code carries and the
      sketch does not — it predates this fix on both sides (`a848111` has it in the code and not in the
      sketch) and it is additive, not contradictory: regenerating from the sketch drops a true clause,
      it does not produce a false one. `## Design` also now reconciles why the sketch shows four
      helpers and the enumeration names five, in the sentence "`activeId()` is the fifth; it is added
      by the routing section below". Nothing to fix.

- [x] false positive — **the routed helpers' `WITH SYSTEM_MODE` protection is now single-point, so a
      revert of the whole helper block would go unnoticed where per-site declarations would not.**
      Re-raised against the mutation evidence rather than the earlier pass's reasoning, and it does not
      survive: the dry-run above reverted one helper and the deploy *failed*, naming both callers by
      method in the stack. A revert of more helpers fails harder, not more quietly — reverting all five
      is the 26-of-40 failure `## Intent` describes. There is no configuration of this file in which a
      reverted `WITH SYSTEM_MODE` passes against the org shape `## Traps` names.

**The seven `false positive` dispositions above were re-checked against their recorded disproofs and
all seven stand.** Independently re-verified rather than accepted: `sysmode-verify-02` is live and holds
zero assignments of `Salesforce_Navigator_User`; the `getLayouts()` sandwich is present on `main` at the
same five duplicated-window regions; none of the 31 call sites of the three routed helpers asserts `0`
active or a `null` result, so `activeId()`'s null branch and `activeName()`'s are unexercised
symmetrically; `activeId()` is `private` and its four siblings carry no ApexDoc either; the three
surviving pointer comments sit at sites that kept their queries; and neither routed call site sits
inside a `System.runAs` block — both follow `Test.stopTest()`, at 892-901 and 1743-1752 — so no
access-mode declaration moved into a `runAs` context and Outcome 5 is untouched. One trivial correction
to a recorded number, which changes no disposition: the longest identical run shared by the two routed
methods is **six**, not five — the disproof starts its count at `Test.stopTest();` and the closing brace
of the `System.runAs(owner)` block above it is shared too. Six is as far under the ten-line threshold as
five was, so criterion 4 holds either way.

**No trap written.** The trigger is binary — a confirmed finding whose cause is a test that passed while
the code was wrong — and neither confirmed finding has a test anywhere on its path. Both are `spec.md`
prose defects: a stale count and a stale distance, in sentences no Apex test can reach. The mutation
this slice's hazard actually turns on is already covered by the first `## Traps` entry, and the mutation
run above is fresh evidence that entry is enforceable rather than a further trap.

---

Slice pass, re-review of the second fix, 2026-08-27. Code under review is `09100cf`; the fix under review
is `git diff d6ffa41 09100cf` — two `devpath/` files, prose only. `git diff a848111 HEAD -- force-app/` is
the nine-line comment change from `2a1da02` and nothing else, so no code moved in this pass, no metadata
changed and nothing was deployed. Working tree clean. **Line numbers below are as of `09100cf`**, which is
the same numbering the pass above used.

**Both findings are closed, and each closure was checked against the file rather than against the text of
the fix.**

The Group B count. `## Design` no longer states a Group B membership anywhere — established by grepping the
whole of `spec.md` for every numeral and number-word, not by re-reading the two sentences that were edited.
The only surviving "seven" is the historical one, and it is genuinely historical in every instance: the
paragraph now reads "the seven it missed **were written** inline mid-assertion", past tense, followed by an
explicit disclaimer that it is the first inventory's miss rather than today's membership. Its arithmetic
reconciles with the roster it defers to — seven missed, less the four `## Current state` records as routed
away, leaves three, which is what the Group B table holds. And the table is a roster that says what
`## Design` now claims it says: three rows, each one a query that is still in the file and still carries a
pointer comment — 375/379 (`Schema_Version__c`), 921/925 (owner-scoped `COUNT()`), 932/936 (peer-scoped
`Name`) — and no fourth pointer comment exists anywhere in the file. Nothing was left dangling by the
removal: the rewritten sentence stands on its own and matches "Comment placement" word for word, as
intended.

The proximity claim. Re-measured from the `storedLayouts()` declaration at 122 rather than trusting the
record: `sectionNameOf` 1053, `activeCount` 1069, `activeName` 1078, `activeId` 1089 — 931, 947, 956 and 967
lines below. None within 900, so the clause really was false of all four and dropping the appeal rather than
restating a figure is the right disposal. The reason that replaced it is true and mechanically checkable:
the file holds exactly eight `WITH SYSTEM_MODE` **query** sites — 133, 381, 928, 939, 1060, 1074, 1083, 1094
— of which the five helper sites are named one by one in the comment at 113-121 and the three inline sites
carry pointers at 375, 921 and 932. No site is unreached, and the three corrected sentences now give the
same reason.

**Did the second fix pass break the pattern?** Not in the way the two before it did — it introduced no new
false count and no new false distance, and I looked for both. But it rewrote a sentence that ends in a
colon and did not look at what the colon introduces, which is the first finding below. Two further stale
counts turned up in the sweep, one of them created by this slice's own routing and never updated.

- [ ] **`## Design`'s pointer exemplar is one of the four sites this slice's routing deleted — and the
      sentence this fix pass rewrote is what introduces it.** The rewritten sentence ends "— `## Current
      state`'s Group B table is the roster:" and the colon hands straight to a fenced block (`spec.md`
      `## Design`) showing a pointer comment above an inline
      `[SELECT COUNT() FROM Navigator_Layout__c WHERE Is_Active__c = TRUE WITH SYSTEM_MODE]` carrying the
      message `'Exactly one of a user\'s layouts may be active'`. That block is not a Group B site and is
      not in the roster the sentence just pointed at. It is verbatim what stood at `a848111~1` lines
      891-901 inside `activatingOneLayoutClearsTheFlagOnTheOthers` — pointer comment, query and assertion
      message together — which is one of the two `activeCount()` copies this slice routed away. That
      message now sits at line 895 on an `activeCount()` call with no pointer comment above it, exactly as
      `## Design`'s own routing section requires ("The pointer comments on the routed queries go away with
      them"). So `## Design` offers as its worked example of a surviving Group B site the precise code its
      routing section says must no longer exist, and none of the three rows actually in the Group B table
      has that shape — one selects `Schema_Version__c`, the other two are further filtered on `OwnerId`.
      This is the same failure mode as the finding this pass closed and carries the same consequence its
      own justification names: a reader regenerating pointers from `## Design` restores a pointer plus an
      inline copy at a routed site. **Not created by this fix pass** — the block was accurate before the
      routing and has been stale since `a848111` — but this pass rewrote the sentence above it and re-aimed
      that sentence at a roster the block contradicts, which is where a stale illustration became a
      self-contradiction. Swapping the illustrated query for one that survives, the `Schema_Version__c`
      read at 379 for instance, closes it; no code changes either way.

- [ ] **`## Current state`'s headline figure, "32 SOQL sites", is this slice's own casualty and was never
      updated: the file holds 29.** Counted mechanically at `09100cf` — 29 `SELECT` keywords, no
      subqueries — against 32 at `a848111~1` and 32 on `main`. The difference is exactly this slice: four
      inline sites deleted (both `activeCount()` copies, both `activeId()` copies), one added
      (`activeId()`), net −3. It is the first line of the section, and the second fix pass has just made
      that section the authority `## Design` defers to — for the Group B roster in the sentence it
      rewrote, and for figures generally in its own recorded reasoning ("`## Current state` is the section
      that holds this spec's figures"). It also makes the section's arithmetic wrong for any reader who
      does it: Group A (5) + Group B (3) + Group C (4) = 12, so "Group D — everything else" reads as 20
      sites when it is 17. Same defect class as the two findings this pass closed, created by the same
      commit that created them. Worth noting for whoever fixes it: `## Current state`'s own stated
      convention is to drop a number that rots rather than restate it — it abandoned line numbers on
      exactly those grounds two paragraphs later — so deleting the figure may serve better than
      correcting it. Either way 32 is wrong.

- [ ] **Two of the three caller counts in `## Current state`'s Group A are false of the file.**
      `activeCount()` is described as "Called from the two activation tests". It is called from twelve
      test methods, one call each: 894, 1118, 1165, 1209, 1255, 1288, 1316, 1489, 1535, 1556, 1745, 1815.
      This slice added two of them (894, 1745) and the line was written inside this spec, at `e494832`, so
      it reads as though the routing gave `activeCount()` its callers when it already had ten.
      `activeId()`'s identically worded clause is true — 899 and 1750, and nothing else — which is what
      makes the `activeCount()` one read as exhaustive. `storedLayouts()` is described as "Called from 8
      write-path tests"; it is called from nine distinct methods, at 512, 546, 593, 627, 642, 701, 750,
      792 and 837, all of them write-path — `updateRefusesANullLayoutId` (766-803, calling at 792) is the
      one an eight-count leaves out. That second site is **not this spec's**: it is nine on `main` too and
      has been wrong since the survey commit. Lower weight than the two findings above, because nobody
      regenerates code from a caller count — but Group A is half of the roster `## Design` now sends
      readers to, and this pass's stated reason for sending them there is that `## Current state` is where
      the figures are kept.

**Everything else re-derived from the file and standing.** Criterion 4, mechanically: the longest run of
identical consecutive lines shared by the two routed methods is **six** — 889-894 against 1740-1745, the
`System.runAs` closing brace, `Test.stopTest();`, blank, `Assert.areEqual(`, `1,`, `activeCount(),`,
diverging at the message — which matches the correction recorded above rather than the five in the original
disproof. A file-wide scan for any 10-line window occurring more than once returns only the pre-existing
`getLayouts()` sandwich, in the regions at 187-190, 341, 408-412 and 469-473, across four methods, all
confirmed present on `main`. Outcome 1: every query naming a custom field declares `WITH SYSTEM_MODE` —
the eight sites listed above; every other appearance of `Is_Active__c`, `Layout_JSON__c`,
`Schema_Version__c` or `Sort_Order__c` in the file is a field assignment on a seeded row or a read off a
returned SObject, not a query. Group memberships re-checked against the file rather than against the table:
Group B's three sit outside any `runAs` (379 follows an assertion at the method body's own indent; 925 and
936 both follow `Test.stopTest()` at 919), and Group C's four are 262 (bare `COUNT()`, outside `runAs`),
301 (`Id` filter, inside `System.runAs(owner)`), 971 and 998 (both outside any `runAs`) — so "exactly one of
the four sits inside a `System.runAs` block" holds. Group D's three non-`Navigator_Layout__c` queries are
`Profile` (45), `PermissionSet` (52) and `User` (96), in `makeUsers()` and `userWith(String)` as described.
Both file references in `spec.md` resolve: `NavigatorLayoutControllerTest.cls:18` is the
`private with sharing` declaration, and `NavigatorLayoutController.cls:388-402` is `ownLayouts()` exactly,
its `WITH USER_MODE` at 399. Criterion 7 is untouched by this pass — no `force-app/` file changed since
`2a1da02`, whose org body the previous pass verified byte-identical — so the `sysmode-verify-02` evidence
still describes the committed code; not re-run.

**"The existing convention two lines up", checked and deliberately not raised.** The previous pass left this
one proximity figure standing and measured it as three lines (1086 to 1089) while calling it "two", which is
the sort of near-miss this review was told to look for. On the file it is sound on the natural reading:
`activeName()` closes at 1087 and `activeId()` opens at 1089, two lines apart, and `activeName()` is the
method immediately above. Whichever end you measure from, the claim's substance — the adjacent convention is
the null-safe one — is true. Raising an off-by-one on a hedge phrase would be manufacturing a finding.

**No trap written.** The trigger is binary — a confirmed finding whose cause is a test that passed while the
code was wrong — and none of the three findings above has a test anywhere on its path. All three are
`spec.md` prose: an illustration showing deleted code, a stale site count and two stale caller counts. No
Apex test can reach any of them, and no test could have caught any of them. The `## Traps` entries were
re-read against the file and all four remain enforceable as written; the first is the one this slice's
hazard turns on and the mutation runs recorded above are its evidence.

**Commit typing since `2a1da02`, an observation and not a finding.** Both commits made since — `d6ffa41` and
`09100cf` — are typed `docs(spec):` over prose-only changes, which is what
`.claude/rules/rstk-conventional-commits.md` prescribes. That confirms rather than disturbs the open box
above: `2a1da02` is still the single mistyped commit on this branch and nothing since has compounded it.
The box is left exactly as it stands, and no git history operation was performed or is proposed here.
