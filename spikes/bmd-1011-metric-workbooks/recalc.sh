#!/usr/bin/env bash
# Recalculate workbooks headlessly.
#
# LibreOffice will NOT recalculate an xlsx on load unless told to: the default
# OOXMLRecalcMode is "never", so a plain --convert-to silently hands back the
# values the file was saved with. That is the failure mode to watch for — it
# looks like success and gives you stale answers.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
profile="${LO_PROFILE:-$here/.lo-profile}"
outdir="${1:-$here/out/recalculated}"

mkdir -p "$profile" "$outdir"
export HOME="$profile"

# Seed the profile, then force recalculation on load.
soffice --headless --norestore --terminate_after_init >/dev/null 2>&1 || true
reg="$profile/.config/libreoffice/4/user/registrymodifications.xcu"
if [ -f "$reg" ] && ! grep -q OOXMLRecalcMode "$reg"; then
  python3 - "$reg" <<'PY'
import sys
path = sys.argv[1]
setting = ('<item oor:path="/org.openoffice.Office.Calc/Formula/Load">'
           '<prop oor:name="OOXMLRecalcMode" oor:op="fuse"><value>0</value></prop></item>')
xml = open(path).read().replace('</oor:items>', setting + '</oor:items>')
open(path, 'w').write(xml)
print('forced recalculation on load')
PY
fi

for f in "$here"/out/*.xlsx; do
  echo "recalculating $(basename "$f")"
  soffice --headless --norestore --convert-to xlsx --outdir "$outdir" "$f" >/dev/null
done
echo "written to $outdir"
