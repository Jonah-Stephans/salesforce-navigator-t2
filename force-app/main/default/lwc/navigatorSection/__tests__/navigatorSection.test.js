import { createElement } from "lwc";
import NavigatorSection from "c/navigatorSection";
import {
  resolveLayout,
  MIN_COLUMNS,
  MAX_COLUMNS
} from "c/navigatorLayoutModel";
import { readFileSync } from "fs";
import { join } from "path";

const TABS = [
  {
    id: "Account",
    label: "Accounts",
    pageReference: {
      type: "standard__objectPage",
      attributes: { objectApiName: "Account", actionName: "home" },
      state: {}
    }
  },
  {
    id: "Contact",
    label: "Contacts",
    pageReference: {
      type: "standard__objectPage",
      attributes: { objectApiName: "Contact", actionName: "home" },
      state: {}
    }
  }
];

// The section always receives a *resolved* section — the same object
// resolveLayout produces — rather than a stored one, so this builds it the
// way the running component does instead of hand-rolling a lookalike that
// could drift from the model.
function resolvedSection({ name = "Selling", columns = 3, itemIds } = {}) {
  const ids = itemIds || TABS.map((tab) => tab.id);
  return resolveLayout(
    {
      sections: [{ name, columns, items: ids.map((id) => ({ id })) }]
    },
    TABS
  )[0];
}

function createSection(section, { editing = false } = {}) {
  const element = createElement("c-navigator-section", {
    is: NavigatorSection
  });
  element.section = section || resolvedSection();
  element.editing = editing;
  document.body.appendChild(element);
  return element;
}

// A third tab, so a reorder has a genuine middle and two ends rather than a
// single swap that reads the same in either direction.
const TABS_3 = TABS.concat([
  {
    id: "standard-OurSite",
    label: "Our Site",
    pageReference: {
      type: "standard__cmsPage",
      attributes: { pageName: "our-site-home" },
      state: {}
    }
  }
]);

// A fourth tab, so that an item leaving from above a grabbed one leaves a real
// position on either side of the grab rather than a list short enough that a
// wrong index would clamp back onto the right item by luck.
const TABS_4 = TABS_3.concat([
  {
    id: "standard-ShieldHome",
    label: "Shield",
    pageReference: {
      type: "standard__navItemPage",
      attributes: { apiName: "standard-ShieldHome" },
      state: {}
    }
  }
]);

/**
 * A resolved section holding exactly `ids`, in that order. The parent hands a
 * freshly resolved section down on every render, so re-assigning `element.section`
 * is how a test says "the list this card is showing has changed underneath it" —
 * which is what a sibling leaving, or an item arriving from elsewhere, actually
 * looks like from in here.
 */
function sectionOf(tabs, ids) {
  return resolveLayout(
    {
      sections: [
        { name: "Selling", columns: 3, items: ids.map((id) => ({ id })) }
      ]
    },
    tabs
  )[0];
}

function createThree() {
  const section = resolveLayout(
    {
      sections: [
        {
          name: "Selling",
          columns: 3,
          items: TABS_3.map((tab) => ({ id: tab.id }))
        }
      ]
    },
    TABS_3
  )[0];
  return createSection(section);
}

function itemsOf(element) {
  return Array.from(element.shadowRoot.querySelectorAll("c-navigator-item"));
}

// The item re-emits every gesture as an explicit CustomEvent, so a test never
// has to fake a DragEvent to drive the section — which is just as well, since
// jsdom defines none.
function fire(item, name, detail) {
  item.dispatchEvent(new CustomEvent(name, { detail }));
}

function announcement(element) {
  const region = element.shadowRoot.querySelector("[aria-live]");
  return region ? region.textContent.trim() : "";
}

/**
 * What a screen reader would voice and a sighted user could see, which is the
 * announcement with every zero-width character taken out of it. The
 * distinguisher that makes a repeated announcement a *new* one is only
 * allowed to live in this gap: anything else would be read aloud on every
 * arrow press, or would show up on screen.
 */
function spoken(text) {
  return text.replace(/[\u200B-\u200D\u2060\uFEFF]/g, "");
}

function menuOf(element) {
  return element.shadowRoot.querySelector("lightning-button-menu");
}

function selectMenuItem(element, value) {
  menuOf(element).dispatchEvent(
    new CustomEvent("select", { detail: { value } })
  );
}

// Shared with the "adding and removing items" describe block below and with
// the edit-mode gate tests: both need to find the same hand-rolled button.
function addButtonOf(element) {
  return element.shadowRoot.querySelector(".rstk-nav-section__add");
}

describe("c-navigator-section", () => {
  afterEach(() => {
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
    jest.clearAllMocks();
  });

  it("renders the section's name in its header", () => {
    const element = createSection(resolvedSection({ name: "Daily work" }));

    expect(element.shadowRoot.querySelector("h2").textContent).toBe(
      "Daily work"
    );
  });

  it("renders one item per resolved item, under the label the model resolved", () => {
    const element = createSection();

    const items = element.shadowRoot.querySelectorAll("c-navigator-item");
    expect(items).toHaveLength(2);
    expect(items[0].label).toBe("Accounts");
    expect(items[0].pageReference).toEqual(TABS[0].pageReference);
    expect(items[1].label).toBe("Contacts");
  });

  it("says so when the section holds no items, rather than rendering an empty box", () => {
    const element = createSection(resolvedSection({ itemIds: [] }));

    expect(
      element.shadowRoot.querySelectorAll("c-navigator-item")
    ).toHaveLength(0);
    expect(
      element.shadowRoot.querySelector(".rstk-nav-section__empty")
    ).not.toBeNull();
  });

  it.each([1, 2, 3, 4, 5, 6])(
    "puts the cols-%i class on the grid so the items lay out in that many columns",
    (columns) => {
      const element = createSection(resolvedSection({ columns }));

      const grid = element.shadowRoot.querySelector("ul");
      expect(grid.className).toContain(`cols-${columns}`);
      // And only that one — a grid carrying two column classes would render
      // at whichever the stylesheet happened to order last.
      const applied = grid.className
        .split(/\s+/)
        .filter((name) => /^cols-\d+$/.test(name));
      expect(applied).toEqual([`cols-${columns}`]);
    }
  );

  it("defines a real CSS Grid template for every column count the menu offers", () => {
    // The assertion above proves the class is computed; jsdom applies no
    // stylesheet, so it cannot prove the class means anything. This reads the
    // stylesheet that ships and pins that each of the six is a grid of that
    // many equal tracks — which is the half of "renders in that many columns"
    // that a class-name assertion silently skips. `grid-template-columns` is
    // deliberately not an inline style: the SLDS linter validates `width` and
    // would flag one, and does not validate `grid-template-columns`.
    const css = readFileSync(
      join(__dirname, "..", "navigatorSection.css"),
      "utf8"
    );

    for (let columns = MIN_COLUMNS; columns <= MAX_COLUMNS; columns += 1) {
      expect(css).toMatch(
        new RegExp(
          `\\.cols-${columns}\\s*\\{[^}]*grid-template-columns:\\s*repeat\\(\\s*${columns}\\s*,\\s*minmax\\(\\s*0\\s*,\\s*1fr\\s*\\)\\s*\\)`
        )
      );
    }
    expect(css).toContain("display: grid");
  });

  // No span-N test lives here. The span class is bound on the
  // `<c-navigator-section>` host in salesforceNavigator.html, one level
  // outside this component's own shadow root, and the `.rstk-nav-section_span-N`
  // rules that give it a `grid-column` live beside the canvas grid in
  // salesforceNavigator.css — not in this component or this stylesheet. A
  // class-name assertion on the `<article>` here, or a stylesheet pin against
  // navigatorSection.css, would stay green whether or not the class reaches
  // the grid at all; see `salesforceNavigator.test.js`'s "sections canvas"
  // tests for the ones that can actually fail on that.

  it("offers exactly one column choice per supported count, and no others", () => {
    const element = createSection(undefined, { editing: true });

    const values = Array.from(
      element.shadowRoot.querySelectorAll("lightning-menu-item")
    )
      .map((item) => item.value)
      .filter((value) => value.startsWith("columns-"));

    expect(values).toEqual([
      "columns-1",
      "columns-2",
      "columns-3",
      "columns-4",
      "columns-5",
      "columns-6"
    ]);
  });

  it("asks its parent to set the column count when a column choice is made", () => {
    const element = createSection(resolvedSection({ columns: 2 }), {
      editing: true
    });
    const handler = jest.fn();
    element.addEventListener("sectioncolumns", handler);

    selectMenuItem(element, "columns-5");

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].detail).toEqual({ index: 0, columns: 5 });
  });

  it("asks its parent to delete the section it was given, by index", () => {
    const twoSections = resolveLayout(
      {
        sections: [
          { name: "First", columns: 1, items: [] },
          { name: "Second", columns: 1, items: [] }
        ]
      },
      TABS
    );
    const element = createSection(twoSections[1], { editing: true });
    const handler = jest.fn();
    element.addEventListener("sectiondelete", handler);

    selectMenuItem(element, "delete");

    expect(handler).toHaveBeenCalledTimes(1);
    // The second section's index, not a hard-coded 0 — a component that
    // always reported 0 would delete the wrong card.
    expect(handler.mock.calls[0][0].detail).toEqual({ index: 1 });
  });

  it("renames the section on commit, carrying the typed name", async () => {
    const element = createSection(undefined, { editing: true });
    const handler = jest.fn();
    element.addEventListener("sectionrename", handler);

    selectMenuItem(element, "rename");
    await Promise.resolve();

    const input = element.shadowRoot.querySelector("lightning-input");
    expect(input).not.toBeNull();
    expect(input.value).toBe("Selling");

    input.dispatchEvent(
      new CustomEvent("change", { detail: { value: "Renamed" } })
    );
    input.dispatchEvent(new CustomEvent("commit"));

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].detail).toEqual({
      index: 0,
      name: "Renamed"
    });
  });

  it("does not fire a rename while the user is still typing", async () => {
    // Every change dispatched upstream would be a rename per keystroke. The
    // autosave would coalesce the writes, but the section header would
    // re-render on every character and the caret would jump.
    const element = createSection(undefined, { editing: true });
    const handler = jest.fn();
    element.addEventListener("sectionrename", handler);

    selectMenuItem(element, "rename");
    await Promise.resolve();

    const input = element.shadowRoot.querySelector("lightning-input");
    input.dispatchEvent(new CustomEvent("change", { detail: { value: "R" } }));
    input.dispatchEvent(new CustomEvent("change", { detail: { value: "Re" } }));

    expect(handler).not.toHaveBeenCalled();
  });

  it("keeps the name it had when a rename is abandoned with Escape", async () => {
    const element = createSection(undefined, { editing: true });
    const handler = jest.fn();
    element.addEventListener("sectionrename", handler);

    selectMenuItem(element, "rename");
    await Promise.resolve();

    const input = element.shadowRoot.querySelector("lightning-input");
    input.dispatchEvent(
      new CustomEvent("change", { detail: { value: "Nope" } })
    );
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
    );
    await Promise.resolve();

    expect(handler).not.toHaveBeenCalled();
    expect(element.shadowRoot.querySelector("lightning-input")).toBeNull();
    expect(element.shadowRoot.querySelector("h2").textContent).toBe("Selling");
  });

  describe("the edit-mode gate on this card's header controls", () => {
    // `## Design`'s "Controls are absent from the DOM, not hidden": jsdom
    // applies no stylesheet, so "renders no customisation control" is
    // provable only as absence from the DOM, never as a hidden-but-present
    // element — the same reasoning `isRenaming` already demonstrates for the
    // rename anchor.
    it("renders no Add items button and no overflow menu out of edit mode", () => {
      const element = createSection(undefined, { editing: false });

      expect(addButtonOf(element)).toBeNull();
      expect(menuOf(element)).toBeNull();
    });

    it("renders the Add items button and the full overflow menu — rename, every column count and delete — in edit mode", () => {
      const element = createSection(undefined, { editing: true });

      expect(addButtonOf(element)).not.toBeNull();
      const values = Array.from(
        element.shadowRoot.querySelectorAll("lightning-menu-item")
      ).map((item) => item.value);
      expect(values).toEqual([
        "rename",
        "columns-1",
        "columns-2",
        "columns-3",
        "columns-4",
        "columns-5",
        "columns-6",
        "delete"
      ]);
    });

    it("removes an already-rendered Add items button and overflow menu the moment edit mode ends", async () => {
      // Mounted once, then flipped — not two separate mounts — so this proves
      // the *transition* removes the controls, which a fresh mount at
      // `editing: false` cannot distinguish from "never rendered them".
      const element = createSection(undefined, { editing: true });
      expect(addButtonOf(element)).not.toBeNull();
      expect(menuOf(element)).not.toBeNull();

      element.editing = false;
      await Promise.resolve();

      expect(addButtonOf(element)).toBeNull();
      expect(menuOf(element)).toBeNull();
    });

    it("cancels an in-progress rename when edit mode ends, so no rename input is left showing with no menu to close it", async () => {
      // The overflow menu is the only route into `isRenaming`. Once it is
      // gone, nothing else on this card would ever put the heading back — so
      // the flag that hides the menu has to close the rename along with it.
      const element = createSection(undefined, { editing: true });
      selectMenuItem(element, "rename");
      await Promise.resolve();
      expect(
        element.shadowRoot.querySelector("lightning-input")
      ).not.toBeNull();

      element.editing = false;
      await Promise.resolve();

      expect(element.shadowRoot.querySelector("lightning-input")).toBeNull();
      expect(element.shadowRoot.querySelector("h2").textContent).toBe(
        "Selling"
      );
    });
  });

  describe("reordering its items", () => {
    it("tells each item its own position in the list", () => {
      const element = createThree();

      expect(itemsOf(element).map((item) => item.index)).toEqual([0, 1, 2]);
    });

    it("asks its parent to move the dragged item to the item it was dropped on", () => {
      const element = createThree();
      const handler = jest.fn();
      element.addEventListener("itemmove", handler);
      const items = itemsOf(element);

      fire(items[0], "itemdragstart", { index: 0 });
      fire(items[2], "itemdragover", { index: 2 });
      fire(items[2], "itemdrop", { index: 2 });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].detail).toEqual({
        sectionIndex: 0,
        from: 0,
        to: 2
      });
    });

    it("keeps the source index in JS rather than reading it back off dataTransfer", () => {
      // dataTransfer.getData() returns "" during dragover in every browser by
      // the HTML spec's protected mode. A section that recovered the source
      // from the drop event would work in no browser at all; this one is
      // handed the source on dragstart and remembers it.
      const element = createThree();
      const handler = jest.fn();
      element.addEventListener("itemmove", handler);
      const items = itemsOf(element);

      // A drop with no preceding dragstart has no source, and must not
      // invent one.
      fire(items[1], "itemdrop", { index: 1 });
      expect(handler).not.toHaveBeenCalled();

      fire(items[2], "itemdragstart", { index: 2 });
      fire(items[0], "itemdrop", { index: 0 });
      expect(handler.mock.calls[0][0].detail).toEqual({
        sectionIndex: 0,
        from: 2,
        to: 0
      });
    });

    it("does not ask for a move when an item is dropped back on itself", () => {
      const element = createThree();
      const handler = jest.fn();
      element.addEventListener("itemmove", handler);
      const items = itemsOf(element);

      fire(items[1], "itemdragstart", { index: 1 });
      fire(items[1], "itemdrop", { index: 1 });

      expect(handler).not.toHaveBeenCalled();
    });

    it("forgets the drag when it ends without a drop, so the next drop invents nothing", () => {
      const element = createThree();
      const handler = jest.fn();
      element.addEventListener("itemmove", handler);
      const items = itemsOf(element);

      fire(items[0], "itemdragstart", { index: 0 });
      fire(items[0], "itemdragend", { index: 0 });
      fire(items[2], "itemdrop", { index: 2 });

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe("reordering its items from the keyboard", () => {
    it("marks only the grabbed item as grabbed", async () => {
      const element = createThree();

      fire(itemsOf(element)[1], "itemgrab", { index: 1 });
      await Promise.resolve();

      expect(itemsOf(element).map((item) => item.grabbed)).toEqual([
        false,
        true,
        false
      ]);
    });

    it("announces the grab assertively, naming the item and its position", async () => {
      const element = createThree();

      fire(itemsOf(element)[1], "itemgrab", { index: 1 });
      await Promise.resolve();

      const region = element.shadowRoot.querySelector("[aria-live]");
      expect(region.getAttribute("aria-live")).toBe("assertive");
      // Atomic, or a screen reader may read only the part of the sentence
      // that changed — "Position 2 of 3" with no idea what moved.
      expect(region.getAttribute("aria-atomic")).toBe("true");
      expect(announcement(element)).toContain("Contacts");
      expect(announcement(element)).toContain("grabbed");
      expect(announcement(element)).toMatch(/position 2 of 3/i);
    });

    it("asks its parent for the move an arrow key means, and announces the new position", async () => {
      const element = createThree();
      const handler = jest.fn();
      element.addEventListener("itemmove", handler);

      fire(itemsOf(element)[0], "itemgrab", { index: 0 });
      fire(itemsOf(element)[0], "itemkeymove", { index: 0, delta: 1 });
      await Promise.resolve();

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].detail).toEqual({
        sectionIndex: 0,
        from: 0,
        to: 1
      });
      expect(announcement(element)).toContain("Accounts");
      expect(announcement(element)).toMatch(/position 2 of 3/i);
    });

    it("stays inside the list at either end rather than losing the item", async () => {
      const element = createThree();
      const handler = jest.fn();
      element.addEventListener("itemmove", handler);

      fire(itemsOf(element)[0], "itemgrab", { index: 0 });
      fire(itemsOf(element)[0], "itemkeymove", { index: 0, delta: -1 });
      await Promise.resolve();

      // Announced at the position it is still at — not silence, which would
      // leave a screen reader user unsure whether the key registered.
      expect(announcement(element)).toMatch(/position 1 of 3/i);
      expect(handler).not.toHaveBeenCalled();
    });

    it("re-announces a repeated arrow press rather than writing nothing the second time", async () => {
      // A screen reader reads a live region when its content changes, and LWC
      // writes nothing to the DOM for an unchanged string. Two identical
      // presses at the same end of the list produce the same sentence, so
      // without something to distinguish them the second press is silent —
      // which is exactly the case "announced even when nothing moved" exists
      // to serve. An item walked to position 3, back, and to 3 again is the
      // ordinary case, not an exotic one.
      const element = createThree();

      fire(itemsOf(element)[0], "itemgrab", { index: 0 });
      await Promise.resolve();
      fire(itemsOf(element)[0], "itemkeymove", { index: 0, delta: -1 });
      await Promise.resolve();

      const region = element.shadowRoot.querySelector("[aria-live]");
      const first = region.textContent;
      expect(first).toMatch(/position 1 of 3/i);

      fire(itemsOf(element)[0], "itemkeymove", { index: 0, delta: -1 });
      await Promise.resolve();

      expect(region.textContent).toMatch(/position 1 of 3/i);
      expect(region.textContent).not.toBe(first);
      // And the distinguisher is silent and invisible. The two announcements
      // are the *same sentence* once the zero-width characters are taken out:
      // anything else — a counter, a space, a bullet — would be read aloud on
      // every arrow press or would appear on screen, which is the entire
      // justification for choosing U+200B in the first place.
      expect(spoken(region.textContent)).toBe(spoken(first));
    });

    it("refuses a second grab while one is in flight, so the first Escape origin survives", async () => {
      // Reachable with a mouse: `navigatorItem.handleClick` blocks navigation
      // mid-grab but not focus, so a click on another item can put focus
      // there and Space arrives here. Taking the second grab would overwrite
      // the first item's origin, and its cancel would then move the wrong
      // thing to the wrong place.
      const element = createThree();
      const handler = jest.fn();
      element.addEventListener("itemmove", handler);

      fire(itemsOf(element)[0], "itemgrab", { index: 0 });
      fire(itemsOf(element)[0], "itemkeymove", { index: 0, delta: 1 });
      await Promise.resolve();

      fire(itemsOf(element)[2], "itemgrab", { index: 2 });
      await Promise.resolve();

      expect(itemsOf(element).map((item) => item.grabbed)).toEqual([
        false,
        true,
        false
      ]);

      fire(itemsOf(element)[1], "itemkeycancel", { index: 1 });

      expect(handler).toHaveBeenCalledTimes(2);
      expect(handler.mock.calls[1][0].detail).toEqual({
        sectionIndex: 0,
        from: 1,
        to: 0
      });
    });

    it("announces the drop, at the position the item ended at", async () => {
      const element = createThree();

      fire(itemsOf(element)[2], "itemgrab", { index: 2 });
      fire(itemsOf(element)[2], "itemkeydrop", { index: 2 });
      await Promise.resolve();

      expect(announcement(element)).toContain("dropped");
      expect(announcement(element)).toMatch(/position 3 of 3/i);
      expect(itemsOf(element).map((item) => item.grabbed)).toEqual([
        false,
        false,
        false
      ]);
    });

    it("puts the item back where it started on Escape, rather than committing the move", async () => {
      // The whole point of cancel. Each arrow press has already been applied
      // to the layout, so cancelling is a move back to the origin — through
      // the same `itemmove` the arrows use, and therefore the same maths.
      const element = createThree();
      const handler = jest.fn();
      element.addEventListener("itemmove", handler);

      fire(itemsOf(element)[0], "itemgrab", { index: 0 });
      fire(itemsOf(element)[0], "itemkeymove", { index: 0, delta: 1 });
      fire(itemsOf(element)[1], "itemkeymove", { index: 1, delta: 1 });
      fire(itemsOf(element)[2], "itemkeycancel", { index: 2 });
      await Promise.resolve();

      expect(handler).toHaveBeenCalledTimes(3);
      expect(handler.mock.calls[2][0].detail).toEqual({
        sectionIndex: 0,
        from: 2,
        to: 0
      });
      expect(announcement(element)).toContain("cancelled");
      expect(announcement(element)).toMatch(/position 1 of 3/i);
      expect(itemsOf(element).map((item) => item.grabbed)).toEqual([
        false,
        false,
        false
      ]);
    });

    /**
     * A grab is held on an *item*, and `grabbedItemIndex` is only a position in
     * a list that renumbers for reasons that have nothing to do with this drag.
     * A sibling can leave the section from its own Move to… menu mid-grab —
     * `navigatorItem.handleClick` blocks navigation, not focus, and the menu
     * button is a sibling of the anchor, so nothing stands in the way of it —
     * and an item can arrive from another section above the one being held.
     */
    it("keeps a keyboard grab on the item it was placed on when a sibling leaves", async () => {
      const ids = TABS_4.map((tab) => tab.id);
      const element = createSection(sectionOf(TABS_4, ids));

      // The third of four.
      fire(itemsOf(element)[2], "itemgrab", { index: 2 });
      await Promise.resolve();
      expect(itemsOf(element)[2].label).toBe("Our Site");

      // The *first* item leaves, and the list renumbers underneath the grab.
      fire(itemsOf(element)[0], "itemmoveto", { index: 0, toSection: 1 });
      element.section = sectionOf(TABS_4, ids.slice(1));
      await Promise.resolve();

      // Still holding what the user picked up — not the item that has slid into
      // position 2, and not nothing.
      expect(
        itemsOf(element)
          .filter((item) => item.grabbed)
          .map((item) => item.label)
      ).toEqual(["Our Site"]);
      expect(spoken(announcement(element))).not.toContain("cancelled");
    });

    it("does not report a grab cancelled when it is a sibling that left", async () => {
      // The falsely alarming half. With the grab on the *last* item, a sibling
      // leaving pushes a stale index past the end of the list, and an index that
      // is out of range is indistinguishable from an item that is gone — so the
      // card announces the move cancelled, assertively, about an item the user
      // is still holding and can still see.
      const ids = TABS_3.map((tab) => tab.id);
      const element = createSection(sectionOf(TABS_3, ids));

      fire(itemsOf(element)[2], "itemgrab", { index: 2 });
      await Promise.resolve();

      fire(itemsOf(element)[0], "itemmoveto", { index: 0, toSection: 1 });
      element.section = sectionOf(TABS_3, ids.slice(1));
      // Twice: a sentence written during a render only reaches the live region
      // on the render after it, so one flush would let a false announcement
      // through unseen.
      await Promise.resolve();
      await Promise.resolve();

      expect(spoken(announcement(element))).toBe(
        "Our Site grabbed. Position 3 of 3."
      );
      expect(itemsOf(element).map((item) => item.grabbed)).toEqual([
        false,
        true
      ]);
    });

    it("still returns a walked item to where it was picked up after a sibling leaves", async () => {
      // The origin renumbers with everything else. Escape means "back to the
      // slot it was picked up from", and a slot recorded before a sibling left
      // names a different one afterwards — so the cancel would put the item
      // somewhere it has never been.
      const ids = TABS_4.map((tab) => tab.id);
      const element = createSection(sectionOf(TABS_4, ids));
      const handler = jest.fn();
      element.addEventListener("itemmove", handler);

      // Grab "Our Site", third of four, and walk it one to the left.
      fire(itemsOf(element)[2], "itemgrab", { index: 2 });
      fire(itemsOf(element)[2], "itemkeymove", { index: 2, delta: -1 });
      element.section = sectionOf(TABS_4, [
        "Account",
        "standard-OurSite",
        "Contact",
        "standard-ShieldHome"
      ]);
      await Promise.resolve();

      // "Accounts", above it, leaves the section.
      fire(itemsOf(element)[0], "itemmoveto", { index: 0, toSection: 1 });
      element.section = sectionOf(TABS_4, [
        "standard-OurSite",
        "Contact",
        "standard-ShieldHome"
      ]);
      await Promise.resolve();

      fire(itemsOf(element)[0], "itemkeycancel", { index: 0 });
      await Promise.resolve();

      // Back behind "Contacts", which is where it started relative to the items
      // that are still here — not position 2, which is where it started
      // relative to a list that no longer exists.
      expect(
        handler.mock.calls[handler.mock.calls.length - 1][0].detail
      ).toEqual({ sectionIndex: 0, from: 0, to: 1 });
      expect(spoken(announcement(element))).toMatch(/position 2 of 3/i);
    });

    it("keeps a keyboard grab on its own item when another arrives above it", async () => {
      // The mirror of the same problem in the *destination* of a cross-section
      // move: an item dropped in above the grabbed one renumbers the list just
      // as a departure does.
      const element = createThree();

      fire(itemsOf(element)[1], "itemgrab", { index: 1 });
      await Promise.resolve();
      expect(itemsOf(element)[1].label).toBe("Contacts");

      element.section = sectionOf(
        TABS_4,
        ["standard-ShieldHome"].concat(TABS_3.map((tab) => tab.id))
      );
      await Promise.resolve();

      expect(
        itemsOf(element)
          .filter((item) => item.grabbed)
          .map((item) => item.label)
      ).toEqual(["Contacts"]);
    });

    it("uses neither aria-grabbed nor aria-dropeffect while an item is grabbed", async () => {
      const element = createThree();

      fire(itemsOf(element)[1], "itemgrab", { index: 1 });
      await Promise.resolve();

      const attributes = Array.from(
        element.shadowRoot.querySelectorAll("*")
      ).flatMap((node) => Array.from(node.attributes).map((at) => at.name));

      expect(attributes).not.toContain("aria-grabbed");
      expect(attributes).not.toContain("aria-dropeffect");
      expect(attributes).toContain("aria-live");
    });
  });

  describe("as a draggable card of its own", () => {
    function cardOf(element) {
      return element.shadowRoot.querySelector("article");
    }

    it("makes the section card itself draggable and focusable", () => {
      const card = cardOf(createSection());

      expect(card.draggable).toBe(true);
      expect(card.getAttribute("tabindex")).toBe("0");
    });

    it("tells its parent when its own card is picked up and dropped on", () => {
      const element = createSection();
      const start = jest.fn();
      const drop = jest.fn();
      element.addEventListener("sectiondragstart", start);
      element.addEventListener("sectiondrop", drop);

      cardOf(element).dispatchEvent(
        new CustomEvent("dragstart", { bubbles: true, cancelable: true })
      );
      const over = new CustomEvent("dragover", {
        bubbles: true,
        cancelable: true
      });
      cardOf(element).dispatchEvent(over);
      cardOf(element).dispatchEvent(
        new CustomEvent("drop", { bubbles: true, cancelable: true })
      );

      expect(start.mock.calls[0][0].detail).toEqual({ index: 0 });
      expect(over.defaultPrevented).toBe(true);
      expect(drop.mock.calls[0][0].detail).toEqual({ index: 0 });
    });

    it("grabs, moves, drops and cancels its own card from the keyboard", () => {
      const element = createSection();
      const grab = jest.fn();
      const move = jest.fn();
      const drop = jest.fn();
      const cancel = jest.fn();
      element.addEventListener("sectiongrab", grab);
      element.addEventListener("sectionkeymove", move);
      element.addEventListener("sectionkeydrop", drop);
      element.addEventListener("sectionkeycancel", cancel);
      const card = cardOf(element);

      card.dispatchEvent(
        new KeyboardEvent("keydown", { key: " ", cancelable: true })
      );
      expect(grab.mock.calls[0][0].detail).toEqual({ index: 0 });

      element.grabbed = true;

      card.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", cancelable: true })
      );
      expect(move.mock.calls[0][0].detail).toEqual({ index: 0, delta: 1 });

      const tab = new KeyboardEvent("keydown", {
        key: "Tab",
        cancelable: true
      });
      card.dispatchEvent(tab);
      expect(tab.defaultPrevented).toBe(true);

      card.dispatchEvent(
        new KeyboardEvent("keydown", { key: " ", cancelable: true })
      );
      expect(drop.mock.calls[0][0].detail).toEqual({ index: 0 });

      card.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", cancelable: true })
      );
      expect(cancel.mock.calls[0][0].detail).toEqual({ index: 0 });
    });

    it("does not read a key pressed on one of its items as a gesture on the card", () => {
      // Keydown bubbles. Without this guard, Space on an item would grab
      // both the item and the whole section.
      const element = createSection();
      const grab = jest.fn();
      element.addEventListener("sectiongrab", grab);

      element.shadowRoot.querySelector("c-navigator-item").dispatchEvent(
        new KeyboardEvent("keydown", {
          key: " ",
          bubbles: true,
          cancelable: true
        })
      );

      expect(grab).not.toHaveBeenCalled();
    });

    it("looks grabbed while the card is grabbed, and only then", async () => {
      const element = createSection();

      expect(cardOf(element).classList.contains("rstk-nav-section")).toBe(true);
      expect(
        cardOf(element).classList.contains("rstk-nav-section_grabbed")
      ).toBe(false);

      element.grabbed = true;
      await Promise.resolve();

      expect(cardOf(element).classList.contains("rstk-nav-section")).toBe(true);
      expect(
        cardOf(element).classList.contains("rstk-nav-section_grabbed")
      ).toBe(true);

      element.grabbed = false;
      await Promise.resolve();

      expect(
        cardOf(element).classList.contains("rstk-nav-section_grabbed")
      ).toBe(false);
    });

    it("gives the grabbed card a real appearance that works in both colour modes", () => {
      const css = readFileSync(
        join(__dirname, "..", "navigatorSection.css"),
        "utf8"
      );
      const rule = css.match(/\.rstk-nav-section_grabbed\s*\{[^}]*\}/);

      expect(rule).not.toBeNull();
      expect(rule[0]).toContain("--slds-g-shadow-outline-focus-1");
      expect(rule[0]).toContain("--slds-g-color-surface-container-2");
      expect(rule[0]).not.toMatch(/prefers-color-scheme|--slds-c-|--lwc-/);
    });

    it("carries its section's name, so it is not announced as nothing", () => {
      // The card is draggable and reachable by Tab. Without a name it is an
      // interactive element a screen reader announces as nothing at all.
      const card = cardOf(createSection());

      expect(card.getAttribute("aria-label")).toBe("Selling");
    });

    it("follows the section's name through a rename", async () => {
      // The name has to be read from the section on every render rather than
      // captured once, or the card keeps announcing the old name for the rest
      // of the session.
      const element = createSection();
      expect(cardOf(element).getAttribute("aria-label")).toBe("Selling");

      element.section = resolvedSection({ name: "Buying" });
      await Promise.resolve();

      expect(cardOf(element).getAttribute("aria-label")).toBe("Buying");
    });

    it("still names a card whose section name is empty", () => {
      // An all-whitespace name is refused at the rename, but a stored layout
      // can still arrive carrying one, and a nameless card is the very bug
      // the label exists to fix.
      const card = cardOf(createSection(resolvedSection({ name: "   " })));

      expect(card.getAttribute("aria-label")).toBe("Unnamed section");
    });

    it("attaches its own drag instruction text only while the card is grabbed", async () => {
      const element = createSection();
      const card = cardOf(element);

      expect(card.hasAttribute("aria-describedby")).toBe(false);
      expect(
        element.shadowRoot.querySelector(".rstk-nav-section__instructions")
      ).toBeNull();

      element.grabbed = true;
      await Promise.resolve();

      const instructions = element.shadowRoot.querySelector(
        ".rstk-nav-section__instructions"
      );
      expect(instructions).not.toBeNull();
      expect(cardOf(element).getAttribute("aria-describedby")).toBe(
        instructions.getAttribute("id")
      );

      element.grabbed = false;
      await Promise.resolve();

      expect(cardOf(element).hasAttribute("aria-describedby")).toBe(false);
    });
  });

  describe("moving an item into another section", () => {
    function cardOf(element) {
      return element.shadowRoot.querySelector("article");
    }

    it("hands each item the destinations the parent worked out", () => {
      // A section knows nothing of its siblings, so the list of other sections
      // arrives with the resolved section and is passed straight through.
      const targets = [{ value: "1", label: "Support" }];
      const element = createSection({
        ...resolvedSection(),
        moveTargets: targets
      });

      itemsOf(element).forEach((item) => {
        expect(item.moveTargets).toEqual(targets);
      });
    });

    it("forwards a chosen destination upward with its own section index", () => {
      // Deliberately not the section at index 0. A card that reported a
      // constant would be indistinguishable from one that reports itself
      // anywhere else in this file, because every other fixture here is a
      // single section and so is always index 0.
      const second = resolveLayout(
        {
          sections: [
            { name: "First", columns: 3, items: [{ id: "Account" }] },
            {
              name: "Second",
              columns: 3,
              items: [{ id: "Account" }, { id: "Contact" }]
            }
          ]
        },
        TABS
      )[1];
      const element = createSection(second);
      const handler = jest.fn();
      element.addEventListener("itemmoveto", handler);

      fire(itemsOf(element)[1], "itemmoveto", { index: 1, toSection: 0 });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].detail).toEqual({
        fromSection: 1,
        fromIndex: 1,
        toSection: 0
      });
    });

    it("forwards an item rename upward with its own section index", () => {
      // The same shape as the destination test above, and here for the same
      // reason: not the section at index 0, because a card that reported a
      // constant would rename an item in the wrong section and no
      // single-section fixture could tell.
      const second = resolveLayout(
        {
          sections: [
            { name: "First", columns: 3, items: [{ id: "Account" }] },
            {
              name: "Second",
              columns: 3,
              items: [{ id: "Account" }, { id: "Contact" }]
            }
          ]
        },
        TABS
      )[1];
      const element = createSection(second);
      const handler = jest.fn();
      element.addEventListener("itemrename", handler);

      fire(itemsOf(element)[1], "itemrename", { index: 1, rename: "People" });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].detail).toEqual({
        sectionIndex: 1,
        index: 1,
        rename: "People"
      });
    });

    it("forwards a cleared rename as readily as a set one", () => {
      // The empty string is the whole of "put this back under its Salesforce
      // label", so a section that treated it as nothing to report would make
      // clearing a rename impossible.
      const element = createSection();
      const handler = jest.fn();
      element.addEventListener("itemrename", handler);

      fire(itemsOf(element)[0], "itemrename", { index: 0, rename: "" });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].detail).toEqual({
        sectionIndex: 0,
        index: 0,
        rename: ""
      });
    });

    it("names the position an item was dropped at when it forwards a foreign drop", () => {
      // A drop from another section has no `dragFromIndex` here, so it is
      // forwarded to the parent — and it has to carry *where* in this section
      // it landed, or a cross-section drag could only ever append.
      const element = createSection();
      const handler = jest.fn();
      element.addEventListener("sectiondrop", handler);

      fire(itemsOf(element)[1], "itemdrop", { index: 1 });

      expect(handler.mock.calls[0][0].detail).toEqual({
        index: 0,
        itemIndex: 1
      });
    });

    it("looks like a drop target while an item is dragged over it, and only then", async () => {
      // Criterion 5. Two facts have to be true at once: an item drag is in
      // flight — which only the parent can know, since it is the only thing
      // that sees both kinds of drag — and the pointer is over this card.
      const element = createSection();
      const card = cardOf(element);

      card.dispatchEvent(new CustomEvent("dragenter", { bubbles: true }));
      await Promise.resolve();
      expect(card.classList.contains("rstk-nav-section_droptarget")).toBe(
        false
      );

      element.itemDragActive = true;
      await Promise.resolve();
      expect(card.classList.contains("rstk-nav-section_droptarget")).toBe(true);
      expect(card.classList.contains("rstk-nav-section")).toBe(true);

      card.dispatchEvent(new CustomEvent("dragleave", { bubbles: true }));
      await Promise.resolve();
      expect(card.classList.contains("rstk-nav-section_droptarget")).toBe(
        false
      );
    });

    it("stops looking like a drop target once the drop has happened", async () => {
      const element = createSection();
      const card = cardOf(element);
      element.itemDragActive = true;

      card.dispatchEvent(new CustomEvent("dragenter", { bubbles: true }));
      await Promise.resolve();
      expect(card.classList.contains("rstk-nav-section_droptarget")).toBe(true);

      card.dispatchEvent(
        new CustomEvent("drop", { bubbles: true, cancelable: true })
      );
      await Promise.resolve();

      expect(card.classList.contains("rstk-nav-section_droptarget")).toBe(
        false
      );
    });

    it("gives the drop target a real appearance that works in both colour modes", () => {
      // jsdom applies no CSS, so the class assertions above cannot see an
      // empty rule. This reads the stylesheet that ships.
      const css = readFileSync(
        join(__dirname, "..", "navigatorSection.css"),
        "utf8"
      );
      const rule = css.match(/\.rstk-nav-section_droptarget\s*\{[^}]*\}/);

      expect(rule).not.toBeNull();
      expect(rule[0]).toContain("--slds-g-");
      expect(rule[0]).not.toMatch(/prefers-color-scheme|--slds-c-|--lwc-/);
    });
  });

  it("refuses to rename a section to nothing at all", async () => {
    const element = createSection(undefined, { editing: true });
    const handler = jest.fn();
    element.addEventListener("sectionrename", handler);

    selectMenuItem(element, "rename");
    await Promise.resolve();

    const input = element.shadowRoot.querySelector("lightning-input");
    input.dispatchEvent(
      new CustomEvent("change", { detail: { value: "   " } })
    );
    input.dispatchEvent(new CustomEvent("commit"));

    expect(handler).not.toHaveBeenCalled();
  });

  describe("adding and removing items", () => {
    // What a screen reader computes for a <button>: the whole of its rendered
    // content, assistive-text spans included, with whitespace collapsed the
    // way the accessible name computation collapses it.
    function accessibleNameOf(button) {
      return button.textContent.replace(/\s+/g, " ").trim();
    }

    // What a sighted user reads: the same content with the assistive-only
    // parts taken out, which is exactly what `slds-assistive-text` does on
    // screen and does not do to the name above.
    function visibleTextOf(button) {
      const copy = button.cloneNode(true);
      copy
        .querySelectorAll(".slds-assistive-text")
        .forEach((node) => node.remove());
      return copy.textContent.replace(/\s+/g, " ").trim();
    }

    it("offers an Add items button in its header, where a user can find it, in edit mode", () => {
      const element = createSection(undefined, { editing: true });

      const button = addButtonOf(element);
      expect(button).not.toBeNull();
      expect(visibleTextOf(button)).toBe("Add items");
    });

    it("names the section in the button's accessible name, which is what a screen reader reads", () => {
      // A <button>'s accessible name comes from its *content* before its
      // `title` (HTML-AAM), so a `title` carrying the section name is a mouse
      // tooltip and nothing else — every card in the layout would then be
      // announced as the identical "Add items". An assistive-text span inside
      // the button is content, so it contributes to the name.
      const element = createSection(resolvedSection({ name: "Support" }), {
        editing: true
      });

      expect(accessibleNameOf(addButtonOf(element))).toBe(
        "Add items to Support"
      );
    });

    it("still names the button's target when the section name is blank", () => {
      // Same arrival the card's own `aria-label` guards against: nothing
      // scrubs a blank name already stored in `Layout_JSON__c`, which anything
      // with write access can fill. A button announced as "Add items to" with
      // nothing after it names no target at all, so the assistive text takes
      // the same generic fallback the card label does.
      const element = createSection(resolvedSection({ name: "   " }), {
        editing: true
      });

      expect(accessibleNameOf(addButtonOf(element))).toBe(
        "Add items to Unnamed section"
      );
    });

    it("keeps the visible wording short while the name carries the section", () => {
      // The header already prints the section's name in its own <h2>. A
      // button that printed it again would say it twice in a row and roughly
      // double the header's intrinsic width, so the section name is carried
      // by assistive text rather than by visible text.
      const element = createSection(resolvedSection({ name: "Support" }), {
        editing: true
      });
      const button = addButtonOf(element);

      expect(visibleTextOf(button)).toBe("Add items");
      expect(
        button.querySelector(".slds-assistive-text").textContent.trim()
      ).toBe("to Support");
    });

    it("styles the hand-rolled Add items button itself, in both colour modes", () => {
      // It is not a `lightning-button` any more, so SLDS 2 adoption on this
      // one control is ours: it has to look like a button and carry a visible
      // focus ring without a hand-rolled outline or a colour-mode branch.
      const css = readFileSync(
        join(__dirname, "..", "navigatorSection.css"),
        "utf8"
      );
      const base = css.match(/\.rstk-nav-section__add\s*\{[^}]*\}/);
      const focus = css.match(
        /\.rstk-nav-section__add:focus-visible\s*\{[^}]*\}/
      );

      expect(base).not.toBeNull();
      expect(base[0]).toContain("--slds-g-");
      expect(focus).not.toBeNull();
      expect(focus[0]).toContain("--slds-g-shadow-outline-focus-1");
      expect(css).not.toMatch(/prefers-color-scheme|--slds-c-|--lwc-/);
    });

    it("keeps a long section name from pushing the header wider than its card", () => {
      // `justify-content: space-between` with no `min-width: 0` cannot shrink
      // a flex item below its own content, so a long stored name at six
      // columns widens the header against a card that does not grow. The
      // heading is the part that gives way; the button and the menu are not.
      const css = readFileSync(
        join(__dirname, "..", "navigatorSection.css"),
        "utf8"
      );
      const title = css.match(/\.rstk-nav-section__title\s*\{[^}]*\}/);

      expect(title).not.toBeNull();
      expect(title[0]).toMatch(/min-width:\s*0/);
      expect(title[0]).toContain("text-overflow: ellipsis");
    });

    it("asks the parent to open the picker for its own section", () => {
      const element = createSection(undefined, { editing: true });
      const handler = jest.fn();
      element.addEventListener("sectionadditems", handler);

      addButtonOf(element).dispatchEvent(new CustomEvent("click"));

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].detail).toEqual({ index: 0 });
    });

    it("asks for the picker with its own section index and not a constant", () => {
      // Slice 05's row 13: a first-section fixture cannot tell "reports
      // itself" from "reports zero". This card is built at index 1.
      const resolved = resolveLayout(
        {
          sections: [
            { name: "Selling", columns: 3, items: [] },
            { name: "Support", columns: 3, items: [{ id: "Account" }] }
          ]
        },
        TABS
      )[1];
      const element = createSection(resolved, { editing: true });
      const handler = jest.fn();
      element.addEventListener("sectionadditems", handler);

      addButtonOf(element).dispatchEvent(new CustomEvent("click"));

      expect(handler.mock.calls[0][0].detail).toEqual({ index: 1 });
    });

    it("tells an empty section's user that it is empty and how to fill it", () => {
      // Not a blank card, and not a bare "nothing here" either — the message
      // has to name the way out, which is the button in this card's own
      // header.
      const element = createSection(resolvedSection({ itemIds: [] }), {
        editing: true
      });

      const empty = element.shadowRoot.querySelector(
        ".rstk-nav-section__empty"
      );
      expect(empty).not.toBeNull();
      expect(empty.textContent).toContain("no items");
      // And the route it names is actually on screen, *reading the way the
      // sentence quotes it*. Asserting the button merely exists let the two
      // drift apart once already, when the button's wording changed and the
      // sentence did not.
      const button = addButtonOf(element);
      expect(button).not.toBeNull();
      expect(empty.textContent.replace(/\s+/g, " ")).toContain(
        `Use ${visibleTextOf(button)} to`
      );
    });

    it("forwards an item's removal upward with the section it is in", () => {
      const element = createSection();
      const handler = jest.fn();
      element.addEventListener("itemremove", handler);

      itemsOf(element)[1].dispatchEvent(
        new CustomEvent("itemremove", { detail: { index: 1 } })
      );

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].detail).toEqual({
        sectionIndex: 0,
        index: 1
      });
    });

    it("forwards a removal with its own section index and not a constant", () => {
      const resolved = resolveLayout(
        {
          sections: [
            { name: "Selling", columns: 3, items: [] },
            {
              name: "Support",
              columns: 3,
              items: [{ id: "Account" }, { id: "Contact" }]
            }
          ]
        },
        TABS
      )[1];
      const element = createSection(resolved);
      const handler = jest.fn();
      element.addEventListener("itemremove", handler);

      itemsOf(element)[0].dispatchEvent(
        new CustomEvent("itemremove", { detail: { index: 0 } })
      );

      expect(handler.mock.calls[0][0].detail).toEqual({
        sectionIndex: 1,
        index: 0
      });
    });

    it("ends a keyboard grab on the item being removed, silently", async () => {
      // The same hazard `releaseGrabForDepartingItem` was added for on the
      // cross-section move: without it `reseatOrReleaseGrab` would find the
      // item gone on the next render and announce "Move cancelled. X is no
      // longer available." on an assertive region — a second, alarming
      // sentence about a removal the parent has already announced.
      const element = createThree();
      const items = itemsOf(element);
      fire(items[1], "itemgrab", { index: 1 });
      await Promise.resolve();
      expect(spoken(announcement(element))).toBe(
        "Contacts grabbed. Position 2 of 3."
      );

      fire(items[1], "itemremove", { index: 1 });
      element.section = sectionOf(TABS_3, ["Account", "standard-OurSite"]);
      await Promise.resolve();

      // The section says nothing further — the parent is the one voice on a
      // removal, exactly as it is on a cross-section move.
      expect(spoken(announcement(element))).toBe(
        "Contacts grabbed. Position 2 of 3."
      );
      expect(itemsOf(element).map((item) => item.grabbed)).toEqual([
        false,
        false
      ]);
    });

    it("keeps a grab on its own item when a *sibling* is removed", async () => {
      // The mirror: another item leaving is not this drag's business, and
      // dropping a grab the user is still holding would strand them mid-move.
      const element = createThree();
      const items = itemsOf(element);
      fire(items[2], "itemgrab", { index: 2 });
      await Promise.resolve();

      fire(items[0], "itemremove", { index: 0 });
      element.section = sectionOf(TABS_3, ["Contact", "standard-OurSite"]);
      await Promise.resolve();

      expect(
        itemsOf(element)
          .filter((item) => item.grabbed)
          .map((item) => item.label)
      ).toEqual(["Our Site"]);
    });
  });
});
