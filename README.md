# prefs-utility

Faster judge-pref editing for Tabroom.

Tabroom has no bulk pref import — every rank change is typed in one judge at a
time through the web UI. This tool closes the loop around that limitation:

1. **Import** a pref-sheet CSV export.
2. **Re-rank** by drag, search-and-nudge, or bulk tier assignment.
3. **Export** an edited CSV.
4. **Diff** old vs. new to get a short checklist of exactly what to re-enter.

Later, a persistent Elo-style rating built from pairwise judge comparisons
generates a first-pass ranking for a new tournament roster.

## Status

Scaffolding. Nothing is built yet — see [PLAN.md](PLAN.md) for the build order and
[docs/csv-formats.md](docs/csv-formats.md) for the reverse-engineered export formats.

## Layout

```
index.html            the app (single page, no build step, no backend)
tools/diff_prefs.py   old vs. new rank diff -> Tabroom re-entry checklist
docs/csv-formats.md   what Tabroom's exports actually contain
samples/              redacted fixtures reproducing every format quirk
data/                 real exports (gitignored)
```

## The diff script

```
python3 tools/diff_prefs.py original.csv edited.csv
```

Prints only the judges whose rank changed, sorted by new rank. Needs Python 3.9+;
no dependencies.

## Data handling

Pref sheets are competitively sensitive — they are your team's read on the judge
pool. `data/` and every `.csv` outside `samples/` are gitignored. Keep real
exports out of commits, especially if this repo is ever made public for Pages
hosting.

## Hosting

Static single-page app, so GitHub Pages works. See "Hosting" in
[PLAN.md](PLAN.md) for the constraints that follow from that choice — chiefly
that all state is browser-local `localStorage`, per-browser and unsynced, so the
Phase 3 rating DB needs explicit JSON export to survive.
