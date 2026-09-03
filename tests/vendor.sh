#!/usr/bin/env sh
# Download the CDN libraries index.html pins, into gitignored vendor/.
#
# The URLs are read out of index.html rather than repeated here, so this also
# checks that the versions the app actually loads are still resolvable — a
# broken or typo'd CDN pin fails CI instead of failing in someone's browser.
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
mkdir -p "$root/vendor"

grep -o 'https://cdnjs\.cloudflare\.com/[^"]*\.js' "$root/index.html" | sort -u | while read -r url; do
  case "$url" in
    *PapaParse*) out=papaparse.js ;;
    *Sortable*)  out=sortable.js ;;
    *) echo "vendor.sh: unrecognised CDN pin $url" >&2; exit 1 ;;
  esac
  printf '  %s\n    -> vendor/%s\n' "$url" "$out"
  curl -fsSL --retry 3 "$url" -o "$root/vendor/$out"
  [ -s "$root/vendor/$out" ] || { echo "vendor.sh: $out came back empty" >&2; exit 1; }
done

ls -l "$root/vendor"
