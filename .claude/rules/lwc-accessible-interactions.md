---
paths:
  - "**/lwc/**/*.js"
  - "**/lwc/**/*.html"
---

# Accessible interactions in LWC

Anything adding a drag, a reorder, or any pointer-driven gesture to a component needs this. The
recurring failure is not the keyboard route — it is the announcement, which is easy to leave out
because the feature demonstrably works when you try it with a mouse and a keyboard.

- Every gesture that works with a mouse needs both a keyboard route and a screen-reader announcement, and the keyboard route alone is half the work https://github.com/Jonah-Stephans/salesforce-navigator-t2/pull/1
  Shipped short on exactly this: section create, rename, delete and column change were all
  keyboard-reachable and all silent, and the gap survived to merge.
- `aria-grabbed` and `aria-dropeffect` are deprecated — never author them; hold drag state in the component and announce it through a live region instead https://github.com/Jonah-Stephans/salesforce-navigator-t2/pull/1
- A live region does not re-announce text identical to what it already holds, so a repeated action needs a distinguisher appended to the message https://github.com/Jonah-Stephans/salesforce-navigator-t2/pull/1
  A zero-width space works and stays inaudible.
- Announce the grab, each move, the drop and the cancel separately — announcing only the endpoint leaves a keyboard user unable to track where they are mid-gesture https://github.com/Jonah-Stephans/salesforce-navigator-t2/pull/1
- After a keyboard move re-renders the list, hand focus to the moved element explicitly or it falls to the document body https://github.com/Jonah-Stephans/salesforce-navigator-t2/pull/1
- Track a held item by its identity, never by its index — a sibling leaving the list re-seats every index below it and the grab follows the wrong element https://github.com/Jonah-Stephans/salesforce-navigator-t2/pull/1
- Give a repeated card or region an accessible name, or a screen reader announces it as nothing https://github.com/Jonah-Stephans/salesforce-navigator-t2/pull/1
- A live region holds one value, so two `announce()` calls in the same tick with no `await` between them render only the second — the first is not quiet, it is gone https://github.com/Jonah-Stephans/salesforce-navigator-t2/pull/11
  Whether an announcement is heard is a fact about call order inside the handler, and the unit to
  enumerate is the branch rather than the control: one method whose two branches announce
  differently will defeat an enumeration over controls. The mechanical check is every call site
  that starts a busy state, and whether an `announce(` follows it in the same body before any
  `await`, `.then()` or `return`. No rendered-text assertion can catch this, because the collapse
  happens before any render — assert the announce call log instead.
- Keep the live region outside the block the mode toggles, or it is created in the same tick as its first text and the announcement is lost https://github.com/Jonah-Stephans/salesforce-navigator-t2/pull/11
