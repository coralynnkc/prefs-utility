#!/usr/bin/env sh
# Everything CI runs, so local and CI can't drift apart.
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"

echo "==> fetching the CDN libraries index.html pins"
tests/vendor.sh

echo
echo "==> node: the pure logic inside index.html"
node --test tests/*.test.mjs

echo
echo "==> python: tools/diff_prefs.py"
python3 -m unittest discover -s tests
