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

Far more queries are affected than the first cut of this design found. It named only the four that live
in named helper methods and reasoned that the rest were safe; that reasoning was wrong in a specific
way (`## Design`), and every verification query written inline in a test body was missed. Correcting
just the four helpers took the failure count from 26/40 to 4/40 against a fresh scratch org — real
progress, and still a failed deploy. `## Current state` holds the full inventory.

## Outcomes

- Every verification query in `NavigatorLayoutControllerTest.cls` that reads or filters on a
  `Navigator_Layout__c` custom field explicitly declares `WITH SYSTEM_MODE`, so it reads a row's true
  state regardless of which identity is running the test. Enumerated in `## Current state`, by
  enclosing method. **Deliberately no count here** — the number changes whenever a query is routed
  through a helper, and re-deriving it has already been wrong twice. The property is the Outcome.
- No block of ten or more lines appears in more than one method in that file, per
  `.claude/rules/rstk-dry-enforcement.md`.
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
- The owner-scoped queries in `activatingOneUsersLayoutDoesNotDisturbAnother` — a `COUNT()` and a
  `SELECT Name`, each filtered on `Is_Active__c` and `OwnerId` — are near-variants of `activeCount()`
  and `activeName()` and stay inline. Each appears exactly once, so extracting
  `activeCountFor(Id)` / `activeNameFor(Id)` would add a helper per caller and remove no duplication;
  the DRY rule's trigger is a block appearing in more than one method. If a third caller ever wants
  either shape, that is when they become helpers.

## Current state

`force-app/main/default/classes/NavigatorLayoutControllerTest.cls`, 32 SOQL sites.

**Queries below are identified by their enclosing method and their shape, never by line number.** Line
numbers in this section went stale twice — the second time inside the very commit that was correcting
them, because that commit expanded two comment blocks and shifted every number it had just written.
Method names survive every edit and are greppable; the numbers added a precision no reader could rely
on. Neither is a file length quoted here, for the same reason.

The custom fields at issue are `Is_Active__c`, `Layout_JSON__c`, `Schema_Version__c` and
`Sort_Order__c`. Their FLS lives only in `Salesforce_Navigator_User`
(`force-app/main/default/permissionsets/Salesforce_Navigator_User/`), the only permission set in the
repo. `@TestSetup` (`makeUsers()`) assigns it to exactly two users, `nvowner` and `nvpeer` — the
`System.runAs` identities — never to the org's default admin, which is the identity that runs every
query outside a `runAs` block.

**Field-level security applies to a field named anywhere in a query — the `SELECT` list, the `WHERE`
clause, or `ORDER BY` — not only to fields whose values come back.** That is the fact the first cut of
this design got wrong, and it is what puts the `COUNT()` queries below in scope.

### Group A — the verification helpers. All declare `WITH SYSTEM_MODE` already.

- `storedLayouts()` — selects all four custom fields, orders by `Sort_Order__c`. Called from 8
  write-path tests.
- `sectionNameOf(String)` — selects `Layout_JSON__c`.
- `activeCount()` — `COUNT()` filtered on `Is_Active__c`.
- `activeName()` — selects `Name`, filtered on `Is_Active__c`; returns `null` when nothing is active.

### Group B — inline queries in test bodies. All declare `WITH SYSTEM_MODE` already.

None sits inside a `System.runAs` block, so none bears on Outcome 3.

| Enclosing method                                  | Query                                                                    | Custom field, and where       |
| ------------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------- |
| `aV1RowIsUpgradedToV2OnRead`                      | `SELECT Schema_Version__c … LIMIT 1`                                     | `Schema_Version__c`, selected |
| `activatingOneLayoutClearsTheFlagOnTheOthers`     | `SELECT COUNT() … WHERE Is_Active__c = TRUE`                             | `Is_Active__c`, filtered      |
| `activatingOneLayoutClearsTheFlagOnTheOthers`     | `SELECT Id … WHERE Is_Active__c = TRUE LIMIT 1`                          | `Is_Active__c`, filtered      |
| `activatingOneUsersLayoutDoesNotDisturbAnother`   | `SELECT COUNT() … WHERE Is_Active__c = TRUE AND OwnerId = :owner.Id`     | `Is_Active__c`, filtered      |
| `activatingOneUsersLayoutDoesNotDisturbAnother`   | `SELECT Name … WHERE Is_Active__c = TRUE AND OwnerId = :peer.Id LIMIT 1` | `Is_Active__c`, filtered      |
| `activationStaysOneUpdateAcrossTwoHundredLayouts` | `SELECT COUNT() … WHERE Is_Active__c = TRUE`                             | `Is_Active__c`, filtered      |
| `activationStaysOneUpdateAcrossTwoHundredLayouts` | `SELECT Id … WHERE Is_Active__c = TRUE LIMIT 1`                          | `Is_Active__c`, filtered      |

**Two shapes in that table appear twice**, and after the access-mode fix expanded each from one line
to six, the surrounding blocks became byte-identical across 24 lines in
`activatingOneLayoutClearsTheFlagOnTheOthers` and `activationStaysOneUpdateAcrossTwoHundredLayouts`,
differing only in two assertion message strings. That crosses
`.claude/rules/rstk-dry-enforcement.md`'s ten-line threshold and is the remaining work — see
`## Design`. The `COUNT()` shape is `activeCount()`'s body verbatim; the `SELECT Id` shape has no
helper yet.

The owner-scoped pair in `activatingOneUsersLayoutDoesNotDisturbAnother` appears once each and is not
duplication — see `## Open questions`.

### Group C — four queries that stay bare, and why.

Exactly one of the four sits inside a `System.runAs` block; the other three run at the default admin
identity.

- `peerCannotReadAnotherUsersLayouts` — bare `COUNT()`, no field named anywhere, after
  `Test.stopTest()` and outside any `runAs`.
- `sharingCanNeverBecomeTheFilterForWhoseLayoutsComeBack` — `COUNT()` filtered on `Id`, inside
  `System.runAs(owner)`. This is the only Group C query inside a `runAs` block, and it is in neither
  of the two security tests.
- `aUserCannotUpdateAnotherUsersLayout` — two, both outside any `runAs`: `SELECT Id … LIMIT 1` before
  the `runAs` write, and `SELECT Name … WHERE Id = :ownersLayoutId` after `Test.stopTest()`.

None of the four needs a declaration: each names only `Id`, `Name` or nothing at all, and FLS cannot
restrict those on a custom object. Adding one would also not void anything — see `## Design` and
`## Traps` for why the earlier claim that it would was wrong.

### Group D — everything else. Out of scope, and safe by coincidence rather than by structure.

Whatever remains after Groups A, B and C. Three query `Profile`, `PermissionSet` and `User` — a
different object entirely, all inside `@TestSetup`'s `makeUsers()` and `userWith(String)`. The rest
read `Navigator_Layout__c` but name only `Id`, `Name`, `OwnerId` or nothing at all (bare `COUNT()`),
none of which FLS can restrict on a custom object. They are safe today because of which fields they
happen to name. See `## Traps`.

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

**The fix.** Add `WITH SYSTEM_MODE` to every query in Groups A and B of `## Current state`, placed
after `WHERE` (where present) and before `ORDER BY` / `LIMIT`. Group A's helpers are shown here as the
worked pattern; Group B's inline queries take the same treatment in place, each with a one-line
pointer to the comment above `storedLayouts()` — except the two shapes that are routed into helpers
instead, below.

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

**Comment placement.** The full explanatory comment sits once above `storedLayouts()`. Every Group B
site that remains inline after the routing gets a one-line pointer back to it. Those sites are
scattered across the file, and the trap this spec records — someone reverting to `WITH USER_MODE` to
match house convention — is triggered by a person reading one site, not the file; a pointer is the
only thing that reaches them. The helpers need no pointer, sitting under the comment already. The two
Group C security tests get their own comment, per above.

**A stated limit.** Group D's queries against `Navigator_Layout__c` need no declaration **only because
of which fields they currently name** (`## Current state`). Adding a custom field to any of their
`WHERE` clauses later reintroduces this bug, in a file where their neighbours already carry the fix
and therefore look like they cover it. Nothing in this design prevents that, and no code change here
would; it is recorded in `## Traps` because that is what the next Build worker reads.

**Scanner risk, resolved.** No suppression annotation is added. This repo's CI runs no PMD or Codacy
job (`## Current state`), so there's nothing to trip over an explicit `WITH SYSTEM_MODE`. Whether the
house rule itself should be taught to distinguish "missing an access mode" from "declares
`SYSTEM_MODE` on purpose" is the mirror case already on file under `## Open questions`, unchanged by
this fix.

**Routing the duplicated shapes through helpers.** The access-mode fix expanded two one-line queries
into six-line ones, and in doing so turned a one-line duplication into a 24-line one:
`activatingOneLayoutClearsTheFlagOnTheOthers` and `activationStaysOneUpdateAcrossTwoHundredLayouts`
now hold byte-identical blocks differing only in two assertion message strings. That crosses
`.claude/rules/rstk-dry-enforcement.md`'s ten-line threshold. This spec originally deferred
helper-routing, and that deferral was reasoned about the pre-fix one-liners; it does not survive the
blocks the fix created, so the routing is in scope.

Two shapes, both duplicated across exactly those two methods:

- **`SELECT COUNT() … WHERE Is_Active__c = TRUE`** — already exists as `activeCount()`. Both inline
  copies are deleted and the call sites call it.
- **`SELECT Id … WHERE Is_Active__c = TRUE LIMIT 1`** — no helper today. Add `activeId()` beside the
  others, and both call sites call it.

```apex
private static Id activeId() {
  List<Navigator_Layout__c> active = [
    SELECT Id FROM Navigator_Layout__c WHERE Is_Active__c = TRUE WITH SYSTEM_MODE LIMIT 1
  ];
  return active.isEmpty() ? null : active[0].Id;
}
```

**`activeId()` returns `null` on an empty result rather than throwing, matching `activeName()`
directly above it.** This is the only behavioural difference in the whole change and it is worth
naming: the inline form it replaces is `[… LIMIT 1].Id`, which throws `List has no rows for
assignment` when nothing is active. Under the helper, a test with no active row fails on its assertion
— `expected <a01…> actual null`, carrying the assertion's own message — instead of on a query
exception. **Neither form changes whether a test passes**, only how it reads when it fails, and the
existing convention two lines up is the null-safe one.

**The assertion messages stay at the call sites.** They are the only thing that distinguishes the two
blocks, and they are what a failure prints. Nothing moves into the helper except the query.

**The pointer comments on the routed queries go away with them** — the routed shapes now
live in the helper block, directly under the full comment above `storedLayouts()`, so a pointer back
to a comment four lines up would be noise. The remaining inline sites keep theirs.

## Traps

Reverting any `WITH SYSTEM_MODE` declaration added by this fix back to `WITH USER_MODE` — to match this
codebase's otherwise-universal convention — silently reintroduces the bug this spec fixes. It won't
fail against a normally-provisioned dev org (whose admin usually already has broad FLS); it only fails
against a freshly created scratch org whose default admin holds no permission set, which is exactly the
shape of org this project's own CI deploy gate creates. The comment above `storedLayouts()` carries the
same warning at the code site, and every inline site points back to it.

**A test that passes under a green deploy against the wrong org shape proves nothing about this bug.**
The default dev org for this project (`sfnav-t2`) has the permission set on its admin, so the whole
suite passes there _with the bug fully present_ — verified. Only a freshly created scratch org with no
permission set assigned to its default admin can fail this, and therefore only that org can pass it
meaningfully. Any claim that this spec's Outcome 2 is met must name the org it was checked against and
confirm `Salesforce_Navigator_User` is absent from it.

**`WITH SYSTEM_MODE` suppresses CRUD/FLS, never sharing — so do not reason about this file as though an
access-mode declaration could silently void a `System.runAs` security test.** An earlier version of this
spec said exactly that, and it is wrong: `NavigatorLayoutControllerTest` is declared
`private with sharing`, and under `WITH SYSTEM_MODE` record sharing is still controlled by the class's
sharing keyword. What `peerCannotReadAnotherUsersLayouts` and `aUserCannotUpdateAnotherUsersLayout` each prove
is the `NavigatorLayoutController` call made inside its `System.runAs(peer)` block, which no
declaration on a test-class query can reach. The four Group C queries stay bare because they need
nothing — they name only `Id`, `Name` or no field at all — and three of the four do not sit inside a
`runAs` block in the first place. If you ever need to check whether a change voids one of these tests,
look at the controller call inside the `runAs`, not at the verification query after it.

**Group D's queries against `Navigator_Layout__c` are safe only because of which fields they name, not
because of where they sit** (`## Current state` — `Id`, `Name`, `OwnerId`, bare `COUNT()`). FLS applies
to a field named anywhere in a query, including one that only appears in a `WHERE` clause — so adding
any custom field to any of their filters reintroduces this bug, in a file where their neighbours
already carry the fix and therefore look like they cover it. **This is the exact mistake
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
