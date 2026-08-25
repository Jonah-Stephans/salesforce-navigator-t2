---
depends_on:
  - dev-path/personal-navigator-layouts/slices/03-sections-and-columns.md
touches:
  - force-app/main/default/classes/NavigatorLayoutController.cls
  - force-app/main/default/classes/NavigatorLayoutControllerTest.cls
  - force-app/main/default/lwc/salesforceNavigator/salesforceNavigator.js
  - force-app/main/default/lwc/salesforceNavigator/salesforceNavigator.html
  - force-app/main/default/lwc/salesforceNavigator/salesforceNavigator.css
  - force-app/main/default/lwc/salesforceNavigator/__tests__/salesforceNavigator.test.js
done: true
---

# Keep more than one layout and switch between them

> Watch a new test go red before you make it green.
> _Why: a test written before the code cannot be written to hit a coverage number — there is nothing to
> cover yet. Retires when Apex gets mutation testing._

## What to build

A user keeps several named layouts for different kinds of work and switches which one they are looking
at.

## Acceptance criteria

- [x] met A user creates a second named layout, and the Navigator header lists both with the active one
      marked.
- [x] met Switching layouts re-renders the sections, items, column counts and renames belonging to the
      selected layout, and leaves the other layout untouched.
- [x] met The chosen layout is still the active one after a page reload and a fresh login.
- [x] met A user can rename a layout and delete one.
- [x] met Exactly one layout is active at a time — activating one deactivates the previously active one in the
      same transaction, and no sequence of switches leaves two active or none active.
- [x] met Deleting the active layout leaves the user with a sensible active layout rather than an empty
      screen.
- [ ] The same active layout is shown on the Navigator tab, on an App page placement and on a Home page
      placement — switching on one is reflected on the others.
- [x] met A user's layouts are theirs alone; a second user's list is independent.

## Deviations

### What "a sensible active layout" was decided to mean, and why

Deleting the active layout activates **the layout that takes its place in the user's own ordering** —
the one after it, or the one before it when the deleted layout was last. That is what a list does
when a row is removed from the middle of it, so the user's next screen is the layout their eye was
already next to rather than an arbitrary one. It is decided in `NavigatorLayoutController.deleteLayout`
and not in the client, so the two cannot disagree about it.

Deleting the **only** layout deliberately leaves **no row at all**. That is not an empty screen: it is
exactly the first-open state — every tab the user can reach in one seeded section, computed and not
written. Writing a replacement row would put back the thing the user just asked to be rid of, and
would create a row for a user who now has no customisation to store.

### Three new Apex methods rather than reusing `updateLayout`

`activateLayout`, `renameLayout` and `deleteLayout` were added, and **none of them takes a payload**.
Switching through `updateLayout` would have meant the client sending the layout it is looking at
along with the id of the layout it is switching *to* — which is the previous project's bug rebuilt
out of new parts. A switch and a rename now have nothing to write onto the wrong row even if they
named one.

### One defect found and fixed during the mutation pass, not present before this slice

`persist` sent `makeActive: true` on every autosave. With one layout that was harmless; with several,
a save queued before a switch and resolving after it **dragged the active flag back** to the layout
the user had just left. Fixed at both ends: the client asks "is this still the layout on screen?" as
late as possible (`makeActive: isCurrent`) while the *row* stays captured at queue time, and
`updateLayout` now reads `makeActive == false` as **"leave the flag as it is"** rather than "clear
it" — so no ordinary save can leave a user with no active layout. Pinned by
`anUpdateThatDoesNotClaimTheActiveFlagLeavesEveryFlagAlone` (Apex) and
`a change made while a switch is still in flight is written to the layout it was made on` (jest).

The jest test had to hold the switch open (`store.deferNextActivation`) to see it. Every other test in
the block resolves Apex instantly, and instant resolution ends the switch before the change is made —
another instance of *a fixture that cannot distinguish two rules will pass both*.

### The deploy's source-tracking conflict

`sf project deploy start` reported a conflict on all four components. Retrieved to a temp dir with
`--target-metadata-dir` (never the working tree) and diffed each file against `git show HEAD:<path>`.
The `.cls`, `.js`, `.html` and `.css` files differed **only** by the trailing newline. The two
`.cls-meta.xml` files differed by that and by **one space in the XML prolog** —
`encoding="UTF-8" ?>` locally against `encoding="UTF-8"?>` from the server — which is Prettier's XML
writer against the Metadata API's serialiser, the same class of artifact as the newline and not a
content change. No content differed anywhere, so `--ignore-conflicts` was used. Recorded here because
the rule as written names only the newline.

### Criterion 7 — the three placements — is NOT ticked

**What was established.** Layouts are global to the user and there is no seam at which a placement
could scope one. `getLayouts()` takes no argument and the client passes none; `salesforceNavigator.js-meta.xml`
declares all three targets (`lightning__Tab`, `lightning__AppPage`, `lightning__HomePage`) and
**declares no `<property>` at all**, which is not a preference — `lightning__Tab` rejects `<property>`
outright, server-enforced, as `## Current state` → *Outcome 2* records. A jest test mounts a second
component instance standing for a second placement and asserts it shows the same active layout after a
switch made in the first, and that the read is called with no argument at all.

**What remains.** The three placements *themselves* — the component rendered on a real Navigator tab,
on a real Lightning App page and on a real Home page in a running org, with a switch made on one and
observed on the others. jsdom renders one component in one document and has no Lightning page context;
`lightning__Tab` in particular gives no `recordId` and no FlexiPage wrapper to stand up. This needs a
browser driver against a live org with the tab placed in an app and the component dropped on both page
types — the two admin steps in `## Out of scope` are prerequisites, so it cannot be reached from
source either. It is the same ceiling slices 04–07 recorded for their gesture-level halves.

### Mutation results

Each mutation was applied to the shipped code, the suite run, and the mutation reverted. **Nothing
survived.**

| # | Mutation | Caught by | Failing tests |
| --- | --- | --- | --- |
| 1 | `save()` stops capturing the layout id; `persist` reads `this.layoutId` at write time | jest | 1 — *a change made while a switch is still in flight…* |
| 2 | New layout calls `updateLayout` on the active layout instead of `createLayout` (the original bug, verbatim) | jest | 1 — *a new layout sits beside the existing ones…* |
| 3 | `deleteLayout` never activates a successor — delete leaves nothing active | Apex | 3 |
| 4 | `deactivations` returns nothing — activation leaves two (or 200) active | Apex | 6 |
| 5 | `layoutChoices` lists only the active layout | jest | 1 — *lists every layout the user owns…* |
| 6 | Opening any layout dialog calls `applyLayout`, so the menu writes | jest | 3 |
| 7 | Switching strips `rename` out of the adopted payload | jest | 18 |

Mutation 1 **survived the first attempt** and the gap was real: no test held a switch open, so no
fixture could distinguish "captured at queue time" from "read at write time". The test written to
close it then found the `makeActive` defect above. Mutation 6 was not seen by
*opening the menu … writes nothing*, which fired a bare `open` event that reaches no handler; that
test now opens all three dialogs and would catch it on its own.

## Critique findings
