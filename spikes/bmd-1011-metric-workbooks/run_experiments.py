"""
BMD-1011 spike: prove a scenario can be written into a real metric workbook,
recalculated headlessly, and read back.

Writes three workbooks into out/:
  01-added-rows.xlsx   a habitat, a hedgerow and a watercourse added to a
                       workbook that had 12 / 5 / 0 of them
  02-bug-corrected.xlsx the cumulative-surplus correction, formulas only
Run `recalc.sh` over them, then `verify.mjs` to read the results back.
"""

import os
import sys
import shutil

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from workbook_patch import patch_workbook

SRC = os.environ.get('METRIC_WORKBOOK', '/host-files/Example - Area Habitats MVS.xlsx')
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out')

# A-1 row 23 is the 13th baseline row: its Ref is pre-filled, its input cells
# are styled blanks, and its computed columns already hold formulas. So adding
# a habitat is filling a row the template already laid out, not inserting one.
# Strategic significance must match the workbook's own list character for
# character. Anything else fails a lookup inside the metric's formulas, which
# are wrapped in IFERROR — so the row silently reports "Check Data" and
# generates no units instead of raising anything. A generator has to source
# these values from the workbook, not from our own reference data.
SS_NOT_IN_STRATEGY = 'Area/compensation not in local strategy/ no local strategy'

HABITAT_ROW = {
    'E23': 'Grassland',
    'F23': 'Other neutral grassland',
    'G23': 'No',
    'H23': 2,
    'K23': 'Moderate',
    'M23': SS_NOT_IN_STRATEGY,
    'AI23': 1,
}

ADD_ROWS = {
    'A-1 On-Site Habitat Baseline': HABITAT_ROW,
    # B-1 already held five hedgerows; this is a sixth.
    'B-1 On-Site Hedge Baseline': {
        'D15': 'Native hedgerow',
        'E15': 0.5,
        'H15': 'Moderate',
    },
    # C-1 held none at all, so this also covers writing into an empty sheet.
    "C-1 On-Site WaterC' Baseline": {
        'D10': 'Ditches',
        'E10': 0.5,
        'H10': 'Moderate',
    },
}

# The metric folds the Medium deficit into the running total before carrying it
# down to the Low band, which the trading rules do not permit: a surplus in one
# broad habitat cannot make good a deficit in another. Removing K89 is the
# whole correction.
BUG_CORRECTIONS = {
    '_formulas': {
        'Trading Summary Area Habitats': {'K90': 'K40+K12'},
    }
}

# The same parcel retained in full. Net unit change is nil, so the trading
# summary should not move — the control for the scenario below it.
RETAINED = {'A-1 On-Site Habitat Baseline': {**HABITAT_ROW, 'S23': 2},
            'B-1 On-Site Hedge Baseline': ADD_ROWS['B-1 On-Site Hedge Baseline'],
            "C-1 On-Site WaterC' Baseline": ADD_ROWS["C-1 On-Site WaterC' Baseline"]}

# The same parcel lost: no retained area, so its units come off the Medium
# surplus and the cumulative surplus alike.
LOST = {'A-1 On-Site Habitat Baseline': HABITAT_ROW}


def main():
    os.makedirs(OUT, exist_ok=True)
    shutil.copy(SRC, os.path.join(OUT, '00-source.xlsx'))
    scenarios = [
        ('01-added-rows', ADD_ROWS),
        ('02-bug-corrected', BUG_CORRECTIONS),
        ('03-added-rows-retained', RETAINED),
        ('04-added-loss', LOST),
    ]
    for name, edits in scenarios:
        dst = os.path.join(OUT, f'{name}.xlsx')
        parts = patch_workbook(SRC, dst, edits)
        size = os.path.getsize(dst) / 1e6
        print(f'{name}.xlsx  {size:.2f}MB  parts rewritten: {", ".join(parts)}')

if __name__ == '__main__':
    main()
