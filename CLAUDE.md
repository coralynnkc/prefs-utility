# CLAUDE.md

Working notes for this repo. Read `docs/csv-formats.md` before touching any
CSV-handling code — it records what Tabroom's exports actually contain, which
differs from what their headers claim.

## What this is

A browser-only utility for editing Tabroom judge prefs. No backend, no build
step, no framework. `index.html` is the whole app; open it as a file or serve it
statically. Deployment target is GitHub Pages.

## Non-negotiable data rules

These come from measured properties of real exports. Violating them corrupts
pref sheets silently.

1. **Never zip header names to fields positionally without a count check.** The
   pref export declares 6 headers for 7 fields; the unnamed 7th-from-left column
   is the rank. Dropping trailing fields drops the rank.
2. **Ranks tie and have gaps.** They are not `1..N`. Never renumber the sheet as
   `index + 1` — that flattens tie groups and makes every row show up in the
   diff. Preserve tie groups; emit changes only for judges the user moved.
3. **`Rating` is read-only.** Tabroom computes it as a percentile over the full
   tournament pool. Carry it through unchanged; never recompute or interpolate it.
4. **Preserve unknown columns verbatim.** Round-trip every field the importer did
   not understand, in its original position. Export is only allowed to differ
   from import in the rank column.
5. **Use a real CSV parser.** The observed files happen to have no quoted fields;
   a school name containing a comma would break `split(',')`.
6. **No silent fuzzy name matching.** There is no judge ID in any export. Exact
   normalized name matches auto-apply; anything less gets queued for human
   confirmation. Wrong-judge matches are worse than unmatched judges.

## Conventions

- Vanilla JS, ES modules, no transpile. Libraries via CDN `<script>` only when
  they earn their place (PapaParse for CSV, SortableJS for drag).
- `localStorage` keys are namespaced `prefsutil:` — GitHub Pages puts every
  `<user>.github.io` project on one shared origin.
- Python tooling in `tools/` is stdlib-only and CLI-shaped, one file per job.
- Test against `samples/`, never against `data/`.

## Don't commit

Real exports. `data/` and non-`samples/` CSVs are gitignored — keep it that way.
If this repo goes public for Pages, that gitignore is the only thing standing
between a public repo and a published pref sheet.
