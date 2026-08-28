---
depends_on:
touches:
  - force-app/main/default/lwc/salesforceNavigator/salesforceNavigator.css
  - force-app/main/default/lwc/salesforceNavigator/salesforceNavigator.html
  - force-app/main/default/lwc/salesforceNavigator/salesforceNavigator.js
  - force-app/main/default/lwc/salesforceNavigator/__tests__/salesforceNavigator.test.js
  - force-app/main/default/lwc/navigatorSection/navigatorSection.css
---

# A section's width follows its field-column count, and sections sit side by side

> Watch a new test go red before you make it green.
> _Why: a test written before the code cannot be written to hit a coverage number — there is nothing to
> cover yet. Retires when Apex gets mutation testing._

## What to build

A section holding one field column takes a narrow slice of the layout while a section holding six takes
the whole width, so several narrow sections sit side by side in one row, every column gets wider as the
window gets wider, and the layout scrolls sideways rather than squeezing anything once there is no room
left.

## Acceptance criteria

- [ ] A section holding one field column renders visibly narrower than a section holding six, rather than
      both filling the layout's width.
- [ ] Two sections whose field columns total six or fewer appear beside each other in one row.
- [ ] Two sections holding the same number of field columns render at the same width, whichever row each
      one sits in.
- [ ] The same layout shows more of a long tab name on a 1680px-wide window than on a 1280px one, without
      the user changing anything.
- [ ] A column stops growing once it reaches 26rem, so a layout of one single-column section does not
      stretch that section across an ultrawide monitor.
- [ ] A column stops shrinking once it reaches 10rem; below roughly 1072px of available width a horizontal
      scroll bar appears and scrolls the layout, and no section is clipped or made narrower still.
- [ ] Zooming in produces that scroll bar and moves no section into a different row.
- [ ] No row holds sections whose field columns total more than six, and a section holding six field
      columns sits alone in its row.
- [ ] Sections whose column counts do not fill a row leave the remaining space empty rather than
      stretching to fill it — `[4, 3, 3]` renders as one row of `[4]` and one row of `[3, 3]`.
- [ ] `npm run lint` passes at `--max-warnings 0` over the changed CSS and HTML, and
      `npm run lint:slds-gate` still reports its six `ok:` lines.
- [ ] `navigatorSection.test.js`'s existing assertions on `.cols-1`…`.cols-6` still pass untouched.

## Deviations

## Critique findings
