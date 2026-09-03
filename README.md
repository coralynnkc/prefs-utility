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

Steps 1–4 work: the editor and the diff script are both built. The Elo ratings
and roster first-pass are not. See [PLAN.md](PLAN.md) for the build order and
[docs/csv-formats.md](docs/csv-formats.md) for the reverse-engineered export formats.

## Layout

```
index.html            the app (single page, no build step, no backend)
tools/diff_prefs.py   old vs. new rank diff -> Tabroom re-entry checklist
tests/                node + unittest suites, run by tests/run.sh
docs/csv-formats.md   what Tabroom's exports actually contain
samples/              redacted fixtures reproducing every format quirk
data/                 real exports (gitignored)
```

## The editor

Open `index.html` — from GitHub Pages, or straight off disk; both work.

1. Drop in a pref-sheet CSV. The mapper shows every column with its real values
   and asks which is the rank; it pre-fills its guess and explains it.
2. Re-rank. Judges sit in **tiers** — a tier is one rank value, shared by
   everyone in it, exactly as Tabroom stores them. Drag a judge onto another
   tier to join it, or into a gap between tiers to split off a new one. With a
   judge focused, `↑`/`↓` joins the tier above or below and `⇧↑`/`⇧↓` splits
   into a new one; the arrow keys are the fast path at 50+ judges.
3. Export. Only the rank column changes; every other field, the row order and
   the odd 6-name header come back out exactly as they went in.

A judge's rank changes only if you moved them. Untouched tiers keep their
original rank values, gaps and all, which is what keeps the diff in step 4 down
to the handful of judges you actually have to re-type.

`Rating` is Tabroom's own percentile over the full tournament pool, so it is
shown greyed and never written.

Everything is stored in this browser's `localStorage` and nothing is uploaded.
Edits autosave per file and are offered back the next time you open it.

## The diff script

```
python3 tools/diff_prefs.py original.csv edited.csv
```

Prints only the judges whose rank changed, sorted by new rank, plus anyone added
or dropped. Needs Python 3.9+; no dependencies.

## Tests

```
tests/run.sh
```

Runs the Node suite over the app's logic and the `unittest` suite over the diff
script; `tests/vendor.sh` fetches the two CDN libraries first. Both run in CI on
every push and PR. See "Testing" in [PLAN.md](PLAN.md) for how a single-file app
with no build step gets unit tested.

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
