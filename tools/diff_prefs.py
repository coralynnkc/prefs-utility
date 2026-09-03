#!/usr/bin/env python3
"""Diff two Tabroom pref-sheet exports and print what to re-enter in Tabroom.

Tabroom has no bulk pref import, so the useful output is the *short* list: only
the judges whose rank actually changed, in the order you'd work down the page.

    python3 tools/diff_prefs.py original.csv edited.csv

Stdlib only. See docs/csv-formats.md for why the parsing below looks paranoid.
"""

import argparse
import csv
import sys
import unicodedata


def read_rows(path):
    """Return (header, rows) as lists of lists, every row padded to full width.

    Rows are kept positional. The pref export declares 6 header names for 7
    fields, and the unnamed column is *inserted in the middle* — so every header
    name from the insertion point rightward is attached to the wrong column.
    Names are only trustworthy left of the first surplus, which is why nothing
    below looks columns up by name past that point.
    """
    with open(path, newline="", encoding="utf-8-sig") as fh:
        reader = csv.reader(fh)
        try:
            header = next(reader)
        except StopIteration:
            sys.exit(f"{path}: file is empty")
        rows = [r for r in reader if any(cell.strip() for cell in r)]
    if not rows:
        sys.exit(f"{path}: no data rows")

    width = max([len(header)] + [len(r) for r in rows])
    rows = [r + [""] * (width - len(r)) for r in rows]
    return header, rows, width


def _is_int(s):
    s = s.strip()
    return bool(s) and (s[1:] if s[:1] == "-" else s).isdigit()


def _is_decimal(s):
    s = s.strip()
    if "." not in s:
        return False
    try:
        float(s)
        return True
    except ValueError:
        return False


def _col(rows, i):
    return [r[i] for r in rows if r[i].strip()]


def find_col(header, name):
    """Index of a header name, or None. Only valid left of any surplus column."""
    lowered = [h.strip().casefold() for h in header]
    try:
        return lowered.index(name.casefold())
    except ValueError:
        return None


def resolve_rank_col(header, rows, width, override, path):
    """Index of the rank column.

    With a well-formed header, find it by name. With the pref export's short
    header the names are shifted, so fall back to the shape of the data: rank is
    an integer column and Rating is the decimal column immediately right of it.
    """
    if override is not None:
        if override.isdigit():
            idx = int(override)
            if not 0 <= idx < width:
                sys.exit(f"{path}: column index {idx} out of range (0..{width - 1})")
            return idx
        idx = find_col(header, override)
        if idx is None:
            sys.exit(f"{path}: no column named {override!r}; have {header}")
        return idx

    if len(header) == width:
        for candidate in ("Rank", "current_rank", "pref", "Pref"):
            idx = find_col(header, candidate)
            if idx is not None:
                return idx
        sys.exit(f"{path}: can't identify the rank column; pass --rank-col. "
                 f"Columns: {header}")

    # Short header: the surplus is an unlabeled column inserted mid-row.
    rank, rating = width - 2, width - 1
    if all(_is_int(v) for v in _col(rows, rank)) and \
       all(_is_decimal(v) for v in _col(rows, rating)):
        print(f"{path}: header names {len(header)} columns but rows have {width}; "
              f"using column {rank} as rank, {rating} as rating.", file=sys.stderr)
        return rank
    sys.exit(f"{path}: header names {len(header)} columns but rows have {width}, "
             f"and columns {rank}/{rating} don't look like rank/rating. "
             f"Pass --rank-col <index>.")


def norm(s):
    """Normalize a name part for keying: fold accents, case, and inner spacing."""
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    return " ".join(s.split()).casefold()


class Sheet:
    def __init__(self, path, override):
        self.path = path
        self.header, self.rows, self.width = read_rows(path)
        self.rank_i = resolve_rank_col(self.header, self.rows, self.width, override, path)
        self.first_i = find_col(self.header, "First")
        self.last_i = find_col(self.header, "Last")
        self.school_i = find_col(self.header, "School")
        if self.school_i is None:
            self.school_i = find_col(self.header, "Institution")

        # Tabroom splits the name, but the editor lets you map a single
        # full-name column, so accept that shape too. A full name is never
        # split back into parts: guessing where the surname starts is exactly
        # the kind of inference docs/csv-formats.md rules out.
        self.full_i = None
        if self.first_i is None and self.last_i is None:
            for candidate in ("Name", "Judge"):
                self.full_i = find_col(self.header, candidate)
                if self.full_i is not None:
                    break
        if self.first_i is None and self.last_i is None and self.full_i is None:
            sys.exit(f"{path}: no First/Last or Name column; can't key judges. "
                     f"Columns: {self.header}")
        self.by_key = {self.key(r): r for r in self.rows}

    @property
    def name_mode(self):
        return "full" if self.full_i is not None else "parts"

    def _at(self, row, i):
        return row[i].strip() if i is not None else ""

    def key(self, row):
        if self.full_i is not None:
            return norm(self._at(row, self.full_i))
        return f"{norm(self._at(row, self.first_i))}|{norm(self._at(row, self.last_i))}"

    def rank(self, row):
        return row[self.rank_i].strip()

    def display(self, row):
        if self.full_i is not None:
            name = self._at(row, self.full_i)
        else:
            name = " ".join(p for p in (self._at(row, self.first_i),
                                        self._at(row, self.last_i)) if p)
        school = self._at(row, self.school_i)
        return f"{name} ({school})" if school else (name or "(unnamed judge)")


def sort_key(rank):
    try:
        return (0, float(rank))
    except ValueError:
        return (1, 0.0)


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("original")
    ap.add_argument("edited")
    ap.add_argument("--rank-col", help="rank column, by header name or 0-based index")
    ap.add_argument("--csv", action="store_true", help="emit CSV instead of a checklist")
    args = ap.parse_args()

    old = Sheet(args.original, args.rank_col)
    new = Sheet(args.edited, args.rank_col)

    # Keys built from a single name column and keys built from First+Last never
    # match each other. Bailing out beats a diff claiming every judge was
    # dropped and re-added.
    if old.name_mode != new.name_mode:
        sys.exit(f"{args.original} names judges by {old.name_mode} and "
                 f"{args.edited} by {new.name_mode}; can't compare them. "
                 f"Export both files the same way.")

    changed, added, dropped = [], [], []
    for k, row in new.by_key.items():
        if k not in old.by_key:
            added.append(row)
        elif old.rank(old.by_key[k]) != new.rank(row):
            changed.append((row, old.rank(old.by_key[k]), new.rank(row)))
    for k, row in old.by_key.items():
        if k not in new.by_key:
            dropped.append(row)

    changed.sort(key=lambda t: sort_key(t[2]))
    added.sort(key=lambda r: sort_key(new.rank(r)))
    dropped.sort(key=lambda r: sort_key(old.rank(r)))

    if args.csv:
        out = csv.writer(sys.stdout)
        out.writerow(["judge", "old_rank", "new_rank", "status"])
        for row, o, n in changed:
            out.writerow([new.display(row), o, n, "changed"])
        for row in added:
            out.writerow([new.display(row), "", new.rank(row), "added"])
        for row in dropped:
            out.writerow([old.display(row), old.rank(row), "", "dropped"])
        return

    if not (changed or added or dropped):
        print("No rank changes. Nothing to re-enter.")
        return

    if changed:
        plural = "" if len(changed) == 1 else "s"
        print(f"Re-enter in Tabroom ({len(changed)} judge{plural}):\n")
        w = max(len(new.display(r)) for r, _, _ in changed)
        for row, o, n in changed:
            print(f"  [ ] {new.display(row):<{w}}  {o:>4} -> {n}")
    if added:
        print(f"\nIn edited only ({len(added)}) — new to the sheet:")
        for row in added:
            print(f"  [ ] {new.display(row)}  -> {new.rank(row)}")
    if dropped:
        print(f"\nIn original only ({len(dropped)}) — dropped from the sheet:")
        for row in dropped:
            print(f"  [ ] {old.display(row)}  was {old.rank(row)}")


if __name__ == "__main__":
    main()
