---
paths:
  - "**/lwc/**/*.js"
  - "**/lwc/**/*.html"
---

# Gating controls behind a mode

Read this before putting any control behind a mode flag — edit mode, a read-only flag, a
permission check. Gating the control is the easy half. The recurring failure is a route that
reaches the same effect without going through the control, and every one below was missed at
least twice on the Navigator by an enumeration that read the component in front of it.

- Binding an attribute does not remove it, so `draggable={editing}` renders `draggable="false"` where an omitted attribute would render nothing https://github.com/Jonah-Stephans/salesforce-navigator-t2/pull/11
  Assert the value, not the presence. A test copied from a precedent that swapped the whole
  element out asserts absence, passes for the wrong reason, and then fails when it should not.
- Gating a template attribute does not gate the handler, because `onkeydown` fires on a non-draggable element https://github.com/Jonah-Stephans/salesforce-navigator-t2/pull/11
  A gate that stops at the template leaves the keyboard route live for exactly the users the
  accessibility rule exists to protect.
- A drop target writes nothing, so no scan for a written payload can find it — gate the `preventDefault()` in every `dragover` and `drop` handler, not just the drag sources https://github.com/Jonah-Stephans/salesforce-navigator-t2/pull/11
  `preventDefault()` on `dragover` is what offers the move cursor and what makes the browser fire
  `drop` at all. The drag-source inventory returns none of them; the check is a separate grep over
  every `dragover` and `drop` handler in every component of the family.
- Re-check the mode where a gesture's effect is applied, not only where the gesture is made — an effect landing in a `.then()`, a callback or a modal resolution arrives after the mode may have changed https://github.com/Jonah-Stephans/salesforce-navigator-t2/pull/11
  A picker opened from a control that renders only in edit mode still resolves after the user
  leaves it, and the write lands with the mode false. Guarding the handler and the chosen id is
  not guarding the mode.
- The inventory of what can still reach the write path lives in the test suite, not in the component you just gated https://github.com/Jonah-Stephans/salesforce-navigator-t2/pull/11
  The mechanical form is one pass over the parent suite: every test asserting a written payload
  that contains no call into the mode is naming a route still reachable. Count the surfaces that
  scan returns rather than the ones a previous finding named.
- Every site that opens a shared dialog field must close the previous dialog first, or state cleared only in the close path leaks into the next one https://github.com/Jonah-Stephans/salesforce-navigator-t2/pull/11
  One reactive field holding several dialogs has a fourth exit nobody counts: a sibling opening,
  which calls neither the close handler nor the cancel handler. A field the open path
  re-initialises hides this; a field it does not re-initialise exposes it. A shared cancel
  handler must establish which dialog it is on before reading state belonging to one of them.
