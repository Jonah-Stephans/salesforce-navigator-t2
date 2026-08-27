---
depends_on:
touches:
  - force-app/main/default/classes/NavigatorLayoutControllerTest.cls
---

# Declare WITH SYSTEM_MODE on the four test verification queries

> Watch a new test go red before you make it green.
> _Why: a test written before the code cannot be written to hit a coverage number — there is nothing to
> cover yet. Retires when Apex gets mutation testing._

## What to build

`NavigatorLayoutControllerTest`'s verification helpers — `storedLayouts`, `activeCount`, `activeName`,
`sectionNameOf` — read a row's true state regardless of which identity is running the test, so a
freshly created scratch org's default admin, never granted `Salesforce_Navigator_User`, deploys this
package and passes `RunLocalTests` cleanly.

## Acceptance criteria

- [x] met `storedLayouts()`, `activeCount()`, `activeName()`, and `sectionNameOf()` in
      `NavigatorLayoutControllerTest.cls` each declare `WITH SYSTEM_MODE`
- [x] met An inline comment above `storedLayouts()` documents why `WITH SYSTEM_MODE` is deliberate here and
      what reverting it to `WITH USER_MODE` would reintroduce
- [ ] `sf project deploy start --test-level RunLocalTests` succeeds against a freshly created scratch
      org with no permission set assigned to the org's default admin, and every local test passes
- [x] met `peerCannotReadAnotherUsersLayouts` and `aUserCannotUpdateAnotherUsersLayout` pass unchanged
- [x] met No SOQL outside these four methods has an access-mode declaration added or changed

## Deviations

- [ ] **The spec's inventory of four affected queries is incomplete, and criterion 3 cannot be met
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
