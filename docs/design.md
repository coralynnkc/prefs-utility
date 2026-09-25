# Design decisions

Settled choices and the reasoning behind them. Open work lives in
[PLAN.md](../PLAN.md); what Tabroom's exports actually contain, and the evidence
for the constraints below, is in [csv-formats.md](csv-formats.md).

## Where the original sketch was wrong

The first sketch assumed a schema (`judge_id, judge_name, current_rank,
percentile, ...`) that Tabroom does not produce. Five corrections carry through
everything:

| Assumption | Reality |
|---|---|
| `judge_id` key | **No ID in any export.** Identity is `First + Last` plus an alias map. |
| `rank = list position` | Ranks **tie and skip** (`10 10 10 13`, and `80` in a 53-row sheet). The pool is tiered, not strictly ordered. |
| `percentile` is ours | `Rating` is Tabroom-computed over the full pool. **Read-only.** |
| Header names the columns | Pref export has **6 headers for 7 fields**; the unnamed one is the rank. |
| `window.storage` | Artifact-runtime only. On Pages it's `localStorage`. |

## Editor

Single `index.html`, PapaParse for CSV, SortableJS for drag, no build step.

**Import.** When a row has more fields than the header has names, the surplus
columns appear in the mapper as `column N (unnamed)` rather than being dropped.
The mapper asks for **name** (one or two columns), **rank**, and optionally
**school** and **rating**; everything else is carried through untouched. The
mapping is persisted per header signature, so a second export from the same
tournament imports without re-mapping.

`Rating` is a display-only role: the column has to be identified to be rendered
greyed rather than as `col 7`, but it is never written.

**Tiers are the model.** The sheet is an ordered list of tier groups, each one
rank value shared by one or more judges. A judge's rank changes only if the user
moved them; untouched tiers keep their original value, gaps and all. This is
what keeps the diff short — a diff listing all 53 judges is as useless as no
diff.

**Where a split judge lands.** Splitting out of a tie group takes the free rank
nearest the tier it came from — nudging up off `10` in a `1, 10, 80` sheet gives
9, not 2. The obvious "first free number in the interval" rule flings judges
across the large gaps real sheets are full of.

**When there is no free number.** Splitting between `10` and `11` has to
renumber somebody. The editor shifts the shortest possible run — the contiguous
block below the gap, stopping at the first natural gap — and reports how many
judges it moved, because each becomes a line in Tabroom re-entry. Those judges
are marked `bumped`.

**Arrow keys and search from day one.** At 53 judges in a pref sheet and 145 in
a roster, drag alone is unusable. No virtualisation: 145 rows don't need it.

**Export** keeps the same column order, field count and unnamed header; only the
rank column may differ. `Blob` + `<a download>`.

## Diff script

`tools/diff_prefs.py`, stdlib `csv` only — no pandas, so it runs with no venv at
50–150 rows where pandas buys nothing. Keys on normalized `first last`; reports
rank changes plus added and dropped judges, sorted by new rank.

It also reads a single `Name` column, since the mapper can produce one. A full
name is never split back into first/last — guessing where a surname starts is
the same forbidden inference as nickname expansion. Diffing a `Name` file
against a `First`/`Last` file is refused outright rather than reported as every
judge dropped and re-added.

## Name matching

The hard cases (Okafor/Okafor across schools, Sam/Samir Ferreira, Robin/Ryan
Okafor) are written up in [csv-formats.md §3](csv-formats.md). What follows from
them:

- Exact normalized name matches auto-apply; everything else queues for human
  confirmation and is written to a persistent alias map.
- School never confirms or rejects a match — it disagrees with itself for the
  one judge known to be a true match. It is shown to the human as context only.
- No nickname expansion; it would merge Sam/Samir on a guess.
- Judges the matcher can't place go in an explicit **unplaced** bucket, never
  interleaved at a median rank. A guessed-into-the-middle judge is a worse error
  than one placed by hand.

## Testing

The app is one file with no build step, so there is no module to import.
`index.html` marks its pure region with `core:start` / `core:end`;
`tests/harness.mjs` slices exactly that text out and imports it as a data-URL
module, so **the tests run the shipping code, not a copy**. A test asserts the
region stays free of `document` and `localStorage`, so the seam can't rot
quietly.

- `tests/core.test.mjs` — column guessing on the short header, tier algebra
  (ties, gaps, the shift path and its bounds), and export fidelity: an untouched
  sheet re-exports byte for byte, a moved judge changes one cell.
- `tests/test_diff_prefs.py` — stdlib `unittest` over the CLI, mainly checking
  the checklist stays short.
- `tests/vendor.sh` downloads PapaParse and SortableJS from the URLs it reads
  *out of `index.html`*, so a stale CDN pin fails CI rather than a browser.

CI (`.github/workflows/ci.yml`) runs `tests/run.sh` on every push to `main` and
every PR. A second job fails the build if any `.csv` outside `samples/` is
committed.

## Hosting (current)

GitHub Pages: static single page, no backend, no secrets, no build step. What
follows from that:

- **Public repo.** Pages on a private repo needs a paid plan. The code is fine to
  publish; pref sheets are not. `data/` and all non-`samples/` CSVs are
  gitignored, and that gitignore is the only thing between a public repo and a
  published read on the judge pool.
- **`localStorage` only** — per-browser, unsynced, unshared, cleared with site
  data.
- **Shared origin.** Every `<user>.github.io` project page shares one
  `localStorage`, hence the `prefsutil:` key prefix.

Whether this survives shared ratings is an open question — see PLAN.md.
