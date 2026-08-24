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
  setSectionColumns
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
    for (let columns = MIN_COLUMNS; columns <= MAX_COLUMNS; columns += 1) {
      expect(setSectionColumns(base, 0, columns).sections[0].columns).toBe(
        columns
      );
    }
  });

  it("clamps a column count outside one to six rather than storing it", () => {
    expect(setSectionColumns(base, 0, 9).sections[0].columns).toBe(MAX_COLUMNS);
    expect(setSectionColumns(base, 0, 0).sections[0].columns).toBe(MIN_COLUMNS);
    expect(setSectionColumns(base, 1, 4).sections[0].columns).toBe(2);
  });

  it("leaves the layout alone when an operation names a section that is not there", () => {
    expect(renameSection(base, 7, "Nope")).toEqual(base);
    expect(deleteSection(base, 7)).toEqual(base);
    expect(setSectionColumns(base, 7, 4)).toEqual(base);
  });
});
