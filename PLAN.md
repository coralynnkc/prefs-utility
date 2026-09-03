# Plan

Revised against the two real Tabroom exports in `data/`. Format details and the
evidence behind the constraints below are in [docs/csv-formats.md](docs/csv-formats.md).

## What the real exports changed

The original sketch assumed a schema (`judge_id, judge_name, current_rank,
percentile, ...`) that Tabroom does not produce. Five corrections carry through
the whole plan:

| Assumption | Reality |
|---|---|
| `judge_id` key | **No ID in any export.** Identity is `First + Last` plus an alias map. |
| `rank = list position` | Ranks **tie and skip** (`10 10 10 13`, and `80` in a 53-row sheet). The pool is tiered, not strictly ordered. |
| `percentile` is ours | `Rating` is Tabroom-computed over the full pool. **Read-only.** |
| Header names the columns | Pref export has **6 headers for 7 fields**; the unnamed one is the rank. |
| `window.storage` | Artifact-runtime only. On Pages it's `localStorage`. |

The column-mapping UI was already the right call — it just has to handle a header
that is *shorter than the row*, which is the specific defect here.

---

## Phase 1 — Pref editor

Single `index.html`. PapaParse for CSV, SortableJS for drag, no build step.

**Import**
- Parse with header detection; if field count > header count, show the surplus
  columns as `column N (unnamed)` in the mapper rather than dropping them.
- Mapper asks for three roles only: **name** (one or two columns), **rank**,
  and optionally **school**. Everything else is carried through untouched.
- Persist the mapping per header-signature so a second export from the same
  tournament imports without re-mapping.

**Edit** — the tiering problem is the design centre.
- Model the sheet as an ordered list of **tier groups**, each holding one or more
  judges at a shared rank. Drag moves a judge between tiers or splits a new one.
- Renumbering rule: a judge's rank changes only if the user moved them.
  Untouched tiers keep their original rank value, gaps and all. This keeps the
  Phase 2 diff short, which is the entire point — a diff listing all 53 judges is
  as useless as no diff.
- Search filter and arrow-key nudge from v1, not retrofitted. 53 judges in the
  pref sheet and 145 in the roster: dragging is unusable at that size. Virtualize
  only if the DOM actually struggles; 145 rows probably won't.
- `Rating` is displayed greyed and never edited.

**Export** — same column order, same field count, same unnamed header. Only the
rank column may differ from the imported file. `Blob` + `<a download>`.

**Persistence** — `localStorage`, keys namespaced `prefsutil:`, autosaved per
tournament. See Hosting for why this is weaker than it sounds.

---

## Phase 2 — Diff script

`tools/diff_prefs.py`, stdlib `csv` only. Dropping pandas keeps it a true
one-liner between exports with no venv to activate — the dataset is 50–150 rows,
pandas buys nothing here.

Keys on normalized `first last`. Reports rank changes plus judges added or
dropped between the two files, sorted by new rank, as a checklist to work down
in Tabroom.

---

## Phase 3 — Elo ratings

Persistent, cross-tournament, keyed by normalized name + alias map.

```
judges: { key: { first, last, schools[], rating, comparisons, last_seen } }
```

- Pairwise: "prefer A or B for your side?" Elo update `R' = R + K(S - E)`,
  `E = 1/(1 + 10^((R_opp - R)/400))`, K ≈ 24.
- Pair selection prioritizes low-comparison judges, then near-equal ratings.
- Realistically you will do tens, not hundreds, of comparisons. Ratings will stay
  noisy — treat output as a *starting position*, never a final sheet.

**Roster → first pass**
1. Import roster CSV (`Tabroom-judgelist.csv` shape).
2. Exact normalized name match auto-applies. Near-matches queue for confirmation;
   nothing matches silently.
3. Matched judges sort by rating into tiers.
4. Unmatched judges land in an explicit "unplaced" bucket — **not** interleaved
   at a median rank. An unrated judge guessed into the middle of the sheet is a
   worse error than one you had to place by hand.
5. Output becomes the rank column feeding Phase 1.

**Validation gap:** the two exports on hand share exactly one judge, so there is
no matched pair to test the matcher against. Get two exports from the same
circuit before trusting step 2.

---

## Build order

1. Import with column mapping + tier-aware edit + export
2. `tools/diff_prefs.py`
3. Rating store + pairwise comparison UI + JSON export/import
4. Roster upload → first-pass ranking, wired into 1

---

## Hosting

**GitHub Pages is fine.** Static single page, no backend, no server-side secrets,
no build step required. Push `index.html` at the repo root, enable Pages on the
default branch, done — no Actions workflow needed.

Four constraints follow from that choice:

- **Public repo.** Pages on a private repo needs a paid plan. The code is fine to
  publish; the pref sheets are not. `data/` and all non-`samples/` CSVs are
  gitignored — that gitignore is the only thing between a public repo and a
  published read on the judge pool. Check `git status` before the first push.
- **`localStorage`, not `window.storage`.** The original plan's `window.storage`
  with its personal/shared distinction is an Artifact-runtime API and does not
  exist on Pages. Everything is per-browser `localStorage`: not synced across
  devices, not shared with anyone, and cleared with site data.
- **Shared origin.** All of `<user>.github.io` is one origin, so every project
  page you host shares a `localStorage` namespace. Prefix keys `prefsutil:`.
- **The Phase 3 rating DB is the real exposure.** Months of pairwise comparisons
  living only in one browser's `localStorage`, one "clear site data" from gone.
  Ship JSON export/import in the same commit as the rating store, not later.

If cross-device sync for ratings ever matters more than simplicity, that is the
point to move off Pages — not before.
