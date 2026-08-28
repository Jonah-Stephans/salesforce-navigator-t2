---
paths:
  - "**/lwc/**/*.js"
  - "**/lwc/**/*.html"
---

# Navigation targets in LWC

Anything a user clicks in order to go somewhere needs this. A click handler that navigates looks
correct in every manual test, because the tester left-clicks.

- A navigation target must be a real `<a href>`; `NavigationMixin.Navigate` behind a click handler alone silently breaks middle-click and open-in-new-tab https://github.com/Jonah-Stephans/salesforce-navigator-t2/pull/1
- Populate the href from `NavigationMixin.GenerateUrl` and hold a placeholder until the promise settles, so the anchor is never hrefless mid-render https://github.com/Jonah-Stephans/salesforce-navigator-t2/pull/1
- Never call `preventDefault()` on a click carrying `metaKey`, `ctrlKey` or `shiftKey` — return early and let the browser serve the modified click https://github.com/Jonah-Stephans/salesforce-navigator-t2/pull/1
- When `GenerateUrl` rejects permanently, the element has no href and stops being focusable, so it needs an explicit tabindex, role and Enter handler for that path alone https://github.com/Jonah-Stephans/salesforce-navigator-t2/pull/1
- An anchor that is also a drag source must not navigate on drag; read drag state in the click handler rather than suppressing the anchor's default https://github.com/Jonah-Stephans/salesforce-navigator-t2/pull/1
