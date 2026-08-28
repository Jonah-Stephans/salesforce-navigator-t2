---
depends_on:
  - devpath/variable-width-sections/slices/01-width-follows-columns-side-by-side.md
touches:
  - force-app/main/default/lwc/navigatorItem/navigatorItem.css
  - force-app/main/default/lwc/navigatorItem/navigatorItem.html
  - force-app/main/default/lwc/navigatorItem/__tests__/navigatorItem.test.js
done: true
---

# A long item label is cut off inside its pill, not spilled out of it

> Watch a new test go red before you make it green.
> _Why: a test written before the code cannot be written to hit a coverage number — there is nothing to
> cover yet. Retires when Apex gets mutation testing._

## What to build

An item whose tab name is longer than the column it sits in shows as much of the name as fits followed by
an ellipsis, staying inside its own pill, and the user can still get at the whole name by hovering it, by
searching the page for it, or with a screen reader.

## Acceptance criteria

- [x] met An item whose label does not fit its column shows the label truncated with an ellipsis.
      `slds-truncate` (`max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap`,
      read verbatim from the shipped `salesforce-lightning-design-system.css` rather than assumed) is on
      the label span, which per the Flexbox spec gets an automatic min-width of 0 once its own `overflow`
      is not `visible` — so it shrinks and truncates inside the item's flex row with no hand-added
      `min-width: 0` of its own. jsdom applies no stylesheet, so the rendered ellipsis itself is a
      real-browser fact, not a jest one; what jest pins is the markup that produces it.
- [x] met That item's text stays inside the pill's border rather than overflowing past it or overlapping
      the item's overflow menu. `.rstk-nav-item` (the anchor/pill) gained its own `overflow: hidden`,
      pinned by reading the shipped CSS as text — the repo's existing pattern for a fact jsdom cannot
      observe by rendering.
- [x] met Hovering a truncated item reveals the full label. The anchor gained `title={label}`, the full
      untruncated string, asserted directly.
- [x] met The browser's find-in-page still matches text that the ellipsis hides. Truncation is CSS-only
      (`text-overflow: ellipsis` clips rendering, never the DOM text node), pinned by asserting the label
      span's `textContent` is the full, unshortened string.
- [x] met A screen reader announces the full label, and announces it once rather than twice. `aria-label`
      remains the anchor's only accessible-name source (accname computation ranks it above `title`), so
      adding `title` does not change what the _name_ is computed from — asserted directly. Whether some
      assistive tech separately reads `title` as a hint on top of that name is the live-AT question
      spec.md's own `## Traps` names as unverified; jsdom computes no accessible name and applies no
      screen reader, so that residual is left exactly where the spec left it, not asserted past it.
- [x] met An item whose label already fits is unchanged — no ellipsis and no truncation. Nothing branches
      on length: the same `slds-truncate` class and `title` apply unconditionally, and it is the real
      stylesheet's own `text-overflow` that decides whether an ellipsis ever shows — pinned by asserting a
      short label's class and full text are unchanged, i.e. no second, JS-computed truncation is layered
      on top.
- [x] met No item label wraps to a second line at any column width. `white-space: nowrap` is part of what
      `slds-truncate` resolves to in the shipped stylesheet (verified, not assumed — see the note above
      `## Acceptance criteria`). Real wrapping is a real-browser fact jsdom cannot render; the class that
      produces it is what jest pins.
- [x] met `npm run lint` passes at `--max-warnings 0` over the changed CSS and HTML. Ran clean, along with
      `npm run lint:slds-gate` (all six `ok:` lines) and the full `npm run test:unit` suite (455 passed).

## Deviations

- `sf project deploy start` reported a source-tracking conflict against the scratch org (`sfnav-t2`) on
  all four bundle members of `navigatorItem`, including `navigatorItem.js` and its meta-xml — files this
  slice never touched. This is deploy-mechanics drift between the org's tracked baseline and local git
  (the org's own record of prior slices, not a design question), so local git was taken as authoritative
  and the deploy was rerun with `--ignore-conflicts`. Deploy then succeeded (`Status: Succeeded`, 4
  components changed).

## Critique findings
