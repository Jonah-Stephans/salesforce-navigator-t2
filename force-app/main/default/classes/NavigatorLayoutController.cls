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
  private static final String EMPTY_PAYLOAD = '{"sections":[]}';

  private static final String NULL_ID_MESSAGE =
    'updateLayout needs the id of the layout to update. A null id is not a request to ' +
    'update whichever layout happens to load first — call createLayout to make a new one.';

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
  }

  // ---------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------

  @AuraEnabled(cacheable=true)
  public static List<LayoutDTO> getLayouts() {
    List<LayoutDTO> layouts = new List<LayoutDTO>();
    for (Navigator_Layout__c row : ownLayouts()) {
      layouts.add(toDto(row));
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
      Sort_Order__c = existing.size() + 1,
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
    row.Is_Active__c = makeActive == true;
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

  private static LayoutDTO toDto(Navigator_Layout__c row) {
    LayoutDTO dto = new LayoutDTO();
    dto.layoutId = row.Id;
    dto.name = row.Name;
    dto.isActive = row.Is_Active__c == true;
    dto.sortOrder = row.Sort_Order__c == null
      ? null
      : row.Sort_Order__c.intValue();
    // Always the current version, because `layoutJson` below has been brought
    // up to it. The row itself is left at whatever version it was stored at —
    // reading never writes.
    dto.schemaVersion = CURRENT_SCHEMA_VERSION;
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
   * zero columns that a bug once wrote.
   */
  private static Integer columnsOf(Object raw) {
    return Math.max(
      MIN_COLUMNS,
      Math.min(MAX_COLUMNS, intOf(raw, MIN_COLUMNS))
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
