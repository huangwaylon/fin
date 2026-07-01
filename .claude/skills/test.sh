#!/usr/bin/env bash
# Smoke test for the equity research skills. Requires the server running (npm start).
# Each check asserts the script emits valid JSON with the expected top-level shape.
set -u
cd "$(dirname "$0")"
PASS=0; FAIL=0
check() { # name, command...
  local name="$1"; shift
  if out="$("$@" 2>/dev/null)" && echo "$out" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);if(!j.skill)throw new Error('no skill key')})" 2>/dev/null; then
    echo "PASS  $name"; PASS=$((PASS+1))
  else
    echo "FAIL  $name"; FAIL=$((FAIL+1))
  fi
}

# Server reachable?
if ! curl -s "http://localhost:5173/api/snapshot?symbol=AAPL" >/dev/null 2>&1; then
  echo "SKIP  server not reachable at :5173 — run 'npm start' first"; exit 2
fi

check "dossier"            node equity-dossier/scripts/dossier.mjs NVDA
check "screen composite"   node equity-screen/scripts/screen.mjs AAPL MSFT NVDA V
check "screen tilted"      node equity-screen/scripts/screen.mjs AAPL MSFT NVDA --weights quality:0.5,value:0.5
check "screen fault-iso"   node equity-screen/scripts/screen.mjs V NOTATICKER MSFT
check "compare"            node equity-compare/scripts/compare.mjs GOOGL V NVDA
check "portfolio invvol"   node equity-portfolio/scripts/portfolio.mjs GOOGL V NVDA LLY
check "portfolio minvar"   node equity-portfolio/scripts/portfolio.mjs GOOGL V NVDA LLY --method minvar
check "portfolio equal"    node equity-portfolio/scripts/portfolio.mjs GOOGL V NVDA --method equal

echo "----"
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
