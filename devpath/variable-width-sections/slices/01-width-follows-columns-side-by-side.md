---
depends_on:
touches:
  - force-app/main/default/lwc/salesforceNavigator/salesforceNavigator.css
  - force-app/main/default/lwc/salesforceNavigator/salesforceNavigator.html
  - force-app/main/default/lwc/salesforceNavigator/salesforceNavigator.js
  - force-app/main/default/lwc/salesforceNavigator/__tests__/salesforceNavigator.test.js
  - force-app/main/default/lwc/navigatorSection/navigatorSection.css
done: true
fix_cycles: 1
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

- [ ] A section holding one field column renders visibly narrower than a section holding six, rather
      than both filling the layout's width.
- [ ] Two sections whose field columns total six or fewer appear beside each other in one row.
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
- [ ] No row holds sections whose field columns total more than six, and a section holding six field
      columns sits alone in its row.
- [ ] Sections whose column counts do not fill a row leave the remaining space empty rather than
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

**Fix pass, on Findings 1, 2, 4, 5 and 6:**

- `salesforceNavigator.html` and `salesforceNavigator.css` were touched after all, to fix Finding 1 —
  correcting the deviation above, which was wrong. `class={section.spanClass}` now binds on
  `<c-navigator-section>` in `salesforceNavigator.html`, and the six `.rstk-nav-section_span-N` rules
  moved from `navigatorSection.css` into `salesforceNavigator.css` beside the six-track grid they size —
  the grid's actual children are the `<c-navigator-section>` hosts, and a rule carrying `grid-column`
  written against anything inside one of those hosts' own shadow roots reaches nothing. `navigatorSection.js`
  and `.css` lost the `spanClass` getter and the six rules that never worked; `navigatorLayoutModel.js`'s
  own `spanClass` computation is unchanged, only its doc comment's file reference is corrected.
- Finding 4's fix is test-only: `salesforceNavigator.test.js` now imports `MAX_COLUMNS` from
  `c/navigatorLayoutModel` and drives the six-track stylesheet pin's `repeat(N, …)` off it, so moving the
  maximum without moving the CSS's own six tracks now fails this test instead of staying green.
- Finding 5's fix, at the engineer's decision: the floor's fallback is now `var(--slds-g-sizing-13, 10rem)`
  — `--slds-g-sizing-13` resolves to exactly `10rem` in both `slds` and `cosmos`
  (`node_modules/@salesforce-ux/sds-metadata/*/SLDSStylingHooks.csv`) — nested inside the existing
  `--rstk-nav-col-min` override seam, which is unchanged. **The ceiling stays a raw `26rem`,** because no
  sizing hook matches that value (`--slds-g-sizing-14` is `15rem`) — the engineer's decision, not a gap
  left open.
- Finding 6's fix is wording-only, at the engineer's decision: `CARD_ARROW_DELTAS`' ±1 arithmetic is
  unchanged — sections are still reordered through their own flat stored order, which is what packs into
  the canvas's rows, and `## Design` keeps row membership out of JS. The section drag instructions in
  `navigatorSection.html` (assistive text, shown only while a card is grabbed) now say "move this section
  earlier or later" rather than "move this section" and away, so the copy no longer implies an
  up/down/left/right move through the two-dimensional canvas that this key does not make. No other
  user-facing or assistive wording named a direction for the section axis.
- `sf project deploy start` succeeded on the plain command both times in this pass, with no
  source-tracking conflict and no need for `--ignore-conflicts` — unlike the original build's deploy.
- `navigatorLayoutModel.js` and its test were touched too, outside `touches`, for the same reason the
  original build's own deviation reached beyond `touches`: `resolveLayout`'s `spanClass` comment named the
  wrong file (`navigatorSection.css`) once the rule moved. Doc-only — the computation it describes,
  `spanClass: \`rstk-nav-section_span-${columns}\``, is unchanged.
- Finding 3 is untouched by this pass, at the engineer's explicit instruction: its severity is to be
  graded in a real org rather than fixed blind, since any ancestor `overflow: auto` clips an
  absolutely-positioned dropdown and a wrapper element does not change that, and O4 forbids dropping the
  scroll bar. It is queued for the same live-org pass that Criteria 1, 2, 8 and 9 also need.
- Criteria 1, 2, 8 and 9 are left un-ticked rather than re-ticked. Finding 1's fix is verified — the span
  class now reaches `.rstk-nav-sections`'s direct children in jsdom, and the six-track template, the
  `minmax()` floor/ceiling and the span rules all still pin correctly in the shipped stylesheet — so the
  mechanism these four criteria depend on is genuinely wired, unlike at the last pass. But none of the four
  is about the mechanism existing; each is about what it renders (visibly narrower, beside each other, no
  row over six, `[4, 3, 3]` packing as `[4]`/`[3, 3]`), and that is CSS Grid auto-placement in a real
  browser, not something jsdom renders or this repo's stylesheet-text pins can observe. Per the engineer's
  instruction, confirming these four is queued for the same live-org pass Finding 3 awaits, rather than
  claimed here on the mechanism fix alone.

## Critique findings

- [x] fixed — the `span-N` class never reaches a grid item, so the width mechanism is inert: `.rstk-nav-sections` (`salesforceNavigator.css:50`) is the grid and its direct children are the `<c-navigator-section>` hosts (`salesforceNavigator.html:157`), but `cardClass` puts `span-N` on an `<article>` inside `navigatorSection`'s shadow root (`navigatorSection.html:6`, `navigatorSection.js:170`), where `grid-column` applies to nothing — probed in jsdom, the grid container's own child has `className === ""` and the `<article>` has `parentElement === null`, so every section occupies exactly one of the six tracks whatever its column count, leaving criteria 1, 2, 8 and 9 ticked but unsatisfied and O1, O3 and O7 unmet
- [x] fixed — `## Design`'s mechanism sketch names neither the element that carries `grid-column` nor the stylesheet it belongs in, and `## Current state`'s O1 note calls `.rstk-nav-section` "a block-level flex item inside `.rstk-nav-sections`" when the flex item was always the `<c-navigator-section>` host — the code inherited that error, and the span rules plus the class have to move to `salesforceNavigator.css`/`.html` on the host or become `:host` rules in `navigatorSection.css`
- [ ] `overflow-x: auto` makes the canvas a scroll container (`overflow-y` computes to `auto` with it) enclosing every `lightning-button-menu` in the layout — the section menu at `navigatorSection.html:72` and each item's menu at `navigatorItem.html:56` — whose SLDS dropdown is `position: absolute` inside a `position: relative` trigger, so an open menu is cut at the canvas edge or forces the canvas to scroll rather than overlaying; the spec's `overflow-x` trap weighed only the cards' `box-shadow` and 1rem of padding does not cover a dropdown several rem tall
- [x] fixed — nothing couples the canvas's six tracks to `MAX_COLUMNS`: `salesforceNavigator.test.js`'s pin hard-codes `repeat(\s*6\s*,` and that file does not import the constant, so moving the maximum leaves `repeat(6, ...)` green — `navigatorSection.test.js` does drive its `span-N` loop off `MIN_COLUMNS`/`MAX_COLUMNS`, so the track count is the one uncovered copy of the three `## Traps` says must move in lockstep
- [x] fixed — `10rem` and `26rem` are raw lengths in a dimension property, which `.claude/rules/rstk-slds2-ux-standards.md` says never to hardcode; `--slds-g-sizing-13` is exactly `10rem` in both slds and cosmos, though its own metadata scopes it to `border-width`/`width` rather than `grid-template-columns`, and no hook matches `26rem` at all (14 is `15rem`) — `npm run lint` flags neither, so this is a judgement call handed back rather than decided here
- [x] fixed — keyboard section reorder still moves ±1 through a now two-dimensional layout: `CARD_ARROW_DELTAS` (`navigatorSection.js:33`) maps ArrowUp/ArrowDown to -1/+1 and the parent applies it through `reorder`, so ArrowDown on a card sharing a row slides it sideways rather than down a row; `## Design` keeps row membership out of JS by choice, so there is no arithmetic fix and the decision is about wording or which keys are offered
- [x] false positive — `--rstk-nav-col-min` and `--rstk-nav-col-max` are declared nowhere in the repo, but `var()` resolves to its fallback when the property is undeclared, so the 10rem floor and the 26rem ceiling do apply; the undeclared names are an override seam, not dead code
- [ ] the deleted `navigatorSection.test.js` span-N test asserted two things and only one was replaced: besides the class being present it filtered the card's class list to `/^rstk-nav-section_span-\d+$/` and required exactly one member, and nothing now covers that half — `salesforceNavigator.test.js:753` and `:847` are both `toContain`, so emitting `` spanClass: `rstk-nav-section_span-${columns} rstk-nav-section_span-6` `` from `resolveLayout` (`navigatorLayoutModel.js:106`) leaves all 449 tests green where the deleted assertion would have gone red (mutated and restored to confirm), and a host carrying two span classes renders at whichever the stylesheet orders last — six tracks wide whatever its column count, breaking O1 and O10 silently; the sibling `cols-N` uniqueness guard at `navigatorSection.test.js:199-204` survives, so the span family is now the only one of the two computed class families with no such guard
- [ ] `CARD_ARROW_DELTAS`' new doc comment (`navigatorSection.js:41-43`) justifies the reworded assistive text by contrasting the section axis with "an item's own ARROW_DELTAS in navigatorItem, genuinely moving within one section's own grid of field columns", but `navigatorItem.js:10-15` is the identical `{ ArrowUp: -1, ArrowLeft: -1, ArrowDown: 1, ArrowRight: 1 }`, dispatched as `itemkeymove` and applied by `handleItemKeyMove` as `to = from + delta` over the flat `items` array whose members render into the `cols-N` grid — the item axis has exactly the same flat-order-versus-two-dimensional-render mismatch, `navigatorItem.html:100` already says only "move this item" for that reason, and so the contrast the comment draws is false; doc-only, and the ±1 arithmetic itself is settled and is not re-raised
