---
depends_on:
  - dev-path/personal-navigator-layouts/slices/03-sections-and-columns.md
touches:
---

# Keep more than one layout and switch between them

> Watch a new test go red before you make it green.
> _Why: a test written before the code cannot be written to hit a coverage number — there is nothing to
> cover yet. Retires when Apex gets mutation testing._

## What to build

A user keeps several named layouts for different kinds of work and switches which one they are looking
at.

## Acceptance criteria

- [ ] A user creates a second named layout, and the Navigator header lists both with the active one
      marked.
- [ ] Switching layouts re-renders the sections, items, column counts and renames belonging to the
      selected layout, and leaves the other layout untouched.
- [ ] The chosen layout is still the active one after a page reload and a fresh login.
- [ ] A user can rename a layout and delete one.
- [ ] Exactly one layout is active at a time — activating one deactivates the previously active one in the
      same transaction, and no sequence of switches leaves two active or none active.
- [ ] Deleting the active layout leaves the user with a sensible active layout rather than an empty
      screen.
- [ ] The same active layout is shown on the Navigator tab, on an App page placement and on a Home page
      placement — switching on one is reflected on the others.
- [ ] A user's layouts are theirs alone; a second user's list is independent.

## Deviations

## Critique findings
