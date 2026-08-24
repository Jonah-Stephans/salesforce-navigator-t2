---
depends_on:
  - dev-path/personal-navigator-layouts/slices/02-tab-and-navigation.md
touches:
---

# Group tabs into named sections that survive a reload

> Watch a new test go red before you make it green.
> _Why: a test written before the code cannot be written to hit a coverage number — there is nothing to
> cover yet. Retires when Apex gets mutation testing._

## What to build

A user groups their tabs into named sections at a column count they choose, and finds those sections
still there tomorrow.

## Acceptance criteria

- [ ] A user opening the Navigator for the first time sees every tab they can reach in one section named
      "All Items".
- [ ] No layout record exists for a user who has only ever looked — the first record is written on their
      first actual change.
- [ ] A user can create a section, give it a name, rename it, and delete it.
- [ ] A user can set a section's column count to any value from one to six, and the section renders its
      items in that many columns.
- [ ] Sections, names and column counts survive a page reload and a fresh login.
- [ ] A change is saved without the user pressing anything; a burst of rapid changes results in one save,
      not one per change.
- [ ] A second user opening the Navigator sees their own sections, never the first user's, and cannot
      reach the first user's layout through ordinary record access.
- [ ] A user whose manager sits above them in the role hierarchy is not visible to that manager — the
      object grants no access through hierarchies.
- [ ] An item whose tab the user has lost access to stops rendering, and the stored layout is unchanged:
      restoring access restores the item to its original position.
- [ ] The stored payload carries no tab labels — an org relabelling a tab is reflected on the next render
      with no write.
- [ ] The stored payload carries a schema version, and the code that reads it dispatches on that version.
- [ ] Apex tests cover the controller under `System.runAs` for a non-administrator, and at the bulk volume
      the repository's testing rule requires.

## Deviations

## Critique findings
