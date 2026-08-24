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
  moveSection
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

    const next = moveItemWithinSection(base, 0, 0, 2);

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
    const next = moveItemWithinSection(base, 0, 0, 2);

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

    const next = moveItemWithinSection(renamed, 0, 0, 1);

    expect(next.sections[0].items).toEqual([
      { id: "Contact" },
      { id: "Account", rename: "Clients" }
    ]);
  });

  it("leaves every other section, and the section's own name and columns, alone", () => {
    const next = moveItemWithinSection(base, 0, 2, 0);

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
          moveItemWithinSection(base, 0, from, to).sections[0].items.map(
            (item) => item.id
          )
        ).toEqual(reorder(ids, from, to));
      }
    }
  );

  it("leaves the layout alone when it names a section that is not there", () => {
    expect(moveItemWithinSection(base, 7, 0, 1)).toEqual(base);
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

  function frozenCopy() {
    return JSON.parse(JSON.stringify(base));
  }

  function idsOf(layout, sectionIndex) {
    return layout.sections[sectionIndex].items.map((item) => item.id);
  }

  it("takes the item out of one section and puts it into another at the chosen position", () => {
    const before = frozenCopy();

    const next = moveItemBetweenSections(base, 0, 1, 1, 0);

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
    const next = moveItemBetweenSections(base, 0, 0, 1, undefined);

    expect(idsOf(next, 1)).toEqual([
      "standard-ActionHub",
      "standard-ShieldHome",
      "Account"
    ]);
  });

  it("carries the item's rename across the move, because a rename is the user's own wording", () => {
    const next = moveItemBetweenSections(base, 0, 0, 1, 0);

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

        expect(idsOf(moveItemBetweenSections(base, 0, from, 1, to), 1)).toEqual(
          reorder(appended, appended.length - 1, to)
        );
      }
    }
  );

  it("leaves the layout unchanged when the destination is the section it came from", () => {
    // Criterion 7. Structural rather than by care: the function itself
    // refuses, so no caller has to remember to.
    expect(moveItemBetweenSections(base, 0, 0, 0, 2)).toEqual(base);
  });

  it("leaves every other section's name, columns and items alone", () => {
    const next = moveItemBetweenSections(base, 0, 1, 1, 0);

    expect(next.sections[0].name).toBe("First");
    expect(next.sections[0].columns).toBe(2);
    expect(next.sections[1].name).toBe("Second");
    expect(next.sections[1].columns).toBe(3);
  });

  it("hands back copies, not the caller's own section and item objects", () => {
    // Structural equality cannot tell a copy from a shared reference, and the
    // module's docblock promises a copy. The same blind spot the two other
    // move functions were bitten by.
    const next = moveItemBetweenSections(base, 0, 0, 1, 0);

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
    const moved = moveItemBetweenSections(base, 0, 1, 1, 0);

    expect(idsOf(deserializeLayout(serializeLayout(moved)), 1)).toEqual([
      "Contact",
      "standard-ActionHub",
      "standard-ShieldHome"
    ]);
  });

  it("leaves the layout alone when either section is not there", () => {
    expect(moveItemBetweenSections(base, 7, 0, 1, 0)).toEqual(base);
    expect(moveItemBetweenSections(base, 0, 0, 7, 0)).toEqual(base);
  });

  it("leaves the layout alone when the item is not there", () => {
    expect(moveItemBetweenSections(base, 0, 9, 1, 0)).toEqual(base);
    expect(moveItemBetweenSections(base, 0, -1, 1, 0)).toEqual(base);
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
