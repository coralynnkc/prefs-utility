/**
 * Tests for the pure logic in index.html. Run with:
 *
 *     tests/vendor.sh && node --test tests/
 *
 * The cases here are the ones docs/csv-formats.md says the real exports will
 * throw at us: a header shorter than the rows, ranks that tie and skip, a
 * Rating column that must survive untouched, and a school name with a comma in
 * it. If one of these breaks, a pref sheet gets silently corrupted.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { core, coreSource, hasPapa, read, openSample, sheetOfRanks, shape } from "./harness.mjs";

const {
  isInt, isDecimal, parseCsv, profile, guess, makeSheet,
  tiers, allocRank, splitInto, retier, movedCount, extraCols, buildCsv, setSheet,
  moveNeighbour, place, isMoved, bumpedCount, liveRatings, staleRatings, standing, namedCount,
  diff, diffText, diffCsv, flaggedCount, getSheet,
} = core;

/* ---------------------------------------------------------------------- */

describe("the core block stays pure", () => {
  test("no DOM or storage access leaks in", () => {
    // Comments in there legitimately *mention* the DOM, so scan the code only.
    const code = coreSource()
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    for (const bad of [/\bdocument\b/, /\blocalStorage\b/, /\bwindow\b/,
                       /\bsetTimeout\b/, /\bfetch\b/]) {
      assert.ok(!bad.test(code),
        `core:start..core:end uses ${bad} — it has to stay loadable outside a browser`);
    }
  });

  test("the markers are still where the harness expects them", () => {
    // The prose at the top of index.html names the markers too, so match the
    // exact banner form the harness slices on.
    const html = read("index.html");
    assert.equal((html.match(/\/\* ==== core:start/g) || []).length, 1);
    assert.equal((html.match(/\/\* ==== core:end/g) || []).length, 1);
    assert.ok(coreSource().includes("function buildCsv"),
      "buildCsv fell outside the core markers, so the export path is untested");
  });
});

/* ---------------------------------------------------------------------- */

describe("column shape detection", () => {
  test("int and decimal predicates", () => {
    assert.ok(isInt("10") && isInt(" 80 ") && isInt("-3"));
    assert.ok(!isInt("") && !isInt("11.44") && !isInt("1a"));
    assert.ok(isDecimal("11.44") && isDecimal("0.37") && isDecimal(".5"));
    assert.ok(!isDecimal("") && !isDecimal("10") && !isDecimal("1.2.3"));
  });
});

describe("importing the pref export", { skip: !hasPapa && "run tests/vendor.sh first" }, () => {
  test("a 6-name header over 7-field rows keeps all 7 fields", () => {
    const { parsed } = openSample("prefs-sample.csv");
    assert.equal(parsed.header.length, 6);
    assert.equal(parsed.width, 7);
    assert.ok(parsed.rows.every(r => r.length === 7));
  });

  test("the unnamed middle column is identified as the rank", () => {
    const text = read("samples/prefs-sample.csv");
    const parsed = parseCsv(text);
    const g = guess(parsed.header, profile(parsed.rows, parsed.width), parsed.width);
    assert.equal(g.shifted, true);
    assert.equal(g.map.rank, 5, "rank is the int column left of the decimal rating");
    assert.equal(g.map.rating, 6);
    // Names are only believable left of where the unnamed column was inserted.
    assert.equal(g.trustedUpto, 5);
    assert.deepEqual([g.map.first, g.map.last, g.map.school], [0, 1, 2]);
  });

  test("a trailing comma on the header doesn't hide the missing rank name", () => {
    // Some exports end the header with a comma, so it parses as 7 names --
    // the 7th blank -- over 7 fields. The rank is still unnamed in the middle.
    const parsed = parseCsv("First,Last,School,Online,Rounds,Rating,\n" +
      "Grace,Hopper,Sample School HS,ONLINE,2,7,3.21\nAlan,Turing,Placeholder Prep,,5,5,2\n");
    assert.equal(namedCount(parsed.header), 6);
    const g = guess(parsed.header, profile(parsed.rows, parsed.width), parsed.width);
    assert.equal(g.shifted, true);
    assert.deepEqual([g.map.rank, g.map.rating, g.map.rounds], [5, 6, 4],
      "a whole-number rating like Alan's `2` still reads as the rating column");
  });

  test("a header whose names really do line up is read by name", () => {
    const parsed = parseCsv(read("samples/judgelist-sample.csv"));
    const g = guess(parsed.header, profile(parsed.rows, parsed.width), parsed.width);
    assert.equal(g.shifted, false);
    assert.equal(g.trustedUpto, parsed.width);
    assert.deepEqual([g.map.first, g.map.last, g.map.school], [1, 2, 3]);
    assert.equal(g.map.rank, null, "a roster has no rank column to find");
  });

  test("an explicit Rank header wins when the header is well-formed", () => {
    const parsed = parseCsv("Name,Rank,Note\nAda,4,x\nGrace,9,y\n");
    const g = guess(parsed.header, profile(parsed.rows, parsed.width), parsed.width);
    assert.equal(g.map.rank, 1);
  });

  test("a short header we cannot explain guesses nothing at all", () => {
    // Rows are wider than the header, but the last two columns are not the
    // int/decimal pair that marks a Tabroom rank+rating. Guessing here would
    // be worse than making the user point at the column.
    const parsed = parseCsv("A,B\nfoo,bar,baz\nqux,quux,corge\n");
    const g = guess(parsed.header, profile(parsed.rows, parsed.width), parsed.width);
    assert.equal(g.shifted, true);
    assert.equal(g.map.rank, null);
    assert.equal(g.trustedUpto, 0, "no header name can be trusted once we're lost");
  });

  test("a school name containing a comma stays one field", () => {
    const { parsed } = openSample("prefs-quirks.csv");
    assert.equal(parsed.rows[0][2], "Lovelace, Babbage & Co");
    assert.equal(parsed.width, 7);
  });

  test("ranks import with ties, gaps and blanks intact", () => {
    openSample("prefs-sample.csv");
    assert.deepEqual(shape(), [[1,1],[2,1],[6,1],[10,3],[30,1],[80,1]]);
    assert.equal(movedCount(), 0, "importing a file moves nobody");

    openSample("prefs-quirks.csv");
    assert.deepEqual(shape(), [[10,2],[11,1],[12,1],[15,1],[20,1]]);
    assert.equal(tiers().unranked.length, 1, "the blank-rank judge is not tier 0");
  });

  test("Rating is carried as an unmapped read-only column, never a rank", () => {
    const { sheet } = openSample("prefs-sample.csv");
    assert.equal(sheet.map.rating, 6);
    assert.ok(!extraCols().some(c => c.i === 6),
      "the rating column is claimed by the mapping, so it is not a generic chip");
    // Rounds sits left of the unnamed rank column, so its header name is still
    // trustworthy and the guess claims it to weight the rating.
    assert.equal(sheet.map.rounds, 4);
    assert.deepEqual(extraCols(), [{ i: 3, label: "Online" }]);
  });
});

/* ---------------------------------------------------------------------- */

describe("tier algebra", () => {
  test("tiers are derived from ranks, preserving ties and gaps", () => {
    sheetOfRanks([1, 2, 6, 10, 10, 10, 30, 80]);
    assert.deepEqual(shape(), [[1,1],[2,1],[6,1],[10,3],[30,1],[80,1]]);
    assert.equal(movedCount(), 0);
  });

  test("joining the tier above moves exactly one judge", () => {
    const S = sheetOfRanks([1, 2, 6, 10, 10, 10, 30, 80]);
    S.judges[3].rank = 6;
    assert.deepEqual(shape(), [[1,1],[2,1],[6,2],[10,2],[30,1],[80,1]]);
    assert.equal(movedCount(), 1);
  });

  test("splitting up out of a tie group hugs the tier below it", () => {
    // 1, 2, 6, [10 10 10], 30, 80 — nudging one judge up off rank 10 should
    // land on 9, not on 7 next to the tier above.
    const S = sheetOfRanks([1, 2, 6, 10, 10, 10, 30, 80]);
    assert.equal(splitInto(S.judges[3], 3, "high"), 0, "no shift was needed");
    assert.equal(S.judges[3].rank, 9);
    assert.equal(movedCount(), 1);
  });

  test("splitting down out of a tie group hugs the tier above it", () => {
    const S = sheetOfRanks([1, 2, 6, 10, 10, 10, 30, 80]);
    assert.equal(splitInto(S.judges[3], 4, "low"), 0);
    assert.equal(S.judges[3].rank, 11);
    assert.equal(movedCount(), 1);
  });

  test("a split with no free number shifts only the contiguous run", () => {
    // 10, 11, 12, [20 20]. Opening a slot under 10 has to push 11 and 12 down,
    // but must stop at the natural gap and leave the 20s alone.
    const S = sheetOfRanks([10, 11, 12, 20, 20]);
    assert.equal(splitInto(S.judges[4], 1, "low"), 2, "two judges shifted, not four");
    assert.deepEqual(shape(), [[10,1],[11,1],[12,1],[13,1],[20,1]]);
    assert.equal(S.judges[4].rank, 11);
    assert.equal(movedCount(), 1, "only the mover counts as moved");
    assert.equal(bumpedCount(), 2, "the run it displaced is renumbered, not moved");
  });

  test("a judge the user already moved is not demoted to bumped", () => {
    const S = sheetOfRanks([10, 11, 30, 40]);
    place(S.judges[2], 12);                        // deliberate: 30 -> 12
    splitInto(S.judges[3], 1, "low");              // 40 slots in under 10
    assert.deepEqual(S.judges.map(j => j.rank), [10, 12, 13, 11]);
    assert.equal(S.judges[1].bumped, true);
    assert.ok(isMoved(S.judges[2]), "still a move of their own, just shifted");
    assert.equal(movedCount(), 2);
  });

  test("moving a bumped judge makes them moved again", () => {
    const S = sheetOfRanks([10, 11, 30]);
    splitInto(S.judges[2], 1, "low");
    assert.equal(S.judges[1].bumped, true);
    place(S.judges[1], 20);
    assert.ok(isMoved(S.judges[1]));
  });

  test("a split prefers the judge's own imported rank when it fits the gap", () => {
    const S = sheetOfRanks([1, 8, 10, 10, 30]);
    place(S.judges[1], 10);                        // 8 joins the 10s...
    splitInto(S.judges[1], 1, "high");             // ...and splits back above them
    assert.equal(S.judges[1].rank, 8, "not 9, which the 'high' hug alone would pick");
    assert.equal(movedCount(), 0);
  });

  test("shifting works at the very top of the sheet", () => {
    const S = sheetOfRanks([1, 2, 9]);
    assert.equal(splitInto(S.judges[2], 0, "low"), 2);
    assert.deepEqual(shape(), [[1,1],[2,1],[3,1]]);
    assert.equal(S.judges[2].rank, 1);
  });

  test("inserting above the top tier can hug it", () => {
    const S = sheetOfRanks([5, 10]);
    splitInto(S.judges[1], 0, "high");
    assert.equal(S.judges[1].rank, 4);
  });

  test("a judge already alone in a tier cannot split into their own gap", () => {
    // Without this guard, 10/80 would fling the rank-80 judge to 11.
    const S = sheetOfRanks([10, 80]);
    assert.equal(splitInto(S.judges[1], 2, "low"), 0);
    assert.equal(S.judges[1].rank, 80);
    assert.equal(splitInto(S.judges[1], 1, "high"), 0);
    assert.equal(S.judges[1].rank, 80);
    assert.equal(movedCount(), 0);
  });

  test("appending below the last tier", () => {
    const S = sheetOfRanks([1, 10]);
    assert.equal(splitInto(S.judges[0], 2, "low"), 0);
    assert.equal(S.judges[0].rank, 11);
  });

  test("renumbering a tier onto an existing one merges them", () => {
    sheetOfRanks([1, 10, 10, 30]);
    retier(10, 30);
    assert.deepEqual(shape(), [[1,1],[30,3]]);
  });

  test("unranked judges are a bucket, not rank zero", () => {
    sheetOfRanks([1, 10, null, null]);
    assert.equal(tiers().unranked.length, 2);
    assert.deepEqual(shape(), [[1,1],[10,1]]);
  });

  test("allocRank on an empty sheet starts at 1", () => {
    assert.deepEqual(allocRank([], 0, "low"), { rank: 1, shifted: 0 });
  });
});

/* ---------------------------------------------------------------------- */

describe("moving past a neighbour", () => {
  test("takes a free number beyond the neighbour's tier; nobody else changes", () => {
    const S = sheetOfRanks([1, 2, 6, 10, 10, 10, 30]);
    const r = moveNeighbour(S.judges[2], false);    // the 6 goes down past the 10s
    assert.equal(r.past, S.judges[3], "the first judge in the 10 tier");
    assert.equal(r.shifted, 0);
    assert.equal(S.judges[2].rank, 11, "hugs the tier it just passed");
    assert.deepEqual(shape(), [[1,1],[2,1],[10,3],[11,1],[30,1]]);
    assert.equal(movedCount(), 1, "exactly the one judge moved");
  });

  test("moving up hugs the tier just passed from above", () => {
    const S = sheetOfRanks([1, 10, 10, 10, 30]);
    assert.equal(moveNeighbour(S.judges[4], true).past, S.judges[3]);
    assert.equal(S.judges[4].rank, 9);
    assert.equal(movedCount(), 1);
  });

  test("tie-mates are skipped: moving out of a tie passes the tier beyond", () => {
    const S = sheetOfRanks([5, 10, 10, 10]);
    assert.equal(moveNeighbour(S.judges[3], true).past, S.judges[0]);
    assert.equal(S.judges[3].rank, 4);
  });

  test("bubbling one judge up many places renumbers nobody when there are gaps", () => {
    const S = sheetOfRanks([2, 4, 6, 8, 10]);
    for (let k = 0; k < 4; k++) moveNeighbour(S.judges[4], true);
    assert.deepEqual(S.judges.map(j => j.rank), [2, 4, 6, 8, 1]);
    assert.equal(movedCount(), 1);
    assert.equal(bumpedCount(), 0);
  });

  test("with no free number, the displaced run is bumped and left out of the diff", () => {
    const S = sheetOfRanks([1, 2, 3, 4]);
    const r = moveNeighbour(S.judges[3], true);
    assert.equal(r.shifted, 1);
    assert.deepEqual(S.judges.map(j => j.rank), [1, 2, 4, 3]);
    assert.equal(movedCount(), 1);
    assert.equal(bumpedCount(), 1);
  });

  test("moving back undoes the move completely", () => {
    const S = sheetOfRanks([1, 2, 6, 10, 10, 10, 30]);
    moveNeighbour(S.judges[2], false);
    moveNeighbour(S.judges[2], true);
    assert.equal(S.judges[2].rank, 6, "back on the imported number, not 9");
    assert.equal(movedCount(), 0);
  });

  test("does nothing at either end of the sheet", () => {
    const S = sheetOfRanks([1, 2]);
    assert.equal(moveNeighbour(S.judges[0], true), null);
    assert.equal(moveNeighbour(S.judges[1], false), null);
    assert.equal(movedCount(), 0);
  });

  test("never moves into or out of the unranked bucket", () => {
    const S = sheetOfRanks([1, 2, null]);
    assert.equal(moveNeighbour(S.judges[1], false), null, "nobody gets unranked by a move");
    assert.equal(moveNeighbour(S.judges[2], true), null);
    assert.equal(movedCount(), 0);
  });

  test("with a filter, moves past the nearest judge still showing", () => {
    const S = sheetOfRanks([10, 20, 30, 40]);
    const shown = new Set([0, 3]);
    assert.equal(moveNeighbour(S.judges[0], false, j => shown.has(j.i)).past, S.judges[3]);
    assert.deepEqual(S.judges.map(j => j.rank), [41, 20, 30, 40], "the hidden two are untouched");
  });
});

/* ---------------------------------------------------------------------- */

describe("live ratings", () => {
  test("the rounds-weighted formula reproduces every imported rating", () => {
    const { sheet } = openSample("prefs-rated.csv");
    const live = liveRatings();
    assert.ok(live, "the fixture's ratings follow the formula, so it is trusted");
    for (const j of sheet.judges) {
      assert.equal(live.get(j) ?? "", j.fields[6], `${j.fields[0]} ${j.fields[1]}`);
    }
  });

  test("ratings follow a move, while the export keeps the imported cells", () => {
    const { sheet } = openSample("prefs-rated.csv");
    const [ada, grace, alan, katherine] = sheet.judges;
    moveNeighbour(katherine, true);                // 5 -> above the 2s; 1 and 2 are consecutive
    assert.equal(katherine.rank, 2);
    assert.deepEqual([grace.rank, alan.rank], [3, 3], "the 2s were bumped to make room");
    const live = liveRatings();
    assert.equal(live.get(ada), "3.23");
    assert.equal(live.get(katherine), "22.58");
    assert.equal(live.get(grace), "41.94", "(1 + 6 + 6) / 31");
    assert.deepEqual(diff().map(r => r.j), [katherine], "only the judge the user moved");
    const lines = buildCsv().trimEnd().split("\n");
    assert.equal(lines[2], "Grace,Hopper,Example Academy,,6,3,22.58",
      "a bumped judge's new rank is exported; the rating cell is not rewritten");
    assert.equal(lines[4], "Katherine,Johnson,Sample School HS,,6,2,51.61");
  });

  test("imported ratings that disagree are reported, not trusted over the ranks", () => {
    const { sheet } = openSample("prefs-rated.csv");
    assert.deepEqual(staleRatings(), [], "a fresh Tabroom export agrees with itself");
    // What a re-imported -edited.csv looks like: new ranks, the old Rating cells.
    const [ada, grace, alan, katherine] = sheet.judges;
    for (const [j, r] of [[ada, 5], [katherine, 1]]) {
      j.fields[5] = j.origRaw = String(r);
      j.origRank = j.rank = r;
    }
    assert.deepEqual(new Set(staleRatings()), new Set([ada, katherine]),
      "the 2s happen to keep their rating: 6 rounds still sit above them");
    const live = liveRatings();
    assert.ok(live, "stale cells no longer switch the live ratings off");
    assert.equal(live.get(katherine), "3.23", "rated from the rank they have now");
    assert.equal(live.get(ada), "51.61", "(1 + 6 + 6 + 3) / 31");
  });

  test("no rounds column, no live ratings", () => {
    const { map } = openSample("prefs-rated.csv");
    openSample("prefs-rated.csv", { ...map, rounds: null });
    assert.equal(liveRatings(), null);
  });

  test("standing falls back to an even split when there are no live ratings", () => {
    const S = sheetOfRanks([1, 2, 2, 9]);
    const at = standing();
    assert.deepEqual(S.judges.map(j => Math.round(at.get(j))), [25, 50, 50, 100]);
  });
});

/* ---------------------------------------------------------------------- */

describe("the in-app diff", { skip: !hasPapa && "run tests/vendor.sh first" }, () => {
  test("an untouched sheet has nothing to re-enter", () => {
    openSample("prefs-sample.csv");
    assert.deepEqual(diff(), []);
    assert.equal(diffText(), "No rank changes. Nothing to re-enter.\n");
  });

  test("lists only moved judges, sorted by new rank, unranked last", () => {
    const { sheet } = openSample("prefs-quirks.csv");
    sheet.judges[2].rank = 40;
    sheet.judges[0].rank = null;
    sheet.judges[6].rank = 3;                      // Margaret Hamilton, was blank
    const rows = diff();
    assert.deepEqual(rows.map(r => r.j.i), [6, 2, 0]);
    assert.deepEqual(rows.map(r => [r.from, r.to]).at(0), ["", "3"]);
    assert.equal(rows.at(-1).to, "");
  });

  test("a tick only holds for the rank it was ticked at", () => {
    const { sheet } = openSample("prefs-sample.csv");
    const j = sheet.judges[3];
    j.rank = 6;
    j.ticked = "6";
    assert.equal(diff()[0].done, true);
    j.rank = 7;                                    // moved again after ticking
    assert.equal(diff()[0].done, false);
  });

  test("the checklist names each judge with their school", () => {
    const { sheet } = openSample("prefs-sample.csv");
    sheet.judges[3].rank = 6;
    assert.equal(diffText(),
      "Re-enter in Tabroom (1 judge):\n\n  [ ] Katherine Johnson (Sample School HS)    10 -> 6\n");
  });

  test("agrees line for line with tools/diff_prefs.py --csv on the exported file", () => {
    const { text, sheet } = openSample("prefs-quirks.csv");
    sheet.judges[0].rank = 30;
    sheet.judges[2].rank = null;
    sheet.judges[6].rank = 2;
    const dir = mkdtempSync(path.join(tmpdir(), "prefs-diff-"));
    const a = path.join(dir, "original.csv"), b = path.join(dir, "edited.csv");
    writeFileSync(a, text);
    writeFileSync(b, buildCsv());
    const py = execFileSync("python3", ["tools/diff_prefs.py", "--csv", a, b],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    assert.equal(diffCsv(), py.replace(/\r\n/g, "\n"));
  });

  test("flags are a note to self and never reach the export", () => {
    const { text, sheet } = openSample("prefs-sample.csv");
    sheet.judges[0].flag = sheet.judges[5].flag = true;
    assert.equal(flaggedCount(), 2);
    assert.equal(movedCount(), 0);
    assert.equal(buildCsv(), text);
  });
});

/* ---------------------------------------------------------------------- */

describe("export fidelity", { skip: !hasPapa && "run tests/vendor.sh first" }, () => {
  for (const name of ["prefs-sample.csv", "prefs-quirks.csv"]) {
    test(`${name}: exporting an untouched sheet reproduces the input exactly`, () => {
      const { text } = openSample(name);
      assert.equal(buildCsv(), text);
    });
  }

  test("only the rank cell of a moved judge changes", () => {
    const { text, sheet } = openSample("prefs-sample.csv");
    sheet.judges[3].rank = 6;                       // Katherine Johnson, 10 -> 6
    const before = text.trimEnd().split("\n");
    const after = buildCsv().trimEnd().split("\n");

    assert.equal(before.length, after.length);
    const differing = before.map((l, i) => [i, l, after[i]]).filter(([, a, b]) => a !== b);
    assert.equal(differing.length, 1, "exactly one line moved");
    const [i, was, now] = differing[0];
    assert.equal(i, 4, "row order is preserved, so it is still the fourth judge");
    assert.equal(was, "Katherine,Johnson,Sample School HS,,6,10,11.44");
    assert.equal(now, "Katherine,Johnson,Sample School HS,,6,6,11.44");
  });

  test("the rating column survives a re-rank untouched", () => {
    const { sheet } = openSample("prefs-sample.csv");
    for (const j of sheet.judges) j.rank = 1;      // flatten everything
    for (const line of buildCsv().trimEnd().split("\n").slice(1)) {
      const fields = line.split(",");
      assert.equal(fields[5], "1");
      assert.match(fields[6], /^\d+\.\d\d$/, "rating is still a 2dp percentile");
    }
    assert.equal(buildCsv().trimEnd().split("\n")[1].split(",")[6], "0.37");
  });

  test("a short row stays short, and a quoted comma stays quoted", () => {
    const { sheet } = openSample("prefs-quirks.csv");
    sheet.judges[2].rank = 10;                     // touch an unrelated row
    const lines = buildCsv().trimEnd().split("\n");
    assert.equal(lines[5], "Barbara,Liskov,Hire,,5,15",
      "the six-field row is not padded out to seven");
    assert.equal(lines[1], 'Ada,Lovelace,"Lovelace, Babbage & Co",,6,10,11.44');
  });

  test("an unquoted comma in a school survives byte for byte", () => {
    // Tabroom writes this unquoted, so it parses with a field " Northside".
    // Papa.unparse would quote that for its leading space.
    const text = "First,Last,School,Online,Rounds,Rating,\n" +
      "Ada,Lovelace,Example University, Northside,2,11,5.41\n" +
      "Grace,Hopper,Sample School HS,ONLINE,2,7,3.21\n";
    const parsed = parseCsv(text);
    const g = guess(parsed.header, profile(parsed.rows, parsed.width), parsed.width);
    setSheet(makeSheet("x.csv", parsed, g.map));
    assert.equal(buildCsv(), text);
    getSheet().judges[1].rank = 3;
    assert.equal(buildCsv().split("\n")[1], "Ada,Lovelace,Example University, Northside,2,11,5.41");
  });

  test("CRLF line endings and a missing final newline are given back", () => {
    const text = "First,Last,School,Online,Rounds,Rating,\r\n" +
      "Grace,Hopper,Sample School HS,ONLINE,2,7,3.21\r\nAlan,Turing,Placeholder Prep,,5,5,2";
    const parsed = parseCsv(text);
    const g = guess(parsed.header, profile(parsed.rows, parsed.width), parsed.width);
    setSheet(makeSheet("x.csv", parsed, g.map));
    assert.equal(buildCsv(), text);
  });

  test("an untouched unranked judge keeps a blank rank, not a zero", () => {
    const { sheet } = openSample("prefs-quirks.csv");
    sheet.judges[0].rank = 9;                      // move somebody else
    const lines = buildCsv().trimEnd().split("\n");
    assert.equal(lines[7], "Margaret,Hamilton,Unranked Academy,,2,,");
  });

  test("ranking a previously unranked judge writes the new number", () => {
    const { sheet } = openSample("prefs-quirks.csv");
    sheet.judges[6].rank = 25;
    assert.equal(buildCsv().trimEnd().split("\n")[7],
      "Margaret,Hamilton,Unranked Academy,,2,25,");
  });

  test("makeSheet freezes the imported rank as the thing to diff against", () => {
    const parsed = parseCsv("First,Last,Rank\nAda,Lovelace,7\nGrace,Hopper,\n");
    const sheet = makeSheet("x.csv", parsed,
      { first: 0, last: 1, full: null, rank: 2, school: null, rating: null });
    setSheet(sheet);
    assert.deepEqual(sheet.judges.map(j => j.origRank), [7, null]);
    assert.deepEqual(sheet.judges.map(j => j.origRaw), ["7", ""]);
    assert.equal(movedCount(), 0);
    sheet.judges[0].rank = 7;                      // reassigned to the same value
    assert.equal(movedCount(), 0, "same rank is not a move");
  });
});
