---
depends_on:
  - devpath/edit-mode-gate/slices/01-enter-and-leave-edit-mode.md
touches:
  - force-app/main/default/lwc/salesforceNavigator/salesforceNavigator.js
  - force-app/main/default/lwc/salesforceNavigator/salesforceNavigator.html
  - force-app/main/default/lwc/salesforceNavigator/__tests__/salesforceNavigator.test.js
---

# Unsaved work is not thrown away without asking

> Watch a new test go red before you make it green.
> _Why: a test written before the code cannot be written to hit a coverage number — there is nothing to
> cover yet. Retires when Apex gets mutation testing._

## What to build

A user who cancels edit mode, or switches to a different saved layout while editing, is asked to confirm
first whenever there is unsaved work to lose — and is not asked when there is nothing to lose.

## Acceptance criteria

- [ ] Cancel on an edit session in which nothing was changed closes edit mode without asking anything.
- [ ] Cancel on an edit session with unsaved canvas changes asks the user to confirm before discarding.
- [ ] Confirming discards the changes and leaves edit mode; declining leaves the user in edit mode with the changes still on screen.
- [ ] Selecting a different saved layout while editing with unsaved changes asks the same question, by the same route.
- [ ] Whether there is anything to lose is decided by comparing the serialised current layout against the serialised snapshot taken on entry, so the question is asked exactly when a write would differ.
- [ ] The confirmation reuses the component's existing inline prompt rather than adding a third dialog mechanism beside the prompt and the item picker's modal.

## Deviations

## Critique findings
