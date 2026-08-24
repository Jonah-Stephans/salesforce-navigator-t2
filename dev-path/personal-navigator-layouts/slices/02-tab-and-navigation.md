---
depends_on:
  - dev-path/personal-navigator-layouts/slices/01-slds-lint-gate.md
touches:
  - jest.config.js
---

# Open the Navigator and click through to a tab

> Watch a new test go red before you make it green.
> _Why: a test written before the code cannot be written to hit a coverage number — there is nothing to
> cover yet. Retires when Apex gets mutation testing._

## What to build

A user opens the Salesforce Navigator tab, sees every tab they can reach listed under its Salesforce
label, and clicks one to arrive at it.

## Acceptance criteria

- [ ] A user with the shipped permission set sees the Navigator tab and can open it; a user without it
      does not see the tab.
- [ ] The Navigator appears in the Lightning App Builder component palette for both App pages and the
      Home page.
- [ ] Every tab listed is one the running user can reach; no tab the user cannot access is rendered, and
      the rendered set is never wider than the App Launcher's All Items list.
- [ ] More than 100 accessible tabs are all listed — the page size caps at 100, so a single unpaginated
      request fails this.
- [ ] Clicking an item navigates to that tab. A jest test asserts the emitted `pageReference` matches the
      one the platform supplied for that item, unmodified.
- [ ] Each item is a real link: middle-click and ctrl/cmd-click open it in a new browser tab rather than
      being swallowed.
- [ ] Every tab kind the platform returns navigates correctly, including kinds whose `pageReference.type`
      is not in the published documentation — the stored reference is passed through verbatim, never
      reconstructed from the tab's name.
- [ ] All tab data is read through one module, so that swapping the source later touches exactly one file.
- [ ] Colour, spacing and typography come from `--slds-g-*` semantic hooks; the lint gate from slice 01
      passes.

## Deviations

## Critique findings
