---
depends_on:
  - devpath/variable-width-sections/slices/01-width-follows-columns-side-by-side.md
touches:
  - force-app/main/default/lwc/salesforceNavigator/salesforceNavigator.css
  - force-app/main/default/lwc/salesforceNavigator/salesforceNavigator.js
  - force-app/main/default/lwc/salesforceNavigator/__tests__/salesforceNavigator.test.js
---

# On a phone the layout goes back to one section per row

> Watch a new test go red before you make it green.
> _Why: a test written before the code cannot be written to hit a coverage number — there is nothing to
> cover yet. Retires when Apex gets mutation testing._

## What to build

A user on a phone sees each section on its own row filling the width of the screen with its field columns
sharing that width equally — the layout they see today — and never has to scroll sideways, while a user
on a desktop who zooms in still gets the side-by-side layout and its scroll bar.

## Acceptance criteria

- [ ] On the `Small` form factor every section occupies its own row at the full width of the viewport.
- [ ] On `Small`, a section's field columns divide the section's width equally, exactly as they do today.
- [ ] On `Small`, no horizontal scroll bar appears at any section column count.
- [ ] On `Medium` and `Large` the behaviour built in slice 01 is unchanged.
- [ ] Zooming in on a desktop does not switch the layout into the `Small` behaviour — it produces the
      horizontal scroll bar from slice 01 instead.
- [ ] No CSS media query is introduced anywhere in the component.
- [ ] `npm run lint` passes at `--max-warnings 0` over the changed CSS.

## Deviations

## Critique findings
