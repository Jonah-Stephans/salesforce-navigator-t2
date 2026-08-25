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
