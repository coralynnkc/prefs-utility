# Tabroom CSV formats (observed)

Judge, school and tournament names throughout are pseudonyms. Every case below
preserves the exact shape of a real one — the substitutions are consistent, so the
reasoning holds.

Derived empirically from two real exports (kept locally in `data/`, gitignored).
Redacted fixtures reproducing every quirk below live in `samples/`.

---

## 1. Pref sheet export

Source file: `Prefs for <Team> at <Tournament>.csv` (54 data rows in the observed sample).

### The header lies

(Some exports end the header with a comma — `...,Rounds,Rating,` — which parses
as a seventh, blank name. It names nothing; the rank is still unnamed in the
middle. Trailing blank names don't count as names.)

The header row declares **6 columns**. Every data row has **7 fields**:

```
First,Last,School,Online,Rounds,Rating          <- 6 names
Ada,Lovelace,Example Academy,,6,12,18.45        <- 7 values (shape is real, row is not)
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
all three judges holding it). It is a **rounds-weighted percentile of the sheet
itself**:

```
rating = (1 + Rounds of every judge ranked strictly better)
         / (Rounds of every judge on the sheet, unranked included) × 100
```

Checked against the real 53-judge export: total Rounds is 271 (the one unranked
judge's 2 included), and the formula reproduces all 53 ratings to the hundredth.
(An earlier note here claimed it was over the full tournament pool because
rank 80 → 94.10 does not divide out of 53 judges. It divides out of 271 rounds.)
A 0-round judge adds nothing, which is why ranks 1 and 2 both read 0.37.

A second real export (144 judges, 499 rounds) agrees on 139. The five misses sit
at ranks 11–14 and 16–17, which Tabroom rated as if tied with ranks 11 and 15
(5.41 and 7.21 each): the Rating column there describes an earlier tiering than
the ranks do. So an imported rating is evidence, not ground truth — and a
re-imported `-edited.csv` from this tool disagrees almost everywhere, since it
keeps the old Rating cells beside the new ranks.

**The exported cell is still read-only.** Carry it through unchanged; Tabroom
recomputes its own once the new ranks are entered. The editor shows a live
recomputation from the current ranks for display, and says so when most of the
imported column disagrees (the already-edited case).

---

## 2. Judge list export

Source file: `Tabroom-judgelist.csv` (145 data rows observed).

```
Paradigm,First,Last,Institution,Location,Mode,Rounds,Record
,Ada,Lovelace,Example,CA,0,3,
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
built from `First + Last`.

### School is not a tiebreaker — it means something different in each export

The pref sheet's `School` is the school the judge is **judging for**. The
judgelist's `Institution` is the college the judge **attends**. These disagree for
the same human:

| | pref sheet `School` | judgelist `Institution` |
|---|---|---|
| Robin Okafor | Ridgeview School | State University |

The pref sheet's vocabulary is local high schools (Ridgeview, Northgate and
their neighbours, plus `Hire` for independents); the judgelist's is universities
(State, Coastal, Metro). Same circuit, same judges, orthogonal vocabularies.

**So never use school to confirm or reject a name match.** Using it to reject
would have discarded the one confirmed true match in the data. Show it to help a
human decide; never branch on it.

### The near-match problem is real

Exact normalized `first last` matches across the two files: **1** (`robin okafor`).
Last-name matches: 5. The other 4 are where the difficulty lives:

| pref sheet | judgelist | verdict |
|---|---|---|
| Robin Okafor [Ridgeview School] | Robin Okafor [State University] | same person |
| Robin Okafor | **Ryan** Okafor [Coastal University] | different person, same surname |
| Sam Ferreira [Northgate Academy] | **Samir** Ferreira [Metro University] | **unresolvable from the data** |
| Beatrice Nakamura | **Karl** Nakamura | different |
| Nadia Castellanos | **Theo** / **Marcus** Castellanos | different |

`Sam` / `Samir` is the case that decides the design. A nickname-aware matcher
would match them; a strict matcher would not; the schools differ, so school
cannot break the tie — and school cannot break it for Robin Okafor either, where
the answer is "same person". No automatic rule gets both right.

Decision: **exact normalized match auto-applies; everything else queues for human
confirmation, with both schools shown.** Confirmations write to a persistent alias
map, so each judge is resolved once rather than once per tournament. Silent fuzzy
matching is prohibited — a wrong-judge match corrupts a rating that then
propagates into every future first-pass sheet.

### Low overlap is expected, not a matching failure

One overlapping judge out of 53 does not mean the matcher is broken. These are two
different tournaments on the same circuit, and tournaments draw largely disjoint
pools. Rating coverage builds slowly across many exports — an argument for making
the alias map durable and exportable early.

## 4. Parsing notes

- Line endings are CRLF with **no final newline** in the 144-judge export; the
  exporter gives back whatever it was handed.
- A school with a comma (shape: `Example University, Northside`) arrives
  **unquoted**, so it splits into `Example University` and a ` Northside` in
  the Online slot, and the row still has 7 fields. Rank and Rating stay in
  place; only the school display suffers. Re-export it unquoted as it came
  (PapaParse's `unparse` would quote ` Northside` for its leading space).
- No quoted fields in either observed file (`grep -c '"'` → 0 in both). Do **not**
  rely on this holding: a school name with a comma would break naive `split(',')`.
  Use a real CSV parser.
- Both files end with a trailing blank line. Skip empty rows.
- The pref export's filename encodes team and tournament with spaces stripped
  (`PrefsforRidgeviewAWatNorthgateInvitational.csv`) — usable as a default
  autosave key, but not reliably parseable back into its parts.
