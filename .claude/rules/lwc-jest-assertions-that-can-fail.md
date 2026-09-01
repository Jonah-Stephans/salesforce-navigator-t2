---
paths:
  - "**/lwc/**/__tests__/**/*.js"
---

# Jest assertions that can actually fail

jsdom applies no stylesheet and `getBoundingClientRect()` returns zeros, so an LWC jest suite proves
less than it looks like it does. Write each assertion against the mutation it has to go red on, and
run that mutation before you believe it.

- A `toContain` on a mutually-exclusive class family passes on an element carrying two members of it, so filter the class list to the family and assert exactly one member https://github.com/Jonah-Stephans/salesforce-navigator-t2/pull/5
  Put the filter-and-compare inside the `it.each` that already walks every member. A guard fixed at
  one value of the parameter is green on a duplicate emitted only at the others, and a conditional
  override is the realistic shape of the hazard. One honest bound: an exact duplicate of the same
  token renders once and no DOM-level guard can see it, because it is not a rendering hazard.
- A fact that lives only in CSS needs a stylesheet-text pin, and the pin must be driven off the imported constant rather than a literal https://github.com/Jonah-Stephans/salesforce-navigator-t2/pull/5
  A pin hard-coding `repeat(6, …)` stays green when `MAX_COLUMNS` moves. Import the constant and
  build the expected text from it, so the two copies cannot drift in silence.
- Moving a test behind a mode through a shared mount helper satisfies its "writes nothing" assertions with the mode guard instead of the guard under test https://github.com/Jonah-Stephans/salesforce-navigator-t2/pull/11
  Delete the guard the test names and check it still reddens. One payload-equality guard on the
  Navigator went uncovered exactly this way, and the test that went vacuous was the only one that
  had ever driven it.
- Rewriting a test that attempted a change into one that asserts the control is absent drops the write-side coverage its name still promises https://github.com/Jonah-Stephans/salesforce-navigator-t2/pull/11
  Keep the mutation beside the new assertion rather than in place of it. An early return on a save
  path went uncovered this way and was deletable with the whole suite still passing.
- A suite that resolves Apex instantly closes the window a concurrency bug needs, so every test of an overlapping-write path is green whether or not the bug exists https://github.com/Jonah-Stephans/salesforce-navigator-t2/pull/11
  Defer the first call, make the second act inside the wait, and assert how many records the store
  ends up holding and which one the UI has checked — not only which Apex method was called.
