---
type: bug
intent_accepted: true
---

# Navigator test helpers silently inherited Apex's new default execution mode

## Intent

`NavigatorLayoutControllerTest`'s verification-helper queries (`storedLayouts`, `activeCount`,
`activeName`, `sectionNameOf`) query `Navigator_Layout__c` without declaring an access mode. This
project targets `sourceApiVersion: 67.0`, and Salesforce's Summer '26 release changed Apex's default
for SOQL/DML from system mode to user mode at that API version — so these queries silently started
enforcing the running user's field-level security instead of seeing the row's true state. The org's
default admin identity is never granted the permission set that gives FLS on `Navigator_Layout__c`'s
custom fields (only two `System.runAs` test users are, in `@TestSetup`), so under user mode every field
became invisible to the admin: `System.QueryException: No such column`. 26 of 40 tests failed,
reproduced identically across three independently-created fresh scratch orgs. Deploying the whole spec
into an org holding none of it — the exact scenario a CI completeness gate is meant to exercise —
fails every time. Fix the four affected queries to declare the access mode they actually need.

## Outcomes

- `storedLayouts`, `activeCount`, `activeName`, and `sectionNameOf` in
  `NavigatorLayoutControllerTest.cls` explicitly declare `WITH SYSTEM_MODE`, so they read a row's true
  state regardless of which identity is running the test.
- `sf project deploy start --test-level RunLocalTests` against a freshly created scratch org holding
  none of this spec's metadata, with no permission set assigned to the org's default admin, deploys
  clean: the whole-payload deploy succeeds and every local test passes.
- `peerCannotReadAnotherUsersLayouts` and `aUserCannotUpdateAnotherUsersLayout` — the two
  `System.runAs` cross-user security tests — continue to pass, unchanged. Their own access-mode
  behavior, a peer user without the permission set being unable to read or touch another user's rows,
  is exactly what must not change.
- No query outside these four methods has its access-mode behavior altered.

## Out of scope

- `NavigatorLayoutController.ownLayouts()` — already explicitly declares `WITH USER_MODE`, correctly,
  as defense in depth per the class's own header comment. Not touched.
- CI/deploy-pipeline changes (credential architecture, workflow restructuring, branch-protection
  rules) — a separate, non-Salesforce-metadata effort tracked outside devpath.
- Auditing other Rootstock Apex codebases for the same latent API-67 default-mode risk. Real and
  worth doing, but a different repo's concern.

## Open questions

- Should `.claude/rules/rstk-security.md`'s scanner rule (today: flag new SOQL missing
  `WITH USER_MODE`) also flag test-verification-helper queries that should instead declare
  `WITH SYSTEM_MODE`? The mirror case to the rule it already enforces. Owner: whoever maintains that
  rule; out of scope for this spec's own fix.

## Current state

`force-app/main/default/classes/NavigatorLayoutControllerTest.cls` (1769 lines). The four target
methods, verbatim, all with no `WITH` clause today:

- `storedLayouts()` (lines 113–126) — `SELECT Id, Name, OwnerId, Is_Active__c, Sort_Order__c,
Schema_Version__c, Layout_JSON__c FROM Navigator_Layout__c ORDER BY Sort_Order__c NULLS LAST, Name`.
  Called from 8 write-path tests to re-query what actually landed.
- `sectionNameOf(String layoutName)` (lines 1011–1024) — `SELECT Layout_JSON__c FROM
Navigator_Layout__c WHERE Name = :layoutName LIMIT 1`. Used ~10 times across the switching/rename
  test block.
- `activeCount()` (lines 1026–1028) — `SELECT COUNT() FROM Navigator_Layout__c WHERE Is_Active__c =
TRUE`. Used ~10 times to assert the "exactly one active" invariant.
- `activeName()` (lines 1030–1038) — `SELECT Name FROM Navigator_Layout__c WHERE Is_Active__c = TRUE
LIMIT 1`. Used ~13 times alongside `activeCount()`.

All four read `Is_Active__c`, `Layout_JSON__c`, `Schema_Version__c`, and/or `Sort_Order__c` — exactly
the custom fields whose FLS lives only in `Salesforce_Navigator_User`
(`force-app/main/default/permissionsets/Salesforce_Navigator_User/`), the only permission set in the
repo. `@TestSetup` (`makeUsers()`, lines 39–75) assigns it to exactly two users, `nvowner` and
`nvpeer` — the `System.runAs` identities — never to the org's default admin, which is the identity
that runs every bare query outside a `runAs` block, including all four target methods.

The two `System.runAs` security tests (`peerCannotReadAnotherUsersLayouts`, lines 219–244;
`aUserCannotUpdateAnotherUsersLayout`, lines 922–959) never call any of the four target methods and
are confirmed untouched by scope.

Reference pattern, out of scope: `NavigatorLayoutController.ownLayouts()`
(`NavigatorLayoutController.cls:388-402`) already declares `WITH USER_MODE`, documented in the class
header as deliberate defense in depth. No test file in the repo declares an explicit access mode on
any SOQL today — there is no existing precedent for `WITH SYSTEM_MODE` to point to.

`.claude/rules/rstk-security.md` (scanner-enforced, applies to `**/*.cls`) says "ALL new SOQL must
include `WITH USER_MODE`... flagged as must-fix by local PMD and GH Codacy," and never mentions `WITH
SYSTEM_MODE`. Checked against this repo's actual CI (`.github/workflows/pr-checks.yml`): there is no
PMD or Codacy job in it — the rule describes a scanner this repo doesn't run. See `## Design` for how
this resolves the risk of the fix being misread later.

## Design

**Entry point.** The existing 40 `@IsTest` methods in `NavigatorLayoutControllerTest`, run via `sf
project deploy start --test-level RunLocalTests` (Outcome 2's own command, against a freshly created
scratch org with no permission set on the default admin). No new test is written — the fix corrects
four existing verification helpers so the existing suite reads each row's true state.

**The fix.** Add `WITH SYSTEM_MODE` to each of the four queries above, placed after `WHERE` (where
present) and before `ORDER BY` / `LIMIT`:

```apex
// Deliberately WITH SYSTEM_MODE, not WITH USER_MODE (the convention everywhere else in this
// codebase): these four methods verify the row's true state after a write, and the running
// identity (this project's org default admin, in a freshly created org) is never granted FLS on
// Navigator_Layout__c's custom fields — only the two System.runAs test users are. Reverting this to
// WITH USER_MODE reintroduces "No such column" against exactly that org shape.
private static List<Navigator_Layout__c> storedLayouts() {
  return [
    SELECT Id, Name, OwnerId, Is_Active__c, Sort_Order__c, Schema_Version__c, Layout_JSON__c
    FROM Navigator_Layout__c
    WITH SYSTEM_MODE
    ORDER BY Sort_Order__c NULLS LAST, Name
  ];
}

private static String sectionNameOf(String layoutName) {
  return String.valueOf(
    firstSectionOf(
        [SELECT Layout_JSON__c FROM Navigator_Layout__c WHERE Name = :layoutName WITH SYSTEM_MODE LIMIT 1]
          .Layout_JSON__c
      )
      .get('name')
  );
}

private static Integer activeCount() {
  return [SELECT COUNT() FROM Navigator_Layout__c WHERE Is_Active__c = TRUE WITH SYSTEM_MODE];
}

private static String activeName() {
  List<Navigator_Layout__c> active = [
    SELECT Name FROM Navigator_Layout__c WHERE Is_Active__c = TRUE WITH SYSTEM_MODE LIMIT 1
  ];
  return active.isEmpty() ? null : active[0].Name;
}
```

The comment is placed once, above `storedLayouts()` — the first of the four in file order — rather
than repeated four times; the four methods sit within 900 lines of each other with nothing but test
methods between them, so one comment at the top of the group covers all four.

**Left alone, and why it's safe.** The two `System.runAs` tests' own bare queries (line 241:
`[SELECT COUNT() FROM Navigator_Layout__c]`; line 956: `[SELECT Name FROM Navigator_Layout__c WHERE
Id = :ownersLayoutId].Name`) are not touched. `COUNT()` selects no fields at all, and `Name` is a
standard field visible by default regardless of permission-set assignment — neither touches the four
custom fields whose FLS lives only in `Salesforce_Navigator_User`. They were never going to hit "No
such column," so Outcome 4 (no query outside the four methods changes behavior) holds structurally,
not just by omission.

**Scanner risk, resolved.** No suppression annotation is added. This repo's CI runs no PMD or Codacy
job (`## Current state`), so there's nothing to trip over an explicit `WITH SYSTEM_MODE`. Whether the
house rule itself should be taught to distinguish "missing an access mode" from "declares
`SYSTEM_MODE` on purpose" is the mirror case already on file under `## Open questions`, unchanged by
this fix.

## Traps

Reverting the four `WITH SYSTEM_MODE` declarations added by this fix back to `WITH USER_MODE` — to
match this codebase's otherwise-universal convention — silently reintroduces the bug this spec fixes.
It won't fail against a normally-provisioned dev org (whose admin usually already has broad FLS); it
only fails against a freshly created scratch org whose default admin holds no permission set, which is
exactly the shape of org this project's own CI deploy gate creates. The inline comment above
`storedLayouts()` carries the same warning at the code site.

## Evidence

Confirmed directly, isolating the fix to an access-mode declaration and ruling out any other logic
change: assigned `Salesforce_Navigator_User` to a fresh scratch org's default admin (no code touched),
then ran the existing, unmodified test suite. 41 of 41 passed. The same suite, same org shape, admin
never granted the permission set: 26 of 40 fail, identically, across three separate fresh orgs and
under `--dry-run`.

Root cause, from Salesforce's own release note: _"Database Operations Run in User Mode by Default, Not
System Mode"_ — apex SOQL/SOSL/DML/Database methods default to user mode instead of system mode for
code compiled at API 67.0+.
(https://help.salesforce.com/s/articleView?language=en_US&id=release-notes.rn_apex_default_user_mode.htm&release=262&type=5)

Full investigation trail, including the two disproven hypotheses tried first (a same-deploy-transaction
timing race; a metadata-propagation gap) and why each was ruled out: `docs/research/salesforce-same-deploy-schema-race.md`.
