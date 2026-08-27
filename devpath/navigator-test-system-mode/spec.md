---
type: bug
intent_accepted: true
design_approved: true
---

# Navigator test verification queries silently inherited Apex's new default execution mode

## Intent

`NavigatorLayoutControllerTest`'s verification queries read `Navigator_Layout__c` without declaring an
access mode. This project targets `sourceApiVersion: 67.0`, and Salesforce's Summer '26 release changed
Apex's default for SOQL/DML from system mode to user mode at that API version — so these queries
silently started enforcing the running user's field-level security instead of seeing the row's true
state. The org's default admin identity is never granted the permission set that gives FLS on
`Navigator_Layout__c`'s custom fields (only two `System.runAs` test users are, in `@TestSetup`), so
under user mode those fields became invisible to the admin: `System.QueryException: No such column`.
26 of 40 tests failed, reproduced identically across three independently-created fresh scratch orgs.
Deploying the whole spec into an org holding none of it — the exact scenario a CI completeness gate is
meant to exercise — fails every time. Fix every affected query to declare the access mode it actually
needs.

Eleven queries are affected, not four. The first cut of this design named only the four that live in
named helper methods and reasoned that the rest were safe; that reasoning was wrong in a specific way
(`## Design`), and seven inline queries written directly into test bodies were missed. Correcting the
first four took the failure count from 26/40 to 4/40 against a fresh scratch org — real progress, and
still a failed deploy.

## Outcomes

- Every verification query in `NavigatorLayoutControllerTest.cls` that reads or filters on a
  `Navigator_Layout__c` custom field explicitly declares `WITH SYSTEM_MODE`, so it reads a row's true
  state regardless of which identity is running the test. Eleven queries, enumerated in
  `## Current state`.
- `sf project deploy start --test-level RunLocalTests` against a freshly created scratch org holding
  none of this spec's metadata, with no permission set assigned to the org's default admin, deploys
  clean: the whole-payload deploy succeeds and every local test passes.
- `peerCannotReadAnotherUsersLayouts` and `aUserCannotUpdateAnotherUsersLayout` — the two
  `System.runAs` cross-user security tests — continue to pass, unchanged. Their own access-mode
  behavior, a peer user without the permission set being unable to read or touch another user's rows,
  is exactly what must not change.
- No query inside a `System.runAs` block, and no query that reads or filters on only standard fields,
  has an access-mode declaration added or changed.

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
- **`NavigatorLayoutControllerTest` duplicates two query shapes that already exist as helpers, and that
  duplication is what let this bug survive the first survey.** `activeCount()`'s body is retyped
  verbatim inline at lines 876 and 1701; `[SELECT Id FROM Navigator_Layout__c WHERE Is_Active__c = TRUE
LIMIT 1].Id` appears at 881 and 1706 with no helper at all; lines 906 and 915 are owner-scoped
  variants of `activeCount()` and `activeName()`. Routing all six through helpers — plus a new
  `activeId()`, `activeCountFor(Id)`, `activeNameFor(Id)` — would leave exactly one site per query
  shape where access mode has to be reasoned about, and would satisfy this repo's DRY rule, which those
  bodies currently violate. Deliberately **not** done here: rewiring four test methods risks producing
  a test that still passes while checking something other than what it was written to check, which is a
  worse failure than the one being fixed and wants a spec where the rewiring is what's under review.
  Considered and rejected for this spec at the design gate, not overlooked.

## Current state

`force-app/main/default/classes/NavigatorLayoutControllerTest.cls`, 1786 lines, 32 SOQL sites. Line
numbers below are current — the four helpers already carry the fix from the first build pass, so the
file has shifted 17 lines from the numbers in this spec's git history.

The custom fields at issue are `Is_Active__c`, `Layout_JSON__c`, `Schema_Version__c` and
`Sort_Order__c`. Their FLS lives only in `Salesforce_Navigator_User`
(`force-app/main/default/permissionsets/Salesforce_Navigator_User/`), the only permission set in the
repo. `@TestSetup` (`makeUsers()`, lines 39–75) assigns it to exactly two users, `nvowner` and
`nvpeer` — the `System.runAs` identities — never to the org's default admin, which is the identity
that runs every query outside a `runAs` block.

**Field-level security applies to a field named anywhere in a query — the `SELECT` list, the `WHERE`
clause, or `ORDER BY` — not only to fields whose values come back.** That is the fact the first cut of
this design got wrong, and it is what puts the `COUNT()` queries below in scope.

### Group A — the four helpers. Already fixed, in the pause commit on this branch.

- `storedLayouts()` (121–135) — selects all four custom fields, orders by `Sort_Order__c`. Called from
  8 write-path tests.
- `sectionNameOf(String)` (1020–1034) — selects `Layout_JSON__c`. Used ~10 times.
- `activeCount()` (1036–1043) — `COUNT()` filtered on `Is_Active__c`. Used ~10 times.
- `activeName()` (1045–1055) — selects `Name`, filtered on `Is_Active__c`. Used ~13 times.

### Group B — seven inline queries. Not yet fixed; this is the remaining work.

None sits inside a `System.runAs` block, so none bears on Outcome 3.

| Line | Test method                                              | Query                                                                    | Custom field, and where       |
| ---- | -------------------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------- |
| 365  | `aV1RowIsUpgradedToV2OnRead` (319)                       | `SELECT Schema_Version__c FROM Navigator_Layout__c LIMIT 1`              | `Schema_Version__c`, selected |
| 876  | `activatingOneLayoutClearsTheFlagOnTheOthers` (847)      | `SELECT COUNT() … WHERE Is_Active__c = TRUE`                             | `Is_Active__c`, filtered      |
| 881  | same                                                     | `SELECT Id … WHERE Is_Active__c = TRUE LIMIT 1`                          | `Is_Active__c`, filtered      |
| 906  | `activatingOneUsersLayoutDoesNotDisturbAnother` (887)    | `SELECT COUNT() … WHERE Is_Active__c = TRUE AND OwnerId = :owner.Id`     | `Is_Active__c`, filtered      |
| 915  | same                                                     | `SELECT Name … WHERE Is_Active__c = TRUE AND OwnerId = :peer.Id LIMIT 1` | `Is_Active__c`, filtered      |
| 1701 | `activationStaysOneUpdateAcrossTwoHundredLayouts` (1663) | `SELECT COUNT() … WHERE Is_Active__c = TRUE`                             | `Is_Active__c`, filtered      |
| 1706 | same                                                     | `SELECT Id … WHERE Is_Active__c = TRUE LIMIT 1`                          | `Is_Active__c`, filtered      |

Only four of the seven appear in the current failure list, because a test method stops at its first
failing assertion — 881, 915 and 1706 sit behind a query that already threw.

### Group C — four queries that stay bare, and why.

Line numbers here are as the file stands after Group B was fixed, so they run ahead of Group B's table
above. Exactly one of the four sits inside a `System.runAs` block; the other three run at the default
admin identity.

- 257 — in `peerCannotReadAnotherUsersLayouts` (236), after `Test.stopTest()`, outside any `runAs`.
  Bare `COUNT()`, no field named anywhere.
- 296 — in `sharingCanNeverBecomeTheFilterForWhoseLayoutsComeBack` (276), inside `System.runAs(owner)`.
  `COUNT()` filtered on `Id`. This is the only Group C query inside a `runAs` block, and it is in
  neither of the two security tests.
- 975, 1002 — in `aUserCannotUpdateAnotherUsersLayout` (969), both outside any `runAs`: `SELECT Id …
LIMIT 1` before the `runAs` write, and `SELECT Name … WHERE Id = :ownersLayoutId` after
  `Test.stopTest()`.

None of the four needs a declaration: each names only `Id`, `Name` or nothing at all, and FLS cannot
restrict those on a custom object. Adding one would also not void anything — see `## Design` and
`## Traps` for why the earlier claim that it would was wrong.

### Group D — the remaining 17 sites. Out of scope, and safe by coincidence rather than by structure.

32 SOQL sites in the file, less the 11 of Groups A and B and the 4 of Group C, leaves 17. Three query
`Profile`, `PermissionSet` and `User` (45, 52, 96) — a different object entirely. The other 14 read
`Navigator_Layout__c` but name only `Id`, `Name`, `OwnerId` or nothing at all (bare `COUNT()`), none of
which FLS can restrict on a custom object. They are safe today because of which fields they happen to
name. See `## Traps`.

### Convention in the repo

`NavigatorLayoutController.ownLayouts()` (`NavigatorLayoutController.cls:388-402`) declares
`WITH USER_MODE`, documented in the class header as deliberate defense in depth — correct there, and
out of scope. Before this spec, no test file in the repo declared an explicit access mode on any SOQL,
so there is no pre-existing `WITH SYSTEM_MODE` precedent to point to.

`.claude/rules/rstk-security.md` (applies to `**/*.cls`) says "ALL new SOQL must include
`WITH USER_MODE`… flagged as must-fix by local PMD and GH Codacy," and never mentions `WITH
SYSTEM_MODE`. Checked against this repo's actual CI (`.github/workflows/pr-checks.yml`): there is no
PMD or Codacy job in it — the rule describes a scanner this repo does not run.

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
existing verification queries so the existing suite reads each row's true state.

**The fix.** Add `WITH SYSTEM_MODE` to each of the eleven queries in Groups A and B of
`## Current state`, placed after `WHERE` (where present) and before `ORDER BY` / `LIMIT`. Group A's
four are already done and are shown here as the worked pattern; Group B's seven take the same
treatment, in place, each with a one-line pointer to the comment above `storedLayouts()`.

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

The full comment is placed once, above `storedLayouts()` — the first affected query in file order. The
other three helpers sit within 900 lines of it with nothing but test methods between, so they need no
pointer. Group B's seven do, and get one:

```apex
// WITH SYSTEM_MODE is deliberate here — see the note above storedLayouts().
Assert.areEqual(
  1,
  [SELECT COUNT() FROM Navigator_Layout__c WHERE Is_Active__c = TRUE WITH SYSTEM_MODE],
  'Exactly one of a user\'s layouts may be active'
);
```

And the two Group C security tests get a comment at the method level, recording why their queries are
bare — see the paragraph below on what that reason actually is:

```apex
// The queries in this method are deliberately bare — no WITH clause, unlike the verification
// helpers above — because they need none: they name only Id or no field at all, and FLS cannot
// restrict those on a custom object. Nor would declaring one void this test. The class is
// private with sharing, and under WITH SYSTEM_MODE record sharing is still controlled by the
// class's sharing keyword, so an access mode suppresses CRUD/FLS only. What this test actually
// proves is the NavigatorLayoutController call made inside System.runAs(peer), which no
// declaration on a query in this class can reach.
```

**The correction to this design's own earlier reasoning.** The first cut argued that everything outside
the four helpers was safe because "`COUNT()` selects no fields at all." That premise is true and the
conclusion drawn from it is false: **FLS applies to every field a query names, including one it only
filters on.** `SELECT COUNT() FROM Navigator_Layout__c` really is safe — it names no field anywhere.
`SELECT COUNT() FROM Navigator_Layout__c WHERE Is_Active__c = TRUE` is not, and throws the identical
`No such column`. That single misreading is what left seven queries out of the first inventory; it also
explains the shape of what was missed, since the four that _were_ found live in named helper methods
and the seven that were not are written inline mid-assertion, where they read as test prose rather than
as queries.

**Group C is left alone, and now for a reason that holds.** The four queries listed as Group C stay
bare because **they need no declaration at all**: each names only `Id`, `Name` or no field whatsoever,
and FLS cannot restrict those on a custom object. None of them would ever have thrown, so annotating
them would buy nothing.

Nor would annotating them cost anything, which is worth stating because an earlier version of this
paragraph claimed it would. It said the two security tests prove a peer cannot reach another user's
rows, that the proof is "only worth something under user mode", and that any access mode would leave
both tests green and testing nothing. That is false on two counts. The class is `private with sharing`
(`NavigatorLayoutControllerTest.cls:18`), and under `WITH SYSTEM_MODE` record sharing is still
controlled by the class's sharing keyword — an access mode suppresses CRUD/FLS only, never sharing. And
each test's proof is the `NavigatorLayoutController` call made inside its `System.runAs(peer)` block —
the empty DTO list in `peerCannotReadAnotherUsersLayouts`, the caught `AuraHandledException` in
`aUserCannotUpdateAnotherUsersLayout` — which no declaration on a test-class query can reach. Three of
the four Group C queries do not even sit inside a `runAs` block (`## Current state`).

Each of the two security test methods still gets a method-level comment, so that a later reader knows
the bareness is considered rather than overlooked — but the comment says the true reason above, not the
false one.

**Comment placement.** The full explanatory comment sits once above `storedLayouts()`, as before. Each
of the seven Group B sites gets a one-line pointer back to it. The seven are scattered from line 365 to
1706, and the trap this spec records — someone reverting to `WITH USER_MODE` to match house convention
— is triggered by a person reading one site, not the file; a pointer is the only thing that reaches
them. The two Group C test methods get their own comment, per above.

**A stated limit.** After this fix the file contains 11 queries declaring `WITH SYSTEM_MODE`, the 4 of
Group C left deliberately bare, and 14 more against `Navigator_Layout__c` that need no
declaration **only because of which fields they currently name** (`## Current state`, Group D). Adding
a custom field to any of their `WHERE` clauses later reintroduces this bug in a file where a dozen
neighbours already carry the fix. Nothing in this design prevents that, and no code change here would;
it is recorded in `## Traps` because that is what the next Build worker reads.

**Scanner risk, resolved.** No suppression annotation is added. This repo's CI runs no PMD or Codacy
job (`## Current state`), so there's nothing to trip over an explicit `WITH SYSTEM_MODE`. Whether the
house rule itself should be taught to distinguish "missing an access mode" from "declares
`SYSTEM_MODE` on purpose" is the mirror case already on file under `## Open questions`, unchanged by
this fix.

**Not done here, and deliberately.** Six of the seven Group B queries duplicate a shape that already
exists as a helper. Routing them through helpers instead of annotating them is the better end state and
is recorded under `## Open questions` as its own piece of work — rejected for this spec because
rewiring four test methods risks a test that passes while checking the wrong thing.

## Traps

Reverting any of the eleven `WITH SYSTEM_MODE` declarations added by this fix back to `WITH USER_MODE`
— to match this codebase's otherwise-universal convention — silently reintroduces the bug this spec
fixes. It won't fail against a normally-provisioned dev org (whose admin usually already has broad
FLS); it only fails against a freshly created scratch org whose default admin holds no permission set,
which is exactly the shape of org this project's own CI deploy gate creates. The comment above
`storedLayouts()` carries the same warning at the code site, and each of the seven inline sites points
back to it.

**A test that passes under a green deploy against the wrong org shape proves nothing about this bug.**
The default dev org for this project (`sfnav-t2`) has the permission set on its admin, so the whole
suite passes there _with the bug fully present_ — verified. Only a freshly created scratch org with no
permission set assigned to its default admin can fail this, and therefore only that org can pass it
meaningfully. Any claim that this spec's Outcome 2 is met must name the org it was checked against and
confirm `Salesforce_Navigator_User` is absent from it.

**`WITH SYSTEM_MODE` suppresses CRUD/FLS, never sharing — so do not reason about this file as though an
access-mode declaration could silently void a `System.runAs` security test.** An earlier version of this
spec said exactly that, and it is wrong: `NavigatorLayoutControllerTest` is `private with sharing`
(line 18), and under `WITH SYSTEM_MODE` record sharing is still controlled by the class's sharing
keyword. What `peerCannotReadAnotherUsersLayouts` and `aUserCannotUpdateAnotherUsersLayout` each prove
is the `NavigatorLayoutController` call made inside its `System.runAs(peer)` block, which no
declaration on a test-class query can reach. The four Group C queries stay bare because they need
nothing — they name only `Id`, `Name` or no field at all — and three of the four do not sit inside a
`runAs` block in the first place. If you ever need to check whether a change voids one of these tests,
look at the controller call inside the `runAs`, not at the verification query after it.

**Fourteen queries against `Navigator_Layout__c` are safe only because of which fields they name, not
because of where they sit** (`## Current state`, Group D — `Id`, `Name`, `OwnerId`, bare `COUNT()`).
FLS applies to a field named anywhere in a query, including one that only appears in a `WHERE` clause —
so adding any custom field to any of their filters reintroduces this bug, in a file where eleven
neighbours already carry the fix and therefore look like they cover it. **This is the exact mistake
that produced the first, incomplete version of this design:** the premise "`COUNT()` selects no fields"
is true, and the conclusion "so it can't hit FLS" does not follow.

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
