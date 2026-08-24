---
depends_on:
  - dev-path/personal-navigator-layouts/slices/02-tab-and-navigation.md
touches:
  - force-app/main/default/objects/Navigator_Layout__c/Navigator_Layout__c.object-meta.xml
  - force-app/main/default/objects/Navigator_Layout__c/fields/Is_Active__c.field-meta.xml
  - force-app/main/default/objects/Navigator_Layout__c/fields/Layout_JSON__c.field-meta.xml
  - force-app/main/default/objects/Navigator_Layout__c/fields/Schema_Version__c.field-meta.xml
  - force-app/main/default/objects/Navigator_Layout__c/fields/Sort_Order__c.field-meta.xml
  - force-app/main/default/classes/NavigatorLayoutController.cls
  - force-app/main/default/classes/NavigatorLayoutControllerTest.cls
  - force-app/main/default/permissionsets/Salesforce_Navigator_User/Salesforce_Navigator_User.permissionset-meta.xml
  - force-app/main/default/permissionsets/Salesforce_Navigator_User/objectSettings/Navigator_Layout__c.objectSettings-meta.xml
---

# Group tabs into named sections that survive a reload

> Watch a new test go red before you make it green.
> _Why: a test written before the code cannot be written to hit a coverage number — there is nothing to
> cover yet. Retires when Apex gets mutation testing._

## What to build

A user groups their tabs into named sections at a column count they choose, and finds those sections
still there tomorrow.

## Acceptance criteria

- [ ] A user opening the Navigator for the first time sees every tab they can reach in one section named
      "All Items".
- [ ] No layout record exists for a user who has only ever looked — the first record is written on their
      first actual change.
- [ ] A user can create a section, give it a name, rename it, and delete it.
- [ ] A user can set a section's column count to any value from one to six, and the section renders its
      items in that many columns.
- [ ] Sections, names and column counts survive a page reload and a fresh login.
- [ ] A change is saved without the user pressing anything; a burst of rapid changes results in one save,
      not one per change.
- [x] met — A second user opening the Navigator sees their own sections, never the first user's, and
      cannot reach the first user's layout through ordinary record access.
      `NavigatorLayoutControllerTest.peerCannotReadAnotherUsersLayouts` proves the read half and
      `aUserCannotUpdateAnotherUsersLayout` the write half — holding another user's record id is not
      enough, and the refusal does not distinguish "not yours" from "does not exist". Both run under
      `System.runAs` a genuine Standard User. The query is `WITH USER_MODE` *and* explicitly
      predicated on `OwnerId = :UserInfo.getUserId()`; sharing is defence in depth, never the filter.
- [ ] A user whose manager sits above them in the role hierarchy is not visible to that manager — the
      object grants no access through hierarchies.
- [ ] An item whose tab the user has lost access to stops rendering, and the stored layout is unchanged:
      restoring access restores the item to its original position.
- [x] met — The stored payload carries no tab labels — an org relabelling a tab is reflected on the
      next render with no write.
      `theStoredPayloadCarriesNothingDerivableFromThePlatform` hands the controller a payload
      carrying `label`, `iconUrl` and `pageReference`, then re-queries the row and asserts none of
      the three is in `Layout_JSON__c` while `id` and `rename` survive. They are dropped by
      construction rather than by a rule someone has to remember: the normalising walk emits `name`,
      `columns`, `id` and `rename` and nothing else, and it is the only route into the blob.
      _The rendering half of this criterion is the LWC pass's — nothing can relabel until something
      draws a label._
- [x] met — The stored payload carries a schema version, and the code that reads it dispatches on
      that version. `Schema_Version__c` is stamped on every write and `schemaVersion` is written into
      every payload including an empty one. Four tests hold it down:
      `aV1RowIsUpgradedToV2OnRead` (a v1 row's bare-string items come back as `{id}` objects, column
      counts intact, **and the row is still at v1 afterwards** — reading never writes),
      `savingAlwaysStampsAndWritesTheCurrentVersion` (a v1 payload handed to a save is written back
      at v2), `anUnreadableFutureSchemaVersionIsRefusedRatherThanGuessedAt` (a v99 row raises and the
      message names the version) and `anEmptyPayloadIsStoredAsALayoutWithNoSections`.
- [x] met — Apex tests cover the controller under `System.runAs` for a non-administrator, and at the
      bulk volume the repository's testing rule requires. All 18 methods run under `System.runAs` a
      user on the genuine **Standard User** profile, not an admin;
      `activationStaysOneUpdateAcrossTwoHundredLayouts` is the 200-record bulk test. It is written to
      earn its place rather than to satisfy the hook: it seeds all 200 layouts active so the
      activation clearing does real work, then asserts exactly one survives, that it is the right
      one, and that the cost stayed O(1) — `dmlUsed <= 2` and `queriesUsed <= 3` regardless of
      volume. 18/18 pass; `NavigatorLayoutController` is at 92% coverage.

## Deviations

- [x] **"Grant Access Using Hierarchies" cannot be shipped as source, and the design assumes it can.**
      `## Design` → _The store_ specifies the object as "OWD Private, Grant Access Using Hierarchies
      OFF" and one acceptance criterion turns on it. **The flag is not expressible in the Metadata
      API**, established against the live scratch org at API 67.0 rather than from documentation:

      1. Deployed `Navigator_Layout__c`, then retrieved it back. The server round-trips
         `<sharingModel>`, `<externalSharingModel>` and `<enableSharing>` and emits **no** hierarchy
         element — and it does emit defaults, so absence is not suppression.
      2. `Settings:Sharing` (`SharingSettings`) carries thirteen org-wide switches, none per-object
         and none about hierarchies. `SharingRules:Navigator_Layout__c` came back an empty element.
      3. Tooling `EntityDefinition` exposes only `InternalSharingModel` / `ExternalSharingModel`;
         Tooling `CustomObject` exposes only `SharingModel`.
      4. Dry-run deploys of `<enableHierarchicalSharing>`, `<grantAccessUsingHierarchies>`,
         `<enableGrantAccessUsingHierarchies>` and `<sharingModelHierarchy>` each failed with
         `Element {…}<name> invalid at this location in type CustomObject` — **the identical error a
         deliberately bogus `<totallyBogusElementXyz>` control produced.** The server does not
         recognise the concept on `CustomObject` under any spelling.

      So the toggle is Setup-only: Setup → Sharing Settings → Organization-Wide Defaults → untick
      **Grant Access Using Hierarchies** on Navigator Layout. That is a third documented admin step,
      alongside the two the spec already carries in `## Out of scope` (placing the tab in an app,
      assigning the permission set) — but unlike those two it is **load-bearing for an Outcome**, not
      just for reach. Until it is performed, every manager above a user in the role hierarchy can
      read that user's layouts, and the isolation Outcome is not met in the org.

      This is a design question, not a build one, so this pass did not decide it.

      **Resolved. Engineer's decision, 2026-08-24, taken in the `dev-path:build` session when asked and
      recorded here at their request: accept it as a third documented admin step**, alongside the two
      the spec already carries. `spec.md` → `## Out of scope` and `## Design` → *What an administrator
      must do* have been updated to carry it, with the note that this third step differs from the other
      two in being load-bearing for an Outcome rather than only for reach.

      The acceptance criterion below stays unticked, because the criterion is a claim about the org and
      the org is not in that state until an admin acts. It is not a defect and not deferred work: the
      object ships at OWD Private, which is the half source can deliver, and the remaining half is a
      documented Setup action. What makes this tolerable rather than a hole is the paragraph following
      — the Navigator itself is safe either way.

      The peer-isolation half of the Outcome — a second user cannot reach the first user's layout —
      **is** met and is asserted by `NavigatorLayoutControllerTest.peerCannotReadAnotherUsersLayouts`.

- **The JSON payload declares its own version, and the save path reads it.** _How_, not _what_ — the
      slice still ships one versioned deserialiser reading v1 and writing v2; this is how it decides
      which version it is looking at.

      The first green run had exactly one failure, and it was the test catching a real gap rather
      than the test being wrong. The write path parsed incoming payloads at the current version, so a
      client holding a v1 payload was rejected outright. That is not hypothetical: during a package
      upgrade a user with a browser tab still running the previous bundle keeps autosaving in the
      previous shape, and every drag they make would throw.

      So the version is now resolved from two different authorities, one per direction, because each
      is the only reliable one in its own situation:

      | Direction | Authority | Why |
      | --- | --- | --- |
      | Read | the row's `Schema_Version__c` | the queryable, reportable record of what was written; the only trustworthy thing about a blob from an older package, including one written before the payload carried a version |
      | Write | the payload's own `schemaVersion` key, defaulting to 1 when absent | there is no column yet; a payload declaring no version is by definition from before the key existed |

      `schemaVersion` is therefore written into every payload including an empty one, and the two
      entry points (`fromStored`, `fromClient`) share one normalising walk so they cannot drift.

- **`sf project deploy start` reported a source-tracking conflict on `Salesforce_Navigator_User` and
      was re-run with `--ignore-conflicts`.** Checked before overriding rather than after: the
      permission set was retrieved from the org and is byte-identical to what slice 02 committed. The
      conflict is tracking noise — deploying the new `CustomObject` touched the permission set's
      server-side timestamp. Nothing in the org was lost.

## Critique findings
