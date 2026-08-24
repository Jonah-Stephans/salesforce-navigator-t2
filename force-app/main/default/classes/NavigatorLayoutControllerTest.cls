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

    Assert.areEqual(
      1,
      [SELECT Schema_Version__c FROM Navigator_Layout__c LIMIT 1]
      .Schema_Version__c,
      'Upgrading on read must not write — the stored row stays at v1 until the user next saves'
    );
  }

  @IsTest
  static void anUnreadableFutureSchemaVersionIsRefusedRatherThanGuessedAt() {
    User owner = userWith(OWNER_ALIAS);
    System.runAs(owner) {
      insert new Navigator_Layout__c(
        Name = 'From the future',
        Is_Active__c = true,
        Sort_Order__c = 1,
        Schema_Version__c = 99,
        Layout_JSON__c = V2_PAYLOAD
      );
    }

    Boolean refused = false;
    String message;
    Test.startTest();
    System.runAs(owner) {
      try {
        NavigatorLayoutController.getLayouts();
        Assert.fail(
          'A payload at an unknown schema version must not be read as though it were current'
        );
      } catch (AuraHandledException e) {
        refused = true;
        message = e.getMessage();
      }
    }
    Test.stopTest();

    Assert.isTrue(
      refused,
      'An unknown schema version should raise, not silently mis-read the payload'
    );
    Assert.isTrue(
      message.contains('99'),
      'The refusal should name the version it could not read, so the cause is obvious. Got: ' +
      message
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
      [SELECT COUNT() FROM Navigator_Layout__c WHERE Is_Active__c = TRUE],
      'Exactly one of a user\'s layouts may be active'
    );
    Assert.areEqual(
      targetId,
      [SELECT Id FROM Navigator_Layout__c WHERE Is_Active__c = TRUE LIMIT 1].Id,
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

    Assert.areEqual(
      1,
      [
        SELECT COUNT()
        FROM Navigator_Layout__c
        WHERE Is_Active__c = TRUE AND OwnerId = :owner.Id
      ],
      'One user activating a layout must not clear another user\'s active flag'
    );
    Assert.areEqual(
      'Peer second',
      [
        SELECT Name
        FROM Navigator_Layout__c
        WHERE Is_Active__c = TRUE AND OwnerId = :peer.Id
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
      [SELECT COUNT() FROM Navigator_Layout__c WHERE Is_Active__c = TRUE],
      'Exactly one layout may be active however many the user owns'
    );
    Assert.areEqual(
      targetId,
      [SELECT Id FROM Navigator_Layout__c WHERE Is_Active__c = TRUE LIMIT 1].Id,
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
}
