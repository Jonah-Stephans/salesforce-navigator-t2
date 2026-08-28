/**
 * Tests for NavigatorLayoutController.
 *
 * Two things this suite deliberately does NOT do, because the plugin's own
 * record says they are how green stops meaning done:
 *
 *   1. It never asserts what the caller *sent*. A previous project shipped a
 *      `saveLayout(layoutId, ...)` where a null id meant "make me a new one" to
 *      the client and "update the one that loads on arrival" to the server. In
 *      the running org, New layout renamed and overwrote the existing layout —
 *      and the suite stayed green throughout, because it asserted the call
 *      rather than its effect. Every assertion below re-queries the database
 *      and asserts what is actually stored.
 *   2. It does not settle for existence. `Assert.isNotNull` proves a row
 *      arrived, not that the right thing is in it.
 */
@IsTest
private with sharing class NavigatorLayoutControllerTest {
  private static final String OWNER_ALIAS = 'nvowner';
  private static final String PEER_ALIAS = 'nvpeer';

  /** The published v2 payload: sections of {name, columns, items:[{id, rename?}]}. */
  private static final String V2_PAYLOAD =
    '{"schemaVersion":2,"sections":[' +
    '{"name":"All Items","columns":3,"items":[' +
    '{"id":"standard-Account"},{"id":"Widget__c","rename":"Widgets"}]}]}';

  /**
   * The v1 payload this repo must still be able to read: items were bare id
   * strings and there was no per-item rename. Kept as a literal rather than
   * generated, because it stands in for rows written by an older package
   * version — the platform will not migrate the inside of a Long Text Area
   * across an upgrade, so this shape can arrive at any time.
   */
  private static final String V1_PAYLOAD =
    '{"sections":[{"name":"All Items","columns":3,' +
    '"items":["standard-Account","Widget__c"]}]}';

  @TestSetup
  static void makeUsers() {
    // Users are a setup sObject, so they are created in their own transaction
    // here and the layout rows are written by the test methods. Mixing the two
    // in one transaction is MIXED_DML_OPERATION.
    Id standardProfileId = [
      SELECT Id
      FROM Profile
      WHERE Name = 'Standard User'
      LIMIT 1
    ]
    .Id;
    Id permSetId = [
      SELECT Id
      FROM PermissionSet
      WHERE Name = 'Salesforce_Navigator_User'
      LIMIT 1
    ]
    .Id;

    List<User> users = new List<User>{
      newStandardUser(standardProfileId, OWNER_ALIAS),
      newStandardUser(standardProfileId, PEER_ALIAS)
    };
    insert users;

    List<PermissionSetAssignment> assignments = new List<PermissionSetAssignment>();
    for (User u : users) {
      assignments.add(
        new PermissionSetAssignment(
          AssigneeId = u.Id,
          PermissionSetId = permSetId
        )
      );
    }
    insert assignments;
  }

  // ---------------------------------------------------------------------
  // Shared setup — one definition each, per this repo's DRY rule.
  // ---------------------------------------------------------------------

  private static User newStandardUser(Id profileId, String userAlias) {
    return new User(
      ProfileId = profileId,
      Alias = userAlias,
      Email = userAlias + '@navigator.test',
      Username = userAlias + '.' + DateTime.now().getTime() + '@navigator.test',
      LastName = 'Navigator',
      EmailEncodingKey = 'UTF-8',
      LanguageLocaleKey = 'en_US',
      LocaleSidKey = 'en_US',
      TimeZoneSidKey = 'America/Los_Angeles'
    );
  }

  private static User userWith(String userAlias) {
    return [SELECT Id FROM User WHERE Alias = :userAlias LIMIT 1];
  }

  private static Navigator_Layout__c seed(
    String layoutName,
    Boolean isActive,
    Integer sortOrder
  ) {
    return new Navigator_Layout__c(
      Name = layoutName,
      Is_Active__c = isActive,
      Sort_Order__c = sortOrder,
      Schema_Version__c = NavigatorLayoutController.CURRENT_SCHEMA_VERSION,
      Layout_JSON__c = V2_PAYLOAD
    );
  }

  // Deliberately WITH SYSTEM_MODE, not WITH USER_MODE (the convention everywhere
  // else in this codebase): this and the four verification helpers that follow
  // — sectionNameOf, activeCount, activeName, activeId — read the row's true
  // state after a write, and the running identity (this project's org default
  // admin, in a freshly created org) is never granted FLS on
  // Navigator_Layout__c's custom fields — only the two System.runAs test users
  // are. Reverting these five to WITH USER_MODE reintroduces "No such column"
  // against exactly that org shape, which is the shape this project's own CI
  // deploy gate creates.
  private static List<Navigator_Layout__c> storedLayouts() {
    return [
      SELECT
        Id,
        Name,
        OwnerId,
        Is_Active__c,
        Sort_Order__c,
        Schema_Version__c,
        Layout_JSON__c
      FROM Navigator_Layout__c
      WITH SYSTEM_MODE
      ORDER BY Sort_Order__c NULLS LAST, Name
    ];
  }

  private static List<Object> sectionsOf(String rawJson) {
    Map<String, Object> payload = (Map<String, Object>) JSON.deserializeUntyped(
      rawJson
    );
    return (List<Object>) payload.get('sections');
  }

  private static Map<String, Object> firstSectionOf(String rawJson) {
    return (Map<String, Object>) sectionsOf(rawJson)[0];
  }

  private static List<Object> itemsOfFirstSection(String rawJson) {
    return (List<Object>) firstSectionOf(rawJson).get('items');
  }

  // ---------------------------------------------------------------------
  // Reading
  // ---------------------------------------------------------------------

  @IsTest
  static void lookingWithoutChangingAnythingWritesNoRow() {
    User owner = userWith(OWNER_ALIAS);

    List<NavigatorLayoutController.LayoutDTO> layouts;
    Test.startTest();
    System.runAs(owner) {
      layouts = NavigatorLayoutController.getLayouts();
    }
    Test.stopTest();

    Assert.areEqual(
      0,
      layouts.size(),
      'A user with no layout should be handed nothing to render'
    );
    Assert.areEqual(
      0,
      [SELECT COUNT() FROM Navigator_Layout__c],
      'Reading must not write — no row may exist until the user first changes something'
    );
  }

  @IsTest
  static void getLayoutsReturnsTheOwnersRowsInSortOrder() {
    User owner = userWith(OWNER_ALIAS);
    System.runAs(owner) {
      insert new List<Navigator_Layout__c>{
        seed('Second', false, 2),
        seed('First', true, 1)
      };
    }

    List<NavigatorLayoutController.LayoutDTO> layouts;
    Test.startTest();
    System.runAs(owner) {
      layouts = NavigatorLayoutController.getLayouts();
    }
    Test.stopTest();

    Assert.areEqual(
      2,
      layouts.size(),
      'Both of the owner\'s layouts should come back'
    );
    Assert.areEqual(
      'First',
      layouts[0].name,
      'Sort_Order__c 1 should be handed back first'
    );
    Assert.areEqual(
      'Second',
      layouts[1].name,
      'Sort_Order__c 2 should be handed back second'
    );
    Assert.areEqual(
      true,
      layouts[0].isActive,
      'The active flag should survive the round trip'
    );
    Assert.areEqual(
      false,
      layouts[1].isActive,
      'The inactive layout should not read as active'
    );
  }

  /**
   * The peer half of the isolation Outcome. The role-hierarchy half is not
   * assertable here — see `## Deviations` on the slice: "Grant Access Using
   * Hierarchies" is not expressible in the Metadata API at all.
   *
   * The queries in this method are deliberately bare — no `WITH` clause,
   * unlike the verification helpers above — because they need none: they name
   * only `Id` or no field at all, and FLS cannot restrict those on a custom
   * object. Nor would declaring one void this test. The class is
   * `private with sharing`, and under `WITH SYSTEM_MODE` record sharing is
   * still controlled by the class's sharing keyword, so an access mode
   * suppresses CRUD/FLS only. What this test actually proves is the
   * `NavigatorLayoutController.getLayouts()` call made inside
   * `System.runAs(peer)`, which no declaration on a query in this class can
   * reach.
   */
  @IsTest
  static void peerCannotReadAnotherUsersLayouts() {
    User owner = userWith(OWNER_ALIAS);
    User peer = userWith(PEER_ALIAS);
    System.runAs(owner) {
      insert seed('Owner only', true, 1);
    }

    List<NavigatorLayoutController.LayoutDTO> peerLayouts;
    Test.startTest();
    System.runAs(peer) {
      peerLayouts = NavigatorLayoutController.getLayouts();
    }
    Test.stopTest();

    Assert.areEqual(
      0,
      peerLayouts.size(),
      'A second user must see their own layouts and never the first user\'s'
    );
    Assert.areEqual(
      1,
      [SELECT COUNT() FROM Navigator_Layout__c],
      'The owner\'s row must still be there — the peer simply cannot reach it'
    );
  }

  /**
   * The claim in the class header is that `WITH USER_MODE` and the explicit
   * `OwnerId = :UserInfo.getUserId()` predicate are a *pair* — sharing is
   * defence in depth, never the filter. With the object at OWD Private,
   * `WITH USER_MODE` alone already hides a peer's rows, so
   * `peerCannotReadAnotherUsersLayouts` stays green with the predicate
   * deleted and the claim is unheld.
   *
   * This holds it: the peer's row is explicitly shared with the owner, which
   * is exactly the "future sharing rule" the pair exists to survive. Sharing
   * now grants read, `WITH USER_MODE` lets it through, and only the OwnerId
   * predicate keeps it out.
   */
  @IsTest
  static void sharingCanNeverBecomeTheFilterForWhoseLayoutsComeBack() {
    User owner = userWith(OWNER_ALIAS);
    User peer = userWith(PEER_ALIAS);

    Navigator_Layout__c peerRow = seed('Peer only', true, 1);
    System.runAs(peer) {
      insert peerRow;
    }
    insert new Navigator_Layout__Share(
      ParentId = peerRow.Id,
      UserOrGroupId = owner.Id,
      AccessLevel = 'Read',
      RowCause = Schema.Navigator_Layout__Share.RowCause.Manual
    );

    // The control. Without it this test could pass because the share never
    // took, which would prove nothing at all about the predicate.
    Integer reachableBySharing;
    System.runAs(owner) {
      reachableBySharing = [
        SELECT COUNT()
        FROM Navigator_Layout__c
        WHERE Id = :peerRow.Id
      ];
    }
    Assert.areEqual(
      1,
      reachableBySharing,
      'The share must genuinely grant the owner read access, or this test proves nothing about the predicate'
    );

    List<NavigatorLayoutController.LayoutDTO> ownerLayouts;
    Test.startTest();
    System.runAs(owner) {
      ownerLayouts = NavigatorLayoutController.getLayouts();
    }
    Test.stopTest();

    Assert.areEqual(
      0,
      ownerLayouts.size(),
      'A layout shared with the running user is still not theirs — sharing must never decide whose layouts this class returns'
    );
  }

  // ---------------------------------------------------------------------
  // The schema version, and the deserialiser that dispatches on it
  // ---------------------------------------------------------------------

  @IsTest
  static void aV1RowIsUpgradedToV2OnRead() {
    User owner = userWith(OWNER_ALIAS);
    System.runAs(owner) {
      insert new Navigator_Layout__c(
        Name = 'Legacy',
        Is_Active__c = true,
        Sort_Order__c = 1,
        Schema_Version__c = 1,
        Layout_JSON__c = V1_PAYLOAD
      );
    }

    List<NavigatorLayoutController.LayoutDTO> layouts;
    Test.startTest();
    System.runAs(owner) {
      layouts = NavigatorLayoutController.getLayouts();
    }
    Test.stopTest();

    Assert.areEqual(
      1,
      layouts.size(),
      'The legacy row should still be readable'
    );
    Assert.areEqual(
      2,
      layouts[0].schemaVersion,
      'A v1 row must be handed to the client at the current version, not at the version it was stored at'
    );

    Map<String, Object> firstItem = (Map<String, Object>) itemsOfFirstSection(
      layouts[0].layoutJson
    )[0];
    Assert.areEqual(
      'standard-Account',
      firstItem.get('id'),
      'A v1 bare-string item must be upgraded into an {id} object without losing the id'
    );
    Assert.areEqual(
      3,
      firstSectionOf(layouts[0].layoutJson).get('columns'),
      'The column count must survive the v1 to v2 upgrade'
    );

    // WITH SYSTEM_MODE is deliberate here — see the note above storedLayouts().
    Assert.areEqual(
      1,
      [
        SELECT Schema_Version__c
        FROM Navigator_Layout__c
        WITH SYSTEM_MODE
        LIMIT 1
      ]
      .Schema_Version__c,
      'Upgrading on read must not write — the stored row stays at v1 until the user next saves'
    );
  }

  /**
   * A row this class cannot read is refused *on its own row* rather than by
   * failing the whole call. The refusal itself is the point — a payload at an
   * unknown version must never be read as though it were current — but taking
   * the user's other, perfectly readable layouts down with it is a second
   * failure on top of the first, and the one that costs them the Navigator.
   */
  @IsTest
  static void anUnreadableFutureSchemaVersionIsReportedOnItsOwnRowRatherThanGuessedAt() {
    User owner = userWith(OWNER_ALIAS);
    System.runAs(owner) {
      insert new List<Navigator_Layout__c>{
        seed('Readable', true, 1),
        new Navigator_Layout__c(
          Name = 'From the future',
          Is_Active__c = false,
          Sort_Order__c = 2,
          Schema_Version__c = 99,
          Layout_JSON__c = V2_PAYLOAD
        )
      };
    }

    List<NavigatorLayoutController.LayoutDTO> layouts;
    Test.startTest();
    System.runAs(owner) {
      layouts = NavigatorLayoutController.getLayouts();
    }
    Test.stopTest();

    Assert.areEqual(
      2,
      layouts.size(),
      'One unreadable row must not take the user\'s other layouts down with it'
    );
    Assert.areEqual(
      'standard-Account',
      ((Map<String, Object>) itemsOfFirstSection(layouts[0].layoutJson)[0])
        .get('id'),
      'The readable layout must still come back with its contents intact'
    );
    Assert.areEqual(
      true,
      layouts[0].isReadable,
      'A row this class can read must be flagged readable'
    );
    Assert.areEqual(
      false,
      layouts[1].isReadable,
      'A payload at an unknown schema version must not be handed over as though it were current'
    );
    Assert.isNull(
      layouts[1].layoutJson,
      'An unreadable row must carry no payload at all, so no caller can render a guess at it'
    );
    Assert.isTrue(
      layouts[1].unreadableReason.contains('99'),
      'The refusal should name the version it could not read, so the cause is obvious. Got: ' +
      layouts[1].unreadableReason
    );
  }

  /**
   * The read-path twin of `aPayloadThatIsNotJsonIsRefusedRatherThanStored`.
   * The write path cannot put this in the field, but an administrator can:
   * the permission set grants `allowEdit` on the object, so `Layout_JSON__c`
   * is hand-editable in the record UI.
   */
  @IsTest
  static void aStoredPayloadThatIsNotJsonIsReportedOnItsOwnRowRatherThanFailingTheRead() {
    User owner = userWith(OWNER_ALIAS);
    System.runAs(owner) {
      insert new List<Navigator_Layout__c>{
        seed('Readable', true, 1),
        new Navigator_Layout__c(
          Name = 'Hand edited',
          Is_Active__c = false,
          Sort_Order__c = 2,
          Schema_Version__c = NavigatorLayoutController.CURRENT_SCHEMA_VERSION,
          Layout_JSON__c = 'not json at all'
        )
      };
    }

    List<NavigatorLayoutController.LayoutDTO> layouts;
    Test.startTest();
    System.runAs(owner) {
      layouts = NavigatorLayoutController.getLayouts();
    }
    Test.stopTest();

    Assert.areEqual(
      2,
      layouts.size(),
      'A row an admin edited into nonsense must not make the user\'s other layouts unreadable'
    );
    Assert.areEqual(
      'standard-Account',
      ((Map<String, Object>) itemsOfFirstSection(layouts[0].layoutJson)[0])
        .get('id'),
      'The readable layout must still come back with its contents intact'
    );
    Assert.areEqual(
      false,
      layouts[1].isReadable,
      'A payload that is not JSON cannot be read and must say so on its own row'
    );
    Assert.isNotNull(
      layouts[1].unreadableReason,
      'An unreadable row must carry the reason it could not be read'
    );
  }

  @IsTest
  static void savingAlwaysStampsAndWritesTheCurrentVersion() {
    User owner = userWith(OWNER_ALIAS);

    Test.startTest();
    System.runAs(owner) {
      NavigatorLayoutController.createLayout('Mine', V1_PAYLOAD, true);
    }
    Test.stopTest();

    Navigator_Layout__c stored = storedLayouts()[0];
    Assert.areEqual(
      2,
      stored.Schema_Version__c,
      'A save must write the current schema version, whatever version the payload arrived as'
    );
    Map<String, Object> firstItem = (Map<String, Object>) itemsOfFirstSection(
      stored.Layout_JSON__c
    )[0];
    Assert.areEqual(
      'standard-Account',
      firstItem.get('id'),
      'A v1 payload handed to a save must be written back in the v2 item shape'
    );
  }

  // ---------------------------------------------------------------------
  // The payload contract
  // ---------------------------------------------------------------------

  @IsTest
  static void theStoredPayloadCarriesNothingDerivableFromThePlatform() {
    User owner = userWith(OWNER_ALIAS);
    String noisy =
      '{"schemaVersion":2,"sections":[{"name":"Work","columns":2,"items":[' +
      '{"id":"standard-Account","label":"Accounts","iconUrl":"/img/a.png",' +
      '"pageReference":{"type":"standard__objectPage"},"rename":"Clients"}]}]}';

    Test.startTest();
    System.runAs(owner) {
      NavigatorLayoutController.createLayout('Work', noisy, true);
    }
    Test.stopTest();

    String stored = storedLayouts()[0].Layout_JSON__c;
    Assert.isFalse(
      stored.containsIgnoreCase('label'),
      'A tab label must never be stored — relabelling a tab has to be free. Stored: ' +
      stored
    );
    Assert.isFalse(
      stored.containsIgnoreCase('iconUrl'),
      'An icon URL must never be stored. Stored: ' + stored
    );
    Assert.isFalse(
      stored.containsIgnoreCase('pageReference'),
      'A pageReference is resolved live from the tab source, never stored. Stored: ' +
      stored
    );

    Map<String, Object> item = (Map<String, Object>) itemsOfFirstSection(
      stored
    )[0];
    Assert.areEqual(
      'standard-Account',
      item.get('id'),
      'The item id is the one thing that must be kept'
    );
    Assert.areEqual(
      'Clients',
      item.get('rename'),
      'The user\'s own wording is theirs and is not derivable, so it must be kept'
    );
  }

  @IsTest
  static void aColumnCountOutsideTheContractRangeIsBroughtBackIntoIt() {
    User owner = userWith(OWNER_ALIAS);
    String outOfRange =
      '{"schemaVersion":2,"sections":[' +
      '{"name":"Too few","columns":0,"items":[]},' +
      '{"name":"Too many","columns":9,"items":[]}]}';

    Test.startTest();
    System.runAs(owner) {
      // makeActive false, which is also the only path through the write that
      // leaves the other layouts' flags alone.
      NavigatorLayoutController.createLayout('Edges', outOfRange, false);
    }
    Test.stopTest();

    List<Object> sections = sectionsOf(storedLayouts()[0].Layout_JSON__c);
    Assert.areEqual(
      1,
      ((Map<String, Object>) sections[0]).get('columns'),
      'A column count below the contract range must be stored as the minimum, 1'
    );
    Assert.areEqual(
      6,
      ((Map<String, Object>) sections[1]).get('columns'),
      'A column count above the contract range must be stored as the maximum, 6'
    );
  }

  /**
   * The two halves of the payload contract have to agree about an absent key,
   * not only about an out-of-range one. This class and `navigatorLayoutModel`
   * both document themselves as implementing one contract; a section carrying
   * no `columns` at all is the key they disagreed on, Apex falling back to 1
   * and the client to 3.
   */
  @IsTest
  static void aSectionWithNoColumnCountAtAllIsStoredAtTheContractDefault() {
    User owner = userWith(OWNER_ALIAS);
    String noColumns =
      '{"schemaVersion":2,"sections":[' + '{"name":"Unspecified","items":[]}]}';

    Test.startTest();
    System.runAs(owner) {
      NavigatorLayoutController.createLayout('Defaults', noColumns, false);
    }
    Test.stopTest();

    Assert.areEqual(
      3,
      firstSectionOf(storedLayouts()[0].Layout_JSON__c).get('columns'),
      'A section carrying no columns key must be stored at the contract default of 3, the same fallback navigatorLayoutModel.clampColumns uses'
    );
  }

  @IsTest
  static void anEmptyPayloadIsStoredAsALayoutWithNoSections() {
    User owner = userWith(OWNER_ALIAS);

    Test.startTest();
    System.runAs(owner) {
      NavigatorLayoutController.createLayout('Blank', null, true);
    }
    Test.stopTest();

    String stored = storedLayouts()[0].Layout_JSON__c;
    Assert.areEqual(
      0,
      sectionsOf(stored).size(),
      'A layout saved with no payload should hold an empty section list, not null'
    );
    Assert.areEqual(
      2,
      ((Map<String, Object>) JSON.deserializeUntyped(stored))
        .get('schemaVersion'),
      'Even an empty payload has to carry the schema version, or the next reader cannot dispatch'
    );
  }

  @IsTest
  static void aPayloadThatIsNotJsonIsRefusedRatherThanStored() {
    User owner = userWith(OWNER_ALIAS);

    Boolean refused = false;
    Test.startTest();
    System.runAs(owner) {
      try {
        NavigatorLayoutController.createLayout(
          'Broken',
          'not json at all',
          true
        );
        Assert.fail('An unparseable payload must not reach the database');
      } catch (AuraHandledException e) {
        refused = true;
      }
    }
    Test.stopTest();

    Assert.isTrue(refused, 'An unparseable payload should raise');
    Assert.areEqual(
      0,
      [SELECT COUNT() FROM Navigator_Layout__c],
      'A refused save must leave nothing behind'
    );
  }

  // ---------------------------------------------------------------------
  // Creation is not update — the regression the plugin's record demands
  // ---------------------------------------------------------------------

  @IsTest
  static void creatingASecondLayoutLeavesTheFirstOneStanding() {
    User owner = userWith(OWNER_ALIAS);
    System.runAs(owner) {
      insert seed('Original', true, 1);
    }

    Test.startTest();
    System.runAs(owner) {
      NavigatorLayoutController.createLayout('New layout', V2_PAYLOAD, true);
    }
    Test.stopTest();

    List<Navigator_Layout__c> stored = storedLayouts();
    Assert.areEqual(
      2,
      stored.size(),
      'Creating a layout must put a second row beside the first, never rename and overwrite it'
    );
    Assert.areEqual(
      'Original',
      stored[0].Name,
      'The pre-existing layout must keep its own name'
    );
    Assert.areEqual(
      'New layout',
      stored[1].Name,
      'The new layout must be the one that got the new name'
    );
    Assert.areEqual(
      2,
      stored[1].Sort_Order__c,
      'A new layout goes after the ones already there'
    );
  }

  /**
   * `Sort_Order__c = existing.size() + 1` collides after a delete — and the
   * permission set grants `allowDelete`, so a delete is an ordinary thing for
   * a user to do. Two layouts sharing a sort order are then ordered
   * arbitrarily-but-stably by `ORDER BY Sort_Order__c NULLS LAST, CreatedDate`
   * rather than as the user left them.
   */
  @IsTest
  static void aNewLayoutGoesAfterTheHighestSortOrderEvenAfterADelete() {
    User owner = userWith(OWNER_ALIAS);
    System.runAs(owner) {
      List<Navigator_Layout__c> rows = new List<Navigator_Layout__c>{
        seed('First', false, 1),
        seed('Second', true, 2)
      };
      insert rows;
      delete rows[0];
    }

    Test.startTest();
    System.runAs(owner) {
      NavigatorLayoutController.createLayout('Third', V2_PAYLOAD, true);
    }
    Test.stopTest();

    Map<String, Decimal> ordersByName = new Map<String, Decimal>();
    for (Navigator_Layout__c row : storedLayouts()) {
      ordersByName.put(row.Name, row.Sort_Order__c);
    }
    Assert.areEqual(
      3,
      ordersByName.get('Third'),
      'A new layout goes after the highest sort order in use, not after the count of surviving rows'
    );
    Assert.areNotEqual(
      ordersByName.get('Second'),
      ordersByName.get('Third'),
      'Two of a user\'s layouts must never share a sort order, or their order stops being the one they left'
    );
  }

  @IsTest
  static void updateRefusesANullLayoutId() {
    User owner = userWith(OWNER_ALIAS);
    System.runAs(owner) {
      insert seed('Original', true, 1);
    }

    Boolean refused = false;
    Test.startTest();
    System.runAs(owner) {
      try {
        NavigatorLayoutController.updateLayout(
          null,
          'Renamed',
          V2_PAYLOAD,
          true
        );
        Assert.fail(
          'A null layout id must not be read as "whichever layout loads on arrival"'
        );
      } catch (AuraHandledException e) {
        refused = true;
      }
    }
    Test.stopTest();

    Assert.isTrue(refused, 'updateLayout must refuse a null id outright');
    List<Navigator_Layout__c> stored = storedLayouts();
    Assert.areEqual(
      1,
      stored.size(),
      'The refused update must not have created anything'
    );
    Assert.areEqual(
      'Original',
      stored[0].Name,
      'The refused update must not have touched the layout that happened to load first'
    );
  }

  @IsTest
  static void updateRewritesOnlyTheLayoutItWasGiven() {
    User owner = userWith(OWNER_ALIAS);
    System.runAs(owner) {
      insert new List<Navigator_Layout__c>{
        seed('Kept', false, 1),
        seed('Edited', true, 2)
      };
    }
    Id targetId = [
      SELECT Id
      FROM Navigator_Layout__c
      WHERE Name = 'Edited'
      LIMIT 1
    ]
    .Id;
    String renamedSection =
      '{"schemaVersion":2,"sections":[{"name":"Renamed section","columns":6,' +
      '"items":[{"id":"standard-Account"}]}]}';

    Test.startTest();
    System.runAs(owner) {
      NavigatorLayoutController.updateLayout(
        targetId,
        'Edited',
        renamedSection,
        true
      );
    }
    Test.stopTest();

    Map<Id, Navigator_Layout__c> byId = new Map<Id, Navigator_Layout__c>(
      storedLayouts()
    );
    Map<String, Object> editedSection = firstSectionOf(
      byId.get(targetId).Layout_JSON__c
    );
    Assert.areEqual(
      'Renamed section',
      editedSection.get('name'),
      'The section rename must be what the database holds afterwards'
    );
    Assert.areEqual(
      6,
      editedSection.get('columns'),
      'The new column count must be what is stored'
    );

    for (Navigator_Layout__c row : byId.values()) {
      if (row.Id != targetId) {
        Assert.areEqual(
          'All Items',
          firstSectionOf(row.Layout_JSON__c).get('name'),
          'The layout that was not named in the call must be left exactly as it was'
        );
      }
    }
  }

  @IsTest
  static void activatingOneLayoutClearsTheFlagOnTheOthers() {
    User owner = userWith(OWNER_ALIAS);
    System.runAs(owner) {
      insert new List<Navigator_Layout__c>{
        seed('Was active', true, 1),
        seed('Becoming active', false, 2)
      };
    }
    Id targetId = [
      SELECT Id
      FROM Navigator_Layout__c
      WHERE Name = 'Becoming active'
      LIMIT 1
    ]
    .Id;

    Test.startTest();
    System.runAs(owner) {
      NavigatorLayoutController.updateLayout(
        targetId,
        'Becoming active',
        V2_PAYLOAD,
        true
      );
    }
    Test.stopTest();

    Assert.areEqual(
      1,
      activeCount(),
      'Exactly one of a user\'s layouts may be active'
    );
    Assert.areEqual(
      targetId,
      activeId(),
      'The layout that was activated must be the one left active'
    );
  }

  @IsTest
  static void activatingOneUsersLayoutDoesNotDisturbAnother() {
    User owner = userWith(OWNER_ALIAS);
    User peer = userWith(PEER_ALIAS);
    System.runAs(owner) {
      insert seed('Owner active', true, 1);
    }
    System.runAs(peer) {
      insert seed('Peer active', true, 1);
    }

    Test.startTest();
    System.runAs(peer) {
      NavigatorLayoutController.createLayout('Peer second', V2_PAYLOAD, true);
    }
    Test.stopTest();

    // WITH SYSTEM_MODE is deliberate here — see the note above storedLayouts().
    Assert.areEqual(
      1,
      [
        SELECT COUNT()
        FROM Navigator_Layout__c
        WHERE Is_Active__c = TRUE AND OwnerId = :owner.Id
        WITH SYSTEM_MODE
      ],
      'One user activating a layout must not clear another user\'s active flag'
    );
    // WITH SYSTEM_MODE is deliberate here — see the note above storedLayouts().
    Assert.areEqual(
      'Peer second',
      [
        SELECT Name
        FROM Navigator_Layout__c
        WHERE Is_Active__c = TRUE AND OwnerId = :peer.Id
        WITH SYSTEM_MODE
        LIMIT 1
      ]
      .Name,
      'The activating user should end up with their newest layout active'
    );
  }

  /**
   * The write half of the isolation criterion. Holding another user's record
   * id must not be enough to change their layout — and the refusal must not
   * distinguish "not yours" from "does not exist", or the id becomes an
   * oracle for whether a given layout exists.
   *
   * The queries in this method are deliberately bare — no `WITH` clause,
   * unlike the verification helpers above — because they need none: they name
   * only `Id` and `Name`, which FLS cannot restrict on a custom object. Nor
   * would declaring one void this test. The class is `private with sharing`,
   * and under `WITH SYSTEM_MODE` record sharing is still controlled by the
   * class's sharing keyword, so an access mode suppresses CRUD/FLS only. What
   * this test actually proves is the refused
   * `NavigatorLayoutController.updateLayout()` call made inside
   * `System.runAs(peer)`, which no declaration on a query in this class can
   * reach.
   */
  @IsTest
  static void aUserCannotUpdateAnotherUsersLayout() {
    User owner = userWith(OWNER_ALIAS);
    User peer = userWith(PEER_ALIAS);
    System.runAs(owner) {
      insert seed('Owner only', true, 1);
    }
    Id ownersLayoutId = [SELECT Id FROM Navigator_Layout__c LIMIT 1].Id;

    Boolean refused = false;
    Test.startTest();
    System.runAs(peer) {
      try {
        NavigatorLayoutController.updateLayout(
          ownersLayoutId,
          'Hijacked',
          V2_PAYLOAD,
          true
        );
        Assert.fail(
          'One user must not be able to write another user\'s layout'
        );
      } catch (AuraHandledException e) {
        refused = true;
      }
    }
    Test.stopTest();

    Assert.isTrue(
      refused,
      'A layout id belonging to somebody else must be refused'
    );
    Assert.areEqual(
      'Owner only',
      [SELECT Name FROM Navigator_Layout__c WHERE Id = :ownersLayoutId].Name,
      'The owner\'s layout must be exactly as they left it'
    );
  }

  // ---------------------------------------------------------------------
  // Switching between layouts — activate, rename, delete
  //
  // Every assertion below re-queries the store. That is the whole point of
  // this section: the failure it exists to prevent is a *client* that sends a
  // plausible call and a *server* that writes it to the wrong row, and a suite
  // asserting the call is green throughout that.
  // ---------------------------------------------------------------------

  /**
   * Three layouts whose payloads differ, with the active one deliberately in
   * the *middle*. A fixture with one layout, or with the active one first,
   * cannot tell "the active one" from "the only one" or "the first one" — so
   * a switch written to the wrong record would pass it.
   */
  private static void seedThree() {
    User owner = userWith(OWNER_ALIAS);
    System.runAs(owner) {
      insert new List<Navigator_Layout__c>{
        seedNamed('First', false, 1, 'Selling'),
        seedNamed('Second', true, 2, 'Support'),
        seedNamed('Third', false, 3, 'Admin')
      };
    }
  }

  /**
   * A layout whose payload names its own section, so that a payload written
   * onto the wrong row is visible as the wrong section name rather than as
   * two identical blobs that no assertion can tell apart.
   */
  private static Navigator_Layout__c seedNamed(
    String layoutName,
    Boolean isActive,
    Integer sortOrder,
    String sectionName
  ) {
    Navigator_Layout__c row = seed(layoutName, isActive, sortOrder);
    row.Layout_JSON__c =
      '{"schemaVersion":2,"sections":[{"name":"' +
      sectionName +
      '","columns":3,"items":[{"id":"standard-Account"}]}]}';
    return row;
  }

  private static Id layoutIdNamed(String layoutName) {
    return [SELECT Id FROM Navigator_Layout__c WHERE Name = :layoutName LIMIT 1]
    .Id;
  }

  private static String sectionNameOf(String layoutName) {
    return String.valueOf(
      firstSectionOf(
          [
            SELECT Layout_JSON__c
            FROM Navigator_Layout__c
            WHERE Name = :layoutName
            WITH SYSTEM_MODE
            LIMIT 1
          ]
          .Layout_JSON__c
        )
        .get('name')
    );
  }

  private static Integer activeCount() {
    return [
      SELECT COUNT()
      FROM Navigator_Layout__c
      WHERE Is_Active__c = TRUE
      WITH SYSTEM_MODE
    ];
  }

  private static String activeName() {
    List<Navigator_Layout__c> active = [
      SELECT Name
      FROM Navigator_Layout__c
      WHERE Is_Active__c = TRUE
      WITH SYSTEM_MODE
      LIMIT 1
    ];
    return active.isEmpty() ? null : active[0].Name;
  }

  private static Id activeId() {
    List<Navigator_Layout__c> active = [
      SELECT Id
      FROM Navigator_Layout__c
      WHERE Is_Active__c = TRUE
      WITH SYSTEM_MODE
      LIMIT 1
    ];
    return active.isEmpty() ? null : active[0].Id;
  }

  /**
   * The trap this slice exists to keep shut, at the server end: switching must
   * be a change of *flag*, never a write of a payload. `activateLayout` takes
   * no payload at all, so there is no payload for a caller to send to the
   * wrong row — and this asserts the consequence rather than the signature.
   */
  @IsTest
  static void activatingALayoutChangesNoPayloadAtAll() {
    seedThree();
    User owner = userWith(OWNER_ALIAS);
    Id thirdId = layoutIdNamed('Third');

    Test.startTest();
    System.runAs(owner) {
      NavigatorLayoutController.activateLayout(thirdId);
    }
    Test.stopTest();

    Assert.areEqual(1, activeCount(), 'Exactly one layout may be active');
    Assert.areEqual(
      'Third',
      activeName(),
      'The layout that was activated must be the active one'
    );
    Assert.areEqual(
      'Selling',
      sectionNameOf('First'),
      'Switching must leave the payload of a layout it did not select alone'
    );
    Assert.areEqual(
      'Support',
      sectionNameOf('Second'),
      'Switching away from a layout must leave that layout\'s payload alone'
    );
    Assert.areEqual(
      'Admin',
      sectionNameOf('Third'),
      'Switching to a layout must not rewrite the payload it is switching to'
    );
  }

  /**
   * The invariant stated as a sequence rather than as a single call: no order
   * of switches may leave two active or none. Every layout is visited,
   * including the one that started active and the one that ends where it
   * began.
   */
  @IsTest
  static void noSequenceOfSwitchesLeavesTwoActiveOrNone() {
    seedThree();
    User owner = userWith(OWNER_ALIAS);
    List<String> order = new List<String>{
      'Third',
      'First',
      'First',
      'Second',
      'Third'
    };

    Test.startTest();
    System.runAs(owner) {
      for (String layoutName : order) {
        NavigatorLayoutController.activateLayout(layoutIdNamed(layoutName));
        Assert.areEqual(
          1,
          activeCount(),
          'Exactly one layout must be active after switching to ' + layoutName
        );
        Assert.areEqual(
          layoutName,
          activeName(),
          'The layout just switched to must be the active one'
        );
      }
    }
    Test.stopTest();
  }

  /**
   * An autosave for a layout the user has since switched away from must write
   * its payload without dragging the active flag back to it — and it must not
   * clear the flag either, or a user whose save resolves late is left with no
   * active layout and the next read falls back to whichever sorts first.
   * `makeActive == false` therefore means "leave the flag as it is".
   */
  @IsTest
  static void anUpdateThatDoesNotClaimTheActiveFlagLeavesEveryFlagAlone() {
    seedThree();
    User owner = userWith(OWNER_ALIAS);
    Id firstId = layoutIdNamed('First');

    Test.startTest();
    System.runAs(owner) {
      NavigatorLayoutController.updateLayout(
        firstId,
        'First',
        '{"schemaVersion":2,"sections":[{"name":"Rewritten","columns":3,"items":[]}]}',
        false
      );
    }
    Test.stopTest();

    Assert.areEqual(
      'Rewritten',
      sectionNameOf('First'),
      'The payload must still be written'
    );
    Assert.areEqual(
      1,
      activeCount(),
      'An update that claims no active flag must leave exactly one layout active'
    );
    Assert.areEqual(
      'Second',
      activeName(),
      'The layout that was active must still be the active one'
    );
  }

  /**
   * The same rule, on the row that actually holds the flag — which is the only
   * fixture that can tell "leave the flag as it is" from "clear it".
   *
   * The test above updates `First`, and `First` is not the active layout in
   * `seedThree()`, so setting its flag to false is a no-op and both rules pass
   * it: *a fixture that cannot distinguish two rules will pass both*, recurring
   * inside the test written to close the defect it caused. Updating `Second`
   * discriminates — under `row.Is_Active__c = makeActive == true` the user is
   * left with no active layout at all, which is the failure mode this class's
   * `makeActive == false` semantics exist to prevent.
   */
  @IsTest
  static void anUpdateOnTheActiveLayoutThatClaimsNoFlagLeavesItActive() {
    seedThree();
    User owner = userWith(OWNER_ALIAS);
    Id secondId = layoutIdNamed('Second');

    Test.startTest();
    System.runAs(owner) {
      NavigatorLayoutController.updateLayout(
        secondId,
        'Second',
        '{"schemaVersion":2,"sections":[{"name":"Rewritten","columns":3,"items":[]}]}',
        false
      );
    }
    Test.stopTest();

    Assert.areEqual(
      'Rewritten',
      sectionNameOf('Second'),
      'The payload must still be written'
    );
    Assert.areEqual(
      1,
      activeCount(),
      'An ordinary autosave on the layout the user is looking at must never leave them with no active layout'
    );
    Assert.areEqual(
      'Second',
      activeName(),
      'The layout the save was for must still be the active one'
    );
  }

  /**
   * The "exactly one active" invariant at the create seam.
   *
   * `createLayout(name, json, false)` is reachable through the `@AuraEnabled`
   * surface, and on an owner with nothing else active it used to store a row
   * that no read could ever land on — `activateLayout` is the only thing that
   * sets a flag, and it is unreachable without an active layout to render the
   * menu beside. Criterion 5 says no sequence leaves none active, so the
   * controller does not permit the state rather than asking the client to cope
   * with it.
   */
  @IsTest
  static void aCreateThatClaimsNoFlagStillLeavesTheUserWithAnActiveLayout() {
    User owner = userWith(OWNER_ALIAS);

    Test.startTest();
    System.runAs(owner) {
      NavigatorLayoutController.createLayout('Only', V2_PAYLOAD, false);
    }
    Test.stopTest();

    Assert.areEqual(
      1,
      activeCount(),
      'A user whose only layout was created without claiming the flag must still have an active layout'
    );
    Assert.areEqual(
      'Only',
      activeName(),
      'The one layout the user owns must be the active one'
    );
  }

  /**
   * The other half of the same rule, and the one that keeps it from becoming
   * "a create always steals the flag": an owner who already has an active
   * layout keeps it.
   */
  @IsTest
  static void aCreateThatClaimsNoFlagDoesNotTakeItFromTheLayoutThatHasIt() {
    seedThree();
    User owner = userWith(OWNER_ALIAS);

    Test.startTest();
    System.runAs(owner) {
      NavigatorLayoutController.createLayout('Fourth', V2_PAYLOAD, false);
    }
    Test.stopTest();

    Assert.areEqual(
      1,
      activeCount(),
      'Creating a layout beside an active one must leave exactly one active'
    );
    Assert.areEqual(
      'Second',
      activeName(),
      'A create that claims no flag must leave the flag on the layout that already held it'
    );
  }

  @IsTest
  static void activateRefusesANullLayoutId() {
    seedThree();
    User owner = userWith(OWNER_ALIAS);

    Boolean refused = false;
    Test.startTest();
    System.runAs(owner) {
      try {
        NavigatorLayoutController.activateLayout(null);
        Assert.fail('A null id must not activate whichever layout loads first');
      } catch (AuraHandledException e) {
        refused = true;
      }
    }
    Test.stopTest();

    Assert.isTrue(refused, 'activateLayout must refuse a null id');
    Assert.areEqual(
      'Second',
      activeName(),
      'A refused activation must leave the active layout exactly as it was'
    );
  }

  @IsTest
  static void aUserCannotActivateAnotherUsersLayout() {
    seedThree();
    User peer = userWith(PEER_ALIAS);
    Id thirdId = layoutIdNamed('Third');

    Boolean refused = false;
    Test.startTest();
    System.runAs(peer) {
      try {
        NavigatorLayoutController.activateLayout(thirdId);
        Assert.fail('One user must not switch another user\'s active layout');
      } catch (AuraHandledException e) {
        refused = true;
      }
    }
    Test.stopTest();

    Assert.isTrue(refused, 'A layout belonging to somebody else is refused');
    Assert.areEqual(
      'Second',
      activeName(),
      'The owner\'s active layout must be exactly as they left it'
    );
  }

  /**
   * A rename is a change of *name* and of nothing else. It takes no payload,
   * for the same reason `activateLayout` takes none: the previous project's
   * bug was a name and a payload travelling together to a row chosen by a
   * null.
   */
  @IsTest
  static void renamingALayoutTouchesNeitherItsPayloadNorItsNeighbours() {
    seedThree();
    User owner = userWith(OWNER_ALIAS);
    Id thirdId = layoutIdNamed('Third');

    Test.startTest();
    System.runAs(owner) {
      NavigatorLayoutController.renameLayout(thirdId, 'Renamed');
    }
    Test.stopTest();

    Assert.areEqual(
      'Renamed',
      [SELECT Name FROM Navigator_Layout__c WHERE Id = :thirdId].Name,
      'The layout named in the call must be the one renamed'
    );
    Assert.areEqual(
      'Admin',
      sectionNameOf('Renamed'),
      'A rename must leave the renamed layout\'s own payload alone'
    );
    Assert.areEqual(
      'Support',
      sectionNameOf('Second'),
      'A rename must leave every other layout alone'
    );
    Assert.areEqual(
      'Second',
      activeName(),
      'Renaming a layout must not change which layout is active'
    );
  }

  @IsTest
  static void renameRefusesANullLayoutId() {
    seedThree();
    User owner = userWith(OWNER_ALIAS);

    Boolean refused = false;
    Test.startTest();
    System.runAs(owner) {
      try {
        NavigatorLayoutController.renameLayout(null, 'Renamed');
        Assert.fail('A null id must not rename whichever layout loads first');
      } catch (AuraHandledException e) {
        refused = true;
      }
    }
    Test.stopTest();

    Assert.isTrue(refused, 'renameLayout must refuse a null id');
    Assert.areEqual(
      0,
      [SELECT COUNT() FROM Navigator_Layout__c WHERE Name = 'Renamed'],
      'A refused rename must leave every layout under its own name'
    );
  }

  @IsTest
  static void aUserCannotRenameAnotherUsersLayout() {
    seedThree();
    User peer = userWith(PEER_ALIAS);
    Id secondId = layoutIdNamed('Second');

    Boolean refused = false;
    Test.startTest();
    System.runAs(peer) {
      try {
        NavigatorLayoutController.renameLayout(secondId, 'Hijacked');
        Assert.fail('One user must not rename another user\'s layout');
      } catch (AuraHandledException e) {
        refused = true;
      }
    }
    Test.stopTest();

    Assert.isTrue(refused, 'A layout belonging to somebody else is refused');
    Assert.areEqual(
      'Second',
      [SELECT Name FROM Navigator_Layout__c WHERE Id = :secondId].Name,
      'The owner\'s layout must keep its own name'
    );
  }

  /**
   * Deleting the active layout must leave the user with a sensible active
   * layout rather than an empty screen. "Sensible" is the layout that takes
   * the deleted one's place in the user's own ordering — the one after it —
   * which is what a list does when a row is removed from the middle of it.
   */
  @IsTest
  static void deletingTheActiveLayoutActivatesTheOneThatTakesItsPlace() {
    seedThree();
    User owner = userWith(OWNER_ALIAS);
    Id secondId = layoutIdNamed('Second');

    List<NavigatorLayoutController.LayoutDTO> remaining;
    Test.startTest();
    System.runAs(owner) {
      remaining = NavigatorLayoutController.deleteLayout(secondId);
    }
    Test.stopTest();

    Assert.areEqual(
      1,
      activeCount(),
      'Deleting the active layout must leave exactly one layout active'
    );
    Assert.areEqual(
      'Third',
      activeName(),
      'The layout that took the deleted one\'s place must be the active one'
    );
    Assert.areEqual(
      2,
      remaining.size(),
      'The call must report the layouts the user is left with'
    );
    Assert.areEqual(
      'Selling',
      sectionNameOf('First'),
      'A delete must leave every surviving layout\'s payload alone'
    );
    Assert.areEqual(
      'Admin',
      sectionNameOf('Third'),
      'Activating the successor must not rewrite its payload'
    );
  }

  /**
   * The end of the list has no "one after it". The layout before it is then
   * the one that takes its place, and the invariant is the same: exactly one
   * active, never none.
   */
  @IsTest
  static void deletingTheLastAndActiveLayoutActivatesTheOneBeforeIt() {
    seedThree();
    User owner = userWith(OWNER_ALIAS);
    System.runAs(owner) {
      NavigatorLayoutController.activateLayout(layoutIdNamed('Third'));
    }

    Test.startTest();
    System.runAs(owner) {
      NavigatorLayoutController.deleteLayout(layoutIdNamed('Third'));
    }
    Test.stopTest();

    Assert.areEqual(
      1,
      activeCount(),
      'Deleting the last layout must still leave exactly one active'
    );
    Assert.areEqual(
      'Second',
      activeName(),
      'The layout before the deleted one must become the active one'
    );
  }

  @IsTest
  static void deletingAnInactiveLayoutLeavesTheActiveOneAlone() {
    seedThree();
    User owner = userWith(OWNER_ALIAS);

    Test.startTest();
    System.runAs(owner) {
      NavigatorLayoutController.deleteLayout(layoutIdNamed('First'));
    }
    Test.stopTest();

    Assert.areEqual(1, activeCount(), 'Exactly one layout may be active');
    Assert.areEqual(
      'Second',
      activeName(),
      'Deleting a layout that was not active must not move the active flag'
    );
    Assert.areEqual(
      'Support',
      sectionNameOf('Second'),
      'Deleting a neighbour must not rewrite the active layout\'s payload'
    );
  }

  /**
   * Deleting the only layout leaves no row at all, which is the first-open
   * state: the user sees every tab they can reach in one seeded section, and
   * nothing is written until they change something again. That is a sensible
   * screen, and it is emphatically not an empty one.
   */
  @IsTest
  static void deletingTheOnlyLayoutLeavesTheUserWithNoRowAtAll() {
    User owner = userWith(OWNER_ALIAS);
    System.runAs(owner) {
      insert seedNamed('Only', true, 1, 'Selling');
    }

    List<NavigatorLayoutController.LayoutDTO> remaining;
    Test.startTest();
    System.runAs(owner) {
      remaining = NavigatorLayoutController.deleteLayout(layoutIdNamed('Only'));
    }
    Test.stopTest();

    Assert.areEqual(
      0,
      remaining.size(),
      'A user who deletes their only layout is left with none'
    );
    Assert.areEqual(
      0,
      [SELECT COUNT() FROM Navigator_Layout__c],
      'The row must actually be gone from the store'
    );
  }

  @IsTest
  static void deleteRefusesANullLayoutId() {
    seedThree();
    User owner = userWith(OWNER_ALIAS);

    Boolean refused = false;
    Test.startTest();
    System.runAs(owner) {
      try {
        NavigatorLayoutController.deleteLayout(null);
        Assert.fail('A null id must not delete whichever layout loads first');
      } catch (AuraHandledException e) {
        refused = true;
      }
    }
    Test.stopTest();

    Assert.isTrue(refused, 'deleteLayout must refuse a null id');
    Assert.areEqual(
      3,
      [SELECT COUNT() FROM Navigator_Layout__c],
      'A refused delete must leave every layout standing'
    );
  }

  @IsTest
  static void aUserCannotDeleteAnotherUsersLayout() {
    seedThree();
    User peer = userWith(PEER_ALIAS);
    Id secondId = layoutIdNamed('Second');

    Boolean refused = false;
    Test.startTest();
    System.runAs(peer) {
      try {
        NavigatorLayoutController.deleteLayout(secondId);
        Assert.fail('One user must not delete another user\'s layout');
      } catch (AuraHandledException e) {
        refused = true;
      }
    }
    Test.stopTest();

    Assert.isTrue(refused, 'A layout belonging to somebody else is refused');
    Assert.areEqual(
      3,
      [SELECT COUNT() FROM Navigator_Layout__c],
      'The owner must still have all three of their layouts'
    );
  }

  /**
   * A second user's list is independent. Both users hold layouts under the
   * same names, so a query that lost its owner predicate would return six
   * rows and this would catch it.
   */
  @IsTest
  static void oneUsersLayoutListIsIndependentOfAnothers() {
    seedThree();
    User owner = userWith(OWNER_ALIAS);
    User peer = userWith(PEER_ALIAS);
    System.runAs(peer) {
      insert new List<Navigator_Layout__c>{
        seedNamed('First', true, 1, 'Peer selling')
      };
    }

    List<NavigatorLayoutController.LayoutDTO> ownersList;
    List<NavigatorLayoutController.LayoutDTO> peersList;
    Test.startTest();
    System.runAs(owner) {
      ownersList = NavigatorLayoutController.getLayouts();
    }
    System.runAs(peer) {
      peersList = NavigatorLayoutController.getLayouts();
      NavigatorLayoutController.deleteLayout(peersList[0].layoutId);
    }
    Test.stopTest();

    Assert.areEqual(3, ownersList.size(), 'The owner sees their own three');
    Assert.areEqual(1, peersList.size(), 'The peer sees only their own one');
    Assert.areEqual(
      3,
      [SELECT COUNT() FROM Navigator_Layout__c WHERE OwnerId = :owner.Id],
      'One user deleting their layout must not touch another user\'s list'
    );
    Assert.areEqual(
      'Second',
      activeName(),
      'The owner\'s active layout must be untouched by the peer\'s delete'
    );
  }

  // ---------------------------------------------------------------------
  // Bulk — 200 records, as this repo's testing rule requires
  // ---------------------------------------------------------------------

  /**
   * A per-user layout switcher will never hold 200 layouts, so this is an odd
   * fit — the spec says so, and says it is enforced and not negotiable. It is
   * written to earn its place anyway: activation has to clear the flag on
   * every other layout the user owns, and the only way that stays one UPDATE
   * rather than 199 is if the clearing is bulkified. Seeding all 200 as active
   * makes the clearing do real work.
   */
  @IsTest
  static void activationStaysOneUpdateAcrossTwoHundredLayouts() {
    User owner = userWith(OWNER_ALIAS);
    List<Navigator_Layout__c> seeds = new List<Navigator_Layout__c>();
    for (Integer i = 0; i < 200; i++) {
      seeds.add(seed('Layout ' + String.valueOf(1000 + i), true, i + 1));
    }
    System.runAs(owner) {
      insert seeds;
    }
    Id targetId = [
      SELECT Id
      FROM Navigator_Layout__c
      WHERE Name = 'Layout 1199'
      LIMIT 1
    ]
    .Id;

    Integer queriesUsed;
    Integer dmlUsed;
    List<NavigatorLayoutController.LayoutDTO> layouts;
    Test.startTest();
    System.runAs(owner) {
      Integer queriesBefore = Limits.getQueries();
      Integer dmlBefore = Limits.getDmlStatements();
      NavigatorLayoutController.updateLayout(
        targetId,
        'Layout 1199',
        V2_PAYLOAD,
        true
      );
      queriesUsed = Limits.getQueries() - queriesBefore;
      dmlUsed = Limits.getDmlStatements() - dmlBefore;
      layouts = NavigatorLayoutController.getLayouts();
    }
    Test.stopTest();

    Assert.areEqual(
      1,
      activeCount(),
      'Exactly one layout may be active however many the user owns'
    );
    Assert.areEqual(
      targetId,
      activeId(),
      'The activated layout must be the survivor out of 200'
    );
    Assert.isTrue(
      dmlUsed <= 2,
      'Clearing 199 flags must be bulkified into one UPDATE, not one per row. Used: ' +
      dmlUsed
    );
    Assert.isTrue(
      queriesUsed <= 3,
      'SOQL must be O(1) in the number of layouts. Used: ' + queriesUsed
    );
    Assert.areEqual(
      200,
      layouts.size(),
      'Every one of the 200 layouts should still be readable'
    );
  }

  /**
   * The same bulk question asked of the switcher. Activation has to clear the
   * flag on every other layout the user owns, and a delete of the active one
   * has to do the same for its successor; both stay one UPDATE only if the
   * clearing is bulkified. Seeding all 200 active makes the clearing do real
   * work in both.
   */
  @IsTest
  static void switchingAndDeletingStayBulkifiedAcrossTwoHundredLayouts() {
    User owner = userWith(OWNER_ALIAS);
    List<Navigator_Layout__c> seeds = new List<Navigator_Layout__c>();
    for (Integer i = 0; i < 200; i++) {
      seeds.add(
        seedNamed('Layout ' + String.valueOf(1000 + i), true, i + 1, 'Selling')
      );
    }
    System.runAs(owner) {
      insert seeds;
    }

    Integer activateDml;
    Integer deleteDml;
    Test.startTest();
    System.runAs(owner) {
      Integer before = Limits.getDmlStatements();
      NavigatorLayoutController.activateLayout(layoutIdNamed('Layout 1150'));
      activateDml = Limits.getDmlStatements() - before;

      before = Limits.getDmlStatements();
      NavigatorLayoutController.deleteLayout(layoutIdNamed('Layout 1150'));
      deleteDml = Limits.getDmlStatements() - before;
    }
    Test.stopTest();

    Assert.isTrue(
      activateDml <= 2,
      'Clearing 199 flags on a switch must be one UPDATE, not one per row. Used: ' +
      activateDml
    );
    Assert.isTrue(
      deleteDml <= 3,
      'A delete plus its successor activation must not grow with the number of layouts. Used: ' +
      deleteDml
    );
    Assert.areEqual(
      1,
      activeCount(),
      'Exactly one layout may be active however many the user owns'
    );
    Assert.areEqual(
      'Layout 1151',
      activeName(),
      'The layout that took the deleted one\'s place must be the active one'
    );
    Assert.areEqual(
      199,
      [SELECT COUNT() FROM Navigator_Layout__c],
      'Exactly one row must have been deleted'
    );
  }
}
