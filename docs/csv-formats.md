# Tabroom CSV formats (observed)

Derived empirically from two real exports (kept locally in `data/`, gitignored).
Redacted fixtures reproducing every quirk below live in `samples/`.

---

## 1. Pref sheet export

Source file: `Prefs for <Team> at <Tournament>.csv` (54 data rows in the observed sample).

### The header lies

The header row declares **6 columns**. Every data row has **7 fields**:

```
First,Last,School,Online,Rounds,Rating          <- 6 names
Tim,Alderete,The Meadows School,,6,6,4.06       <- 7 values
```

The unnamed extra column is **Rank**, sitting between `Rounds` and `Rating`.
Real column order is:

| # | Name     | Type   | Notes |
|---|----------|--------|-------|
| 1 | First    | string | |
| 2 | Last     | string | |
| 3 | School   | string | `Hire` for independent/hired judges |
| 4 | Online   | string | empty in all observed rows |
| 5 | Rounds   | int    | 0–6; rounds the judge is committed for |
| 6 | *(Rank)* | int    | **unlabeled in the header** — the pref rank |
| 7 | Rating   | float  | percentile, 2dp |

**Consequence:** the importer must not zip header names to fields positionally
without checking counts. If `fields > headers`, surface the extra column in the
mapping UI as `column 6 (unnamed)` and let the user label it. Never silently drop
a trailing field — that is the rank, i.e. the entire point of the tool.

### Rank is not a permutation

Observed rank values across 53 rows:

```
1 2 3 6 6 7 9 10 10 10 11 12 13 13 13 15 15 15 16 18 19 19 20 20 20 21 21
23 24 25 26 27 28 29 30 30 30 30 30 31 31 38 40 40 48 50 70 70 73 73 80 80 80
```

- **Ties are allowed and common** — five judges share rank 30, three share rank 80.
- Ties are *competition-ranked*: three judges at 10, next value is 13.
- **Values exceed the row count** (rank 80 in a 53-row export) and have large gaps.

So the pool is **tiered, not strictly ordered**. A drag-to-reorder UI that assigns
`rank = index + 1` will silently flatten every tie and renumber the whole sheet —
producing a diff where all 53 judges "changed" and destroying the tiering. The
editor must preserve tie groups as first-class objects and only emit rank changes
for judges the user actually moved.

### Rating is derived, not authored

`Rating` is monotone in rank and identical within a tie group (rank 20 → 39.48 for
all three judges holding it). It is a Tabroom-computed percentile over the *full*
tournament pool, not over the exported rows — rank 80 → 94.10 does not divide out
of 53. **Treat `Rating` as read-only.** Carry it through the export unchanged and
never recompute it; the numbers are Tabroom's to assign.

---

## 2. Judge list export

Source file: `Tabroom-judgelist.csv` (145 data rows observed).

```
Paradigm,First,Last,Institution,Location,Mode,Rounds,Record
,Ralph,Anderson,Texas,TX,0,3,
```

8 columns, 8 fields — header and rows agree here.

| Name        | Type   | Notes |
|-------------|--------|-------|
| Paradigm    | string | empty in **all** observed rows |
| First       | string | |
| Last        | string | |
| Institution | string | not the same vocabulary as the pref sheet's `School` |
| Location    | string | US state code |
| Mode        | int    | `0` (130 rows) / `1` (15 rows) — presumed in-person / online |
| Rounds      | int    | |
| Record      | string | empty in **all** observed rows |

No rank and no rating: this is a roster, the Phase 3 input.

---

## 3. Judge identity — the hard constraint

**Neither export contains a judge ID.** There is no stable key. Identity has to be
built from `First + Last`, optionally disambiguated by `School`/`Institution` —
and those two fields draw from different vocabularies across the two exports, so
school is a weak tiebreaker at best.

Measured overlap between the two files on lowercased `first last`: **1 judge**
(`jaysyn green`). The samples are from different circuits, so this says nothing
about match rates within one circuit — but it does mean there is no real-world
matched pair available yet to validate a fuzzy matcher against. Get two exports
from the *same* circuit before trusting Phase 3's auto-ranking.

Decision: name-based keying with a **manually maintained alias map** for the
inevitable collisions and spelling drift. No silent fuzzy matching — anything
below an exact normalized match gets queued for human confirmation.

---

## 4. Parsing notes

- No quoted fields in either observed file (`grep -c '"'` → 0 in both). Do **not**
  rely on this holding: a school name with a comma would break naive `split(',')`.
  Use a real CSV parser.
- Both files end with a trailing blank line. Skip empty rows.
- The pref export's filename encodes team and tournament with spaces stripped
  (`PrefsforMountainViewAWatLoyolaInvitational.csv`) — usable as a default
  autosave key, but not reliably parseable back into its parts.
