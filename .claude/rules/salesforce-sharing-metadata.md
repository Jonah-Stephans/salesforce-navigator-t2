---
paths:
  - "**/objects/**"
  - "**/permissionsets/**"
  - "**/classes/**"
---

# Sharing that ships as source, and sharing that does not

Read this before treating a record-isolation requirement as delivered by a deploy. Half of the
Salesforce sharing model is expressible in source and half is not, and the half that is not will
quietly leave a requirement unmet.

- `sharingModel` Private ships as source; "Grant Access Using Hierarchies" is not expressible in the Metadata API and cannot be deployed https://github.com/Jonah-Stephans/salesforce-navigator-t2/pull/1
  Proved against a live org at API 67.0 — four candidate element names each failed with the same
  error a deliberately bogus control element produced.
- A record-isolation requirement that depends on Grant Access Using Hierarchies is not met by any deploy; it needs a documented admin step, and until that step is taken a manager above the owner reads the records through reports, list views and the API https://github.com/Jonah-Stephans/salesforce-navigator-t2/pull/1
- Do not rely on sharing alone in Apex — filter on `OwnerId = :UserInfo.getUserId()` as well as running `WITH USER_MODE`, so the component stays correct whatever the org's hierarchy setting is https://github.com/Jonah-Stephans/salesforce-navigator-t2/pull/1
- An `@AuraEnabled(cacheable=true)` method cannot perform DML, which makes the annotation itself the proof that a read path writes nothing https://github.com/Jonah-Stephans/salesforce-navigator-t2/pull/1
- Prove per-user isolation with a second user under `System.runAs` holding a real record id, not by asserting the query filter exists https://github.com/Jonah-Stephans/salesforce-navigator-t2/pull/1
