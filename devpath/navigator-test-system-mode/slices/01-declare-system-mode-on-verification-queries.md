---
depends_on:
touches:
  - force-app/main/default/classes/NavigatorLayoutControllerTest.cls
done: true
fix_cycles: 0
---

# Declare WITH SYSTEM_MODE on the eleven test verification queries

> Watch a new test go red before you make it green.
> _Why: a test written before the code cannot be written to hit a coverage number — there is nothing to
> cover yet. Retires when Apex gets mutation testing._

## What to build

Every verification query in `NavigatorLayoutControllerTest` reads a row's true state regardless of which
identity is running the test, so a freshly created scratch org's default admin, never granted
`Salesforce_Navigator_User`, deploys this package and passes `RunLocalTests` cleanly.

## Acceptance criteria

- [x] met Group A — `storedLayouts()`, `sectionNameOf()`, `activeCount()` and `activeName()` in
      `NavigatorLayoutControllerTest.cls` each declare `WITH SYSTEM_MODE`
- [x] met A comment above `storedLayouts()` documents why `WITH SYSTEM_MODE` is deliberate here and what
      reverting it to `WITH USER_MODE` would reintroduce
- [x] met Group B — the seven inline queries at lines 365, 876, 881, 906, 915, 1701 and 1706 each declare
      `WITH SYSTEM_MODE`, and each carries a one-line comment pointing back to the note above
      `storedLayouts()`
- [x] met Group C — `peerCannotReadAnotherUsersLayouts` and `aUserCannotUpdateAnotherUsersLayout` each carry
      a method-level comment stating that their queries are deliberately bare and that declaring an
      access mode on them leaves the test passing while it verifies nothing
- [x] met `sf project deploy start --test-level RunLocalTests` succeeds against a freshly created scratch
      org with no permission set assigned to the org's default admin, and every local test passes. The
      org is named in the report and `Salesforce_Navigator_User` is confirmed absent from it — a green
      run against an org whose admin holds the permission set proves nothing here (`spec.md`,
      `## Traps`)
- [x] met `peerCannotReadAnotherUsersLayouts` and `aUserCannotUpdateAnotherUsersLayout` still pass in that
      same run, with no access-mode declaration added to any query inside their `System.runAs` blocks
- [x] met No query inside a `System.runAs` block, and no query that reads or filters on only standard
      fields, has an access-mode declaration added or changed — the four listed as Group C in
      `spec.md`'s `## Current state`, and the twenty-one listed as Group D, are all unchanged

## Deviations

- [x] fixed — **Group C's comment goes inside the existing ApexDoc block, not in a `//` block above
      `@IsTest`.** `## Design` sketches the Group C warning as a `//` comment; both methods already
      carry an ApexDoc block explaining what they prove, and `.claude/rules/rstk-preserve-documentation.md`
      forbids displacing it. The warning is appended as a second paragraph inside each existing block,
      which is still method-level and reads as one explanation rather than two competing ones. Wording
      only — no change to which queries are touched.

      While placing it, two attribution slips in `spec.md`'s `## Current state`, Group C surfaced. They
              change nothing about the work — all four queries are untouched either way — but a later reader
              should not trust the line as written. (a) Line 289 is inside
              `sharingCanNeverBecomeTheFilterForWhoseLayoutsComeBack`, not
              `peerCannotReadAnotherUsersLayouts`. (b) Group C's claim that "all four are inside a
              `System.runAs` block" holds only for 289; 250, 938 and 965 all run at the default admin identity,
              outside any `runAs`. They are safe for the reason `## Design` gives second and calls stronger —
              they name only `Id`, `Name` or nothing — and they must stay bare for the reason it gives first,
              which is about what the two tests prove and does not depend on where the query sits. The comments
              as written say that, so they are true of each method as it actually is.

- [x] fixed — **Resolved at the design gate on 2026-08-27: widen to all 11 queries.** The engineer
      chose to fix the seven inline queries as well and to restate the too-broad criterion as the
      invariant it was reaching for. `## Design`, `## Current state`, `## Outcomes` and `## Traps` on
      `spec.md` were rewritten accordingly, and an independent re-scan of all 32 SOQL sites in the file
      confirmed the seven-query inventory below is complete — there is no eighth. Two options recorded
      here were rejected: keeping the scope at four (forfeits Outcome 2) and switching to a
      `@TestSetup` permission-set grant (a different design). Routing the duplicated queries through
      helpers, a third possibility raised during the conversation, is now on file under
      `## Open questions` as its own follow-up. Original pause text follows.

      **The spec's inventory of four affected queries is incomplete, and criterion 3 cannot be met
                      without contradicting criterion 5. Design decision needed.**

                      The four helpers now declare `WITH SYSTEM_MODE` and the fix works — against a freshly created
                          scratch org with no permission set on the default admin, failures dropped from the spec's
                          reported 26/40 to **4/40**. But the deploy still fails, so criterion 3 is unmet.

                          Verified against scratch org `sysmode-verify` / `test-o7yifj7p7zwv@example.com`, created
                          2026-08-27T12:18:50Z, `Salesforce_Navigator_User` confirmed absent from the org (0 rows in
                          `PermissionSet`), i.e. exactly the org shape criterion 3 names. `sf project deploy start
                          --test-level RunLocalTests --target-org sysmode-verify` → `Status: Failed`, Passing 36,
                          Failing 4:

                          - `activatingOneLayoutClearsTheFlagOnTheOthers` — line 876 —
                            `System.QueryException: No such column 'Is_Active__c' on entity 'Navigator_Layout__c'`
                          - `activatingOneUsersLayoutDoesNotDisturbAnother` — line 905 — same, `Is_Active__c`
                          - `activationStaysOneUpdateAcrossTwoHundredLayouts` — line 1701 — same, `Is_Active__c`
                          - `aV1RowIsUpgradedToV2OnRead` — line 365 —
                            `System.QueryException: No such column 'Schema_Version__c'`

                          **Where `## Design` went wrong.** Its "Left alone, and why it's safe" paragraph reasons that
                          "`COUNT()` selects no fields at all". That is true of the bare `[SELECT COUNT() FROM
                          Navigator_Layout__c]` at line 241, but FLS also applies to fields referenced in a `WHERE`
                          clause — so `[SELECT COUNT() FROM Navigator_Layout__c WHERE Is_Active__c = TRUE]` *does*
                          touch a permission-set-only custom field and *does* throw "No such column". `## Current
                          state`'s inventory missed every inline verification query written directly into a test body
                          rather than routed through a helper.

                          **Full inventory of what else needs the same treatment** — 7 queries in 4 test methods, none
                          of them inside a `System.runAs` block, so none of them bear on criterion 4:

                          | Line | Query | Why it fails |
                          |---|---|---|
                          | 365 | `[SELECT Schema_Version__c FROM Navigator_Layout__c LIMIT 1]` | custom field selected |
                          | 876 | `[SELECT COUNT() FROM Navigator_Layout__c WHERE Is_Active__c = TRUE]` | custom field in `WHERE` |
                          | 881 | `[SELECT Id FROM Navigator_Layout__c WHERE Is_Active__c = TRUE LIMIT 1]` | custom field in `WHERE` |
                          | 905 | `SELECT COUNT() … WHERE Is_Active__c = TRUE AND OwnerId = :owner.Id` | custom field in `WHERE` |
                          | 914 | `SELECT Name … WHERE Is_Active__c = TRUE AND OwnerId = :peer.Id LIMIT 1` | custom field in `WHERE` |
                          | 1701 | `[SELECT COUNT() FROM Navigator_Layout__c WHERE Is_Active__c = TRUE]` | custom field in `WHERE` |
                          | 1706 | `[SELECT Id FROM Navigator_Layout__c WHERE Is_Active__c = TRUE LIMIT 1]` | custom field in `WHERE` |

                          Only 4 of the 7 appear in the failure list because a test stops at its first failing
                          assertion; lines 881, 914 and 1706 sit after a query that already threw.

                          Confirmed untouched and still safe, exactly as `## Design` claims: line 241
                          (`[SELECT COUNT() FROM Navigator_Layout__c]`, no field anywhere) and line 965
                          (`[SELECT Name … WHERE Id = :ownersLayoutId]`, standard fields only) — the two
                          `System.runAs` security tests' own queries. Both tests passed in both orgs.

                          **The decision.** Adding `WITH SYSTEM_MODE` to those 7 queries is the fix that makes
                          criterion 3 / Outcome 2 achievable, but it directly contradicts criterion 5 and Outcome 4
                          ("No SOQL outside these four methods has an access-mode declaration added or changed"). One
                          of the two has to give. Options, for whoever owns the design:

                          1. Widen the scope to all 11 queries (the 4 helpers + these 7) and restate criterion 5 /
                             Outcome 4 as "no query inside a `System.runAs` block, and no query that reads only
                             standard fields, is touched" — which is the invariant the design was actually reaching for.
                          2. Keep the scope at four and drop criterion 3 / Outcome 2 to a partial claim, leaving the
                             package still undeployable against a fresh org — which forfeits the spec's stated point.
                          3. A different fix shape entirely (e.g. granting the permission set to the running admin in
                             `@TestSetup`), which is a different design, not this one.

                          Option 1 looks right but it is not mine to choose. Paused here; the seven queries are
                          **not** edited.

- [ ] excess — `.claude/rules/rstk-lwc-standards.md`, `.claude/rules/rstk-slds2-ux-standards.md`,
      `docs/research/salesforce-same-deploy-schema-race.md`, `job`. All four were already dirty or
      untracked in the working tree before this slice started and are outside its `touches`;
      `git add -A` on the pause commit swept them in. The two `.claude/rules` files are the
      engineer's own in-flight edits, `docs/research/...` is the investigation trail the spec's
      `## Evidence` cites, and `job` is a stray 9-byte file (`NO - red`) that looks like a shell
      artifact rather than anything intentional.

## Critique findings

- [ ] **The two Group C guard comments say something false about the methods they sit above, and
      `spec.md` says it in three places.** The comments at `NavigatorLayoutControllerTest.cls:228-233`
      (`peerCannotReadAnotherUsersLayouts`) and `:962-966` (`aUserCannotUpdateAnotherUsersLayout`) each
      end "Declaring an access mode on them — `WITH SYSTEM_MODE`, to match the helpers — leaves this
      test passing while it verifies nothing at all." Annotating those queries would leave both tests
      verifying exactly what they verify today. Two independent reasons, either one sufficient:
      (a) neither method holds a query inside a `System.runAs` block. The three queries the comments
      govern — 257, 975, 1002 — all run at the default-admin identity, after `Test.stopTest()` or
      before the `runAs` write. Each test's actual proof is the `NavigatorLayoutController` call made
      inside `System.runAs(peer)` (the empty DTO list at 250-254; the caught `AuraHandledException` at
      979-999), which no annotation on a test-class query can reach. (b) The class is declared
      `private with sharing` (line 18). Under `WITH SYSTEM_MODE` record sharing is controlled by the
      class's sharing keyword, so `WITH SYSTEM_MODE` anywhere in this file suppresses CRUD/FLS only
      and never sharing — no annotation in this class can remove a sharing-based proof. The same false
      premise is asserted in `spec.md` `## Design` ("that proof is only worth something under user
      mode… Declaring any access mode on them leaves both tests green and testing nothing") and in
      `## Traps` entry 3, which names those two methods as holding queries "inside a `System.runAs`
      block". Fixing this means rewriting the two comments to say what is actually true — these
      queries name only `Id`, `Name` or nothing, so they need no declaration — and correcting the
      `## Design` paragraph and `## Traps` entry 3 that generated them.

- [ ] **`spec.md` `## Current state`, Group C misattributes three of its four queries.** Verified
      line by line against the file: (a) old line 289 / current 296 is in
      `sharingCanNeverBecomeTheFilterForWhoseLayoutsComeBack` (276), not in
      `peerCannotReadAnotherUsersLayouts`. (b) "All four are inside a `System.runAs` block in one of
      the two security tests" is true of that one query only; old 250 / current 257, old 938 /
      current 975 and old 965 / current 1002 all run outside any `runAs`, and 296 is in neither
      security test. The build worker recorded both slips, but recorded them inside a `## Deviations`
      box marked `- [x] fixed`, and `## Current state` itself was never corrected — so the spec still
      reads false to anyone who opens it, in the one section this spec's whole history says must be
      trusted.

- [ ] **Group D's counts double-count Group C, in `## Current state` and again in `## Traps`.**
      `## Current state` says "Group D — the remaining 21 sites… The other 18 read
      `Navigator_Layout__c`", and `## Traps` entry 4 says "Eighteen queries against
      `Navigator_Layout__c` are safe only because of which fields they name." Enumerated: the file
      holds 32 SOQL sites (no dynamic SOQL, no `Database.query`), 11 now declaring `WITH SYSTEM_MODE`,
      4 in Group C, leaving **17** sites — 3 against `Profile`/`PermissionSet`/`User` (45, 52, 96)
      and **14** against `Navigator_Layout__c` (174, 674, 810, 869, 1053, 1390, 1430, 1456, 1589,
      1614, 1640, 1677, 1710, 1832). 11 + 4 + 21 = 36, four more than the file holds: the Group C
      four are counted once as C and again inside D's 18. Group D's substantive claim is sound — all
      14 name only `Id`, `Name`, `OwnerId` or nothing, checked individually — only the arithmetic is
      wrong.

- [ ] **The fix inflated a one-line duplication into a 24-line one, against
      `.claude/rules/rstk-dry-enforcement.md`.** Lines 887-910 in
      `activatingOneLayoutClearsTheFlagOnTheOthers` and lines 1736-1759 in
      `activationStaysOneUpdateAcrossTwoHundredLayouts` are now byte-identical across 24 lines except
      two assertion message strings (`diff` confirms: only lines 10 and 23 of the block differ). The
      rule's stated minimum check before a PR is "scan all new/modified files for blocks of 10+ lines
      that appear in more than one method. If found, extract into a shared helper." Before this
      commit each site was a single line; the six-line query form the fix introduces is what crosses
      the threshold. Separately, lines 890-895 are now character-for-character `activeCount()`'s body
      (1074-1079). `spec.md` `## Open questions` deliberately defers helper-routing, and that
      deferral is reasoned about the pre-fix one-line duplicates — it does not address the blocks
      this commit creates. Recording it so the human can weigh the deferral against the rule.

- [x] false positive — I raised that line 296, inside `System.runAs(owner)` in
      `sharingCanNeverBecomeTheFilterForWhoseLayoutsComeBack`, is the one query in the file whose
      bareness carries a proof and that it got no guard comment, so a later sweep annotating it would
      make the control assertion at 301-305 pass whether or not the manual share took. Disproved: the
      class is `private with sharing`, and under `WITH SYSTEM_MODE` record sharing is controlled by
      the class's sharing keyword, not suppressed. Annotating 296 would suppress CRUD/FLS only, and
      `nvowner` holds `Salesforce_Navigator_User` anyway, so `reachableBySharing` would still depend
      on the share record. The query needs no guard.

- [x] false positive — I raised that `.claude/rules/rstk-security.md` ("SCANNER-ENFORCED: ALL new
      SOQL must include `WITH USER_MODE`… flagged as must-fix by local PMD and GH Codacy") is
      violated by eleven new `WITH SYSTEM_MODE` declarations. Disproved: `.github/workflows/` holds
      one file, `pr-checks.yml`, and a case-insensitive sweep of `.github/` for `pmd`, `codacy`,
      `code-analyzer` and `scanner` returns nothing — the scanner the rule describes is not run here,
      exactly as `spec.md` `## Current state` claims. The rule also targets new production SOQL, not
      an explicit declaration added to existing test-verification queries, and the mirror case is
      already on file under `## Open questions`.

- [x] false positive — I raised that appending paragraphs to the ApexDoc blocks on
      `peerCannotReadAnotherUsersLayouts` and `aUserCannotUpdateAnotherUsersLayout`, whose bodies are
      unchanged, violates `.claude/rules/rstk-apex-standards.md` ("Do NOT add ApexDoc to methods you
      did not change — it adds noise to the diff"). Disproved: the rule is about signature
      documentation on untouched methods; these are the method-level guard comments the slice's own
      criterion 4 requires, and `.claude/rules/rstk-preserve-documentation.md` forbids displacing the
      existing block, which is why they are appended rather than placed above `@IsTest`. The
      placement is right; only the wording is wrong, which is the first finding above.
