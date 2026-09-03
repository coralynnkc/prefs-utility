"""Tests for tools/diff_prefs.py.

The script is what turns an edited export into a to-do list you work down in
Tabroom by hand, so the thing that matters most is that its output stays
*short*: it must report the judges who actually moved and nobody else. A diff
that lists all 53 judges is as useless as no diff.

Stdlib only, like the script itself. Run with:

    python3 -m unittest discover -s tests
"""

import os
import subprocess
import sys
import tempfile
import textwrap
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPT = os.path.join(ROOT, "tools", "diff_prefs.py")
SAMPLES = os.path.join(ROOT, "samples")

sys.path.insert(0, os.path.join(ROOT, "tools"))
import diff_prefs  # noqa: E402


def csv(body):
    """A CSV literal written as an indented block in a test."""
    return textwrap.dedent(body).lstrip("\n")


class DiffCase(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)

    def write(self, name, text):
        path = os.path.join(self.dir.name, name)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(text)
        return path

    def run_diff(self, original, edited, *args, expect_ok=True):
        proc = subprocess.run(
            [sys.executable, SCRIPT, original, edited, *args],
            capture_output=True, text=True)
        if expect_ok:
            self.assertEqual(proc.returncode, 0, proc.stderr)
        return proc

    def sample(self, name):
        with open(os.path.join(SAMPLES, name), encoding="utf-8") as fh:
            return fh.read()


class TestRankColumn(DiffCase):
    """docs/csv-formats.md §1: the header names 6 columns, the rows have 7."""

    def test_unnamed_middle_column_is_found_by_shape(self):
        path = self.write("a.csv", self.sample("prefs-sample.csv"))
        proc = self.run_diff(path, path)
        self.assertIn("header names 6 columns but rows have 7", proc.stderr)
        self.assertIn("using column 5 as rank, 6 as rating", proc.stderr)

    def test_identical_files_report_nothing(self):
        path = self.write("a.csv", self.sample("prefs-sample.csv"))
        self.assertIn("No rank changes", self.run_diff(path, path).stdout)

    def test_well_formed_header_is_read_by_name(self):
        text = csv("""
            First,Last,Rank,Note
            Ada,Lovelace,4,x
            Grace,Hopper,9,y
            """)
        a = self.write("a.csv", text)
        b = self.write("b.csv", text.replace(",9,y", ",2,y"))
        proc = self.run_diff(a, b)
        self.assertNotIn("header names", proc.stderr)
        self.assertIn("9 -> 2", proc.stdout)

    def test_rank_col_override_by_index_and_name(self):
        text = csv("""
            First,Last,Alpha,Beta
            Ada,Lovelace,4,7
            Grace,Hopper,9,1
            """)
        a = self.write("a.csv", text)
        b = self.write("b.csv", text.replace("Ada,Lovelace,4,7", "Ada,Lovelace,5,7"))
        self.assertIn("4 -> 5", self.run_diff(a, b, "--rank-col", "2").stdout)
        self.assertIn("4 -> 5", self.run_diff(a, b, "--rank-col", "Alpha").stdout)

    def test_unidentifiable_rank_column_refuses_to_guess(self):
        text = csv("""
            First,Last,Alpha,Beta
            Ada,Lovelace,4,7
            """)
        path = self.write("a.csv", text)
        proc = self.run_diff(path, path, expect_ok=False)
        self.assertNotEqual(proc.returncode, 0)
        self.assertIn("--rank-col", proc.stderr)


class TestNameColumns(DiffCase):
    """The editor can map a single full-name column, so the diff must read one."""

    def test_a_single_name_column_keys_judges(self):
        text = csv("""
            Name,School,Rank
            Ada Lovelace,Example,4
            Grace Hopper,Example,9
            """)
        a = self.write("a.csv", text)
        b = self.write("b.csv", text.replace("Grace Hopper,Example,9", "Grace Hopper,Example,2"))
        out = self.run_diff(a, b).stdout
        self.assertIn("Grace Hopper (Example)", out)
        self.assertIn("9 -> 2", out)
        self.assertIn("(1 judge)", out)

    def test_a_full_name_is_never_split_into_parts(self):
        """Guessing where a surname starts is the kind of inference we forbid."""
        a = self.write("a.csv", csv("""
            Name,Rank
            Ada van der Lovelace,1
            """))
        b = self.write("b.csv", csv("""
            Name,Rank
            Ada van der Lovelace,3
            """))
        self.assertIn("1 -> 3", self.run_diff(a, b).stdout)

    def test_mismatched_name_schemes_are_refused(self):
        a = self.write("a.csv", csv("""
            First,Last,Rank
            Ada,Lovelace,1
            """))
        b = self.write("b.csv", csv("""
            Name,Rank
            Ada Lovelace,1
            """))
        proc = self.run_diff(a, b, expect_ok=False)
        self.assertNotEqual(proc.returncode, 0)
        self.assertIn("can't compare them", proc.stderr)

    def test_no_name_column_at_all_is_an_error(self):
        path = self.write("a.csv", csv("""
            Alpha,Rank
            7,1
            """))
        proc = self.run_diff(path, path, expect_ok=False)
        self.assertIn("can't key judges", proc.stderr)


class TestWhatCountsAsAChange(DiffCase):
    def test_only_moved_judges_are_listed(self):
        original = self.sample("prefs-sample.csv")
        # Katherine Johnson moves from the rank-10 tie group to 6.
        edited = original.replace(
            "Katherine,Johnson,Sample School HS,,6,10,11.44",
            "Katherine,Johnson,Sample School HS,,6,6,11.44")
        a = self.write("a.csv", original)
        b = self.write("b.csv", edited)
        out = self.run_diff(a, b).stdout

        self.assertIn("Re-enter in Tabroom (1 judge)", out)
        self.assertIn("Katherine Johnson", out)
        self.assertIn("10 -> 6", out)
        # The two judges still tied at 10, and everyone else, stay out of it.
        for name in ["Claude Shannon", "Barbara Liskov", "Ada Lovelace",
                     "Edsger Dijkstra", "Donald Knuth"]:
            self.assertNotIn(name, out)

    def test_ties_and_gaps_are_not_changes(self):
        """Rank values tie and skip. Re-serialising must not renumber them."""
        text = csv("""
            First,Last,Rank
            Ada,Lovelace,10
            Grace,Hopper,10
            Alan,Turing,10
            Katherine,Johnson,13
            Barbara,Liskov,80
            """)
        path = self.write("a.csv", text)
        self.assertIn("No rank changes", self.run_diff(path, path).stdout)

    def test_added_and_dropped_judges(self):
        a = self.write("a.csv", csv("""
            First,Last,Rank
            Ada,Lovelace,1
            Grace,Hopper,2
            """))
        b = self.write("b.csv", csv("""
            First,Last,Rank
            Ada,Lovelace,1
            Alan,Turing,3
            """))
        out = self.run_diff(a, b).stdout
        self.assertIn("In edited only (1)", out)
        self.assertIn("Alan Turing", out)
        self.assertIn("In original only (1)", out)
        self.assertIn("Grace Hopper", out)

    def test_changes_are_sorted_by_new_rank(self):
        a = self.write("a.csv", csv("""
            First,Last,Rank
            Ada,Lovelace,1
            Grace,Hopper,2
            Alan,Turing,3
            """))
        b = self.write("b.csv", csv("""
            First,Last,Rank
            Ada,Lovelace,30
            Grace,Hopper,20
            Alan,Turing,10
            """))
        names = [line.split("[ ] ")[1].split("  ")[0].strip()
                 for line in self.run_diff(a, b).stdout.splitlines() if "[ ]" in line]
        self.assertEqual(names, ["Alan Turing", "Grace Hopper", "Ada Lovelace"])


class TestParsing(DiffCase):
    def test_school_containing_a_comma(self):
        """A naive split(',') would shift every field after the school."""
        original = self.sample("prefs-quirks.csv")
        edited = original.replace(
            'Ada,Lovelace,"Lovelace, Babbage & Co",,6,10,11.44',
            'Ada,Lovelace,"Lovelace, Babbage & Co",,6,4,11.44')
        a = self.write("a.csv", original)
        b = self.write("b.csv", edited)
        out = self.run_diff(a, b).stdout
        self.assertIn("Ada Lovelace (Lovelace, Babbage & Co)", out)
        self.assertIn("10 -> 4", out)
        self.assertIn("(1 judge)", out)

    def test_short_and_blank_rows_do_not_derail_the_diff(self):
        path = self.write("a.csv", self.sample("prefs-quirks.csv"))
        self.assertIn("No rank changes", self.run_diff(path, path).stdout)

    def test_trailing_blank_lines_are_skipped(self):
        text = csv("""
            First,Last,Rank
            Ada,Lovelace,1
            """) + "\n\n"
        path = self.write("a.csv", text)
        self.assertIn("No rank changes", self.run_diff(path, path).stdout)

    def test_name_keys_fold_case_accents_and_spacing(self):
        self.assertEqual(diff_prefs.norm("  Renée   O'CONNOR "), "renee o'connor")
        self.assertEqual(diff_prefs.norm("José"), diff_prefs.norm("JOSE"))

    def test_a_judge_renamed_only_by_case_is_the_same_judge(self):
        a = self.write("a.csv", csv("""
            First,Last,Rank
            ADA,LOVELACE,1
            """))
        b = self.write("b.csv", csv("""
            First,Last,Rank
            Ada,Lovelace,5
            """))
        out = self.run_diff(a, b).stdout
        self.assertIn("1 -> 5", out)
        self.assertNotIn("In edited only", out)


class TestCsvOutput(DiffCase):
    def test_csv_mode_labels_every_row(self):
        a = self.write("a.csv", csv("""
            First,Last,School,Rank
            Ada,Lovelace,Example,1
            Grace,Hopper,Example,2
            """))
        b = self.write("b.csv", csv("""
            First,Last,School,Rank
            Ada,Lovelace,Example,4
            Alan,Turing,Sample,9
            """))
        lines = self.run_diff(a, b, "--csv").stdout.strip().splitlines()
        self.assertEqual(lines[0], "judge,old_rank,new_rank,status")
        self.assertIn("Ada Lovelace (Example),1,4,changed", lines)
        self.assertIn("Alan Turing (Sample),,9,added", lines)
        self.assertIn("Grace Hopper (Example),2,,dropped", lines)


if __name__ == "__main__":
    unittest.main()
