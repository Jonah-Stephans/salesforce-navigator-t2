---
paths:
  - "**/lwc/**/*.css"
  - "**/lwc/**/*.html"
---

# Laying out child components across the shadow boundary

A parent component that arranges children is styling elements it does not own the insides of. Both
entries below cost a build each on the Navigator before they were written down.

- A grid or flex container places the `<c-*>` child hosts, never the elements inside their shadow roots, so `grid-column`, `grid-row` or `flex` written against a child's own markup applies to nothing https://github.com/Jonah-Stephans/salesforce-navigator-t2/pull/5
  The class binds on the `<c-child>` tag in the parent's template and the rule lives in the parent's
  stylesheet — or the rule becomes `:host` in the child. A class-name assertion and a stylesheet-text
  pin both stay green on the broken arrangement, because each is true on its own; assert the class on
  the grid container's own `children`, which is where it has to land to do anything.
- `overflow-x: auto` forces the computed `overflow-y` to `auto`, which makes the element a clipping context for every `lightning-button-menu` dropdown inside it https://github.com/Jonah-Stephans/salesforce-navigator-t2/pull/5
  `auto`/`visible` is not a valid pairing and `overflow-y: clip` is not an escape — it dodges the
  coercion but still clips descendants. `visible` is the one value that lets a dropdown out and the one
  value that cannot pair with a scrolling `overflow-x`. `menu-alignment="auto"` is the platform's whole
  answer and is worth setting, but it only re-aims the dropdown inside the box. Give the scroll
  container its own padding so card shadows are not cut at its edge.
