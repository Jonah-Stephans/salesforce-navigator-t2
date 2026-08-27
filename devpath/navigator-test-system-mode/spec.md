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

Survey dispatched one researcher, since all four Outcomes cluster on a single file and a single pattern:
`force-app/main/default/classes/NavigatorLayoutControllerTest.cls` (1769 lines).

**The four target methods, verbatim, all with no `WITH` clause today:**

- `storedLayouts()` (lines 113–126) — `SELECT Id, Name, OwnerId, Is_Active__c, Sort_Order__c,
Schema_Version__c, Layout_JSON__c FROM Navigator_Layout__c ORDER BY Sort_Order__c NULLS LAST, Name`.
  Called from 8 write-path tests (e.g. `savingAlwaysStampsAndWritesTheCurrentVersion`,
  `aNewLayoutGoesAfterTheHighestSortOrderEvenAfterADelete`) to re-query what actually landed.
- `sectionNameOf(String layoutName)` (lines 1011–1024) — `SELECT Layout_JSON__c FROM
Navigator_Layout__c WHERE Name = :layoutName LIMIT 1`. Used ~10 times across the switching/rename
  test block.
- `activeCount()` (lines 1026–1028) — `SELECT COUNT() FROM Navigator_Layout__c WHERE Is_Active__c =
TRUE`. Used ~10 times to assert the "exactly one active" invariant.
- `activeName()` (lines 1030–1038) — `SELECT Name FROM Navigator_Layout__c WHERE Is_Active__c = TRUE
LIMIT 1`. Used ~13 times alongside `activeCount()`.

All four read `Is_Active__c`, `Layout_JSON__c`, `Schema_Version__c`, and/or `Sort_Order__c` — exactly
the custom fields whose FLS lives only in the `Salesforce_Navigator_User` permission set (below).

**The two `System.runAs` security tests, confirmed untouched by scope:**
`peerCannotReadAnotherUsersLayouts` (lines 219–244) and `aUserCannotUpdateAnotherUsersLayout` (lines
922–959) never call any of the four target methods. Each has its own bare, unannotated verification
query run _outside_ its `System.runAs` block (`[SELECT COUNT() FROM Navigator_Layout__c]` at line 241;
`[SELECT Name FROM Navigator_Layout__c WHERE Id = :ownersLayoutId]` at line 956) — these are the same
shape of gap the four target methods have, but they sit outside this spec's four named methods and so
outside its Outcomes. Not touched by this fix.

**`@TestSetup` (`makeUsers()`, lines 39–75):** assigns `Salesforce_Navigator_User` to exactly two
users — `nvowner` and `nvpeer`, the two `System.runAs` identities. No assignment anywhere in this file,
or anywhere else in the repo, ever targets the org's default admin — the identity that runs every bare
`[SELECT ...]` outside a `runAs` block, including all four target methods.

**`Salesforce_Navigator_User` (the only permission set in the repo)**
(`force-app/main/default/permissionsets/Salesforce_Navigator_User/`): grants object CRUD (create,
delete, edit, read; not modify-all/view-all) plus field-level read/edit on exactly
`Is_Active__c`, `Layout_JSON__c`, `Schema_Version__c`, `Sort_Order__c` on `Navigator_Layout__c`. No
other permission set or profile-level FLS override exists for this object anywhere in `force-app/`.

**Reference pattern, out of scope:** `NavigatorLayoutController.ownLayouts()`
(`NavigatorLayoutController.cls:388-402`) already reads `WITH USER_MODE` paired with an explicit
`WHERE OwnerId = :UserInfo.getUserId()`, documented in the class header as deliberate defense in depth.
All of the controller's DML already uses `Database.insert/update/delete(..., AccessLevel.USER_MODE)`.

**No existing precedent for `WITH SYSTEM_MODE` anywhere in the repo.** A repo-wide grep for
`WITH USER_MODE|WITH SYSTEM_MODE|SECURITY_ENFORCED|AccessLevel\.(USER|SYSTEM)_MODE` across
`force-app/` turns up matches only in `NavigatorLayoutController.cls` (production, `WITH USER_MODE`)
and in prose doc-comments inside the test file that describe the controller's behavior — never inside
an actual query clause. No test file in the repo declares an explicit access mode on any SOQL today.

**`.claude/rules/rstk-security.md` (scanner-enforced, applies to `**/*.cls`):** _"ALL new SOQL must
include `WITH USER_MODE`... Violations are flagged as must-fix by local PMD and GH Codacy
(ApexCRUDViolation)."_ It also deprecates `WITH SECURITY_ENFORCED` in favor of `WITH USER_MODE`.
**The rule never mentions `WITH SYSTEM_MODE` at all** — there is no house convention anywhere for when
a test-verification helper should declare it instead. This is exactly what the spec's Open Questions
section already flags as a mirror case for whoever maintains that rule, out of scope for this fix
itself — but the design conversation should confirm the fix won't read as a scanner violation.

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
