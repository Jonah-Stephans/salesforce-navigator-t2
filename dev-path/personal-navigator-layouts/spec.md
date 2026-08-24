---
type: feature
upstream: []
intent_accepted: true
---

# Salesforce Navigator — personal tab layouts

## Intent

The App Launcher's All Items list is the only place a user can see everything they can reach, and it
presents that access as one flat, alphabetised list under Salesforce's own labels — so a user who
works across a stable set of tabs pays a search-and-scan cost on every navigation and has no way to
express how they actually group their work. The Salesforce Navigator is a portable Lightning web
component, surfaced through its own tab that can be placed at the front of any app and droppable on
an App or Home page, which shows the same tabs the running user can see in the App Launcher —
scoped to that user's access and never wider — arranged into named sections the user controls. A
section is a card holding a chosen set of items at a chosen column count; items can be dragged
within and between sections, renamed to the user's own wording, and clicked to navigate straight to
the tab. A user keeps as many named layouts as they like and switches between them, and the whole
component reads as native platform UI in both light and dark mode.

## Outcomes

- The component renders only tabs the running user can see in the App Launcher's All Items list; a
  tab the user cannot access never appears, and the rendered set is never wider than that list.
- The component is reachable as its own tab that an administrator can place at the front of any app,
  and is available in the Lightning App Builder component palette for both App pages and the Home
  page.
- A user can create a named section and set its column count; the section renders its items in that
  number of columns.
- A user can drag an item to a new position within its section, and drag an item from one section
  into another; both placements survive a page reload and a new session.
- A user can rename an item to their own wording; the renamed label is displayed in place of the
  Salesforce label, and the item still navigates to the same tab.
- Clicking an item navigates the user to that tab.
- A user can save more than one named layout and switch which one is active; switching re-renders
  the sections, items, column counts and renames belonging to the selected layout.
- Every layout, section, item placement, column count and rename is stored against the individual
  user, and is neither visible to nor alterable by another user.
- All colour, spacing and typography come from SLDS 2 global styling hooks, with no hard-coded
  colour values, and the component renders correctly under the Cosmos theme in both light and dark
  mode.

## Out of scope

- An administrator-authored org-wide default layout that users start from, together with its admin
  surface, permission gating and publish lifecycle. That is a separate spec, reached by running
  `dev-path:initiate` again.
- Any mechanism that widens the visible tab set beyond the running user's own App Launcher access.
- Sharing, copying or transferring a layout between users.
- Changing the App Launcher itself, or changing the org's own tab labels — a rename is the user's own
  wording, local to their layout.
- Themes other than Cosmos, and any styling route that bypasses SLDS 2 global styling hooks.

## Open questions

- Where does a user's set of layouts persist, and does that store need to survive a package upgrade?
  — owner: engineer, at Design.
- Are layouts global to the user across every placement of the component, or scoped per app or per
  placement? The arriving text says a user switches between layouts, but not whether the tab
  placement and a Home-page placement share one active layout. — owner: engineer, at Design.
- What happens to an item already saved in a section when the user loses access to that tab, or the
  tab is deleted from the org? — owner: engineer, at Design.
- What does a user with no layout yet see on first open — an empty Navigator they populate, or every
  accessible item in one starting section? — owner: engineer, at Design. Note that the org-wide
  default layout, which is the natural answer, is explicitly the second spec and cannot be depended
  on here.

## Evidence

Engineer (jstephans@rootstock.com), typed at `dev-path:initiate`, 2026-08-24:

> "The App Launcher's All Items list is the only place a user can see everything they can reach, and
> it presents that access as one flat, alphabetised list under Salesforce's own labels. A user who
> works across a stable set of tabs pays a search-and-scan cost on every navigation and has no way
> to express how they actually group their work."

> "The Salesforce Navigator is a portable Lightning web component — surfaced through its own tab
> that can be placed at the front of any app, and droppable on an App or Home page — which shows
> the same tabs the running user can see in the App Launcher, scoped to that user's access and never
> wider, arranged into named sections the user controls."

> "A section is a card holding a chosen set of items at a chosen column count; items can be dragged
> within and between sections, renamed to the user's own wording, and clicked to navigate straight
> to the tab. A user keeps as many named layouts as they like and switches between them."

> "It is styled with SLDS 2 global styling hooks under the Cosmos theme so it reads as native
> platform UI in both light and dark mode."

> "This spec is the personal-layout Navigator. An administrator authoring an org-wide default layout
> that users start from is a separate design with its own admin surface, permission gating and
> publish lifecycle; it is a second spec, reached by running dev-path:initiate again. There is no
> upstream entry on this spec to carry across to it."
