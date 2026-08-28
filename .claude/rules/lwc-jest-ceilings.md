---
paths:
  - "**/lwc/**/__tests__/**"
---

# What the LWC jest environment cannot prove

Read this before writing a test name that claims a browser behaviour. Each line below is a place a
green test does not mean what its name says.

- sfdx-lwc-jest stubs base components, so a `lightning-button-menu`'s own key handling is absent from the environment and no test here can assert it https://github.com/Jonah-Stephans/salesforce-navigator-t2/pull/1
- jsdom provides no `DragEvent` and no `DataTransfer`; a drag test dispatches synthetic events with a hand-attached `dataTransfer` and proves the handlers, never that a browser fires them on the markup https://github.com/Jonah-Stephans/salesforce-navigator-t2/pull/1
- jsdom applies no stylesheet, so asserting a rendered class name does not prove layout; when the layout itself is the claim, read the shipped CSS file and assert the declaration https://github.com/Jonah-Stephans/salesforce-navigator-t2/pull/1
- Prove persistence by remounting the component on the payload the write actually captured, not by asserting the in-memory model changed https://github.com/Jonah-Stephans/salesforce-navigator-t2/pull/1
- Watch a new test fail against the unfixed code before trusting it; a test written green pins nothing, and several here passed for the wrong reason until driven red first https://github.com/Jonah-Stephans/salesforce-navigator-t2/pull/1
- A theme-reactive styling hook can be verified against `@salesforce-ux/sds-metadata` rather than by eye, which catches a hook that carries no `light-dark()` and so freezes in dark mode https://github.com/Jonah-Stephans/salesforce-navigator-t2/pull/1
