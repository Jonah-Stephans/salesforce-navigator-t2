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
