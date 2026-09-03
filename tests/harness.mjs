/**
 * Loads the app's pure logic out of index.html so it can be tested directly.
 *
 * The app is deliberately a single file with no build step, so there is no
 * module to import. Instead index.html marks its pure region with
 * `core:start` / `core:end`, and this harness slices exactly that text out,
 * appends an export list, and imports it as a data: URL module. The tests
 * therefore run the shipping code, not a copy of it — if someone edits the
 * algorithm in index.html the tests see the edit.
 *
 * PapaParse is a free variable inside that region (a CDN global in the
 * browser), so we put the real library on globalThis first. `tests/vendor.sh`
 * downloads it from the exact CDN URL index.html pins, which also means CI
 * fails if that pin ever goes stale.
 */
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
export const repo = path.resolve(here, "..");

export const read = rel => readFileSync(path.join(repo, rel), "utf8");

const START = "/* ==== core:start";
const END = "/* ==== core:end";

/** Everything index.html declares between the two markers. */
export function coreSource() {
  const html = read("index.html");
  const a = html.indexOf(START);
  const b = html.indexOf(END);
  if (a < 0 || b < 0 || b < a) {
    throw new Error(
      "index.html: could not find the 'core:start' / 'core:end' markers. " +
      "They are the seam the test suite loads through — see the comment at the " +
      "top of index.html before moving them.");
  }
  return html.slice(a, b);
}

const EXPORTS = [
  "hash", "isInt", "isDecimal", "parseCsv", "profile", "guess", "makeSheet",
  "tiers", "allocRank", "splitInto", "retier", "movedCount",
  "judgeName", "trustedUpto", "extraCols", "buildCsv",
];

const papaPath = path.join(repo, "vendor", "papaparse.js");

/** True once the CDN libraries have been fetched by tests/vendor.sh. */
export const hasPapa = existsSync(papaPath);
if (hasPapa) globalThis.Papa = createRequire(import.meta.url)(papaPath);

const src = coreSource() +
  `\nexport { ${EXPORTS.join(", ")} };\n` +
  // `S` is module-level state in the app; the tests need to set and read it.
  `export function setSheet(s) { S = s; }\n` +
  `export function getSheet() { return S; }\n`;

export const core = await import(
  "data:text/javascript;base64," + Buffer.from(src, "utf8").toString("base64"));

/** Load one of the redacted fixtures in samples/ and open it as a sheet. */
export function openSample(name, mapOverride) {
  const text = read(path.join("samples", name));
  const parsed = core.parseCsv(text);
  const map = mapOverride ||
    core.guess(parsed.header, core.profile(parsed.rows, parsed.width), parsed.width).map;
  const sheet = core.makeSheet(name, parsed, map);
  core.setSheet(sheet);
  return { text, parsed, map, sheet };
}

/** A synthetic sheet built straight from a list of ranks, for tier algebra. */
export function sheetOfRanks(ranks) {
  const sheet = {
    fileName: "synthetic.csv",
    header: ["First", "Last", "Rank"],
    width: 3,
    lens: ranks.map(() => 3),
    map: { first: 0, last: 1, full: null, rank: 2, school: null, rating: null },
    judges: ranks.map((r, i) => ({
      i,
      fields: ["J" + i, "Test", r === null ? "" : String(r)],
      origRaw: r === null ? "" : String(r),
      origRank: r,
      rank: r,
    })),
  };
  core.setSheet(sheet);
  return sheet;
}

/** [[rank, size], ...] for the current sheet — the shape a reader cares about. */
export const shape = () => core.tiers().ranked.map(t => [t.rank, t.judges.length]);
