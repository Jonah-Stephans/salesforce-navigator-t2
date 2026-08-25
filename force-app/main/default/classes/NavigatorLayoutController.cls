/**
 * The Salesforce Navigator's one Apex seam: read the running user's layouts,
 * and write one back.
 *
 * Three things here are load-bearing and are not stylistic choices.
 *
 * **Creation is a different method from update.** A previous project shipped a
 * single `saveLayout(layoutId, ...)` in which a null id meant two different
 * things to its two callers — "make me a new one" to the client, "update the
 * one that loads on arrival" to the server. In the running org, *New layout*
 * renamed and overwrote the existing layout instead of sitting beside it. So
 * `createLayout` takes no id at all and `updateLayout` refuses a null one,
 * which leaves no null for the two sides to disagree about.
 *
 * **Sharing is defence in depth, never the filter.** Every query is both
 * `WITH USER_MODE` *and* explicitly predicated on
 * `OwnerId = :UserInfo.getUserId()`. Either alone would do the job today; the
 * pair means a future sharing rule cannot quietly widen what this class
 * returns.
 *
 * **The payload is a published contract.** `Layout_JSON__c` is a Long Text
 * Area, and the platform will not migrate the inside of one across a package
 * upgrade. So `Schema_Version__c` is stamped on every write and the reader
 * dispatches on it — shipped from the first commit rather than when it is
 * first needed, because by then there are rows in the field.
 */
public with sharing class NavigatorLayoutController {
  /**
   * The version this class writes. It reads {1, 2} and writes 2. A row
   * carrying anything else was written by a newer Navigator than this one and
   * is refused rather than guessed at.
   */
  public static final Integer CURRENT_SCHEMA_VERSION = 2;

  private static final Integer OLDEST_READABLE_SCHEMA_VERSION = 1;
  private static final Integer MIN_COLUMNS = 1;
  private static final Integer MAX_COLUMNS = 6;

  /**
   * What a section carrying no `columns` key at all is stored at. It is 3
   * because `navigatorLayoutModel.DEFAULT_COLUMNS` is 3, and the two files are
   * the two halves of one payload contract: a fallback that differed would
   * mean a section written as a 1-column section here and read as a 3-column
   * section there. Out-of-range values are clamped to MIN/MAX; only an absent
   * value lands here.
   */
  private static final Integer DEFAULT_COLUMNS = 3;
  private static final String EMPTY_PAYLOAD = '{"sections":[]}';

  private static final String NULL_ID_MESSAGE =
    'updateLayout needs the id of the layout to update. A null id is not a request to ' +
    'update whichever layout happens to load first — call createLayout to make a new one.';

  /**
   * The same refusal, for the three methods this class gained when layouts
   * became switchable. Each takes an id and each refuses a null one, for the
   * reason `updateLayout` does: a null that reaches the server as "whichever
   * layout loads on arrival" is the shape of the bug this class was written
   * around, and there is no gesture in the Navigator that legitimately means
   * "switch to, rename, or delete a layout I cannot name".
   */
  private static String nullIdMessage(String methodName) {
    return methodName +
      ' needs the id of the layout to act on. A null id is not a request to act on ' +
      'whichever layout happens to load first.';
  }

  /**
   * What the component gets. A DTO rather than the SObject so that
   * `layoutJson` can be handed over already upgraded to the current schema,
   * whatever version the row was stored at.
   */
  public class LayoutDTO {
    @AuraEnabled
    public Id layoutId;
    @AuraEnabled
    public String name;
    @AuraEnabled
    public Boolean isActive;
    @AuraEnabled
    public Integer sortOrder;
    @AuraEnabled
    public Integer schemaVersion;
    @AuraEnabled
    public String layoutJson;
    /**
     * False when this class could not read the row's payload. The row still
     * comes back — a user's other layouts must not become unreachable
     * because one of them is at a version this package does not know, or
     * because an administrator hand-edited `Layout_JSON__c` into something
     * that is not a payload. `layoutJson` is null on such a row, so no caller
     * can render a guess at it.
     */
    @AuraEnabled
    public Boolean isReadable;
    @AuraEnabled
    public String unreadableReason;
  }

  // ---------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------

  /**
   * Every layout the running user owns. A row whose payload this class cannot
   * read is flagged rather than raised: it comes back with `isReadable` false,
   * no `layoutJson` and the reason, and the user's other layouts come back
   * intact beside it.
   *
   * Failing the whole call on the first unreadable row was worse than the
   * problem it reported. One row at a version from a newer package, or one an
   * administrator hand-edited (the permission set grants `allowEdit`), made
   * *every* layout that user owns unreachable — and the client, seeing no
   * layouts, would then have treated them as a first-time user and created a
   * rival active layout.
   */
  @AuraEnabled(cacheable=true)
  public static List<LayoutDTO> getLayouts() {
    return toDtos(ownLayouts());
  }

  /**
   * The read's own DTO walk, shared with the three methods below that hand
   * back the list the user is left with. One definition, so a layout reported
   * by a switch can never describe itself differently from the same layout
   * reported by the read.
   */
  private static List<LayoutDTO> toDtos(List<Navigator_Layout__c> rows) {
    List<LayoutDTO> layouts = new List<LayoutDTO>();
    for (Navigator_Layout__c row : rows) {
      try {
        layouts.add(toDto(row));
      } catch (Exception e) {
        layouts.add(unreadableDto(row, e.getMessage()));
      }
    }
    return layouts;
  }

  // ---------------------------------------------------------------------
  // Write — two methods, because a null id must never mean two things
  // ---------------------------------------------------------------------

  @AuraEnabled
  public static LayoutDTO createLayout(
    String name,
    String layoutJson,
    Boolean makeActive
  ) {
    List<Navigator_Layout__c> existing = ownLayouts();

    Navigator_Layout__c row = new Navigator_Layout__c(
      OwnerId = UserInfo.getUserId(),
      Name = name,
      Is_Active__c = makeActive == true,
      Sort_Order__c = nextSortOrder(existing),
      Schema_Version__c = CURRENT_SCHEMA_VERSION,
      Layout_JSON__c = fromClient(layoutJson)
    );
    Database.insert(row, AccessLevel.USER_MODE);

    List<Navigator_Layout__c> stale = deactivations(
      existing,
      row.Id,
      makeActive
    );
    if (!stale.isEmpty()) {
      Database.update(stale, AccessLevel.USER_MODE);
    }
    return toDto(row);
  }

  @AuraEnabled
  public static LayoutDTO updateLayout(
    Id layoutId,
    String name,
    String layoutJson,
    Boolean makeActive
  ) {
    if (layoutId == null) {
      throw raise(NULL_ID_MESSAGE);
    }

    List<Navigator_Layout__c> existing = ownLayouts();
    Navigator_Layout__c row = findOwned(existing, layoutId);
    row.Name = name;
    // **`makeActive == false` means "leave the flag as it is", not "clear it".**
    // An update is a write of a *payload*; the only thing that deactivates a
    // layout is another layout being activated, which `deactivations` below
    // does in the same statement. Clearing the flag here instead would let an
    // ordinary autosave leave the user with no active layout at all — and it
    // would do it on exactly the row the save was for, so the next read would
    // fall back to whichever layout sorts first. The flag is loaded by
    // `ownLayouts`, so leaving it alone writes it back unchanged.
    if (makeActive == true) {
      row.Is_Active__c = true;
    }
    row.Schema_Version__c = CURRENT_SCHEMA_VERSION;
    row.Layout_JSON__c = fromClient(layoutJson);

    // The target row and every flag it displaces go in one UPDATE, so that
    // "exactly one layout is active" holds at every point another transaction
    // could look, and so that the cost does not grow with the number of
    // layouts the user keeps.
    List<Navigator_Layout__c> toWrite = new List<Navigator_Layout__c>{ row };
    toWrite.addAll(deactivations(existing, layoutId, makeActive));
    Database.update(toWrite, AccessLevel.USER_MODE);

    return toDto(row);
  }

  // ---------------------------------------------------------------------
  // Switching between layouts.
  //
  // **None of the three below takes a payload.** That is the whole design of
  // this section rather than an omission. The bug this class was written
  // around was a name and a payload travelling together to a row the server
  // picked; switching, renaming and deleting are changes to a layout's
  // *identity and flags*, so there is no payload in the signature for a
  // client to send to the wrong layout. A switch cannot overwrite the layout
  // it switches to, and a rename cannot overwrite the layout it renames,
  // because neither has anything to overwrite it with.
  //
  // Each writes id-and-flag stubs rather than the queried rows, for the same
  // reason `deactivations` does: a stub carries no `Layout_JSON__c` at all, so
  // even a future edit to these methods has nothing to write over a payload
  // with.
  // ---------------------------------------------------------------------

  /**
   * Makes one of the running user's layouts the active one, and returns every
   * layout they own with the flags as they now stand.
   *
   * The whole list comes back rather than just the activated row because the
   * client's own "exactly one active" display is then read from the store
   * rather than inferred — a client that got the invariant wrong would be
   * corrected on the next call instead of drifting.
   */
  @AuraEnabled
  public static List<LayoutDTO> activateLayout(Id layoutId) {
    if (layoutId == null) {
      throw raise(nullIdMessage('activateLayout'));
    }

    List<Navigator_Layout__c> existing = ownLayouts();
    Navigator_Layout__c row = findOwned(existing, layoutId);

    Database.update(activation(existing, row.Id), AccessLevel.USER_MODE);
    applyActivation(existing, row.Id);
    return toDtos(existing);
  }

  /**
   * Changes a layout's name and nothing else. `Layout_JSON__c` is not in the
   * stub written, so a rename cannot reach a payload — the criterion is
   * structural rather than a rule to remember.
   */
  @AuraEnabled
  public static LayoutDTO renameLayout(Id layoutId, String name) {
    if (layoutId == null) {
      throw raise(nullIdMessage('renameLayout'));
    }

    List<Navigator_Layout__c> existing = ownLayouts();
    Navigator_Layout__c row = findOwned(existing, layoutId);

    Database.update(
      new Navigator_Layout__c(Id = row.Id, Name = name),
      AccessLevel.USER_MODE
    );
    row.Name = name;
    return toDto(row);
  }

  /**
   * Deletes one of the running user's layouts and returns the ones they are
   * left with.
   *
   * **Deleting the active layout leaves a sensible active one, and which one
   * is decided here rather than by the client.** The successor is the layout
   * that takes the deleted one's place in the user's own ordering — the one
   * after it, or the one before it when the deleted layout was last. That is
   * what a list does when a row is removed from the middle of it, and it means
   * the user's next screen is the layout their eye was already next to rather
   * than an arbitrary one.
   *
   * Deleting the *only* layout deliberately leaves no row at all. That is not
   * an empty screen: it is exactly the first-open state, in which the user
   * sees every tab they can reach in one seeded section and nothing is written
   * until they change something. Writing a replacement row here would put back
   * the thing the user just asked to be rid of, and would create a row for a
   * user who now has no customisation to store.
   */
  @AuraEnabled
  public static List<LayoutDTO> deleteLayout(Id layoutId) {
    if (layoutId == null) {
      throw raise(nullIdMessage('deleteLayout'));
    }

    List<Navigator_Layout__c> existing = ownLayouts();
    Navigator_Layout__c row = findOwned(existing, layoutId);
    Boolean wasActive = row.Is_Active__c == true;

    // Built before the delete, because the position the deleted layout held is
    // what names its successor and that position is gone afterwards.
    List<Navigator_Layout__c> remaining = new List<Navigator_Layout__c>();
    Integer removedAt = 0;
    for (Navigator_Layout__c candidate : existing) {
      if (candidate.Id == layoutId) {
        removedAt = remaining.size();
      } else {
        remaining.add(candidate);
      }
    }

    Database.delete(
      new Navigator_Layout__c(Id = row.Id),
      AccessLevel.USER_MODE
    );

    if (wasActive && !remaining.isEmpty()) {
      Id successorId = remaining[Math.min(removedAt, remaining.size() - 1)].Id;
      Database.update(
        activation(remaining, successorId),
        AccessLevel.USER_MODE
      );
      applyActivation(remaining, successorId);
    }
    return toDtos(remaining);
  }

  /**
   * The one UPDATE that makes `keepActiveId` the active layout: the row being
   * activated, plus every flag it displaces. One statement rather than two, so
   * that "exactly one layout is active" holds at every point another
   * transaction could look, and so the cost does not grow with the number of
   * layouts the user keeps.
   */
  private static List<Navigator_Layout__c> activation(
    List<Navigator_Layout__c> existing,
    Id keepActiveId
  ) {
    List<Navigator_Layout__c> toWrite = new List<Navigator_Layout__c>{
      new Navigator_Layout__c(Id = keepActiveId, Is_Active__c = true)
    };
    toWrite.addAll(deactivations(existing, keepActiveId, true));
    return toWrite;
  }

  /**
   * The same activation applied to the rows already in memory, so the DTOs
   * handed back describe the store as it now is without a second query. It
   * mirrors `activation` exactly — one place decides who is active, and the
   * write and the reply read it from there.
   */
  private static void applyActivation(
    List<Navigator_Layout__c> rows,
    Id keepActiveId
  ) {
    for (Navigator_Layout__c row : rows) {
      row.Is_Active__c = row.Id == keepActiveId;
    }
  }

  // ---------------------------------------------------------------------
  // Shared query and shared write helpers — one definition each, so the
  // create and update paths cannot drift apart.
  // ---------------------------------------------------------------------

  /**
   * The only place this class reads the store. Both writes need the same
   * picture the read needs: which of the owner's layouts are active (to clear
   * them) and how many there are (to place a new one at the end).
   */
  private static List<Navigator_Layout__c> ownLayouts() {
    return [
      SELECT
        Id,
        Name,
        Is_Active__c,
        Sort_Order__c,
        Schema_Version__c,
        Layout_JSON__c
      FROM Navigator_Layout__c
      WHERE OwnerId = :UserInfo.getUserId()
      WITH USER_MODE
      ORDER BY Sort_Order__c NULLS LAST, CreatedDate
    ];
  }

  /**
   * Where a new layout goes: after the highest sort order in use, not after
   * the count of rows. A count collides the moment the user deletes one — the
   * permission set grants `allowDelete`, so that is ordinary — and two rows
   * sharing a sort order are then ordered arbitrarily-but-stably by
   * `ownLayouts`' ORDER BY rather than as the user left them. Computed from
   * the rows the class has already queried, so it costs no extra SOQL.
   */
  private static Decimal nextSortOrder(List<Navigator_Layout__c> existing) {
    Decimal highest = 0;
    for (Navigator_Layout__c row : existing) {
      if (row.Sort_Order__c != null && row.Sort_Order__c > highest) {
        highest = row.Sort_Order__c;
      }
    }
    return highest + 1;
  }

  /**
   * `Is_Active__c` is enforced here rather than by the database, because the
   * platform has no "exactly one per owner" constraint. The rows returned are
   * id-and-flag stubs so that activating a layout cannot accidentally rewrite
   * the payload of the layouts it deactivates.
   */
  private static List<Navigator_Layout__c> deactivations(
    List<Navigator_Layout__c> existing,
    Id keepActiveId,
    Boolean makeActive
  ) {
    List<Navigator_Layout__c> stale = new List<Navigator_Layout__c>();
    if (makeActive != true) {
      return stale;
    }
    for (Navigator_Layout__c row : existing) {
      if (row.Id != keepActiveId && row.Is_Active__c == true) {
        stale.add(new Navigator_Layout__c(Id = row.Id, Is_Active__c = false));
      }
    }
    return stale;
  }

  /**
   * Resolves an id against the rows the running user owns, so an id belonging
   * to somebody else is indistinguishable from one that does not exist. The
   * sharing model would refuse the write anyway; this refuses it earlier and
   * says the same thing either way.
   */
  private static Navigator_Layout__c findOwned(
    List<Navigator_Layout__c> existing,
    Id layoutId
  ) {
    for (Navigator_Layout__c row : existing) {
      if (row.Id == layoutId) {
        return row;
      }
    }
    throw raise('That layout no longer exists, or does not belong to you.');
  }

  /**
   * The half of a DTO that needs no payload: who the row is. Shared by the
   * readable and the unreadable paths so the two cannot drift into describing
   * the same row differently.
   */
  private static LayoutDTO identityDto(Navigator_Layout__c row) {
    LayoutDTO dto = new LayoutDTO();
    dto.layoutId = row.Id;
    dto.name = row.Name;
    dto.isActive = row.Is_Active__c == true;
    dto.sortOrder = row.Sort_Order__c == null
      ? null
      : row.Sort_Order__c.intValue();
    return dto;
  }

  /**
   * A row whose payload could not be read. It carries no `layoutJson` at all
   * rather than an empty one, so that a caller cannot mistake "we could not
   * read this" for "this layout has no sections in it" and save that back.
   */
  private static LayoutDTO unreadableDto(
    Navigator_Layout__c row,
    String reason
  ) {
    LayoutDTO dto = identityDto(row);
    dto.schemaVersion = storedVersionOf(row);
    dto.isReadable = false;
    dto.unreadableReason = reason;
    return dto;
  }

  private static LayoutDTO toDto(Navigator_Layout__c row) {
    LayoutDTO dto = identityDto(row);
    // Always the current version, because `layoutJson` below has been brought
    // up to it. The row itself is left at whatever version it was stored at —
    // reading never writes.
    dto.schemaVersion = CURRENT_SCHEMA_VERSION;
    dto.isReadable = true;
    dto.layoutJson = fromStored(row.Layout_JSON__c, storedVersionOf(row));
    return dto;
  }

  private static Integer storedVersionOf(Navigator_Layout__c row) {
    // A null version is a row written before the field carried anything,
    // which by definition is the oldest shape this class knows.
    return row.Schema_Version__c == null
      ? OLDEST_READABLE_SCHEMA_VERSION
      : row.Schema_Version__c.intValue();
  }

  // ---------------------------------------------------------------------
  // The versioned deserialiser
  // ---------------------------------------------------------------------

  /**
   * Read path. The row's own `Schema_Version__c` is the authority here: it is
   * the queryable, reportable record of what was written, and for a blob
   * written by an older package it is the only trustworthy thing about it —
   * including a blob written before the payload carried a version at all.
   */
  private static String fromStored(String rawJson, Integer storedVersion) {
    return normalise(parsePayload(rawJson), storedVersion);
  }

  /**
   * Write path. There is no column to consult yet, so the payload declares its
   * own version, and one that declares none is by definition from before the
   * key existed.
   *
   * This matters during an upgrade window. A user with a browser tab still
   * holding the previous package's bundle keeps autosaving in the previous
   * payload shape; if the save refused it, their next drag would throw. Making
   * the contract self-describing costs one key and removes that failure mode
   * outright — which is also why the key is written on every save, including
   * on an empty layout.
   */
  private static String fromClient(String rawJson) {
    Map<String, Object> payload = parsePayload(rawJson);
    return normalise(payload, versionDeclaredIn(payload));
  }

  private static Map<String, Object> parsePayload(String rawJson) {
    Object parsed;
    try {
      parsed = JSON.deserializeUntyped(
        String.isBlank(rawJson) ? EMPTY_PAYLOAD : rawJson
      );
    } catch (Exception e) {
      throw raise(
        'This layout\'s payload is not valid JSON. (' + e.getMessage() + ')'
      );
    }
    if (!(parsed instanceof Map<String, Object>)) {
      throw raise('This layout\'s payload is not a JSON object.');
    }
    return (Map<String, Object>) parsed;
  }

  /**
   * Rewrites a parsed payload read at `version` into the current shape.
   *
   * This is deliberately the only route in and out of the blob, and both the
   * read path and the write path go through it. That is what makes the write
   * path lossy in exactly the right direction — the walk below emits `name`,
   * `columns`, `id` and `rename` and nothing else, so a client that sends a
   * label, an icon URL or a `pageReference` has them dropped by construction
   * rather than by a rule someone has to remember. Everything derivable from
   * the platform is derived at render time, and an org relabelling a tab then
   * costs no write at all.
   */
  private static String normalise(
    Map<String, Object> payload,
    Integer version
  ) {
    if (
      version == null ||
      version < OLDEST_READABLE_SCHEMA_VERSION ||
      version > CURRENT_SCHEMA_VERSION
    ) {
      throw raise(
        'This layout was saved at schema version ' +
          version +
          ', which this version of the Navigator cannot read.'
      );
    }

    try {
      Object rawSections = payload.get('sections');

      JSONGenerator out = JSON.createGenerator(false);
      out.writeStartObject();
      out.writeNumberField('schemaVersion', CURRENT_SCHEMA_VERSION);
      out.writeFieldName('sections');
      out.writeStartArray();
      if (rawSections instanceof List<Object>) {
        for (Object rawSection : (List<Object>) rawSections) {
          writeSection(out, (Map<String, Object>) rawSection, version);
        }
      }
      out.writeEndArray();
      out.writeEndObject();
      return out.getAsString();
    } catch (Exception e) {
      throw raise(
        'This layout could not be read: its payload is not a valid schema version ' +
          version +
          ' document. (' +
          e.getMessage() +
          ')'
      );
    }
  }

  private static void writeSection(
    JSONGenerator out,
    Map<String, Object> rawSection,
    Integer version
  ) {
    out.writeStartObject();
    out.writeStringField('name', textOf(rawSection.get('name')));
    out.writeNumberField('columns', columnsOf(rawSection.get('columns')));
    out.writeFieldName('items');
    out.writeStartArray();
    Object rawItems = rawSection.get('items');
    if (rawItems instanceof List<Object>) {
      for (Object rawItem : (List<Object>) rawItems) {
        writeItem(out, rawItem, version);
      }
    }
    out.writeEndArray();
    out.writeEndObject();
  }

  /**
   * The one place the schema version changes what a payload *means*, which is
   * why the dispatch is here and not spread across the walk. In v1 an item was
   * a bare id string and there was no per-item rename; in v2 it is
   * `{id, rename?}`. Sections, names and column counts read the same at both.
   */
  private static void writeItem(
    JSONGenerator out,
    Object rawItem,
    Integer version
  ) {
    String itemId;
    String rename;
    if (version == OLDEST_READABLE_SCHEMA_VERSION) {
      itemId = textOf(rawItem);
    } else {
      Map<String, Object> item = (Map<String, Object>) rawItem;
      itemId = textOf(item.get('id'));
      rename = textOf(item.get('rename'));
    }

    out.writeStartObject();
    out.writeStringField('id', itemId);
    if (String.isNotBlank(rename)) {
      out.writeStringField('rename', rename);
    }
    out.writeEndObject();
  }

  private static String textOf(Object raw) {
    return raw == null ? '' : String.valueOf(raw);
  }

  /**
   * The column range is part of the contract, not just of the UI, so it is
   * held here too — a v3 reader should never have to cope with a section of
   * zero columns that a bug once wrote. The fallback for an absent count is
   * DEFAULT_COLUMNS, matching `navigatorLayoutModel.clampColumns` key for key.
   */
  private static Integer columnsOf(Object raw) {
    return Math.max(
      MIN_COLUMNS,
      Math.min(MAX_COLUMNS, intOf(raw, DEFAULT_COLUMNS))
    );
  }

  private static Integer versionDeclaredIn(Map<String, Object> payload) {
    return intOf(payload.get('schemaVersion'), OLDEST_READABLE_SCHEMA_VERSION);
  }

  /**
   * `JSON.deserializeUntyped` hands back whichever numeric type fits, so a
   * whole number can arrive as an Integer, a Long, a Decimal or a Double
   * depending on how it was written. Coercing in one place keeps the column
   * count and the schema version from disagreeing about what a number is.
   */
  private static Integer intOf(Object raw, Integer fallback) {
    if (raw instanceof Integer) {
      return (Integer) raw;
    }
    if (raw instanceof Long) {
      return ((Long) raw).intValue();
    }
    if (raw instanceof Decimal) {
      return ((Decimal) raw).intValue();
    }
    if (raw instanceof Double) {
      return ((Double) raw).intValue();
    }
    return fallback;
  }

  /**
   * `new AuraHandledException(msg)` alone leaves `getMessage()` reading
   * "Script-thrown exception" everywhere except the client, which makes the
   * failures untestable. Setting the message explicitly is what makes the
   * refusals above assertable.
   */
  private static AuraHandledException raise(String message) {
    AuraHandledException e = new AuraHandledException(message);
    e.setMessage(message);
    return e;
  }
}
