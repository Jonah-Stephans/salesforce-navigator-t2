---
paths:
  - "**/lwc/**/*.css"
---

# Sizing grid tracks against the SLDS scale

`no-hardcoded-values-slds2` is the reason a hard-coded length in an LWC stylesheet fails
`npm run lint --max-warnings 0`. It checks a fixed list of properties, and the properties that size a
grid are not on that list — so the guard that makes the rest of a stylesheet safe is absent exactly
where track sizing is written. All three entries below cost fix cycles on the Navigator.

- `no-hardcoded-values-slds2` is property-scoped, and `grid-template-columns`, `grid-template-rows`, `gap` and `flex-basis` are not among the properties it checks https://github.com/Jonah-Stephans/salesforce-navigator-t2/pull/5
  A raw length inside a track function passes lint in silence. Measured against a probe stylesheet
  under `**/lwc/**`: a raw `30rem`, which maps exactly to `--slds-g-sizing-16`, warns on `width` and
  draws nothing at all on any of those four. Read a silent pass as "this property is not checked",
  never as "no hook maps to this value" — the rule does fire on unmapped values elsewhere, so its
  silence here carries no information either way.
- Search the whole `--slds-g-sizing-*` scale before concluding that no hook matches a length https://github.com/Jonah-Stephans/salesforce-navigator-t2/pull/5
  The scale runs `-13` (10rem), `-14` (15rem), `-15` (20rem), `-16` (30rem), and stops there. A raw
  `26rem` shipped for three fix cycles because a search stopped at `-14` and the missing guard above
  meant nothing said otherwise.
- Where the linter cannot reach, a stylesheet-text pin is the only guard, and it has to be able to fail on a raw length appearing anywhere in the track function https://github.com/Jonah-Stephans/salesforce-navigator-t2/pull/5
  Floor, ceiling and track count all have to be covered. A pin that only checks one end of the
  function is green on a raw value introduced at the other, which is the shape this actually took.
