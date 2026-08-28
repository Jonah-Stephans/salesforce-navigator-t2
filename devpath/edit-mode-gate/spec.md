---
type: feature
upstream: []
intent_accepted: true
---

# Gate Navigator customization behind an edit mode

## Intent
The Navigator's sections are permanently in edit mode: resize handles, add-column
affordances and move controls are on the page whether or not the user intends to
customise anything. That makes the page read as unfinished and it puts visual
clutter between the user and the thing they actually came for, which is getting
somewhere fast. Put every customisation control behind an explicit edit mode,
entered from a small affordance in the top right. Out of edit mode the Navigator
is display-only: links and nothing else. Navigation becomes the page's primary
purpose and modification becomes its secondary one.

## Outcomes
- O1 — Out of edit mode the Navigator renders no customisation control: no resize handle, no add-column affordance, no move or reorder handle
- O2 — An edit affordance sits in the top right and is the only customisation control visible out of edit mode
- O3 — Activating the edit affordance reveals the customisation controls; leaving edit mode hides them again
- O4 — Column resizing is available in edit mode and unavailable out of it
- O5 — Adding and removing columns is available in edit mode and unavailable out of it
- O6 — Moving or reordering items is available in edit mode and unavailable out of it
- O7 — Navigation links are clickable and navigate correctly out of edit mode
- O8 — Customisations made in edit mode survive leaving edit mode and a page reload

## Out of scope
- Adding, removing or changing any customisation capability the Navigator already has — this spec changes when the controls are reachable, not what they do
- Changing where or how customisations are stored
- Restyling the navigation content itself beyond removing the controls from the display view

## Open questions
- Is edit mode one page-wide state, or one per section? "the Navigator sections" is plural and "a little pencil in the top right" is singular. — owner: Jonah
- Does leaving edit mode need an explicit save, or do changes apply as they are made? O8 asks only that they survive; it does not choose between the two. — owner: Jonah
- Is there a discard or cancel path out of edit mode, or is exiting always a commit? — owner: Jonah
- Should edit mode persist across page loads for a user who left it on, or does every load start display-only? — owner: Jonah

## Evidence
Jonah, 2026-08-28, verbatim:

> Today I feel like the Navigator sections are always in edit mode, which feels a
> little unpolished. I would like to hide a lot of the user decisioning and user
> interactivity, customizations, that kind of thing, behind an edit mode. Even if
> it's just a little pencil in the top right, when they click on that, then they
> would be able to see all of the options to resize columns and add more columns,
> move things around, that kind of thing. I think it should be display only when
> it's not in edit mode. This will also help clean up a lot of the visual clutter
> that's on the page when the user is just trying to navigate somewhere.
> Basically, as a user, I want my primary experience of the page to be serving the
> purpose of quick navigation and not the primary purpose to be allowing me to
> modify my navigation panel. Modifications should be the secondary purpose.
