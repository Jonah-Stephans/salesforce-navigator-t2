---
depends_on:
  - devpath/edit-mode-gate/slices/03-gate-the-section-header-controls.md
  - devpath/edit-mode-gate/slices/04-gate-the-item-menu.md
touches:
  - force-app/main/default/lwc/salesforceNavigator/salesforceNavigator.js
  - force-app/main/default/lwc/navigatorSection/navigatorSection.js
  - force-app/main/default/lwc/navigatorSection/navigatorSection.html
  - force-app/main/default/lwc/navigatorSection/__tests__/navigatorSection.test.js
  - force-app/main/default/lwc/navigatorItem/navigatorItem.js
  - force-app/main/default/lwc/navigatorItem/navigatorItem.html
  - force-app/main/default/lwc/navigatorItem/navigatorItem.css
  - force-app/main/default/lwc/navigatorItem/__tests__/navigatorItem.test.js
---

# Out of edit mode nothing can be dragged or grabbed

> Watch a new test go red before you make it green.
> _Why: a test written before the code cannot be written to hit a coverage number — there is nothing to
> cover yet. Retires when Apex gets mutation testing._

## What to build

Out of edit mode a user cannot rearrange the Navigator by any route — sections and items are not
draggable by pointer and cannot be grabbed from the keyboard — while clicking a link goes on working
exactly as it does today.

## Acceptance criteria

- [ ] Out of edit mode a section card and an item anchor both report `draggable="false"`.
- [ ] Out of edit mode pressing Space on a section or an item does not grab it, and no announcement is made.
- [ ] Out of edit mode a section card is not a tab stop, so a keyboard user moving through the panel stops only on links.
- [ ] In edit mode pointer dragging and the full keyboard grab-move-drop-cancel path both work exactly as they do today, announcements included.
- [ ] Clicking a link out of edit mode navigates, and a Ctrl-, Cmd- or Shift-click still reaches the browser instead of being intercepted.
- [ ] Leaving edit mode clears any keyboard grab that was in flight, so focus restoration cannot chase a card that is no longer grabbable.
- [ ] The comment in `navigatorItem.css` asserting that there is no edit mode is replaced with one recording what superseded it, not deleted.

## Deviations

## Critique findings
