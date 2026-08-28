import {
  SCHEMA_VERSION,
  MIN_COLUMNS,
  MAX_COLUMNS,
  DEFAULT_COLUMNS,
  SEEDED_SECTION_NAME,
  buildSeededLayout,
  resolveLayout,
  serializeLayout,
  deserializeLayout,
  addSection,
  renameSection,
  deleteSection,
  setSectionColumns,
  reorder,
  moveItemWithinSection,
  moveItemBetweenSections,
  moveSection,
  renameItem,
  removeItem,
  availableTabs,
  addItemToSection
} from "c/navigatorLayoutModel";

// Three tabs in the shape navigatorTabSource normalises the platform into.
// `standard__cmsPage` is deliberate: it is not on the documented
// PageReference Types page, and nothing in this module may branch on `type`.
const ACCOUNT = {
  id: "Account",
  label: "Accounts",
  pageReference: {
    type: "standard__objectPage",
    attributes: { objectApiName: "Account", actionName: "home" },
    state: {}
  }
};
const CONTACT = {
  id: "Contact",
  label: "Contacts",
  pageReference: {
    type: "standard__objectPage",
    attributes: { objectApiName: "Contact", actionName: "home" },
    state: {}
  }
};
const OUR_SITE = {
  id: "standard-OurSite",
  label: "Our Site",
  pageReference: {
    type: "standard__cmsPage",
    attributes: { pageName: "our-site-home" },
    state: {}
  }
};

const ALL_TABS = [ACCOUNT, CONTACT, OUR_SITE];

/**
 * The accessible tab list, for a test whose subject is *which ids the running
 * user can reach* rather than what they are called. The move functions look at
 * nothing but `id`, which is the whole reason they can take the same `tabs`
 * argument `resolveLayout` takes.
 */
function tabsFor(...ids) {
  return ids.map((id) => ({ id, label: id, pageReference: {} }));
}

describe("buildSeededLayout", () => {
  it("puts every reachable tab into one section named All Items, in order", () => {
    const layout = buildSeededLayout(ALL_TABS);

    expect(layout.sections).toHaveLength(1);
    expect(layout.sections[0].name).toBe(SEEDED_SECTION_NAME);
    expect(layout.sections[0].name).toBe("All Items");
    expect(layout.sections[0].items.map((item) => item.id)).toEqual([
      "Account",
      "Contact",
      "standard-OurSite"
    ]);
    expect(layout.sections[0].columns).toBe(DEFAULT_COLUMNS);
  });

  it("seeds a layout that stores nothing derivable from the platform", () => {
    // The seeded layout is the very first thing that could ever be written,
    // so it is the cheapest place for a label to leak into the store. Assert
    // against the serialised payload rather than the object, because the
    // payload is what the contract is about.
    const payload = serializeLayout(buildSeededLayout(ALL_TABS));

    expect(payload).not.toContain("Accounts");
    expect(payload).not.toContain("label");
    expect(payload).not.toContain("pageReference");
    expect(payload).toContain("Account");
  });

  it("seeds an empty section when the user can reach no tabs at all", () => {
    const layout = buildSeededLayout([]);

    expect(layout.sections).toHaveLength(1);
    expect(layout.sections[0].items).toEqual([]);
  });
});

describe("resolveLayout — the render-time access intersection", () => {
  const stored = {
    sections: [
      {
        name: "Selling",
        columns: 2,
        items: [
          { id: "Account" },
          { id: "Contact" },
          { id: "standard-OurSite" }
        ]
      }
    ]
  };

  it("renders each stored item under its live platform label and pageReference", () => {
    const sections = resolveLayout(stored, ALL_TABS);

    expect(sections).toHaveLength(1);
    expect(sections[0].items.map((item) => item.label)).toEqual([
      "Accounts",
      "Contacts",
      "Our Site"
    ]);
    expect(sections[0].items[2].pageReference).toEqual(OUR_SITE.pageReference);
  });

  it("prefers the user's own rename over the platform label, without touching the target", () => {
    const renamed = {
      sections: [
        {
          name: "Selling",
          columns: 2,
          items: [{ id: "Account", rename: "Clients" }]
        }
      ]
    };

    const sections = resolveLayout(renamed, ALL_TABS);

    expect(sections[0].items[0].label).toBe("Clients");
    expect(sections[0].items[0].pageReference).toEqual(ACCOUNT.pageReference);
  });

  it("keeps a stored rename equal to the platform label when the org relabels the tab", () => {
    // The boundary of what "an item with no rename follows the org" buys, and
    // it is a boundary of the *stored* state rather than of what is on screen.
    // `renameItem` will no longer write this shape — wording equal to the live
    // platform label is stored as the key's absence — but a payload written
    // before that rule existed, or hand-edited, can still carry it. There is
    // nothing the read path can do about it: normalising here would compare
    // `rename` against the *current* label, and by the time the org has
    // relabelled the two no longer match, so the redundancy is undetectable
    // at exactly the moment it starts to matter. Repairing it would take a
    // write, and a write for a user who has only looked is the hazard slice
    // 03's criterion and this slice's own unchanged-commit rule both exist to
    // prevent. So the row keeps its `rename` until the item is next edited,
    // and this pins that rather than pretending otherwise.
    const redundant = {
      sections: [
        {
          name: "Selling",
          columns: 2,
          items: [{ id: "Account", rename: "Accounts" }]
        }
      ]
    };

    // Indistinguishable from an item with no rename while the label stands.
    expect(resolveLayout(redundant, ALL_TABS)[0].items[0].label).toBe(
      "Accounts"
    );

    // The org relabels afterwards, which is the order that discriminates: a
    // rule that dropped the redundant key at adoption time would render the
    // new wording here, and one that only looks at the live label cannot.
    const relabelled = [{ ...ACCOUNT, label: "Accts" }, CONTACT, OUR_SITE];
    const after = resolveLayout(redundant, relabelled)[0].items[0];

    expect(after.label).toBe("Accounts");
    expect(after.label).not.toBe("Accts");
    // And the stored shape is untouched by the render, so nothing self-heals
    // through a round trip either.
    expect(
      deserializeLayout(serializeLayout(redundant)).sections[0].items[0]
    ).toEqual({ id: "Account", rename: "Accounts" });
  });

  it("stops rendering an item whose tab the user has lost access to", () => {
    const withoutContact = [ACCOUNT, OUR_SITE];

    const sections = resolveLayout(stored, withoutContact);

    expect(sections[0].items.map((item) => item.id)).toEqual([
      "Account",
      "standard-OurSite"
    ]);
  });

  it("leaves the stored layout completely unaltered when it drops an item", () => {
    // The whole mechanism: intersection at render time, never a mutation of
    // stored data. Deep-compared against an independent copy taken before
    // the call, so an in-place splice of `items` is caught rather than
    // merely a reassignment of `stored`.
    const before = JSON.parse(JSON.stringify(stored));

    resolveLayout(stored, [ACCOUNT]);

    expect(stored).toEqual(before);
  });

  it("restores a dropped item to its original position when access returns", () => {
    const withoutContact = resolveLayout(stored, [ACCOUNT, OUR_SITE]);
    expect(withoutContact[0].items.map((item) => item.id)).toEqual([
      "Account",
      "standard-OurSite"
    ]);

    const restored = resolveLayout(stored, ALL_TABS);

    expect(restored[0].items.map((item) => item.id)).toEqual([
      "Account",
      "Contact",
      "standard-OurSite"
    ]);
    // Position, not merely presence: Contact is back between the two it sat
    // between, not appended at the end.
    expect(restored[0].items[1].id).toBe("Contact");
  });

  it("renders a section that has lost every one of its items, rather than dropping the section", () => {
    const sections = resolveLayout(stored, []);

    expect(sections).toHaveLength(1);
    expect(sections[0].name).toBe("Selling");
    expect(sections[0].items).toEqual([]);
    expect(sections[0].hasItems).toBe(false);
  });

  it.each([1, 2, 3, 4, 5, 6])(
    "computes the cols-%i class so the section can render in that many columns",
    (columns) => {
      const sections = resolveLayout(
        { sections: [{ name: "S", columns, items: [] }] },
        ALL_TABS
      );

      expect(sections[0].columns).toBe(columns);
      expect(sections[0].columnClass).toContain(`cols-${columns}`);
    }
  );

  it("clamps a column count outside one to six rather than emitting a class no stylesheet has", () => {
    const wide = resolveLayout(
      { sections: [{ name: "S", columns: 12, items: [] }] },
      ALL_TABS
    );
    const narrow = resolveLayout(
      { sections: [{ name: "S", columns: 0, items: [] }] },
      ALL_TABS
    );

    expect(wide[0].columnClass).toContain(`cols-${MAX_COLUMNS}`);
    expect(narrow[0].columnClass).toContain(`cols-${MIN_COLUMNS}`);
  });

  // spanClass is the card's own footprint in the canvas's six-track CSS
  // Grid (`.rstk-nav-section_span-N` in navigatorSection.css) — the seam
  // that drives a section's width off its column count instead of the
  // full-width stretch every section used to get alike. It comes off the
  // same clamped `columns` columnClass does, one definition shared between
  // the two classes, for the same reason the tests below mirror the
  // columnClass ones above rather than inventing a second set of rules.
  it.each([1, 2, 3, 4, 5, 6])(
    "computes the span-%i class so the section's card spans that many of the canvas's six tracks",
    (columns) => {
      const sections = resolveLayout(
        { sections: [{ name: "S", columns, items: [] }] },
        ALL_TABS
      );

      expect(sections[0].columns).toBe(columns);
      expect(sections[0].spanClass).toContain(`span-${columns}`);
    }
  );

  it("clamps a column count outside one to six for the span class too, rather than emitting a class no stylesheet has", () => {
    const wide = resolveLayout(
      { sections: [{ name: "S", columns: 12, items: [] }] },
      ALL_TABS
    );
    const narrow = resolveLayout(
      { sections: [{ name: "S", columns: 0, items: [] }] },
      ALL_TABS
    );

    expect(wide[0].spanClass).toContain(`span-${MAX_COLUMNS}`);
    expect(narrow[0].spanClass).toContain(`span-${MIN_COLUMNS}`);
  });

  it("carries each section's own index, so an edit names the section it came from", () => {
    const twoSections = {
      sections: [
        { name: "First", columns: 1, items: [] },
        { name: "Second", columns: 1, items: [] }
      ]
    };

    const sections = resolveLayout(twoSections, ALL_TABS);

    expect(sections.map((section) => section.index)).toEqual([0, 1]);
  });

  it("resolves nothing at all from a null layout", () => {
    expect(resolveLayout(null, ALL_TABS)).toEqual([]);
    expect(resolveLayout({ sections: [] }, ALL_TABS)).toEqual([]);
  });
});

describe("serializeLayout — the published payload contract", () => {
  it("emits schemaVersion, section name, column count and bare item ids and nothing else", () => {
    const layout = {
      sections: [
        {
          name: "Selling",
          columns: 4,
          items: [{ id: "Account", rename: "Clients" }]
        }
      ]
    };

    expect(JSON.parse(serializeLayout(layout))).toEqual({
      schemaVersion: SCHEMA_VERSION,
      sections: [
        {
          name: "Selling",
          columns: 4,
          items: [{ id: "Account", rename: "Clients" }]
        }
      ]
    });
  });

  it("drops a label, an icon and a pageReference that reached it by accident", () => {
    // Dropped by construction rather than by a rule someone has to remember:
    // this is the only route into the blob from the client, and it emits an
    // explicit set of keys.
    const contaminated = {
      sections: [
        {
          name: "Selling",
          columns: 2,
          label: "Selling section",
          items: [
            {
              id: "Account",
              label: "Accounts",
              iconUrl: "/img/account.png",
              pageReference: ACCOUNT.pageReference
            }
          ]
        }
      ]
    };

    const payload = JSON.parse(serializeLayout(contaminated));

    expect(payload.sections[0]).toEqual({
      name: "Selling",
      columns: 2,
      items: [{ id: "Account" }]
    });
  });

  it("stamps a version even on an empty layout", () => {
    expect(JSON.parse(serializeLayout({ sections: [] }))).toEqual({
      schemaVersion: SCHEMA_VERSION,
      sections: []
    });
  });
});

describe("deserializeLayout", () => {
  it("round-trips a layout through the payload unchanged", () => {
    const layout = {
      sections: [
        {
          name: "Selling",
          columns: 5,
          items: [{ id: "Account", rename: "Clients" }]
        },
        { name: "Support", columns: 1, items: [{ id: "Contact" }] }
      ]
    };

    expect(deserializeLayout(serializeLayout(layout))).toEqual(layout);
  });

  it("upgrades a v1 payload's bare-string items into v2 objects", () => {
    const v1 = JSON.stringify({
      schemaVersion: 1,
      sections: [{ name: "Selling", columns: 3, items: ["Account", "Contact"] }]
    });

    expect(deserializeLayout(v1)).toEqual({
      sections: [
        {
          name: "Selling",
          columns: 3,
          items: [{ id: "Account" }, { id: "Contact" }]
        }
      ]
    });
  });

  it("treats a payload declaring no version as v1, the shape from before the key existed", () => {
    const versionless = JSON.stringify({
      sections: [{ name: "Selling", columns: 2, items: ["Account"] }]
    });

    expect(deserializeLayout(versionless).sections[0].items).toEqual([
      { id: "Account" }
    ]);
  });

  it("refuses a schema version it cannot read, and names the version", () => {
    const future = JSON.stringify({ schemaVersion: 99, sections: [] });

    expect(() => deserializeLayout(future)).toThrow(/99/);
  });

  it("returns an empty layout for a blank, absent or unparseable payload", () => {
    expect(deserializeLayout("")).toEqual({ sections: [] });
    expect(deserializeLayout(null)).toEqual({ sections: [] });
    expect(deserializeLayout(undefined)).toEqual({ sections: [] });
    expect(deserializeLayout("not json at all")).toEqual({ sections: [] });
  });
});

describe("the section operations", () => {
  const base = {
    sections: [
      { name: "First", columns: 2, items: [{ id: "Account" }] },
      { name: "Second", columns: 3, items: [{ id: "Contact" }] }
    ]
  };

  function frozenCopy() {
    return JSON.parse(JSON.stringify(base));
  }

  it("adds a named section at the end without disturbing the ones already there", () => {
    const before = frozenCopy();

    const next = addSection(base, "Third");

    expect(next.sections.map((section) => section.name)).toEqual([
      "First",
      "Second",
      "Third"
    ]);
    expect(next.sections[2].items).toEqual([]);
    expect(next.sections[2].columns).toBe(DEFAULT_COLUMNS);
    expect(base).toEqual(before);
  });

  it("renames the section at the given index and only that one", () => {
    const before = frozenCopy();

    const next = renameSection(base, 1, "Renamed");

    expect(next.sections.map((section) => section.name)).toEqual([
      "First",
      "Renamed"
    ]);
    // The rename must not disturb the section's own items or column count.
    expect(next.sections[1].items).toEqual([{ id: "Contact" }]);
    expect(next.sections[1].columns).toBe(3);
    expect(base).toEqual(before);
  });

  it("deletes the section at the given index and only that one", () => {
    const before = frozenCopy();

    const next = deleteSection(base, 0);

    expect(next.sections.map((section) => section.name)).toEqual(["Second"]);
    expect(next.sections[0].items).toEqual([{ id: "Contact" }]);
    expect(base).toEqual(before);
  });

  it("sets a section's column count anywhere in one to six", () => {
    const before = frozenCopy();

    for (let columns = MIN_COLUMNS; columns <= MAX_COLUMNS; columns += 1) {
      expect(setSectionColumns(base, 0, columns).sections[0].columns).toBe(
        columns
      );
    }
    // The same explicit before/after deep-compare its three siblings have.
    // Without it, an in-place `section.columns = …` was caught only by
    // accident, because the test below happens to reuse `base` across three
    // calls — an accident is not a guard.
    expect(base).toEqual(before);
  });

  it("clamps a column count outside one to six rather than storing it", () => {
    const before = frozenCopy();

    expect(setSectionColumns(base, 0, 9).sections[0].columns).toBe(MAX_COLUMNS);
    expect(setSectionColumns(base, 0, 0).sections[0].columns).toBe(MIN_COLUMNS);
    expect(setSectionColumns(base, 1, 4).sections[0].columns).toBe(2);
    expect(base).toEqual(before);
  });

  // Row 30's general form, on the two operations that had no purity test at
  // all. `expect(base).toEqual(before)` above catches an in-place *write*; it
  // says nothing about the returned sections being the caller's own objects,
  // and `filter`/`map`/`concat` over the caller's list is exactly the shape
  // that passes a deep-equal and shares every object it hands back. All three
  // levels are asserted — per section, per `items` array, and per item — plus
  // a write-through, because an assertion on the container's identity says
  // nothing about the contents'.
  it("deleteSection hands back copies, not the caller's own section and item objects", () => {
    const next = deleteSection(base, 0);

    next.sections.forEach((section, at) => {
      // The survivors shift down by one, so section `at` of the result came
      // from section `at + 1` of the input.
      const source = base.sections[at + 1];
      expect(section).not.toBe(source);
      expect(section.items).not.toBe(source.items);
      section.items.forEach((item) => {
        expect(source.items).not.toContain(item);
      });
    });

    next.sections[0].items[0].rename = "Written through";
    expect(base.sections[1].items[0]).toEqual({ id: "Contact" });
  });

  it("addSection hands back copies, not the caller's own section and item objects", () => {
    const next = addSection(base, "Third");

    base.sections.forEach((source, at) => {
      expect(next.sections[at]).not.toBe(source);
      expect(next.sections[at].items).not.toBe(source.items);
      next.sections[at].items.forEach((item) => {
        expect(source.items).not.toContain(item);
      });
    });

    next.sections[0].items[0].rename = "Written through";
    expect(base.sections[0].items[0]).toEqual({ id: "Account" });
  });

  it("leaves the layout alone when an operation names a section that is not there", () => {
    expect(renameSection(base, 7, "Nope")).toEqual(base);
    expect(deleteSection(base, 7)).toEqual(base);
    expect(setSectionColumns(base, 7, 4)).toEqual(base);
  });
});

describe("reorder — the one placement function", () => {
  const list = ["a", "b", "c", "d"];

  it.each([
    [0, 1, ["b", "a", "c", "d"]],
    [0, 3, ["b", "c", "d", "a"]],
    [3, 0, ["d", "a", "b", "c"]],
    [2, 1, ["a", "c", "b", "d"]],
    [1, 1, ["a", "b", "c", "d"]]
  ])("moves the entry at %i to position %i", (from, to, expected) => {
    expect(reorder(list, from, to)).toEqual(expected);
  });

  it("never mutates the list it was handed", () => {
    // The same purity assertion the section operations carry. Deep-compared
    // against an independent copy taken before the call, so an in-place
    // splice is caught rather than merely a reassignment.
    const before = JSON.parse(JSON.stringify(list));

    reorder(list, 0, 3);
    reorder(list, 3, 0);

    expect(list).toEqual(before);
  });

  it("returns a new array even when nothing moved", () => {
    const result = reorder(list, 1, 1);

    expect(result).not.toBe(list);
    expect(result).toEqual(list);
  });

  it("clamps a destination past either end rather than dropping the entry", () => {
    // This is the keyboard path's edge: ArrowUp on the first item asks for
    // -1, ArrowDown on the last asks for length. Neither may lose the item.
    expect(reorder(list, 0, -1)).toEqual(["a", "b", "c", "d"]);
    expect(reorder(list, 3, 9)).toEqual(["a", "b", "c", "d"]);
    expect(reorder(list, 2, -5)).toEqual(["c", "a", "b", "d"]);
    expect(reorder(list, 1, 99)).toEqual(["a", "c", "d", "b"]);
  });

  it("returns the list unchanged when the source index is not a real position", () => {
    expect(reorder(list, -1, 0)).toEqual(list);
    expect(reorder(list, 4, 0)).toEqual(list);
    expect(reorder(list, undefined, 0)).toEqual(list);
    expect(reorder(list, 1.5, 0)).toEqual(list);
    expect(reorder(list, 0, undefined)).toEqual(list);
    expect(reorder(list, 0, "nowhere")).toEqual(list);
  });

  it("reorders nothing at all from a non-list", () => {
    expect(reorder(null, 0, 1)).toEqual([]);
    expect(reorder(undefined, 0, 1)).toEqual([]);
    expect(reorder([], 0, 1)).toEqual([]);
  });

  it("is its own inverse, which is what makes Escape able to cancel", () => {
    // A grabbed item walked from 0 to 3 by three arrow presses sits where
    // reorder(list, 0, 3) puts it; reorder(that, 3, 0) must give the
    // original list back exactly, or Escape cannot restore it.
    const moved = reorder(reorder(reorder(list, 0, 1), 1, 2), 2, 3);
    expect(moved).toEqual(reorder(list, 0, 3));
    expect(reorder(moved, 3, 0)).toEqual(list);
  });
});

describe("moveItemWithinSection", () => {
  const base = {
    sections: [
      {
        name: "First",
        columns: 2,
        items: [
          { id: "Account" },
          { id: "Contact" },
          { id: "standard-OurSite" }
        ]
      },
      { name: "Second", columns: 3, items: [{ id: "Contact" }] }
    ]
  };

  function frozenCopy() {
    return JSON.parse(JSON.stringify(base));
  }

  it("moves an item to a new position inside its own section", () => {
    const before = frozenCopy();

    const next = moveItemWithinSection(base, ALL_TABS, 0, 0, 2);

    expect(next.sections[0].items.map((item) => item.id)).toEqual([
      "Contact",
      "standard-OurSite",
      "Account"
    ]);
    expect(base).toEqual(before);
  });

  it("hands back copies, not the caller's own section and item objects", () => {
    // The deep-compare above is structural and cannot tell a copy from a
    // shared reference: a version that returned the caller's own objects
    // passes it untouched. The module's docblock promises the opposite — the
    // result can go straight into reactive state "without wondering whether
    // the previous value still exists" — and `reorder`'s own purity test does
    // not cover this, because `reorder` is handed an already-copied array.
    const next = moveItemWithinSection(base, ALL_TABS, 0, 0, 2);

    next.sections.forEach((section, at) => {
      expect(section).not.toBe(base.sections[at]);
      expect(section.items).not.toBe(base.sections[at].items);
    });

    const moved = next.sections[0].items[2];
    expect(moved).toEqual(base.sections[0].items[0]);
    expect(moved).not.toBe(base.sections[0].items[0]);

    // The consequence, stated as behaviour rather than as identity: writing
    // to the result must not reach back into the layout it came from.
    moved.rename = "Clients";
    expect(base.sections[0].items[0].rename).toBeUndefined();
  });

  it("carries a renamed item's rename with it", () => {
    const renamed = {
      sections: [
        {
          name: "First",
          columns: 2,
          items: [{ id: "Account", rename: "Clients" }, { id: "Contact" }]
        }
      ]
    };

    const next = moveItemWithinSection(renamed, ALL_TABS, 0, 0, 1);

    expect(next.sections[0].items).toEqual([
      { id: "Contact" },
      { id: "Account", rename: "Clients" }
    ]);
  });

  it("leaves every other section, and the section's own name and columns, alone", () => {
    const next = moveItemWithinSection(base, ALL_TABS, 0, 2, 0);

    expect(next.sections[0].name).toBe("First");
    expect(next.sections[0].columns).toBe(2);
    expect(next.sections[1]).toEqual(base.sections[1]);
  });

  // Deliberately reaching past both ends. A hand-inlined copy of the splice
  // that skipped `reorder`'s clamp would agree on every in-range case and
  // only diverge here — which is precisely the copy this criterion exists to
  // prevent, so the in-range cases alone would not catch it.
  const DESTINATIONS = [-2, -1, 0, 1, 2, 3, 9];

  it.each(DESTINATIONS)(
    "agrees with reorder exactly on a move to %i, because it is the same function underneath",
    (to) => {
      const ids = base.sections[0].items.map((item) => item.id);

      for (let from = 0; from < ids.length; from += 1) {
        expect(
          moveItemWithinSection(
            base,
            ALL_TABS,
            0,
            from,
            to
          ).sections[0].items.map((item) => item.id)
        ).toEqual(reorder(ids, from, to));
      }
    }
  );

  it("leaves the layout alone when it names a section that is not there", () => {
    expect(moveItemWithinSection(base, ALL_TABS, 7, 0, 1)).toEqual(base);
  });

  /**
   * Criterion 6, asserted where it can still bite.
   *
   * The `it.each` above compares against `reorder`'s output, and every
   * destination it names is one `storedDestination` has already clamped into
   * range before `reorder` sees it — so `reorder`'s own clamp and its source
   * guard are pre-empted from this path, and any correct hand-inlined splice
   * reproduces the whole table exactly. One part of `reorder` is still reached
   * from here: a destination that is not a number is passed through untouched
   * for `reorder` to refuse, and `reorder` refuses it by handing the list back
   * unchanged. A bare `items.splice(NaN, 0, moved)` does not refuse anything —
   * `splice` reads `NaN` as 0 — so the item jumps to the top of the section
   * instead of staying where the user left it. That difference is what
   * distinguishes "calls the shared placement function" from "reproduces its
   * output on the cases the callers happen to reach".
   */
  it("leaves the section as it was when the destination is not a real position", () => {
    const ids = base.sections[0].items.map((item) => item.id);

    expect(
      moveItemWithinSection(
        base,
        ALL_TABS,
        0,
        2,
        "nowhere"
      ).sections[0].items.map((item) => item.id)
    ).toEqual(ids);
    expect(
      moveItemWithinSection(base, ALL_TABS, 0, 2, NaN).sections[0].items.map(
        (item) => item.id
      )
    ).toEqual(ids);
  });

  // The seam. `from` and `to` are positions in the list the user is looking
  // at, which is the *resolved* list; the layout being rewritten is the
  // stored one, and the two are different lists the moment `resolveLayout`
  // drops an id. Every other fixture in this file makes them the same number.
  it("moves the item at that position on screen, not the one at that stored position", () => {
    const stored = {
      sections: [
        {
          name: "First",
          columns: 2,
          items: [
            { id: "Account" },
            { id: "Contact" },
            { id: "standard-OurSite" }
          ]
        }
      ]
    };
    // `Account` is stored but withdrawn, so the user sees two items and the
    // one they call "the first" is stored second.
    const next = moveItemWithinSection(
      stored,
      tabsFor("Contact", "standard-OurSite"),
      0,
      0,
      1
    );

    expect(next.sections[0].items.map((item) => item.id)).toEqual([
      "Account",
      "standard-OurSite",
      "Contact"
    ]);
  });

  it("leaves an item the user cannot see exactly where it was stored", () => {
    // The spec's promise: an item whose tab comes back comes back *in its
    // original position*. An unrelated gesture must not spend that.
    const stored = {
      sections: [
        {
          name: "First",
          columns: 2,
          items: [
            { id: "Account" },
            { id: "Contact" },
            { id: "standard-OurSite" }
          ]
        }
      ]
    };

    const next = moveItemWithinSection(
      stored,
      tabsFor("Contact", "standard-OurSite"),
      0,
      1,
      0
    );

    expect(next.sections[0].items.map((item) => item.id)).toEqual([
      "Account",
      "standard-OurSite",
      "Contact"
    ]);
  });
});

describe("moveItemBetweenSections", () => {
  const base = {
    sections: [
      {
        name: "First",
        columns: 2,
        items: [
          { id: "Account", rename: "Clients" },
          { id: "Contact" },
          { id: "standard-OurSite" }
        ]
      },
      {
        name: "Second",
        columns: 3,
        items: [{ id: "standard-ActionHub" }, { id: "standard-ShieldHome" }]
      }
    ]
  };

  // Every id `base` stores, so that in these tests the index the user sees and
  // the index the layout stores are the same number. The tests further down
  // take an id away, which is the case that tells the two apart.
  const REACHABLE = tabsFor(
    "Account",
    "Contact",
    "standard-OurSite",
    "standard-ActionHub",
    "standard-ShieldHome"
  );

  function frozenCopy() {
    return JSON.parse(JSON.stringify(base));
  }

  function idsOf(layout, sectionIndex) {
    return layout.sections[sectionIndex].items.map((item) => item.id);
  }

  it("takes the item out of one section and puts it into another at the chosen position", () => {
    const before = frozenCopy();

    const next = moveItemBetweenSections(base, REACHABLE, 0, 1, 1, 0);

    expect(idsOf(next, 0)).toEqual(["Account", "standard-OurSite"]);
    expect(idsOf(next, 1)).toEqual([
      "Contact",
      "standard-ActionHub",
      "standard-ShieldHome"
    ]);
    expect(base).toEqual(before);
  });

  it("puts the item at the end of the destination when no position is named", () => {
    // The Move to… menu names a section and not a slot, so this is the whole
    // of what that route asks for.
    const next = moveItemBetweenSections(base, REACHABLE, 0, 0, 1, undefined);

    expect(idsOf(next, 1)).toEqual([
      "standard-ActionHub",
      "standard-ShieldHome",
      "Account"
    ]);
  });

  it("carries the item's rename across the move, because a rename is the user's own wording", () => {
    const next = moveItemBetweenSections(base, REACHABLE, 0, 0, 1, 0);

    expect(next.sections[1].items[0]).toEqual({
      id: "Account",
      rename: "Clients"
    });
  });

  /**
   * The criterion is that the cross-section move uses the *same placement
   * function* as the within-section reorder. One agreeing example would not
   * show that — two implementations can agree on one case — so every
   * destination in range and two past each end are required to land exactly
   * where `reorder` puts the item once it has been appended to the
   * destination list. A hand-inlined splice that skipped `reorder`'s clamp
   * agrees on every in-range case and diverges only here.
   */
  const DESTINATIONS = [-2, -1, 0, 1, 2, 3, 9];

  it.each(DESTINATIONS)(
    "places the item exactly where reorder does for a destination of %i",
    (to) => {
      const destinationIds = idsOf(base, 1);

      for (let from = 0; from < base.sections[0].items.length; from += 1) {
        const movedId = base.sections[0].items[from].id;
        const appended = destinationIds.concat([movedId]);

        expect(
          idsOf(moveItemBetweenSections(base, REACHABLE, 0, from, 1, to), 1)
        ).toEqual(reorder(appended, appended.length - 1, to));
      }
    }
  );

  /**
   * The same discriminator as the one on `moveItemWithinSection`, on this axis.
   * `storedDestination` clamps a numeric position into range before `reorder`
   * runs, so the table above is reproducible by a hand-inlined splice; a
   * destination that is not a number reaches `reorder`'s own refusal, and the
   * appended item stays at the end of the destination rather than being
   * splice-jumped to the top of it.
   */
  it("puts the item at the end of the destination when the drop names no real position", () => {
    expect(
      idsOf(moveItemBetweenSections(base, REACHABLE, 0, 0, 1, "nowhere"), 1)
    ).toEqual(["standard-ActionHub", "standard-ShieldHome", "Account"]);
    expect(
      idsOf(moveItemBetweenSections(base, REACHABLE, 0, 0, 1, NaN), 1)
    ).toEqual(["standard-ActionHub", "standard-ShieldHome", "Account"]);
  });

  it("leaves the layout unchanged when the destination is the section it came from", () => {
    // Criterion 7. Structural rather than by care: the function itself
    // refuses, so no caller has to remember to.
    expect(moveItemBetweenSections(base, REACHABLE, 0, 0, 0, 2)).toEqual(base);
  });

  it("leaves every other section's name, columns and items alone", () => {
    const next = moveItemBetweenSections(base, REACHABLE, 0, 1, 1, 0);

    expect(next.sections[0].name).toBe("First");
    expect(next.sections[0].columns).toBe(2);
    expect(next.sections[1].name).toBe("Second");
    expect(next.sections[1].columns).toBe(3);
  });

  it("hands back copies, not the caller's own section and item objects", () => {
    // Structural equality cannot tell a copy from a shared reference, and the
    // module's docblock promises a copy. The same blind spot the two other
    // move functions were bitten by.
    const next = moveItemBetweenSections(base, REACHABLE, 0, 0, 1, 0);

    next.sections.forEach((section, at) => {
      expect(section).not.toBe(base.sections[at]);
      expect(section.items).not.toBe(base.sections[at].items);
    });

    const moved = next.sections[1].items[0];
    expect(moved).not.toBe(base.sections[0].items[0]);

    moved.rename = "Customers";
    expect(base.sections[0].items[0].rename).toBe("Clients");
  });

  it("survives a round trip through the payload, so the move is what reloads", () => {
    const moved = moveItemBetweenSections(base, REACHABLE, 0, 1, 1, 0);

    expect(idsOf(deserializeLayout(serializeLayout(moved)), 1)).toEqual([
      "Contact",
      "standard-ActionHub",
      "standard-ShieldHome"
    ]);
  });

  it("leaves the layout alone when either section is not there", () => {
    expect(moveItemBetweenSections(base, REACHABLE, 7, 0, 1, 0)).toEqual(base);
    expect(moveItemBetweenSections(base, REACHABLE, 0, 0, 7, 0)).toEqual(base);
  });

  it("leaves the layout alone when the item is not there", () => {
    expect(moveItemBetweenSections(base, REACHABLE, 0, 9, 1, 0)).toEqual(base);
    expect(moveItemBetweenSections(base, REACHABLE, 0, -1, 1, 0)).toEqual(base);
  });

  // The seam, on this axis and on both sides of it: the source position is
  // one the user picked off the screen, and so is the destination position.
  it("takes out the item at that position on screen, not the one at that stored position", () => {
    const stored = {
      sections: [
        {
          name: "First",
          columns: 2,
          items: [
            { id: "Account" },
            { id: "standard-ActionHub" },
            { id: "Contact" }
          ]
        },
        { name: "Second", columns: 3, items: [] }
      ]
    };
    // `Account` is stored but withdrawn: the first item on screen is stored
    // second.
    const next = moveItemBetweenSections(
      stored,
      tabsFor("standard-ActionHub", "Contact"),
      0,
      0,
      1,
      undefined
    );

    expect(idsOf(next, 0)).toEqual(["Account", "Contact"]);
    expect(idsOf(next, 1)).toEqual(["standard-ActionHub"]);
  });

  it("lands the item at that position on screen in the destination, counting past what the user cannot see", () => {
    const stored = {
      sections: [
        { name: "First", columns: 2, items: [{ id: "Contact" }] },
        {
          name: "Second",
          columns: 3,
          items: [{ id: "Account" }, { id: "standard-ActionHub" }]
        }
      ]
    };
    // The destination shows one item, because `Account` is withdrawn. A drop
    // on screen position 0 there must land before that one item, and must not
    // displace the withdrawn one.
    const next = moveItemBetweenSections(
      stored,
      tabsFor("Contact", "standard-ActionHub"),
      0,
      0,
      1,
      0
    );

    expect(idsOf(next, 1)).toEqual([
      "Account",
      "Contact",
      "standard-ActionHub"
    ]);
  });

  // The destination already listing the moved id is not producible by any
  // gesture this Navigator ships, but a hand-edited payload can arrive with
  // one and this is the first operation that can turn a cross-section
  // duplicate into a within-section one — two entries with the same `key`,
  // which LWC refuses to render.
  it("leaves one copy, not two, when the destination already lists the same tab", () => {
    const stored = {
      sections: [
        {
          name: "First",
          columns: 2,
          items: [{ id: "Account", rename: "Clients" }, { id: "Contact" }]
        },
        {
          name: "Second",
          columns: 3,
          items: [{ id: "Account" }, { id: "standard-ActionHub" }]
        }
      ]
    };

    const next = moveItemBetweenSections(stored, REACHABLE, 0, 0, 1, undefined);

    expect(idsOf(next, 0)).toEqual(["Contact"]);
    expect(idsOf(next, 1)).toEqual(["standard-ActionHub", "Account"]);
    // The surviving copy is the one that was moved, so the user's own wording
    // travels with it rather than being replaced by the stale entry's.
    expect(next.sections[1].items[1]).toEqual({
      id: "Account",
      rename: "Clients"
    });
  });
});

describe("moveSection", () => {
  const base = {
    sections: [
      { name: "First", columns: 2, items: [{ id: "Account" }] },
      { name: "Second", columns: 3, items: [{ id: "Contact" }] },
      { name: "Third", columns: 1, items: [] }
    ]
  };

  function frozenCopy() {
    return JSON.parse(JSON.stringify(base));
  }

  it("reorders the sections themselves, carrying each one's items and columns", () => {
    const before = frozenCopy();

    const next = moveSection(base, 2, 0);

    expect(next.sections.map((section) => section.name)).toEqual([
      "Third",
      "First",
      "Second"
    ]);
    expect(next.sections[1].items).toEqual([{ id: "Account" }]);
    expect(next.sections[1].columns).toBe(2);
    expect(base).toEqual(before);
  });

  it.each([-2, -1, 0, 1, 2, 3, 9])(
    "agrees with reorder exactly on a move to %i, because it is the same function underneath",
    (to) => {
      const names = base.sections.map((section) => section.name);

      for (let from = 0; from < names.length; from += 1) {
        expect(
          moveSection(base, from, to).sections.map((section) => section.name)
        ).toEqual(reorder(names, from, to));
      }
    }
  );

  it("hands back copies, not the caller's own section and item objects", () => {
    // The same blind spot as on the item axis: `toEqual` is structural, so a
    // `moveSection` that dropped `copySection` and handed the caller's own
    // sections straight back would pass every other test here.
    const next = moveSection(base, 2, 0);

    next.sections.forEach((section) => {
      base.sections.forEach((original) => {
        expect(section).not.toBe(original);
        expect(section.items).not.toBe(original.items);
      });
    });

    const carried = next.sections[1].items[0];
    expect(carried).toEqual(base.sections[0].items[0]);
    expect(carried).not.toBe(base.sections[0].items[0]);

    carried.rename = "Clients";
    expect(base.sections[0].items[0].rename).toBeUndefined();
  });

  it("survives a round trip through the payload, so the order is what reloads", () => {
    const moved = moveSection(base, 0, 2);

    expect(
      deserializeLayout(serializeLayout(moved)).sections.map(
        (section) => section.name
      )
    ).toEqual(["Second", "Third", "First"]);
  });

  it("leaves the layout alone when it names a section that is not there", () => {
    expect(moveSection(base, 7, 0)).toEqual(base);
  });
});

/**
 * The rename, which is a display field and nothing else.
 *
 * Two things are under test here and they are not the same thing. One is that
 * the user's wording lands on the item they picked — which, exactly as on the
 * move axes, means a *rendered* position translated into a *stored* one, so
 * the fixture that matters stores an id the running user cannot reach. The
 * other is that `id` is never written: the label and the navigation target are
 * different fields, and that is what makes a rename structurally unable to
 * change where an item goes rather than carefully unable to.
 */
describe("renameItem", () => {
  const base = {
    sections: [
      {
        name: "First",
        columns: 2,
        items: [{ id: "Account" }, { id: "Contact", rename: "People" }]
      },
      {
        name: "Second",
        columns: 3,
        items: [{ id: "standard-OurSite" }]
      }
    ]
  };

  const REACHABLE = tabsFor("Account", "Contact", "standard-OurSite");

  function frozenCopy() {
    return JSON.parse(JSON.stringify(base));
  }

  function payloadItem(layout, sectionIndex, itemIndex) {
    return JSON.parse(serializeLayout(layout)).sections[sectionIndex].items[
      itemIndex
    ];
  }

  it("stores the user's own wording against the item they picked", () => {
    const before = frozenCopy();

    const next = renameItem(base, REACHABLE, 0, 0, "Clients");

    expect(next.sections[0].items).toEqual([
      { id: "Account", rename: "Clients" },
      { id: "Contact", rename: "People" }
    ]);
    // The other section is not somewhere a rename can reach.
    expect(next.sections[1].items).toEqual([{ id: "standard-OurSite" }]);
    expect(base).toEqual(before);
  });

  it("writes the rename and never the id, so the item still points where it did", () => {
    // Criterion 7 in one assertion: `id` is what the navigation target is
    // resolved from, and it is not the field a rename writes.
    const next = renameItem(base, REACHABLE, 0, 1, "Contacts of mine");

    expect(next.sections[0].items[1].id).toBe("Contact");
    expect(resolveLayout(next, ALL_TABS)[0].items[1]).toEqual({
      id: "Contact",
      label: "Contacts of mine",
      pageReference: CONTACT.pageReference
    });
  });

  it("clears the rename, leaving no key behind in the payload at all", () => {
    // Cleared means *absent*, not an empty string: the serialiser is asserted
    // against an exact key set, and an empty rename in the payload would be a
    // value that means nothing sitting where one that means something goes.
    const next = renameItem(base, REACHABLE, 0, 1, "");

    expect(next.sections[0].items[1]).toEqual({ id: "Contact" });
    expect(payloadItem(next, 0, 1)).toEqual({ id: "Contact" });
    expect(Object.keys(payloadItem(next, 0, 1))).toEqual(["id"]);
  });

  it("treats an all-whitespace rename as a clearing, and trims the rest", () => {
    expect(
      renameItem(base, REACHABLE, 0, 1, "   ").sections[0].items[1]
    ).toEqual({ id: "Contact" });
    expect(
      renameItem(base, REACHABLE, 0, 0, "  Clients  ").sections[0].items[0]
    ).toEqual({ id: "Account", rename: "Clients" });
  });

  it("clears the rename when the wording committed is the platform label itself", () => {
    // "Call this what Salesforce calls it" has one stored form, whichever
    // route reached it: the key's absence. Storing the platform label as a
    // rename would look identical on screen and quietly cost that item
    // criterion 6 — a later org relabelling would stop reaching it — and it
    // would make an item that already has a rename behave differently from an
    // item that has none under exactly the same keystrokes.
    const next = renameItem(base, ALL_TABS, 0, 1, "Contacts");

    expect(next.sections[0].items[1]).toEqual({ id: "Contact" });
    expect(payloadItem(next, 0, 1)).toEqual({ id: "Contact" });
    // Which is the whole point of it: the org relabels and the item follows.
    const relabelled = [ACCOUNT, { ...CONTACT, label: "People" }, OUR_SITE];
    expect(resolveLayout(next, relabelled)[0].items[1].label).toBe("People");
  });

  it("renames the item the user picked when an earlier one is out of reach", () => {
    // The resolved-versus-stored seam. `Account` is stored first and is not
    // accessible, so the first item *on screen* is `Contact` — and a rename
    // that ran the rendered index into the stored list would label an item the
    // user cannot see and leave the one they picked alone.
    const reachable = tabsFor("Contact", "standard-OurSite");

    const next = renameItem(base, reachable, 0, 0, "Clients");

    expect(next.sections[0].items).toEqual([
      { id: "Account" },
      { id: "Contact", rename: "Clients" }
    ]);
  });

  it("hands back copies, not the caller's own section and item objects", () => {
    const next = renameItem(base, REACHABLE, 0, 0, "Clients");

    next.sections.forEach((section, at) => {
      expect(section).not.toBe(base.sections[at]);
      expect(section.items).not.toBe(base.sections[at].items);
      section.items.forEach((item, index) => {
        expect(item).not.toBe(base.sections[at].items[index]);
      });
    });
  });

  it("survives a round trip through the payload, so the wording is what reloads", () => {
    const renamed = renameItem(base, REACHABLE, 0, 0, "Clients");

    expect(
      deserializeLayout(serializeLayout(renamed)).sections[0].items
    ).toEqual([
      { id: "Account", rename: "Clients" },
      { id: "Contact", rename: "People" }
    ]);
  });

  it("leaves the layout alone when it names a section or an item that is not there", () => {
    expect(renameItem(base, REACHABLE, 7, 0, "Clients")).toEqual(base);
    expect(renameItem(base, REACHABLE, 0, 9, "Clients")).toEqual(base);
    expect(renameItem(base, REACHABLE, 0, -1, "Clients")).toEqual(base);
    // Nothing is reachable, so no rendered position names anything.
    expect(renameItem(base, [], 0, 0, "Clients")).toEqual(base);
  });
});

describe("removeItem", () => {
  const REACHABLE = tabsFor("Account", "Contact", "standard-OurSite");
  let base;

  beforeEach(() => {
    base = {
      sections: [
        {
          name: "Selling",
          columns: 3,
          items: [{ id: "Account" }, { id: "Contact", rename: "People" }]
        },
        { name: "Support", columns: 2, items: [{ id: "standard-OurSite" }] }
      ]
    };
  });

  it("takes the item out of its section and leaves the others alone", () => {
    const next = removeItem(base, REACHABLE, 0, 0);

    expect(next.sections[0].items).toEqual([
      { id: "Contact", rename: "People" }
    ]);
    expect(next.sections[1].items).toEqual([{ id: "standard-OurSite" }]);
  });

  it("removes the item the user can see when an earlier one is out of reach", () => {
    // The fixture shape slice 05's critique established the suite had
    // nowhere: a stored id the running user cannot reach, sitting *before*
    // the one being removed, so the rendered index and the stored index
    // disagree. That is the seam slice 05 shipped a corruption on.
    const layout = {
      sections: [
        {
          name: "Selling",
          columns: 3,
          items: [
            { id: "Account" },
            { id: "Contact" },
            { id: "standard-OurSite" }
          ]
        }
      ]
    };
    const reachable = tabsFor("Contact", "standard-OurSite");

    // Position 0 on screen is `Contact`, not the stored `Account`.
    const next = removeItem(layout, reachable, 0, 0);

    expect(next.sections[0].items).toEqual([
      { id: "Account" },
      { id: "standard-OurSite" }
    ]);
  });

  it("leaves an item the user cannot see exactly where it was stored", () => {
    const layout = {
      sections: [
        {
          name: "Selling",
          columns: 3,
          items: [
            { id: "Contact" },
            { id: "Account" },
            { id: "standard-OurSite" }
          ]
        }
      ]
    };
    const reachable = tabsFor("Contact", "standard-OurSite");

    // Removes `standard-OurSite`, which is rendered second. `Account` is
    // unreachable and must keep its stored position between the two.
    const next = removeItem(layout, reachable, 0, 1);

    expect(next.sections[0].items).toEqual([
      { id: "Contact" },
      { id: "Account" }
    ]);
  });

  it("removes one copy when a section holds the same id twice", () => {
    const layout = {
      sections: [
        {
          name: "Selling",
          columns: 3,
          items: [{ id: "Account" }, { id: "Contact" }, { id: "Account" }]
        }
      ]
    };

    expect(removeItem(layout, REACHABLE, 0, 2).sections[0].items).toEqual([
      { id: "Account" },
      { id: "Contact" }
    ]);
  });

  it("leaves the layout alone when it names a section or an item that is not there", () => {
    expect(removeItem(base, REACHABLE, 7, 0)).toEqual(base);
    expect(removeItem(base, REACHABLE, 0, 9)).toEqual(base);
    expect(removeItem(base, REACHABLE, 0, -1)).toEqual(base);
    expect(removeItem(base, [], 0, 0)).toEqual(base);
  });

  it("hands back copies, not the caller's own section and item objects", () => {
    const next = removeItem(base, REACHABLE, 0, 0);

    next.sections.forEach((section, at) => {
      expect(section).not.toBe(base.sections[at]);
      expect(section.items).not.toBe(base.sections[at].items);
      // Per *item* too, and not only per array. A `filter` over the caller's
      // own list produces a new array holding the caller's own objects, which
      // passes the two assertions above and shares every item — so writing to
      // one of them reaches back into the layout the caller still holds.
      section.items.forEach((item) => {
        expect(base.sections[at].items).not.toContain(item);
      });
    });

    next.sections[1].items[0].rename = "Written through";
    expect(base.sections[1].items[0]).toEqual({ id: "standard-OurSite" });
    expect(base.sections[0].items).toHaveLength(2);
  });

  it("survives a round trip through the payload, so the removal is what reloads", () => {
    const removed = removeItem(base, REACHABLE, 0, 0);

    expect(deserializeLayout(serializeLayout(removed)).sections).toEqual([
      {
        name: "Selling",
        columns: 3,
        items: [{ id: "Contact", rename: "People" }]
      },
      { name: "Support", columns: 2, items: [{ id: "standard-OurSite" }] }
    ]);
  });
});

describe("availableTabs", () => {
  it("offers every reachable tab that is in no section of the layout", () => {
    const layout = {
      sections: [{ name: "Selling", columns: 3, items: [{ id: "Account" }] }]
    };

    expect(availableTabs(layout, ALL_TABS)).toEqual([
      { id: "Contact", label: "Contacts" },
      { id: "standard-OurSite", label: "Our Site" }
    ]);
  });

  it("never offers a tab the running user cannot reach", () => {
    const layout = { sections: [{ name: "Selling", columns: 3, items: [] }] };

    // `Our Site` is stored nowhere and is also not in the accessible list, so
    // it is not the picker's to offer — the whole component is scoped to the
    // running user's access and never wider.
    expect(availableTabs(layout, [ACCOUNT, CONTACT])).toEqual([
      { id: "Account", label: "Accounts" },
      { id: "Contact", label: "Contacts" }
    ]);
  });

  it("looks across every section, not only the first", () => {
    const layout = {
      sections: [
        { name: "Selling", columns: 3, items: [{ id: "Account" }] },
        { name: "Support", columns: 2, items: [{ id: "standard-OurSite" }] }
      ]
    };

    expect(availableTabs(layout, ALL_TABS)).toEqual([
      { id: "Contact", label: "Contacts" }
    ]);
  });

  it("offers a tab back once the section holding it is deleted", () => {
    const layout = {
      sections: [
        { name: "Selling", columns: 3, items: [{ id: "Account" }] },
        {
          name: "Support",
          columns: 2,
          items: [{ id: "Contact" }, { id: "standard-OurSite" }]
        }
      ]
    };

    expect(availableTabs(layout, ALL_TABS)).toEqual([]);
    expect(availableTabs(deleteSection(layout, 1), ALL_TABS)).toEqual([
      { id: "Contact", label: "Contacts" },
      { id: "standard-OurSite", label: "Our Site" }
    ]);
  });

  it("offers a removed item back", () => {
    const layout = {
      sections: [
        {
          name: "Selling",
          columns: 3,
          items: [
            { id: "Account" },
            { id: "Contact" },
            { id: "standard-OurSite" }
          ]
        }
      ]
    };

    expect(availableTabs(layout, ALL_TABS)).toEqual([]);
    expect(availableTabs(removeItem(layout, ALL_TABS, 0, 1), ALL_TABS)).toEqual(
      [{ id: "Contact", label: "Contacts" }]
    );
  });

  it("lists a tab under its Salesforce label, never under a rename in the layout", () => {
    // A rename belongs to a layout *entry*, and a tab that is not in the
    // layout has no entry and therefore no rename. This pins the direction
    // that is expressible: the id renamed in a section is not offered at all,
    // and the one that is offered carries the platform's current wording even
    // though a rename sits in the same payload.
    const layout = {
      sections: [
        {
          name: "Selling",
          columns: 3,
          items: [{ id: "Account", rename: "Clients" }]
        }
      ]
    };
    const relabelled = [
      { ...ACCOUNT, label: "Accts" },
      { ...CONTACT, label: "Ppl" }
    ];

    expect(availableTabs(layout, relabelled)).toEqual([
      { id: "Contact", label: "Ppl" }
    ]);
  });

  it("offers everything when the layout has no sections at all", () => {
    expect(availableTabs({ sections: [] }, ALL_TABS)).toEqual([
      { id: "Account", label: "Accounts" },
      { id: "Contact", label: "Contacts" },
      { id: "standard-OurSite", label: "Our Site" }
    ]);
    expect(availableTabs(undefined, ALL_TABS)).toHaveLength(3);
    expect(availableTabs({ sections: [] }, undefined)).toEqual([]);
  });
});

describe("addItemToSection", () => {
  let base;

  beforeEach(() => {
    base = {
      sections: [
        { name: "Selling", columns: 3, items: [{ id: "Account" }] },
        { name: "Support", columns: 2, items: [{ id: "Contact" }] }
      ]
    };
  });

  it("puts the tab in the section it was asked for, at the end", () => {
    const next = addItemToSection(base, ALL_TABS, 1, "standard-OurSite");

    expect(next.sections[0].items).toEqual([{ id: "Account" }]);
    expect(next.sections[1].items).toEqual([
      { id: "Contact" },
      { id: "standard-OurSite" }
    ]);
  });

  it("puts it in the first section as readily as in the second", () => {
    // The mirror of slice 05's row 13: a fixture that only ever adds to one
    // section cannot tell "the section it was asked for" from a constant.
    const next = addItemToSection(base, ALL_TABS, 0, "standard-OurSite");

    expect(next.sections[0].items).toEqual([
      { id: "Account" },
      { id: "standard-OurSite" }
    ]);
    expect(next.sections[1].items).toEqual([{ id: "Contact" }]);
  });

  it("stores {id} and nothing else — no label, no rename, no pageReference", () => {
    const next = addItemToSection(base, ALL_TABS, 0, "standard-OurSite");

    expect(Object.keys(next.sections[0].items[1])).toEqual(["id"]);
  });

  it("refuses a tab the running user cannot reach", () => {
    expect(
      addItemToSection(base, [ACCOUNT, CONTACT], 0, "standard-OurSite")
    ).toEqual(base);
  });

  it("refuses a tab that is already somewhere in the layout", () => {
    // Two entries with the same id in one section is a duplicated LWC `key`,
    // which the framework refuses to render; across two sections it is a
    // shape no gesture this Navigator ships should be able to create.
    expect(addItemToSection(base, ALL_TABS, 0, "Account")).toEqual(base);
    expect(addItemToSection(base, ALL_TABS, 0, "Contact")).toEqual(base);
  });

  it("leaves the layout alone when the section is not there", () => {
    expect(addItemToSection(base, ALL_TABS, 7, "standard-OurSite")).toEqual(
      base
    );
    expect(addItemToSection(base, ALL_TABS, -1, "standard-OurSite")).toEqual(
      base
    );
    expect(addItemToSection(base, ALL_TABS, 0, undefined)).toEqual(base);
  });

  it("leaves an item the user cannot see exactly where it was stored", () => {
    const layout = {
      sections: [
        {
          name: "Selling",
          columns: 3,
          items: [{ id: "standard-OurSite" }, { id: "Account" }]
        }
      ]
    };

    // `standard-OurSite` is stored but unreachable, so it does not render —
    // and adding must not renumber or drop it.
    const next = addItemToSection(layout, [ACCOUNT, CONTACT], 0, "Contact");

    expect(next.sections[0].items).toEqual([
      { id: "standard-OurSite" },
      { id: "Account" },
      { id: "Contact" }
    ]);
  });

  it("hands back copies, not the caller's own section and item objects", () => {
    const next = addItemToSection(base, ALL_TABS, 0, "standard-OurSite");

    next.sections.forEach((section, at) => {
      expect(section).not.toBe(base.sections[at]);
      expect(section.items).not.toBe(base.sections[at].items);
      section.items.forEach((item) => {
        expect(base.sections[at].items).not.toContain(item);
      });
    });

    next.sections[1].items[0].rename = "Written through";
    expect(base.sections[1].items[0]).toEqual({ id: "Contact" });
    expect(base.sections[0].items).toHaveLength(1);
  });

  it("survives a round trip through the payload, so the addition is what reloads", () => {
    const added = addItemToSection(base, ALL_TABS, 1, "standard-OurSite");

    expect(deserializeLayout(serializeLayout(added)).sections[1].items).toEqual(
      [{ id: "Contact" }, { id: "standard-OurSite" }]
    );
  });

  it("is the inverse of removeItem — an item removed can be added back", () => {
    const removed = removeItem(base, ALL_TABS, 0, 0);
    expect(availableTabs(removed, ALL_TABS)).toContainEqual({
      id: "Account",
      label: "Accounts"
    });

    const restored = addItemToSection(removed, ALL_TABS, 0, "Account");
    expect(restored.sections[0].items).toEqual([{ id: "Account" }]);
  });
});
