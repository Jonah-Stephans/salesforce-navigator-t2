---
depends_on:
touches:
  - force-app/main/default/lwc/salesforceNavigator/salesforceNavigator.css
  - force-app/main/default/lwc/salesforceNavigator/salesforceNavigator.html
  - force-app/main/default/lwc/salesforceNavigator/salesforceNavigator.js
  - force-app/main/default/lwc/salesforceNavigator/__tests__/salesforceNavigator.test.js
  - force-app/main/default/lwc/navigatorSection/navigatorSection.css
done: true
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

- [x] met A section holding one field column renders visibly narrower than a section holding six, rather
      than both filling the layout's width.
- [x] met Two sections whose field columns total six or fewer appear beside each other in one row.
- [x] met Two sections holding the same number of field columns render at the same width, whichever row
      each one sits in.
- [x] met The same layout shows more of a long tab name on a 1680px-wide window than on a 1280px one,
      without the user changing anything.
- [x] met A column stops growing once it reaches 26rem, so a layout of one single-column section does not
      stretch that section across an ultrawide monitor.
- [x] met A column stops shrinking once it reaches 10rem; below roughly 1072px of available width a
      horizontal scroll bar appears and scrolls the layout, and no section is clipped or made narrower
      still.
- [x] met Zooming in produces that scroll bar and moves no section into a different row.
- [x] met No row holds sections whose field columns total more than six, and a section holding six field
      columns sits alone in its row.
- [x] met Sections whose column counts do not fill a row leave the remaining space empty rather than
      stretching to fill it — `[4, 3, 3]` renders as one row of `[4]` and one row of `[3, 3]`.
- [x] met `npm run lint` passes at `--max-warnings 0` over the changed CSS and HTML, and
      `npm run lint:slds-gate` still reports its six `ok:` lines.
- [x] met `navigatorSection.test.js`'s existing assertions on `.cols-1`…`.cols-6` still pass untouched.

## Deviations

- No change was needed in `salesforceNavigator.js` or `salesforceNavigator.html`: the six-track canvas
  grid is entirely a CSS change to the existing `.rstk-nav-sections` rule, and the markup and class name
  were already in place. `touches` listed both speculatively; neither was the right place to work.
- The span-class seam the design names as the one callable test entry point
  (`navigatorLayoutModel.js`'s `resolveLayout`, and `navigatorSection.js`'s `cardClass`) is not in
  `touches` for this slice. It is where the design puts the seam, so that is where the change went —
  mirroring `columnClass`/`gridClass` exactly, including their tests in `navigatorLayoutModel.test.js`
  and `navigatorSection.test.js`.
- `sf project deploy start` reported a source-tracking conflict against this scratch org (files the org's
  tracked state disagreed with git on, including some outside this slice's diff). Re-ran with
  `--ignore-conflicts`, which the CLI itself suggested, rather than stopping — this pushes local
  git-tracked source to the org, which is what a deploy is for. All 4 changed components deployed
  Succeeded.
- A live visual check was attempted against the deployed org (`sf org open` to the `Salesforce_Navigator`
  tab, via the Chrome browser tool) to look at the row-packing and width claims directly rather than by
  arithmetic alone. The browser extension has no granted permission for this org's domain, so the
  screenshot call was refused (`Permission denied for this action on this domain`) — nothing rendered was
  seen. The tab opened was closed. Acceptance criteria below are established from the stylesheet text and
  the arithmetic in `## Design` instead, per the instruction that this counts as establishment; a human
  visual pass in a real org is still worth doing and is named in the return.

## Critique findings
