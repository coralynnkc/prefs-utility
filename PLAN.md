# Plan

Open work only. Settled decisions are in [docs/design.md](docs/design.md);
export formats in [docs/csv-formats.md](docs/csv-formats.md).

The editor and `tools/diff_prefs.py` are done. Everything below starts **after
the current tournament**.

---

## 1. Pairwise judge ratings

Beli-style: "prefer A or B?", one pair at a time, building a persistent,
cross-tournament rating per judge.

```
judges:  { key: { first, last, schools[], rating, comparisons, last_seen } }
aliases: { observed_name_key: judge_key }   // human-confirmed, never inferred
```

- Elo update `R' = R + K(S - E)`, `E = 1/(1 + 10^((R_opp - R)/400))`, K ≈ 24.
- Pair selection favours low-comparison judges, then near-equal ratings.
- Expect tens of comparisons, not hundreds. Ratings stay noisy — output is a
  starting position, never a final sheet.
- JSON export/import ships in the same change as the store. The alias map is
  hand-verified and expensive to rebuild; it matters more than the ratings.

**Open:**

- [ ] **Seed from past pref sheets.** Each person starts from their own past
  pref CSVs instead of from scratch. Proposed: convert each sheet's rank to a
  within-sheet percentile (ties share one; gaps don't matter), map it onto the
  Elo scale, average across sheets weighted toward recent tournaments, and set
  `comparisons` low so pairwise answers move a seeded judge quickly.
- [ ] Seeding runs every past sheet through the matcher, so the alias
  confirmation queue has to exist first — and will be long on the first run.
- [ ] Whose sheets seed whom: prefs are filed per entry (a partnership), not per
  person. Does a sheet seed both partners, or does each person pick theirs?
- [ ] K and the percentile→Elo spread: pick against real past sheets, not a
  guess.

## 2. Roster → first-pass sheet

1. Import a roster CSV (`Tabroom-judgelist.csv` shape).
2. Match names (exact auto-applies, near-matches queue — see design.md).
3. Sort matched judges by rating into tiers.
4. Unmatched judges go in the **unplaced** bucket.
5. Result becomes the rank column feeding the editor.

**Open:**

- [ ] **Choose whose ratings to use.** When generating a sheet, pick which
  people's ratings go into it — e.g. some friends but not others. Implies:
  - ratings are per person and visible to others, so they need shared storage
    and identity (see §3);
  - people's Elo scales aren't comparable, so normalise each person's ratings
    (percentile within their own pool) before combining;
  - decide what a judge only some selected people have rated gets — average of
    those who rated them, not a zero from those who didn't;
  - decide whether others see your raw ratings or only their contribution to a
    combined sheet.
- [ ] Is the alias map shared or per person? Shared means one person's
  confirmation fixes it for everyone — and one wrong confirmation corrupts
  everyone.
- [ ] How tiers are cut from continuous ratings (fixed count, rating gaps, or
  mirror the tournament's tier sizes).

## 3. Hosting once ratings are shared

Pages is fine for everything built so far. Shared ratings (§2) are the first
feature that needs a server-side store and logins; `localStorage` can't do
either.

- [ ] **Recommended:** keep this a static page and talk to the **Supabase
  project `ndt26` already uses** — `supabase-js` from the CDN, a ratings table
  with row-level security. Same logins as the evidence tool, no new auth
  provider, no server of ours, no build step, and it still opens from disk.
  Nothing touches ndt26's Railway API, so its cold start and memory use are
  unaffected.
- [ ] Moving the static page to Vercel is optional: its only real gain is
  deploying from a **private** repo, which retires the public-repo/gitignore
  risk in design.md. Not required for anything above.
- [ ] Folding the code into ndt26's Next.js app gives one URL and one nav, at the
  cost of a rewrite, losing file-open, and the no-build rule. Not a performance
  question either way — a separate route adds nothing to the search pages.
  Revisit only if one URL matters.
