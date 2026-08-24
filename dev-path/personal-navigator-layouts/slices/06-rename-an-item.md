---
depends_on:
  - dev-path/personal-navigator-layouts/slices/03-sections-and-columns.md
touches:
---

# Call a tab what you call it

> Watch a new test go red before you make it green.
> _Why: a test written before the code cannot be written to hit a coverage number — there is nothing to
> cover yet. Retires when Apex gets mutation testing._

## What to build

A user renames an item to their own wording, and it still takes them to the same place.

## Acceptance criteria

- [ ] A user renames an item from its overflow menu and the new wording is displayed in place of the
      Salesforce label.
- [ ] Clicking the renamed item navigates to exactly the same tab it did before the rename. A jest test
      sets a rename and asserts both the rendered text and an unchanged `pageReference` in one go.
- [ ] The rename survives a page reload and a fresh login.
- [ ] The rename is local to this user's layout — no other user's view of that tab changes, and the org's
      own tab label is untouched.
- [ ] Clearing the rename returns the item to its Salesforce label.
- [ ] An item with no rename picks up a subsequent change to the org's tab label without any write.
- [ ] A rename is stored in a different field from the item's identity, so that renaming cannot alter what
      the item points at.

## Deviations

## Critique findings
