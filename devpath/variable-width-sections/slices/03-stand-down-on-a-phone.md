---
depends_on:
  - devpath/variable-width-sections/slices/01-width-follows-columns-side-by-side.md
touches:
  - force-app/main/default/lwc/salesforceNavigator/salesforceNavigator.css
  - force-app/main/default/lwc/salesforceNavigator/salesforceNavigator.js
  - force-app/main/default/lwc/salesforceNavigator/__tests__/salesforceNavigator.test.js
done: true
fix_cycles: 0
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

- [x] false positive — the "no CSS media query" assertion is decorative and would pass on any file. It is real and the comment-stripping is load-bearing: `salesforceNavigator.css:140` literally contains the string "@media" in prose, so `expect(css).not.toMatch(/@media/)` would have failed and a naive `toContain` inversion would have false-passed; the shipped test strips `/\*…\*/` first and then asserts. Widened the check beyond the one file too — `grep -rn "@media" force-app` returns only that comment and the test's own comment and title, so no media query exists in `navigatorSection.css`, `navigatorItem.css`, `navigatorItemPicker.css` or anywhere else under `force-app`
- [x] false positive — six hand-enumerated override rules hide a silent gap in coverage. They are driven off `MIN_COLUMNS`/`MAX_COLUMNS`, not a literal 1..6, and the loop discriminates: deleting `.rstk-nav-sections_small > .rstk-nav-section_span-4` alone from the selector list turns `salesforceNavigator.test.js:919` red on the missing member. The specificity claim holds as written — `.rstk-nav-sections_small > .rstk-nav-section_span-N` is (0,2,0) against `.rstk-nav-section_span-N`'s (0,1,0), so the six overrides win irrespective of source order. Tree restored clean after the probe
- [x] false positive — the second test file is a stylistic split and its `jest.mock` hoisting reasoning is a rationalisation. The reasoning is mechanically correct: probed a mutable factory in one file (`let mockFormFactor = "Large"` with a `get default()`, the only out-of-scope binding jest's factory guard permits) and the second test still read `"Large"` after reassignment, because `import FORM_FACTOR from …` is captured once at module load rather than re-read at each use. So one file genuinely cannot vary the form factor across its own tests without `jest.resetModules()` and a re-`require` of every dependency. The new file also genuinely mounts the real component rather than a stand-in — proven by mutation: breaking `sectionsCanvasClass` in `salesforceNavigator.js` turns `salesforceNavigator.smallFormFactor.test.js:133` red. Confirmed separately that the unmocked `@salesforce/client/formFactor` resolves to `"Large"`, as both files' comments claim
- [x] false positive — slices 01, 02 and 04 changed behaviour on `Medium`/`Large`. Verified from the diff, not the claim: `navigatorSection.css`, `navigatorItem.css` and `navigatorItem.html` are absent from `c5978c4` entirely, so slice 02's truncation and the `cols-N` rules `## Traps`' seventh entry protects are untouched; the `.rstk-nav-sections` rule body is byte-for-byte unchanged apart from two comment lines; and the only shipped change reachable from a non-`Small` form factor is `class="rstk-nav-sections"` becoming `class={sectionsCanvasClass}`, where the getter returns the identical literal for every value that is not `"Small"`. `npx jest` is 461/461 green across all seven suites
- [x] false positive — the diff violates a scoped standard. `rstk-slds2-ux-standards.md` (`**/lwc/**/*.css`, `**/lwc/**/*.html`) is satisfied: the new CSS adds no colour, font, shadow, radius or border, and `minmax(0, 1fr)` and `grid-column: span 1` carry no dimension a `--slds-g-sizing-*` hook maps to — it is the same idiom `navigatorSection.css`'s `cols-N` rules already ship. No `--slds-c-*`, `--slds-s-*`, `--lwc-*` or `--sds-*` is authored and no `prefers-color-scheme` appears. `rstk-lwc-standards.md` is satisfied: `SMALL_FORM_FACTOR` is UPPER_SNAKE_CASE, the template expression is a getter rather than inline logic, and the two places this deviates from its SLDS-utility and `lightning-layout` lines are the two the design already writes down under `### Where this deviates from the repo's LWC rules, deliberately`. `rstk-preserve-documentation.md` is satisfied — the one comment line touched was updated forward, not deleted. `npm run lint` at `--max-warnings 0`, `npm run lint:slds-gate` (six `ok:` lines) and `npx prettier --check` are all clean on the committed tree
- [ ] real — `salesforceNavigator.smallFormFactor.test.js:148` asserts the section's span class with a bare `toContain`, so nothing on the `Small` path can fail on two members of the mutually-exclusive `rstk-nav-section_span-1`…`-6` family landing on one host. `## Traps` names that mutation twice, and the ninth entry's closing clause names this slice's exact shape: "the hazard arrives wherever a second rule has to override a section's stored span rather than replace the class that carries it" — which is precisely what `.rstk-nav-sections_small > .rstk-nav-section_span-N` does. Mutation-verified: making the `sections` getter append a second `rstk-nav-section_span-1` to `section.spanClass` when `FORM_FACTOR === SMALL_FORM_FACTOR` leaves all 162 tests in both files green, because the two `Large`-side filter-and-compare guards never see the conditional branch. The shape that fails on it already exists in this repo twice, at `salesforceNavigator.test.js:762-765` and `:882-885`. Tree restored clean after the probe
- [ ] real — nothing can fail on a viewport reading being OR'd into `sectionsCanvasClass`, which is the exact regression acceptance criterion 5 turns on. Mutation-verified: changing the getter to `return FORM_FACTOR === SMALL_FORM_FACTOR || window.innerWidth < 768;` leaves all 162 tests green, because jsdom reports `window.innerWidth` as 1024 in both files and neither ever sets it. A _pure_ viewport substitution is caught — `window.innerWidth < 768` on its own turns `salesforceNavigator.smallFormFactor.test.js:133` red — so the gap is the additive clause specifically, which is also the likelier drift, since a later change adding a breakpoint would add rather than replace. `window.innerWidth` is writable in jsdom, so a narrow-viewport case in the `Large` file and a wide-viewport case in the `Small` file would close it and would be the first check in this repo able to fail on the zoom criterion at all. Tree restored clean after the probe
- [ ] real — `.rstk-nav-sections_small`'s `grid-template-columns: minmax(0, 1fr)` is the same specificity (0,1,0) as `.rstk-nav-sections`'s six-track template and wins on source order alone. The block comment at `salesforceNavigator.css:158-160` establishes order-independence for the six span rules, correctly and explicitly, but the single-track rule is not covered by that claim and nothing pins its position. Mutation-verified: moving the `.rstk-nav-sections_small { … }` block above `.rstk-nav-sections { … }` silently defeats the entire stand-down — the canvas keeps six tracks on `Small` — and leaves all 162 tests green, because the CSS-text pin matches the rule wherever in the file it sits. An order assertion in the pin, or a self-sufficient selector such as `.rstk-nav-sections.rstk-nav-sections_small`, would remove the dependence. Tree restored clean after the probe
- [ ] real — acceptance criterion 3 is ticked `met` on reasoning that does not establish it. "`minmax(0, 1fr)` has no floor, so the single track can never be asked to exceed the space available" bounds the _track_, not the grid items placed in it, and the `_small` block does not reset the `overflow-x: auto` slice 01 put on `.rstk-nav-sections` — so on `Small` the canvas remains a scroll container, and `## Traps`' first entry's clipping context for every `lightning-button-menu` with it, neither of which existed in the pre-spec `display: flex; flex-direction: column` canvas that O8 calls "the behaviour that ships today". The spec's own `## Current state` measures irreducible per-column item chrome at 66px (28px menu + 4px row gap + 32px anchor padding + 2px border) and `### Form factor, not viewport width` puts a six-column section on a 390px phone at roughly 50px per track, at which point the items overflow their tracks and the canvas is what scrolls. Not disproved here either: no `Small` device was reachable, so the tick rests on the reasoning alone. What is over-claimed is the tick rather than necessarily the code — a scroll bar owned by the canvas may be the better outcome than the pre-spec spill — but "no horizontal scroll bar appears at any section column count" is not what was verified
- [ ] real — criterion 4 says "All 461 pre-existing unit tests pass unchanged"; 461 is the post-change total. The suite ran 455 before this commit and runs 461 after, six tests having been added (four in `salesforceNavigator.test.js`, two in the new file). Minor, and the substantive claim holds — the diff to `salesforceNavigator.test.js` is 91 insertions and 0 deletions, so no pre-existing test was altered, and `npx jest` is 461/461 on the committed tree — only the number is the wrong one
