#!/usr/bin/env bash
# Asserts the SLDS 2 styling gate still fails a pull request that hard-codes a
# colour — by running the entry point CI and the pre-commit hook actually run,
# against throwaway probes on the path that ships.
#
# Why this exists rather than a one-off check at Build: the gate's whole value
# is `--max-warnings 0` on `npm run lint`. The linter reports a hard-coded
# colour at severity *warning*, and warnings exit 0 — so drop that flag and
# `npm run lint` goes green on a stylesheet made entirely of hex codes. Three
# further ways the gate can rot silently, each with an assertion below:
#
#   1. `--max-warnings 0` disappears from `package.json`'s `lint` script, or
#      from the `lint-staged` eslint entry.  → assertions A1, A3
#   2. the `**/lwc/**` re-scoping in `eslint.config.js` stops matching
#      `force-app/**/lwc/**` — the only path that ships — while still matching
#      some other directory holding a fixture.  → assertions A1, A2
#   3. the two SLDS config entries get collapsed onto one `{css,html}` glob,
#      which hands the CSS `language: "css/css"` to every HTML file and
#      silently stops the HTML rules firing.  → assertion B
#   4. an `ignores` entry grows to cover shipping code, so a file that looks
#      linted is never linted at all. `--no-warn-ignored` on the `lint-staged`
#      entry makes that case silent, which is why A1/A2/A3 assert on the
#      *rule name in the output* and not merely on a non-zero exit.
#
# Nothing here asserts an exit code that this script supplies the flags for:
# every probe assertion below shells out to `npm run lint`, or to the exact
# command the `lint-staged` entry runs, so the flag it guards is the flag it
# reads.
#
# The probes live under force-app/**/lwc/** because that is the path that
# reaches an org. They are created and deleted by this script, on the pass and
# the fail path alike, via the EXIT trap — `git status --short` is unchanged by
# a run either way.
set -uo pipefail

cd "$(dirname "$0")/.."

PROBE_DIR="force-app/main/default/lwc/sldsGateProbe"

# The eslint command the pre-commit hook runs, read out of package.json rather
# than copied here. A copy would go green on a package.json that had lost the
# flag, which is the whole failure this script exists to catch.
LINT_STAGED_ESLINT=$(node -e '
  const entries = require("./package.json")["lint-staged"] || {};
  const glob = Object.keys(entries).find(
    (g) => g.includes("lwc") && g.includes("css")
  );
  const cmd = [].concat(entries[glob] || []).find((c) => /(^|\/)eslint\b/.test(c));
  if (!cmd) process.exit(1);
  console.log(cmd);
') || {
  echo "FAIL: package.json has no lint-staged eslint entry globbing lwc CSS."
  echo "The pre-commit half of the gate is gone."
  exit 1
}

cleanup() {
  rm -rf "$PROBE_DIR"
  if [ -e "$PROBE_DIR" ]; then
    echo "FAIL: could not remove the probe at $PROBE_DIR. The tree is dirty."
    return 1
  fi
}
trap cleanup EXIT

fail() {
  echo "FAIL: $1"
  shift
  printf '%s\n' "$@"
  exit 1
}

write_probe() {
  rm -rf "$PROBE_DIR"
  mkdir -p "$PROBE_DIR"
}

# ---------------------------------------------------------------------------
# A — a hard-coded colour on the shipping path fails the real entry point.
# ---------------------------------------------------------------------------
write_probe
cat >"$PROBE_DIR/sldsGateProbe.css" <<'CSS'
/* Throwaway probe written by scripts/verify-slds-gate.sh. Deleted before the
   script exits. Every declaration is a hard-coded value the SLDS linter
   reports at severity *warning*, so only --max-warnings 0 turns it red. */
.probe {
  color: #ffffff;
  background-color: #1b96ff;
  padding: 16px;
  font-size: 14px;
}
CSS

PROBE_CSS_OUT=$(npm run --silent lint 2>&1)
PROBE_CSS_EXIT=$?

# A2 first, because it is the more precise diagnosis. A non-zero exit alone
# would also be satisfied by an unrelated failure elsewhere in the repo, or by
# eslint reporting the probe as ignored rather than linting it.
case "$PROBE_CSS_OUT" in
*no-hardcoded-values-slds2*) ;;
*)
  fail "\`npm run lint\` did not report no-hardcoded-values-slds2 on $PROBE_DIR." \
    "The SLDS CSS rules are no longer reaching force-app/**/lwc/** — either the" \
    "config's **/lwc/** scoping stopped matching the path that ships, or an" \
    "ignores entry now covers it." "" "$PROBE_CSS_OUT"
  ;;
esac
case "$PROBE_CSS_OUT" in
*sldsGateProbe.css*) ;;
*)
  fail "\`npm run lint\` reported no-hardcoded-values-slds2, but not against $PROBE_DIR." \
    "The finding came from somewhere else in the repo, so this run proves" \
    "nothing about the shipping path." "" "$PROBE_CSS_OUT"
  ;;
esac

# A1 — the rules fired, so the only way the entry point can still exit 0 is a
# missing --max-warnings 0.
if [ "$PROBE_CSS_EXIT" -eq 0 ]; then
  fail "\`npm run lint\` reported hard-coded values at $PROBE_DIR and still exited 0." \
    "The SLDS hard-coded-value rules are severity *warning* and warnings exit 0," \
    "so this means --max-warnings 0 has been dropped from package.json's" \
    "\`lint\` script." "" "$PROBE_CSS_OUT"
fi
echo "ok: npm run lint rejects a hard-coded colour under force-app/**/lwc/**."

# A3 — the pre-commit hook's own command must reject it too. `--no-warn-ignored`
# silences the notice eslint prints for an explicitly-named ignored file, which
# would otherwise be the only sign a staged file had stopped being linted. So
# this asserts the rule fires, not just that the exit code is non-zero.
# Word-split on purpose: $LINT_STAGED_ESLINT is a command line read from
# package.json, not a filename.
# shellcheck disable=SC2086
STAGED_OUT=$(npx $LINT_STAGED_ESLINT "$PROBE_DIR/sldsGateProbe.css" 2>&1)
STAGED_EXIT=$?
case "$STAGED_OUT" in
*no-hardcoded-values-slds2*) ;;
*)
  fail "the lint-staged eslint entry did not report no-hardcoded-values-slds2." \
    "Ran: npx $LINT_STAGED_ESLINT $PROBE_DIR/sldsGateProbe.css" \
    "With --no-warn-ignored in play, a staged force-app/**/lwc/** file that has" \
    "become ignored exits 0 in silence; this assertion is what makes that red." \
    "" "$STAGED_OUT"
  ;;
esac
if [ "$STAGED_EXIT" -eq 0 ]; then
  fail "the lint-staged eslint entry reported hard-coded values and still exited 0." \
    "Ran: npx $LINT_STAGED_ESLINT $PROBE_DIR/sldsGateProbe.css" \
    "--max-warnings 0 is no longer on the lint-staged entry in package.json, so" \
    "the pre-commit hook will wave a hard-coded colour through." "" "$STAGED_OUT"
fi
echo "ok: the lint-staged eslint entry rejects it too, and still lints the path."

# ---------------------------------------------------------------------------
# B — the HTML half of the config is still firing.
# ---------------------------------------------------------------------------
# eslint.config.js re-scopes the plugin's CSS entry and its HTML entry
# separately, on purpose: collapsing them onto one `{css,html}` glob hands the
# CSS entry's `language: "css/css"` to every HTML file and the HTML rules stop
# reporting without erroring. Nothing else in this repo would notice.
write_probe
cat >"$PROBE_DIR/sldsGateProbe.html" <<'HTML'
<!-- Throwaway probe written by scripts/verify-slds-gate.sh. Deleted before the
     script exits. The double-dash BEM class is retired in SLDS 2 and
     enforce-bem-usage reports it at severity *error*. -->
<template>
  <div class="slds-text-heading--large slds-p-around--medium">probe</div>
</template>
HTML

PROBE_HTML_OUT=$(npm run --silent lint 2>&1)
PROBE_HTML_EXIT=$?

case "$PROBE_HTML_OUT" in
*enforce-bem-usage*) ;;
*)
  fail "\`npm run lint\` did not report enforce-bem-usage on $PROBE_DIR." \
    "The SLDS HTML entry has stopped applying to force-app/**/lwc/**. The usual" \
    "cause is the two SLDS config entries being collapsed onto one {css,html}" \
    "glob, which hands the CSS language to HTML files and silently disables" \
    "these rules." "" "$PROBE_HTML_OUT"
  ;;
esac
if [ "$PROBE_HTML_EXIT" -eq 0 ]; then
  fail "\`npm run lint\` reported enforce-bem-usage at $PROBE_DIR and still exited 0." \
    "That rule is severity *error*, so this is the lint script no longer" \
    "failing on what it reports." "" "$PROBE_HTML_OUT"
fi
echo "ok: npm run lint rejects retired SLDS markup under force-app/**/lwc/**."

# ---------------------------------------------------------------------------
# C — and the gate is not simply red on everything.
# ---------------------------------------------------------------------------
# A gate that only ever goes red is indistinguishable from a broken one.
write_probe
cat >"$PROBE_DIR/sldsGateProbe.css" <<'CSS'
/* Throwaway probe written by scripts/verify-slds-gate.sh. Deleted before the
   script exits. Every value is an --slds-g-* global hook carrying the fallback
   no-slds-var-without-fallback requires. */
.probe {
  color: var(--slds-g-color-on-surface-1, #747474);
  background-color: var(--slds-g-color-surface-container-1, #ffffff);
  padding: var(--slds-g-spacing-4, 1rem);
  font-size: var(--slds-g-font-scale-1, 0.875rem);
  border-radius: var(--slds-g-radius-border-2, 0.25rem);
  box-shadow: var(--slds-g-shadow-outline-focus-1, 0 0 0 2px #0b5cab);
}
CSS
cat >"$PROBE_DIR/sldsGateProbe.html" <<'HTML'
<!-- Throwaway probe written by scripts/verify-slds-gate.sh. Deleted before the
     script exits. Single-underscore BEM is the SLDS 2 spelling. -->
<template>
  <div class="slds-text-heading_large slds-p-around_medium">probe</div>
</template>
HTML

CLEAN_OUT=$(npm run --silent lint 2>&1)
if [ $? -ne 0 ]; then
  fail "\`npm run lint\` rejected a compliant probe at $PROBE_DIR." \
    "Compliant SLDS 2 hooks and BEM spelling must pass, or the gate is not a" \
    "gate — it is an outage." "" "$CLEAN_OUT"
fi
echo "ok: npm run lint accepts var(--slds-g-*, fallback) and SLDS 2 BEM."

# ---------------------------------------------------------------------------
# D — the committed fixture pair, which records the accepted and the rejected
# form in the repository rather than only inside this script.
# ---------------------------------------------------------------------------
# --no-ignore is required here: eslint.config.js ignores the fixture directory
# so the ordinary lint run never trips over the deliberately dirty one. These
# two assertions supply their own flags, so they guard the *rules*, not the
# entry point's flags — A1 to A3 above are what guard those.
rm -rf "$PROBE_DIR"
DIRTY="test/slds-lint-fixtures/lwc/hardCodedColour/hardCodedColour.css"
CLEAN="test/slds-lint-fixtures/lwc/compliantHooks/compliantHooks.css"

if npx eslint --no-ignore --max-warnings 0 "$DIRTY" >/dev/null 2>&1; then
  fail "the gate accepted $DIRTY. A hard-coded colour must be rejected." \
    "$(npx eslint --no-ignore --max-warnings 0 "$DIRTY" 2>&1)"
fi
echo "ok: the fixture carrying hard-coded values is rejected."

if ! CLEAN_FIXTURE_OUT=$(npx eslint --no-ignore --max-warnings 0 "$CLEAN" 2>&1); then
  fail "the gate rejected $CLEAN. Compliant SLDS 2 hooks must pass." "$CLEAN_FIXTURE_OUT"
fi
echo "ok: the compliant fixture is accepted."
