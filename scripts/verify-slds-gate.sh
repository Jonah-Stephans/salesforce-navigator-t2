#!/usr/bin/env bash
# Asserts the SLDS 2 styling gate's own exit codes against two fixtures.
#
# Why this exists rather than a one-off check at Build: the gate's whole value
# is `--max-warnings 0`. The linter reports a hard-coded colour at severity
# *warning*, and warnings exit 0 — so drop that flag, or extend the config in a
# way that stops matching **/lwc/**, and `npm run lint` goes green on a
# stylesheet made entirely of hex codes with nothing to show for it. This turns
# that silent failure into a red check.
#
# --no-ignore is required: eslint.config.js ignores the fixture directory so the
# ordinary lint run never trips over the deliberately dirty one.
set -uo pipefail

cd "$(dirname "$0")/.."

DIRTY="test/slds-lint-fixtures/lwc/hardCodedColour/hardCodedColour.css"
CLEAN="test/slds-lint-fixtures/lwc/compliantHooks/compliantHooks.css"

npx eslint --no-ignore --max-warnings 0 "$DIRTY" >/dev/null 2>&1
if [ $? -eq 0 ]; then
  echo "FAIL: the gate accepted $DIRTY. A hard-coded colour must be rejected."
  npx eslint --no-ignore --max-warnings 0 "$DIRTY"
  exit 1
fi
echo "ok: the gate rejects a hard-coded colour."

if ! npx eslint --no-ignore --max-warnings 0 "$CLEAN"; then
  echo "FAIL: the gate rejected $CLEAN. Compliant SLDS 2 hooks must pass."
  exit 1
fi
echo "ok: the gate accepts var(--slds-g-*, fallback)."
