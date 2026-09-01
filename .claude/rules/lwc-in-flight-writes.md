---
paths:
  - "**/lwc/**/*.js"
---

# Writes issued while another write is in flight

Read this before adding a second immediate write to a component that already has one. A debounce
coalesces a burst into one call and hides all of this; the moment two paths write immediately and
neither coalesces, the window below opens. Every entry cost fix cycles on the Navigator, and every
one of them was green in a suite that resolves Apex instantly.

- A write captures the record id synchronously, so a second write made inside the first's round trip is captured against the state before that trip landed https://github.com/Jonah-Stephans/salesforce-navigator-t2/pull/11
  An act made while a create is in flight is captured as another create — two rows for a user who
  owned none — and one made while a delete is in flight is captured against the row that is about
  to stop existing.
- Coalescing an in-flight write recaptures every field it reads at the moment the wait clears, not just the id https://github.com/Jonah-Stephans/salesforce-navigator-t2/pull/11
  An act addressed to the record on screen when the user made it becomes an act addressed to
  whatever is on screen afterwards, and lands as a no-op update of that record. The store looks
  tidy in that state — one row, right name, active flag agreeing with the switcher — so assert
  that the act the user performed actually happened, not that the store is consistent.
- A single field cannot hold the set of operations in flight; a bare clear and a bare assignment are both lossy https://github.com/Jonah-Stephans/salesforce-navigator-t2/pull/11
  Each writer must check the field still holds its own entry before clearing it, and must not
  overwrite an entry that is still open. It takes three acts to see the assignment half and a
  refused first act to see the clear half — a two-act probe is clean either way.
- Enumerating one method's callers does not establish what can move a snapshot; re-entry and a wire redelivery both move it https://github.com/Jonah-Stephans/salesforce-navigator-t2/pull/11
  Re-entering a mode re-takes the snapshot, and a snapshot derived from wired data moves when LDS
  refreshes its cache. A branch declared dead on the narrower enumeration is live.
