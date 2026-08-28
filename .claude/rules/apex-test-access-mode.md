---
paths:
  - "**/*Test*.cls"
  - "**/*_Test.cls"
---

# Access mode on test-class queries

`rstk-security.md` requires `WITH USER_MODE` on all new SOQL, and it is right about production code.
A test class is where that rule has an exception, because a verification query's job is to read a row's
true state rather than to enforce the running identity's permissions. Reverting such a query to
`WITH USER_MODE` to match the surrounding convention silently reintroduces the bug. Getting this wrong
does not fail locally — it fails only against an org whose admin holds no permission set, which is the
shape a CI deploy gate creates.

The production-versus-test split itself, and the platform default change that made it matter, are in
`salesforce-apex-access-mode.md`. This file carries only what is specific to a test class.

- Field-level security applies to a custom field named anywhere in a query, including in a `WHERE` clause it does not select https://github.com/Jonah-Stephans/salesforce-navigator-t2/pull/3
  `[SELECT COUNT() FROM Navigator_Layout__c WHERE Is_Active__c = TRUE]` throws
  `System.QueryException: No such column` under user mode. "`COUNT()` selects no fields" is true and
  the conclusion "so it cannot hit FLS" does not follow — that inference produced two wrong scopes
  on one spec.
- A query naming only standard fields — `Id`, `Name`, `OwnerId`, or a bare `COUNT()` — needs no declaration and gets none https://github.com/Jonah-Stephans/salesforce-navigator-t2/pull/3
  Adding any custom field to such a query's filter later reintroduces the bug, in a file where its
  neighbours already carry the fix and therefore look like they cover it.
- Classify a query by the method whose body holds it, never by who calls that method https://github.com/Jonah-Stephans/salesforce-navigator-t2/pull/3
  A verification helper carrying `WITH SYSTEM_MODE` may be called from inside a `System.runAs` block;
  that is a caller-side fact and does not make the helper's query a `runAs` query.
- `WITH SYSTEM_MODE` suppresses CRUD and FLS, never record sharing https://github.com/Jonah-Stephans/salesforce-navigator-t2/pull/3
  Sharing stays controlled by the class's `with sharing` keyword, so an access-mode declaration on a
  test-class query cannot void a `System.runAs` sharing proof. What such a test proves is the
  controller call inside its `runAs` block, not the verification query after it.
- Verify a permission-dependent test fix against a freshly created scratch org whose default admin holds no permission set https://github.com/Jonah-Stephans/salesforce-navigator-t2/pull/3
  The standing dev org's admin already holds the permission set, so the whole suite passes there with
  the bug fully present. Name the org and confirm the permission set is absent from it, or the green
  run proves nothing.
- Raising `sourceApiVersion` to 67.0 or above is a behavioural change to every undeclared query already in the package https://github.com/Jonah-Stephans/salesforce-navigator-t2/pull/3
  Nothing needs editing for the meaning to change: a query written before the bump keeps compiling and
  starts enforcing the running user's FLS. The default flip itself is in
  `salesforce-apex-access-mode.md`.
