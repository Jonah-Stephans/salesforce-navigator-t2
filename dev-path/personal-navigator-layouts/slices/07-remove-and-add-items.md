---
depends_on:
  - dev-path/personal-navigator-layouts/slices/03-sections-and-columns.md
touches:
---

# Prune the layout down, and put things back

> Watch a new test go red before you make it green.
> _Why: a test written before the code cannot be written to hit a coverage number — there is nothing to
> cover yet. Retires when Apex gets mutation testing._

## What to build

A user removes items they never use, and adds any of them back later from a searchable list of everything
they can reach.

## Acceptance criteria

- [ ] A user removes an item from its overflow menu and it disappears from the layout; the removal
      survives a page reload.
- [ ] A section header offers "Add items", opening a picker listing every tab the user can reach that is
      not already in the layout.
- [ ] The picker has a search box, and finds an item by typing part of its label — with 174 items a
      scrolling list alone fails this.
- [ ] Adding an item from the picker places it in the section the picker was opened from.
- [ ] An item removed earlier appears in the picker and can be added back.
- [ ] Deleting a section returns its items to the picker rather than discarding them.
- [ ] The picker lists items under their Salesforce label, and never lists a tab the user cannot reach.
- [ ] A user who removes every item from a section sees something that explains the section is empty and
      how to add to it, not a blank card.
- [ ] The picker is operable from the keyboard alone, and closing it with Escape adds nothing.

## Deviations

## Critique findings
