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
