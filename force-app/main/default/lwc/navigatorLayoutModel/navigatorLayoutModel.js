/**
 * The Navigator's layout maths, as pure functions with no LWC in the file.
 *
 * Everything here is a function of its arguments and returns new objects: a
 * layout is never mutated in place. That is not tidiness — it is the whole
 * mechanism behind one of this slice's criteria. An item whose tab the user
 * has lost access to stops rendering because `resolveLayout` intersects the
 * stored ids against the live accessible set on every render, and the stored
 * layout is left exactly as it was. Restoring access restores the item in its
 * original position for free, because the position never left the store.
 *
 * `serializeLayout` is the only route from the client into `Layout_JSON__c`,
 * and it emits an explicit set of keys — `schemaVersion`, and per section
 * `name`, `columns` and an ordered list of `{id, rename?}`. A label, an icon
 * URL or a `pageReference` that reaches it is therefore dropped by
 * construction rather than by a rule someone has to remember. Everything
 * derivable from the platform is derived at render time, so an org relabelling
 * a tab costs no write at all.
 *
 * The Apex controller normalises identically on both of its own paths and is
 * the authority on what lands in the field; this module is the client half of
 * the same contract, so a payload that never reaches the server (a layout the
 * user has only looked at) still has exactly one shape.
 */

/** The version this module writes. It reads {1, 2}. */
export const SCHEMA_VERSION = 2;

/** The oldest payload shape this module can read: items were bare id strings. */
const OLDEST_READABLE_SCHEMA_VERSION = 1;

export const MIN_COLUMNS = 1;
export const MAX_COLUMNS = 6;
export const DEFAULT_COLUMNS = 3;

/**
 * The name of the section a user who has never customised anything sees. It
 * is the App Launcher's own wording for the same list, which is what makes
 * the seeded state read as a starting point rather than as a thing the
 * Navigator invented.
 */
export const SEEDED_SECTION_NAME = "All Items";

/**
 * What a user with no layout record sees: every tab they can reach, in one
 * section. Computed, never written — no record exists until the user's first
 * actual change, or every user who opens the tab once would generate a row to
 * store something the platform already knows.
 */
export function buildSeededLayout(tabs) {
  return {
    sections: [
      {
        name: SEEDED_SECTION_NAME,
        columns: DEFAULT_COLUMNS,
        items: (tabs || []).map((tab) => ({ id: tab.id }))
      }
    ]
  };
}

/**
 * The render-time access intersection, and the only place a label or a
 * navigation target is attached to a stored item.
 *
 * Stored ids are looked up in the live accessible set; an id that is not
 * there simply does not render. Nothing is written, nothing is deleted, and
 * the layout passed in comes back untouched — which is what makes restoring
 * access restore the item in place.
 *
 * The label is `rename ?? platformLabel` and the target is resolved from the
 * live tab by `id`. They are different fields, so a rename cannot reach the
 * target.
 */
export function resolveLayout(layout, tabs) {
  const byId = new Map((tabs || []).map((tab) => [tab.id, tab]));

  return sectionsOf(layout).map((section, index) => {
    const columns = clampColumns(section.columns);
    const items = itemsOf(section)
      .filter((item) => byId.has(item.id))
      .map((item) => {
        const tab = byId.get(item.id);
        return {
          id: item.id,
          label: item.rename ? item.rename : tab.label,
          pageReference: tab.pageReference
        };
      });

    return {
      key: `${index}:${section.name}`,
      index,
      name: section.name,
      columns,
      columnClass: `rstk-nav-section__grid cols-${columns}`,
      items,
      hasItems: items.length > 0
    };
  });
}

/** Serialises a layout into the published payload contract. */
export function serializeLayout(layout) {
  return JSON.stringify({
    schemaVersion: SCHEMA_VERSION,
    sections: sectionsOf(layout).map((section) => ({
      name: textOf(section.name),
      columns: clampColumns(section.columns),
      items: itemsOf(section).map((item) => storedItem(item.id, item.rename))
    }))
  });
}

/**
 * Reads a payload back into a layout, dispatching on the version the payload
 * declares. A payload declaring no version is by definition from before the
 * key existed, which is v1.
 *
 * A blank or unparseable payload resolves to an empty layout rather than
 * throwing: the caller's next step is to show the user something, and there
 * is nothing to show. A payload from a *newer* Navigator is a different case
 * and does throw — silently rendering a subset of a layout the user built in
 * a newer version, and then autosaving that subset back over it, would lose
 * their work.
 */
export function deserializeLayout(rawJson) {
  let payload;
  try {
    payload = JSON.parse(rawJson || "{}");
  } catch {
    return { sections: [] };
  }
  if (payload === null || typeof payload !== "object") {
    return { sections: [] };
  }

  const version = numberOf(
    payload.schemaVersion,
    OLDEST_READABLE_SCHEMA_VERSION
  );
  if (version < OLDEST_READABLE_SCHEMA_VERSION || version > SCHEMA_VERSION) {
    throw new Error(
      `This layout was saved at schema version ${version}, which this version of the Navigator cannot read.`
    );
  }

  return {
    sections: sectionsOf(payload).map((section) => ({
      name: textOf(section.name),
      columns: clampColumns(section.columns),
      items: itemsOf(section).map((rawItem) => readItem(rawItem, version))
    }))
  };
}

/**
 * The one place the schema version changes what a payload *means*. In v1 an
 * item was a bare id string and there was no per-item rename; in v2 it is
 * `{id, rename?}`. Sections, names and column counts read the same at both.
 */
function readItem(rawItem, version) {
  if (version === OLDEST_READABLE_SCHEMA_VERSION) {
    return storedItem(textOf(rawItem), undefined);
  }
  return storedItem(textOf(rawItem && rawItem.id), rawItem && rawItem.rename);
}

/**
 * The single definition of a stored item, so the serialiser and the reader
 * cannot drift into emitting different keys. `rename` is present only when
 * the user set one — an absent rename and an empty one are the same thing,
 * and storing the empty one would put a value in the payload that means
 * nothing.
 */
function storedItem(id, rename) {
  const item = { id: textOf(id) };
  if (rename) {
    item.rename = textOf(rename);
  }
  return item;
}

// ---------------------------------------------------------------------------
// The section operations. Each returns a new layout; none mutates its input,
// so a caller can hand the result straight to reactive state and an autosave
// without wondering whether the previous value still exists.
// ---------------------------------------------------------------------------

export function addSection(layout, name) {
  return {
    sections: [
      ...sectionsOf(layout).map(copySection),
      { name: textOf(name), columns: DEFAULT_COLUMNS, items: [] }
    ]
  };
}

export function renameSection(layout, index, name) {
  return replaceSection(layout, index, (section) => ({
    ...copySection(section),
    name: textOf(name)
  }));
}

export function setSectionColumns(layout, index, columns) {
  return replaceSection(layout, index, (section) => ({
    ...copySection(section),
    columns: clampColumns(columns)
  }));
}

/**
 * Deleting a section does not discard its items: nothing about an item lives
 * anywhere but the platform, so an item that is in no section is simply one
 * the picker will offer back.
 */
export function deleteSection(layout, index) {
  const sections = sectionsOf(layout);
  if (!isPresent(sections, index)) {
    return { sections: sections.map(copySection) };
  }
  return {
    sections: sections.filter((_section, at) => at !== index).map(copySection)
  };
}

function replaceSection(layout, index, replacer) {
  const sections = sectionsOf(layout);
  const target = isPresent(sections, index) ? index : -1;
  return {
    sections: sections.map((section, at) => {
      return at === target ? replacer(section) : copySection(section);
    })
  };
}

function isPresent(sections, index) {
  return Number.isInteger(index) && index >= 0 && index < sections.length;
}

function copySection(section) {
  return {
    name: section.name,
    columns: section.columns,
    items: itemsOf(section).map((item) => ({ ...item }))
  };
}

function sectionsOf(layout) {
  return layout && Array.isArray(layout.sections) ? layout.sections : [];
}

function itemsOf(section) {
  return section && Array.isArray(section.items) ? section.items : [];
}

function textOf(raw) {
  return raw === null || raw === undefined ? "" : String(raw);
}

/**
 * The column range is part of the contract, not just of the UI. Clamping
 * here rather than at the menu is what keeps a `cols-12` class — which no
 * stylesheet defines, so the section would render as a single unstyled
 * column — from ever being computed, whatever route the value arrived by.
 */
function clampColumns(raw) {
  return Math.max(
    MIN_COLUMNS,
    Math.min(MAX_COLUMNS, numberOf(raw, DEFAULT_COLUMNS))
  );
}

function numberOf(raw, fallback) {
  const value = Number(raw);
  return Number.isFinite(value) ? Math.trunc(value) : fallback;
}
