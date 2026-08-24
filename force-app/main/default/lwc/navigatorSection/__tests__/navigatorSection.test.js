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

function createSection(section) {
  const element = createElement("c-navigator-section", {
    is: NavigatorSection
  });
  element.section = section || resolvedSection();
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

function menuOf(element) {
  return element.shadowRoot.querySelector("lightning-button-menu");
}

function selectMenuItem(element, value) {
  menuOf(element).dispatchEvent(
    new CustomEvent("select", { detail: { value } })
  );
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

  it("offers exactly one column choice per supported count, and no others", () => {
    const element = createSection();

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
    const element = createSection(resolvedSection({ columns: 2 }));
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
    const element = createSection(twoSections[1]);
    const handler = jest.fn();
    element.addEventListener("sectiondelete", handler);

    selectMenuItem(element, "delete");

    expect(handler).toHaveBeenCalledTimes(1);
    // The second section's index, not a hard-coded 0 — a component that
    // always reported 0 would delete the wrong card.
    expect(handler.mock.calls[0][0].detail).toEqual({ index: 1 });
  });

  it("renames the section on commit, carrying the typed name", async () => {
    const element = createSection();
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
    const element = createSection();
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
    const element = createSection();
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

  it("refuses to rename a section to nothing at all", async () => {
    const element = createSection();
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
});
