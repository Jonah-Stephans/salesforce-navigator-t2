import { createElement } from "lwc";
import NavigatorItemPicker from "c/navigatorItemPicker";
import {
  trackModal,
  getOpenModals,
  configOf,
  resetModals
} from "lightning/modal";
import fs from "fs";
import path from "path";

/**
 * The tabs the picker is handed. Five here, 174 where the criterion's own
 * number is what is being tested — see the bulk fixture below.
 */
const AVAILABLE = [
  { id: "Account", label: "Accounts" },
  { id: "Contact", label: "Contacts" },
  { id: "standard-OurSite", label: "Our Site" },
  { id: "standard-ActionHub", label: "Action Plans" },
  { id: "standard-ShieldHome", label: "Shield" }
];

function bulkAvailable(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `Custom_Tab_${index}`,
    label: `Custom Tab ${index}`
  }));
}

/**
 * What the modal closed with, recorded the way the platform's `open()` would
 * record it. `trackModal` is the mock base's own registration step; calling it
 * here is what lets a directly-mounted picker be driven without a parent and
 * without going through `open()` at all — see the note in
 * `test/jest-mocks/lightning/modal.js`.
 */
let closed;

function createPicker(props = {}) {
  const element = createElement("c-navigator-item-picker", {
    is: NavigatorItemPicker
  });
  element.availableItems = AVAILABLE;
  element.sectionName = "Selling";
  Object.keys(props).forEach((key) => {
    element[key] = props[key];
  });

  closed = { called: false, result: "not closed" };
  trackModal(element, (value) => {
    closed.called = true;
    closed.result = value;
  });

  document.body.appendChild(element);
  return element;
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

/** The entries on offer, as a user reads them: buttons carrying a label. */
function entriesOf(element) {
  return Array.from(
    element.shadowRoot.querySelectorAll("button.rstk-nav-picker__item")
  );
}

function entryLabels(element) {
  return entriesOf(element).map((button) => button.textContent.trim());
}

function searchBoxOf(element) {
  return element.shadowRoot.querySelector("lightning-input");
}

function cancelOf(element) {
  return element.shadowRoot.querySelector(
    "lightning-button.rstk-nav-picker__cancel"
  );
}

async function typeSearch(element, term) {
  searchBoxOf(element).dispatchEvent(
    new CustomEvent("change", { detail: { value: term } })
  );
  await flush();
}

describe("c-navigator-item-picker", () => {
  afterEach(() => {
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
  });

  it("lists every item it was handed, under the label it was handed", async () => {
    const element = createPicker();
    await flush();

    expect(entryLabels(element)).toEqual([
      "Accounts",
      "Contacts",
      "Our Site",
      "Action Plans",
      "Shield"
    ]);
  });

  it("names the section it was opened from, so the user knows where an item will land", async () => {
    const element = createPicker({ sectionName: "Support" });
    await flush();

    // Read off the header's own `label` rather than out of `textContent`:
    // `lightning-modal-header` is a stubbed base component whose template is
    // empty, so nothing it is given renders in jsdom. What is asserted is
    // what this component hands it.
    expect(
      element.shadowRoot.querySelector("lightning-modal-header").label
    ).toBe("Add items to Support");
  });

  it("finds an item by part of its label, and hides the rest", async () => {
    const element = createPicker();
    await flush();

    await typeSearch(element, "cco");

    expect(entryLabels(element)).toEqual(["Accounts"]);
  });

  it("matches without regard to case", async () => {
    const element = createPicker();
    await flush();

    await typeSearch(element, "SHIELD");

    expect(entryLabels(element)).toEqual(["Shield"]);
  });

  it("narrows 174 items to one, which a scrolling list alone cannot do", async () => {
    // The criterion's own number — a bare scratch org returns 174 nav items,
    // and that is the reason it says a scrolling list fails. A five-item
    // fixture would pass a search box that did nothing, because the whole
    // list is on screen either way.
    const element = createPicker({ availableItems: bulkAvailable(174) });
    await flush();
    expect(entriesOf(element)).toHaveLength(174);

    await typeSearch(element, "Tab 137");

    expect(entryLabels(element)).toEqual(["Custom Tab 137"]);
  });

  it("says so rather than showing an empty list when nothing matches", async () => {
    const element = createPicker();
    await flush();

    await typeSearch(element, "zzzz");

    expect(entriesOf(element)).toHaveLength(0);
    expect(element.shadowRoot.textContent).toContain("zzzz");
  });

  describe("what the search tells a screen-reader user", () => {
    function liveRegionOf(element) {
      return element.shadowRoot.querySelector("[aria-live]");
    }

    function liveTextOf(element) {
      return liveRegionOf(element).textContent.trim();
    }

    it("carries a polite live region, so a narrowing list is not silent", async () => {
      // A sighted user watches 174 entries become one. Without a live region
      // a screen-reader user gets nothing from the one control the criterion
      // says makes 174 items usable, and has to tab into the list to find out
      // whether anything matched at all. Polite rather than assertive: this
      // is feedback on typing, not on a gesture just completed.
      const element = createPicker();
      await flush();

      const region = liveRegionOf(element);
      expect(region).not.toBeNull();
      expect(region.getAttribute("aria-live")).toBe("polite");
      // Atomic, or a reader may voice only the digit that changed.
      expect(region.getAttribute("aria-atomic")).toBe("true");
    });

    it("counts what the search found, and updates as the list narrows", async () => {
      const element = createPicker({ availableItems: bulkAvailable(174) });
      await flush();
      expect(liveTextOf(element)).toBe("174 items available.");

      await typeSearch(element, "Tab 13");

      expect(liveTextOf(element)).toBe("11 items match “Tab 13”.");

      await typeSearch(element, "Tab 137");

      expect(liveTextOf(element)).toBe("1 item matches “Tab 137”.");
    });

    it("puts the no-match sentence in the live region, not only on screen", async () => {
      const element = createPicker();
      await flush();

      await typeSearch(element, "zzzz");

      expect(liveTextOf(element)).toBe("No item matches “zzzz”.");
    });

    it("puts the nothing-left-to-add sentence there too", async () => {
      const element = createPicker({ availableItems: [] });
      await flush();

      expect(liveTextOf(element)).toBe(
        "Every tab you can reach is already in this layout."
      );
    });
  });

  it("puts every item back when the search box is emptied", async () => {
    const element = createPicker();
    await flush();
    await typeSearch(element, "cco");
    expect(entryLabels(element)).toEqual(["Accounts"]);

    await typeSearch(element, "");

    expect(entryLabels(element)).toHaveLength(5);
  });

  it("ignores the whitespace around what was typed", async () => {
    const element = createPicker();
    await flush();

    await typeSearch(element, "  Shield  ");

    expect(entryLabels(element)).toEqual(["Shield"]);
  });

  it("says there is nothing to add when every tab is already in the layout", async () => {
    const element = createPicker({ availableItems: [] });
    await flush();

    expect(entriesOf(element)).toHaveLength(0);
    expect(element.shadowRoot.textContent).toContain("already");
  });

  it("closes with the id of the item that was chosen", async () => {
    const element = createPicker();
    await flush();

    entriesOf(element)[2].click();
    await flush();

    expect(closed.called).toBe(true);
    expect(closed.result).toBe("standard-OurSite");
  });

  it("reports the item the user clicked, not the first one", async () => {
    // A picker that always reported entry 0 would pass every assertion that
    // only ever clicks entry 0 — slice 05's row 13, one level down.
    const element = createPicker();
    await flush();

    entriesOf(element)[4].click();
    await flush();

    expect(closed.result).toBe("standard-ShieldHome");
  });

  it("reports the item under the pointer after a search has renumbered the list", async () => {
    // Entry 0 of the *filtered* list is not entry 0 of the full one. A picker
    // that indexed into `availableItems` rather than reading the entry's own
    // id would add the wrong tab, and only a search-then-click can see it.
    const element = createPicker();
    await flush();
    await typeSearch(element, "Shield");

    entriesOf(element)[0].click();
    await flush();

    expect(closed.result).toBe("standard-ShieldHome");
  });

  it("closes with nothing when the user cancels", async () => {
    const element = createPicker();
    await flush();

    cancelOf(element).dispatchEvent(new CustomEvent("click"));
    await flush();

    expect(closed.called).toBe(true);
    expect(closed.result).toBeUndefined();
  });

  it("adds nothing when Escape closes it", async () => {
    // Escape is the *base* component's gesture, not this one's — see the note
    // in the modal mock about what that costs. What is pinned here is that
    // this picker neither handles Escape itself nor leaves a chosen id behind
    // when the base closes it.
    const element = createPicker();
    await flush();

    searchBoxOf(element).dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        composed: true
      })
    );
    await flush();

    expect(closed.called).toBe(true);
    expect(closed.result).toBeUndefined();
  });

  it("still adds nothing when Escape arrives after a search has been typed", async () => {
    const element = createPicker();
    await flush();
    await typeSearch(element, "Shield");

    searchBoxOf(element).dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        composed: true
      })
    );
    await flush();

    expect(closed.result).toBeUndefined();
  });

  it("makes every control a natively focusable element, so no gesture here needs a mouse", async () => {
    // Not a proxy for "a keyboard user can operate it" — it is the property
    // that makes that true without this component writing a single key
    // handler: a <button> is in the tab order and fires `click` on Enter and
    // Space for free, and `lightning-input` / `lightning-button` are base
    // components carrying their own keyboard behaviour. A div with a click
    // handler would pass every click-driven test above and be unreachable
    // from the keyboard, which is exactly the distinction this asserts.
    const element = createPicker();
    await flush();

    const entries = entriesOf(element);
    expect(entries).toHaveLength(5);
    entries.forEach((entry) => {
      expect(entry.tagName).toBe("BUTTON");
      expect(entry.type).toBe("button");
    });
    expect(searchBoxOf(element)).not.toBeNull();
    expect(cancelOf(element)).not.toBeNull();
  });

  it("gives each entry an accessible name that says what choosing it does", async () => {
    const element = createPicker({ sectionName: "Support" });
    await flush();

    expect(entriesOf(element)[0].getAttribute("aria-label")).toBe(
      "Add Accounts to Support"
    );
  });

  it("puts focus on the search box, so a keyboard user does not have to find it", async () => {
    const focused = [];
    const spy = jest
      .spyOn(HTMLElement.prototype, "focus")
      .mockImplementation(function focusSpy() {
        focused.push(this.tagName);
      });
    try {
      createPicker();
      await flush();

      expect(focused).toContain("LIGHTNING-INPUT");
    } finally {
      spy.mockRestore();
    }
  });

  it("takes its appearance from SLDS 2 semantic hooks in both colour modes", () => {
    // jsdom applies no CSS, so the stylesheet that ships is read rather than
    // rendered. What is pinned is that the picker's own rules exist and are
    // authored the one way that resolves per colour mode: `--slds-g-*`
    // semantic hooks in `var(--hook, fallback)` form, with no
    // `prefers-color-scheme`, no `--slds-c-*` and no `--lwc-*`.
    const css = fs.readFileSync(
      path.join(__dirname, "..", "navigatorItemPicker.css"),
      "utf8"
    );

    expect(css).toContain(".rstk-nav-picker__item");
    expect(css).toMatch(/var\(--slds-g-[a-z0-9-]+,\s*[^)]+\)/);
    expect(css).not.toContain("prefers-color-scheme");
    expect(css).not.toContain("--slds-c-");
    expect(css).not.toContain("--lwc-");
    // The 38 colour hooks with no `light-dark()` pass a "uses a hook" check
    // and then behave like a hard-coded colour in dark mode.
    expect(css).not.toMatch(/--slds-g-color-palette-/);
    expect(css).not.toMatch(/--slds-g-color-[a-z-]*base-(50|100)/);
  });

  describe("what open() actually hands the base component", () => {
    afterEach(() => {
      resetModals();
    });

    async function openPicker(config = {}) {
      NavigatorItemPicker.open({
        size: "small",
        label: "Add items to Selling",
        availableItems: AVAILABLE,
        sectionName: "Selling",
        ...config
      });
      await flush();
      return getOpenModals()[0];
    }

    function escape(element) {
      element.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          composed: true
        })
      );
    }

    it("carries the base's own config through, not only the @api properties", async () => {
      // `open()` used to apply every key with `element[key] = config[key]`,
      // which in LWC reaches the component only for `@api` properties.
      // `availableItems` and `sectionName` are `@api` and did reflect; `label`
      // — the dialog's accessible name in the real platform, and one
      // `handleSectionAddItems` does pass — landed as an unknown own-property
      // on the host and the component never saw it.
      const picker = await openPicker();

      expect(configOf(picker)).toEqual({
        size: "small",
        label: "Add items to Selling"
      });
      expect(picker.availableItems).toHaveLength(AVAILABLE.length);
    });

    it("honours disableClose, so Escape is not silently ignored under test", async () => {
      // Demonstrated rather than reasoned: this used to close anyway, which
      // means a future `disableClose` would work in the org and be ignored
      // here — the mock passing for the wrong reason.
      const picker = await openPicker({ disableClose: true });

      escape(picker);
      await flush();

      expect(getOpenModals()).toHaveLength(1);
      expect(picker.parentNode).not.toBeNull();
    });

    it("still closes on Escape when disableClose was not asked for", async () => {
      const picker = await openPicker();

      escape(picker);
      await flush();

      expect(getOpenModals()).toHaveLength(0);
    });
  });
});
