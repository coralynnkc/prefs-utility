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
import { core, coreSource, hasPapa, read, openSample, sheetOfRanks, shape } from "./harness.mjs";

const {
  isInt, isDecimal, parseCsv, profile, guess, makeSheet,
  tiers, allocRank, splitInto, retier, movedCount, extraCols, buildCsv, setSheet,
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
    // Columns 3 and 4 are Online and Rounds, still correctly named because they
    // sit left of the unnamed rank column.
    assert.deepEqual(extraCols(), [{ i: 3, label: "Online" }, { i: 4, label: "Rounds" }]);
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
    assert.equal(movedCount(), 3, "the mover plus the run it displaced");
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
