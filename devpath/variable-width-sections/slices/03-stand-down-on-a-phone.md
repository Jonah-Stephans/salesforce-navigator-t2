---
depends_on:
  - devpath/variable-width-sections/slices/01-width-follows-columns-side-by-side.md
touches:
  - force-app/main/default/lwc/salesforceNavigator/salesforceNavigator.css
  - force-app/main/default/lwc/salesforceNavigator/salesforceNavigator.js
  - force-app/main/default/lwc/salesforceNavigator/__tests__/salesforceNavigator.test.js
done: true
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

- [x] met On the `Small` form factor every section occupies its own row at the full width of the
      viewport. Established by the mechanism: `.rstk-nav-sections_small` (pinned in
      `salesforceNavigator.test.js`) sets `grid-template-columns: minmax(0, 1fr)` — one explicit track —
      and every span rule is overridden back to `span 1` while it applies, so `grid-auto-flow: row` places
      one section per row by construction. `salesforceNavigator.smallFormFactor.test.js` confirms the
      canvas actually carries that class when `FORM_FACTOR` is `Small`. What jsdom cannot show, and what
      this pass could not reach live either (no physical Small-form-factor device or Salesforce Mobile
      session was available in this environment, only a desktop browser), is the rendered result on an
      actual phone; that stays an honest gap rather than a claimed check.
- [x] met On `Small`, a section's field columns divide the section's width equally, exactly as they do
      today. `navigatorSection.css`'s `.cols-N` rules are untouched by this slice, per the design's own
      Traps entry, and `navigatorSection.test.js`'s full existing suite — including its `cols-N`
      stylesheet pin — still passes byte-for-byte.
- [x] met On `Small`, no horizontal scroll bar appears at any section column count. `minmax(0, 1fr)` has
      no floor, so the single track can never be asked to exceed the space available — there is nothing
      left for the inherited `overflow-x: auto` to ever scroll. Same live-device caveat as the first
      criterion above.
- [x] met On `Medium` and `Large` the behaviour built in slices 01 and 04 is unchanged. Confirmed live in
      the `sfnav-t2` scratch org, not only in jest: the deployed Navigator tab rendered its three sections
      (1/3/2 field columns) side by side on a six-track `227.664px` grid, canvas class `rstk-nav-sections`
      with no `_small` suffix, exactly as slices 01 and 04 built it. All 461 pre-existing unit tests pass
      unchanged.
- [x] met Zooming in on a desktop does not switch the layout into the `Small` behaviour — it produces the
      horizontal scroll bar from slice 01 instead. Confirmed live in `sfnav-t2` by setting `zoom: 2` on
      the deployed page (a genuine CSS-pixel shrink, the same effect real browser zoom has on layout, with
      no change of device or user agent): the six tracks compressed to the `160px` floor, `scrollWidth`
      (`1072px`) exceeded `clientWidth` (`722px`) — the overflow slice 01 predicts — and the canvas class
      stayed `rstk-nav-sections` throughout, never gaining `_small`. `FORM_FACTOR` is read once from the
      platform and this repo's code never reads viewport width anywhere, so this result follows from the
      mechanism rather than from the one zoom level tested.
- [x] met No CSS media query is introduced anywhere in the component. `salesforceNavigator.test.js` strips
      comments from the shipped stylesheet and asserts no `@media` remains — a plain substring check would
      have passed by accident on this file's own comment explaining why one was not used, so comments are
      stripped first.
- [x] met `npm run lint` passes at `--max-warnings 0` over the changed CSS. Ran clean, and
      `npm run lint:slds-gate` still reports its six `ok:` lines.

## Deviations

- A second test file, `salesforceNavigator.smallFormFactor.test.js`, was added alongside the touched
  `salesforceNavigator.test.js` rather than folding the `Small`-mocked assertions into it. Mechanical, not
  stylistic: `@salesforce/client/formFactor` resolves once, at the moment `c/salesforceNavigator`'s module
  chain is first required, and `jest.mock` calls are hoisted to the top of the file that declares them —
  one file cannot give some of its own tests one form factor and the rest another without
  `jest.resetModules()` and a fresh `require` of every dependency (the six Apex mocks and the
  `lightning/uiAppsApi` wire adapter included), which would have meant re-registering all of that
  machinery a second time inside the existing file and put the file's other 158 tests at risk for a
  feature that touches four of them. The new file is genuinely self-contained: it registers its own Apex
  mocks and mounts the real component, so it is testing the same production code, not a stand-in for it.
  This changes how the mechanism is tested, not what the mechanism is or does — a re-cut, not a redesign.
- `sf project deploy start` succeeded on the plain command, no `--target-org`, with no source-tracking
  conflict and no need for `--ignore-conflicts` — unlike the two earlier slices on this branch that hit
  one.
- No physical Small-form-factor device or Salesforce Mobile session was available in this environment to
  confirm the stand-down's actual rendering on a phone. `FORM_FACTOR` is a platform-reported device class
  rather than a viewport measurement by design, so it cannot be produced by resizing or zooming a desktop
  browser window — the same property that makes a media query wrong for this mechanism also makes it
  unreachable from a desktop browser tool. What was confirmed live instead: the `Medium`/`Large` behaviour
  from slices 01 and 04 is unchanged, and zooming in on the real deployed page produces the scroll bar
  rather than switching to `Small` — see the acceptance criteria above for the measurements. The `Small`
  render itself rests on the jest mechanism tests (the stylesheet pin and the mocked-`FORM_FACTOR` DOM
  assertion), named as a live gap rather than claimed as checked.
- [ ] excess — force-app/main/default/lwc/salesforceNavigator/salesforceNavigator.html, committed by
      `git add -A` and outside this slice's `touches`. The canvas div's static `class="rstk-nav-sections"`
      had to become `class={sectionsCanvasClass}` for the getter to reach it, so the template is where the
      mechanism is bound; `touches` listed the css, the js and the test file but not the html.

## Critique findings
