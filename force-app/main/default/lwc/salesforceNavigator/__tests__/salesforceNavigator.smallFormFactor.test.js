import { createElement } from "lwc";
import SalesforceNavigator from "c/salesforceNavigator";
import { getNavItems } from "lightning/uiAppsApi";
import getLayouts from "@salesforce/apex/NavigatorLayoutController.getLayouts";
import createLayout from "@salesforce/apex/NavigatorLayoutController.createLayout";
import updateLayout from "@salesforce/apex/NavigatorLayoutController.updateLayout";
import activateLayout from "@salesforce/apex/NavigatorLayoutController.activateLayout";
import renameLayout from "@salesforce/apex/NavigatorLayoutController.renameLayout";
import deleteLayout from "@salesforce/apex/NavigatorLayoutController.deleteLayout";

// A file of its own, and the reason is mechanical rather than stylistic.
// `@salesforce/client/formFactor` is resolved once, at the moment this
// module's dependency chain is first required — `jest.mock` calls are hoisted
// to the top of the file that declares them, so a single test file cannot
// give some of its tests one form factor and the rest another without
// resetting the whole module registry (and, with it, every Apex and wire
// mock the rest of salesforceNavigator.test.js already depends on resolving
// to the *unmocked* fallback of "Large"). Mocking it here, and only here,
// keeps that file's assumption undisturbed and keeps this file's own
// assumption — every test in it sees FORM_FACTOR === "Small" — equally
// simple to state.
jest.mock("@salesforce/client/formFactor", () => ({ default: "Small" }), {
  virtual: true
});

// The same Apex seam salesforceNavigator.test.js registers, and for the same
// reason: without these, `@lwc/jest-transformer` substitutes a plain
// function returning `Promise.resolve()` that records nothing, and the
// component cannot even reach the point of rendering a canvas to assert on.
jest.mock(
  "@salesforce/apex/NavigatorLayoutController.getLayouts",
  () => ({ default: jest.fn() }),
  { virtual: true }
);
jest.mock(
  "@salesforce/apex/NavigatorLayoutController.createLayout",
  () => ({ default: jest.fn() }),
  { virtual: true }
);
jest.mock(
  "@salesforce/apex/NavigatorLayoutController.updateLayout",
  () => ({ default: jest.fn() }),
  { virtual: true }
);
jest.mock(
  "@salesforce/apex/NavigatorLayoutController.activateLayout",
  () => ({ default: jest.fn() }),
  { virtual: true }
);
jest.mock(
  "@salesforce/apex/NavigatorLayoutController.renameLayout",
  () => ({ default: jest.fn() }),
  { virtual: true }
);
jest.mock(
  "@salesforce/apex/NavigatorLayoutController.deleteLayout",
  () => ({ default: jest.fn() }),
  { virtual: true }
);

const ACCOUNT_ITEM = {
  developerName: "Account",
  label: "Accounts",
  pageReference: {
    type: "standard__objectPage",
    attributes: { objectApiName: "Account", actionName: "home" },
    state: {}
  }
};

const CONTACT_ITEM = {
  developerName: "Contact",
  label: "Contacts",
  pageReference: {
    type: "standard__objectPage",
    attributes: { objectApiName: "Contact", actionName: "home" },
    state: {}
  }
};

function createNavigator() {
  const element = createElement("c-salesforce-navigator", {
    is: SalesforceNavigator
  });
  document.body.appendChild(element);
  return element;
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("c-salesforce-navigator on the Small form factor", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    getLayouts.mockResolvedValue([]);
    createLayout.mockResolvedValue({
      layoutId: "a0X000000000002AAA",
      name: "My Navigator",
      isActive: true
    });
    updateLayout.mockResolvedValue({});
    activateLayout.mockResolvedValue([]);
    renameLayout.mockResolvedValue({});
    deleteLayout.mockResolvedValue([]);
  });

  afterEach(async () => {
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
    jest.runOnlyPendingTimers();
    await flush();
    await flush();
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it("puts rstk-nav-sections_small on the canvas, the class that collapses the six-track grid to a single full-width track", async () => {
    // Asserting `FORM_FACTOR === "Small"` on its own would only prove the
    // mock was set, not that the component did anything with it — the same
    // gap as a test that asserts what was sent rather than what happened.
    // This mounts the real component under the mocked form factor and reads
    // what it actually put in the DOM.
    const element = createNavigator();
    getNavItems.emit({ navItems: [ACCOUNT_ITEM, CONTACT_ITEM] });
    await flush();

    const canvas = element.shadowRoot.querySelector(".rstk-nav-sections");
    expect(canvas).not.toBeNull();
    expect(canvas.className).toContain("rstk-nav-sections");
    expect(canvas.className).toContain("rstk-nav-sections_small");
  });

  it("still computes the section's ordinary span class underneath the stand-down, unchanged from Medium and Large", async () => {
    // `resolveLayout`'s `spanClass` computation does not branch on form
    // factor anywhere — the CSS override in .rstk-nav-sections_small is what
    // neutralises it, not a JS condition that skips computing it. The seeded
    // layout's one section holds every reachable tab at DEFAULT_COLUMNS (3).
    const element = createNavigator();
    getNavItems.emit({ navItems: [ACCOUNT_ITEM, CONTACT_ITEM] });
    await flush();

    const canvas = element.shadowRoot.querySelector(".rstk-nav-sections");
    const directChildren = Array.from(canvas.children);
    expect(directChildren).toHaveLength(1);
    expect(directChildren[0].className).toContain("rstk-nav-section_span-3");
    // And only that one — a host carrying two of the mutually-exclusive
    // rstk-nav-section_span-1…-6 classes renders at whichever the stylesheet
    // happens to order last, and a toContain check alone stays green on it.
    // `.rstk-nav-sections_small`'s override rules are exactly the shape
    // `## Traps`' ninth entry names: a second rule overriding a section's
    // stored span rather than replacing the class that carries it. Same
    // shape as salesforceNavigator.test.js:762-765 and :882-885.
    const appliedSpans = directChildren[0].className
      .split(/\s+/)
      .filter((name) => /^rstk-nav-section_span-\d+$/.test(name));
    expect(appliedSpans).toEqual(["rstk-nav-section_span-3"]);
  });

  it("keeps rstk-nav-sections_small on the canvas at a wide viewport, because FORM_FACTOR alone decides", async () => {
    // The mirror of salesforceNavigator.test.js's narrow-viewport case: this
    // form factor is Small regardless of how wide the window is, so a
    // mechanism that reads `window.innerWidth` at all should never be able
    // to make a wide viewport turn the stand-down off. `window.innerWidth`
    // is writable in jsdom (default 1024); this sets it well past any
    // desktop viewport a zoom-related breakpoint would plausibly key off.
    const originalInnerWidth = window.innerWidth;
    window.innerWidth = 1920;
    try {
      const element = createNavigator();
      getNavItems.emit({ navItems: [ACCOUNT_ITEM, CONTACT_ITEM] });
      await flush();

      const canvas = element.shadowRoot.querySelector(".rstk-nav-sections");
      expect(canvas).not.toBeNull();
      expect(canvas.className).toContain("rstk-nav-sections_small");
    } finally {
      window.innerWidth = originalInnerWidth;
    }
  });
});
