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

// ---------------------------------------------------------------------------
// The placement maths. One function, `reorder`, and two callers that apply it
// to the two axes a user can rearrange: items inside a section, and the
// sections themselves.
//
// It lives here, in a module with no component in it, on purpose. Both the
// mouse path and the keyboard path route into `moveItemWithinSection`, so
// dropping an item at position three and walking it there with three arrow
// presses cannot disagree about where it lands — they are not two
// implementations that happen to match, they are one function called twice.
// It is also the seam the tests can actually reach: jsdom has no `DragEvent`
// and no `DataTransfer`, so the gesture is untestable, while this is a pure
// function of its arguments.
// ---------------------------------------------------------------------------

/**
 * Moves one entry of a list to a new position, returning a new array. The
 * input list is never touched.
 *
 * A destination past either end is **clamped, not rejected**, because that is
 * the keyboard path's ordinary edge rather than an error: ArrowUp on the first
 * item asks for -1 and ArrowDown on the last asks for `length`, and in both
 * cases the item must stay in the list at the end it is already at. A source
 * index that is not a real position is a different matter — there is no entry
 * to move — so the list comes back as it was.
 */
export function reorder(list, from, to) {
  const items = Array.isArray(list) ? list.slice() : [];
  const destination = Number(to);

  if (
    !Number.isInteger(from) ||
    from < 0 ||
    from >= items.length ||
    !Number.isFinite(destination)
  ) {
    return items;
  }

  const at = Math.max(0, Math.min(items.length - 1, Math.trunc(destination)));
  const [moved] = items.splice(from, 1);
  items.splice(at, 0, moved);
  return items;
}

// ---------------------------------------------------------------------------
// The seam between what the user sees and what is stored.
//
// `resolveLayout` drops any stored id the running user cannot reach, so the
// list a user points at is shorter than the list being rewritten, and the two
// agree on position only when nothing was filtered. A gesture names a position
// in the *resolved* list — the section indexes `renderItems` over it, and that
// is the number every event carries upward.
//
// So every move function below takes `(layout, tabs)`, exactly as
// `resolveLayout` does, and reads its indices as resolved ones. There is no
// exported function here that takes a stored index, which is the point: a
// caller cannot pass a resolved index into a stored-layout function by
// forgetting something, because there is no such function to pass it to. The
// translation happens once, here, rather than at each of the three call sites.
//
// This does not put `resolveLayout` into stored state, and must not: the
// accessible set decides *which entry a position names*, never what is written.
// An id the user cannot reach is neither moved nor dropped nor renumbered — it
// stays at the stored position it was at, which is what makes restoring access
// restore the item in place.
// ---------------------------------------------------------------------------

/** The ids the running user can actually reach, as a set. */
function accessibleIdsOf(tabs) {
  return new Set((tabs || []).map((tab) => tab.id));
}

/**
 * What Salesforce currently calls the tab an item points at, or "" when the
 * running user cannot reach it. Read from the same live tab source
 * `resolveLayout` reads the rendered label from, so "the wording on screen
 * with no rename" is one fact with one definition.
 */
function platformLabelOf(tabs, id) {
  const tab = (tabs || []).find((candidate) => candidate.id === id);
  return tab ? textOf(tab.label) : "";
}

/**
 * The stored positions of the items a user can see, in the order they see
 * them. Entry `n` is the stored index of the item rendered at position `n`,
 * so this array *is* the translation.
 */
function renderedPositions(items, accessibleIds) {
  const positions = [];
  items.forEach((item, at) => {
    if (accessibleIds.has(item.id)) {
      positions.push(at);
    }
  });
  return positions;
}

/**
 * The stored index of the item rendered at `resolvedIndex`, or `undefined`
 * when that names no item on screen — which is the same "there is nothing
 * there to move" `reorder` already answers with an unchanged list.
 */
function storedSource(positions, resolvedIndex) {
  return Number.isInteger(resolvedIndex) &&
    resolvedIndex >= 0 &&
    resolvedIndex < positions.length
    ? positions[resolvedIndex]
    : undefined;
}

/**
 * The stored index a move to rendered position `resolvedIndex` should land at.
 *
 * The clamp is applied on the resolved list rather than on the stored one,
 * because the resolved list is the one the gesture counted along: ArrowUp on
 * the first item the user can see asks for -1 and must stay at the top of what
 * they can see, not jump above an entry that is not on screen. A destination
 * that is not a number is passed through untouched, so `reorder` goes on
 * refusing it.
 */
function storedDestination(positions, resolvedIndex) {
  const wanted = Number(resolvedIndex);
  if (!Number.isFinite(wanted)) {
    return wanted;
  }
  const at = Math.max(0, Math.min(positions.length - 1, Math.trunc(wanted)));
  return positions[at];
}

/**
 * Reorders one section's items. The other sections are untouched.
 *
 * `from` and `to` are positions in the list the user is looking at; `tabs` is
 * the live accessible tab list, the same argument `resolveLayout` takes, and
 * it is what turns those into positions in the stored list.
 */
export function moveItemWithinSection(layout, tabs, sectionIndex, from, to) {
  const sections = sectionsOf(layout);
  const unchanged = { sections: sections.map(copySection) };
  if (!isPresent(sections, sectionIndex)) {
    return unchanged;
  }

  const positions = renderedPositions(
    itemsOf(sections[sectionIndex]),
    accessibleIdsOf(tabs)
  );
  const storedFrom = storedSource(positions, from);
  if (storedFrom === undefined) {
    return unchanged;
  }
  const storedTo = storedDestination(positions, to);

  return replaceSection(layout, sectionIndex, (section) => {
    const copy = copySection(section);
    return { ...copy, items: reorder(copy.items, storedFrom, storedTo) };
  });
}

/**
 * Moves an item out of one section and into another, at a chosen position.
 *
 * **The placement is `reorder`, not a second implementation of it.** The item
 * is appended to a copy of the destination's list and then `reorder`ed from
 * that last slot to where it is wanted, so the cross-section move and the
 * within-section reorder are the same function applied to the same kind of
 * list — which is the criterion this exists to satisfy, and the reason
 * `reorder`'s clamp applies here for free. A destination past either end
 * therefore lands at that end rather than being rejected, exactly as it does
 * within a section.
 *
 * `fromIndex` and `toIndex` are positions in the lists the user is looking at,
 * and `tabs` is what turns them into positions in the stored lists — see the
 * note on the seam above `moveItemWithinSection`.
 *
 * `toIndex` may be omitted, which is what the Move to… menu does: that menu
 * names a section and not a slot, so the item goes to the end of it.
 *
 * **A destination that already lists the moved id keeps one copy, not two.**
 * No gesture this Navigator ships can produce that precondition, but a
 * hand-edited payload can arrive with one, and this is the first operation
 * that can turn a cross-section duplicate into a within-section one — two
 * entries with the same `key`, which LWC refuses to render, and a duplicated
 * entry in everything written afterwards. The stale entry gives way to the one
 * the user actually moved, so the item lands where they asked and carries
 * their own `rename` rather than the abandoned copy's.
 *
 * **Moving an item into the section it is already in leaves the layout
 * unchanged**, rather than becoming a reorder within that section. That is
 * structural rather than a rule a caller has to remember: an item dropped
 * back onto its own section has been put back where it was, and
 * `moveItemWithinSection` is the function for the case where a *position*
 * within one section was actually chosen.
 */
export function moveItemBetweenSections(
  layout,
  tabs,
  fromSection,
  fromIndex,
  toSection,
  toIndex
) {
  const sections = sectionsOf(layout).map(copySection);

  if (
    !isPresent(sections, fromSection) ||
    !isPresent(sections, toSection) ||
    fromSection === toSection
  ) {
    return { sections };
  }

  const accessibleIds = accessibleIdsOf(tabs);
  const source = sections[fromSection];
  const storedFrom = storedSource(
    renderedPositions(source.items, accessibleIds),
    fromIndex
  );
  if (storedFrom === undefined) {
    return { sections };
  }

  const moved = source.items[storedFrom];
  // Removed by stored position rather than by identity: a section holding two
  // copies of one id must lose the copy the user picked up, not both.
  source.items = source.items.filter((_item, at) => at !== storedFrom);

  const destination = sections[toSection];
  const appended = destination.items
    .filter((item) => item.id !== moved.id)
    .concat([moved]);
  const last = appended.length - 1;
  // Counted over the appended list, so the moved item — which the user could
  // see, or they could not have picked it up — is the last rendered position
  // and a destination past the end lands there.
  const positions = renderedPositions(appended, accessibleIds);
  destination.items = reorder(
    appended,
    last,
    toIndex === undefined || toIndex === null
      ? last
      : storedDestination(positions, toIndex)
  );

  return { sections };
}

/**
 * Sets, or clears, one item's rename — the user's own wording for a tab.
 *
 * **It writes `rename` and it does not write `id`.** The label rendered is
 * `rename ?? platformLabel` and the navigation target is resolved from the
 * live tab source by `id`, so the two are different fields and a rename cannot
 * reach the target. That is the whole of the criterion, and it is structural
 * rather than a rule anyone has to remember: the one place a stored item is
 * built is `storedItem`, which this calls, and it takes the id it was already
 * holding.
 *
 * **Clearing is the absence of the key, not an empty string.** A rename of ""
 * — or of nothing but whitespace — puts the item back under its Salesforce
 * label, and `storedItem` emits no `rename` at all for it. An empty string
 * left in the payload would be a value that means nothing sitting where one
 * that means something goes, and the serialiser is asserted against an exact
 * key set.
 *
 * **And so is the platform label itself.** "Call this what Salesforce calls
 * it" has one stored form, whichever route the user reached it by — emptying
 * the box, or typing the wording that is already on the tab. Storing the
 * platform label as a `rename` would render identically and quietly cost that
 * item criterion 6: a later org relabelling would stop reaching it. It would
 * also make an item that *has* a rename behave differently from one that has
 * none under exactly the same keystrokes, which is a disagreement about the
 * same end state. The consequence is deliberate and worth stating: typing the
 * platform label into a renamed item is a second way to clear the rename.
 * Pinning the current platform wording against a future relabelling is not on
 * offer, because criterion 6 is the promise that it is not.
 *
 * `itemIndex` is a position in the list the user is looking at, and `tabs` is
 * what turns it into a position in the stored list — see the note on the seam
 * above `moveItemWithinSection`. Nothing else about the section is touched, so
 * an id the running user cannot reach keeps its stored position through a
 * rename of one of its neighbours.
 */
export function renameItem(layout, tabs, sectionIndex, itemIndex, rename) {
  const sections = sectionsOf(layout);
  const unchanged = { sections: sections.map(copySection) };
  if (!isPresent(sections, sectionIndex)) {
    return unchanged;
  }

  const positions = renderedPositions(
    itemsOf(sections[sectionIndex]),
    accessibleIdsOf(tabs)
  );
  const storedAt = storedSource(positions, itemIndex);
  if (storedAt === undefined) {
    return unchanged;
  }

  const typed = textOf(rename).trim();
  const items = itemsOf(sections[sectionIndex]);
  const wording =
    typed === platformLabelOf(tabs, items[storedAt].id) ? "" : typed;

  return replaceSection(layout, sectionIndex, (section) => {
    const copy = copySection(section);
    return {
      ...copy,
      items: copy.items.map((item, at) => {
        return at === storedAt ? storedItem(item.id, wording) : item;
      })
    };
  });
}

/**
 * Takes one item out of a section.
 *
 * `itemIndex` is a position in the list the user is looking at, and `tabs` is
 * what turns it into a position in the stored list — see the note on the seam
 * above `moveItemWithinSection`. This is the whole of the settled rule applied
 * to a new operation, and it matters here more than anywhere: removing "the
 * item at visible position 2" must remove the item the user can see, not the
 * stored entry that happens to sit at index 2 behind an id they cannot reach.
 *
 * Removal is by stored *position* rather than by identity, for the reason
 * `moveItemBetweenSections` gives: a section holding two copies of one id must
 * lose the copy the user pointed at, not both.
 *
 * **Nothing about the removed item is recorded anywhere.** An item lives in a
 * layout and nowhere else, so an item that is in no section is simply one
 * `availableTabs` will offer back — which is what makes "add it again later"
 * fall out of the store's shape rather than needing a bin to be kept.
 */
export function removeItem(layout, tabs, sectionIndex, itemIndex) {
  const sections = sectionsOf(layout);
  const unchanged = { sections: sections.map(copySection) };
  if (!isPresent(sections, sectionIndex)) {
    return unchanged;
  }

  const positions = renderedPositions(
    itemsOf(sections[sectionIndex]),
    accessibleIdsOf(tabs)
  );
  const storedAt = storedSource(positions, itemIndex);
  if (storedAt === undefined) {
    return unchanged;
  }

  return replaceSection(layout, sectionIndex, (section) => {
    const copy = copySection(section);
    return {
      ...copy,
      items: copy.items.filter((_item, at) => at !== storedAt)
    };
  });
}

/**
 * What the picker offers: every tab the running user can reach that is not
 * already somewhere in this layout, in the tab source's own order.
 *
 * Two properties, and both are load-bearing rather than incidental.
 *
 * **It is a subset of `tabs`, never wider.** The list is built by filtering
 * the accessible tabs, not by walking the stored layout, so there is no input
 * on which it can name a tab the user cannot reach — an id stored in a section
 * they have lost access to is simply not in `tabs` and so cannot appear here
 * either. That is the same intersection `resolveLayout` performs, in the same
 * direction, and it is Outcome 1's one failure mode closed by construction.
 *
 * **The label is the platform's, and there is nowhere for a rename to come
 * from.** A rename is a property of a layout *entry*, and by definition every
 * tab in this list has no entry — that is what "not already in the layout"
 * means. So the picker lists Salesforce's own wording not by a rule someone
 * has to remember but because the alternative does not exist to be reached.
 *
 * And "in no section" is read across the whole layout, so deleting a section
 * returns its items here for free: `deleteSection` drops the section and the
 * ids it held stop being anywhere, which is precisely the condition below.
 */
export function availableTabs(layout, tabs) {
  const placed = new Set();
  sectionsOf(layout).forEach((section) => {
    itemsOf(section).forEach((item) => placed.add(item.id));
  });

  return (tabs || [])
    .filter((tab) => !placed.has(tab.id))
    .map((tab) => ({ id: tab.id, label: textOf(tab.label) }));
}

/**
 * Puts a tab into a section, at the end of it.
 *
 * Takes an **id and not an index**, which is what keeps it clear of the
 * resolved-versus-stored seam entirely: the picker names a tab, never a
 * position, so there is no index to translate and no way to get one wrong.
 * `tabs` is still taken, and for a reason that is not translation — it is the
 * accessible set, and a tab that is not in it is refused. Adding an id the
 * running user cannot reach would put an item in their layout that never
 * renders, which is the render-time intersection working exactly backwards.
 *
 * **An id already somewhere in the layout is refused.** Within one section
 * that would be two entries with the same `key`, which LWC will not render;
 * across two it is the precondition `moveItemBetweenSections` has to
 * deduplicate around. The picker does not offer such a tab in the first place
 * — `availableTabs` has already excluded it — so this is the same fact
 * enforced at the write rather than trusted from the caller.
 *
 * The stored item is built by `storedItem`, so it is `{id}` and nothing else:
 * no label, no `pageReference`, and no `rename`, because the user has not
 * given one. Everything derivable from the platform is derived at render time.
 */
export function addItemToSection(layout, tabs, sectionIndex, tabId) {
  const sections = sectionsOf(layout);
  const unchanged = { sections: sections.map(copySection) };
  if (!isPresent(sections, sectionIndex)) {
    return unchanged;
  }
  if (!accessibleIdsOf(tabs).has(tabId)) {
    return unchanged;
  }
  const alreadyPlaced = sections.some((section) =>
    itemsOf(section).some((item) => item.id === tabId)
  );
  if (alreadyPlaced) {
    return unchanged;
  }

  return replaceSection(layout, sectionIndex, (section) => {
    const copy = copySection(section);
    return {
      ...copy,
      items: copy.items.concat([storedItem(tabId, undefined)])
    };
  });
}

/** Reorders the sections themselves — the same `reorder`, a different axis. */
export function moveSection(layout, from, to) {
  return { sections: reorder(sectionsOf(layout).map(copySection), from, to) };
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

/**
 * Whether `index` names a real position in `list`. Used on both axes — the
 * sections of a layout and the items of a section — because "is there
 * anything there to move?" is the same question either way.
 */
function isPresent(list, index) {
  return Number.isInteger(index) && index >= 0 && index < list.length;
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
