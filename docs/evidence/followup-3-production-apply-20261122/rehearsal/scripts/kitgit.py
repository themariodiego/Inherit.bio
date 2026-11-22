"""LOCAL ONLY helper for the rehearsal scripts: release 4's 21 migration files, read
byte for byte from the supabase/migrations tree the kit pins (guarded/generate.py,
REV_TREE), never from a working tree.

    release_files() -> [(file name, bytes)] in filename order
"""
import os
import re
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
TOP = subprocess.run(['git', '-C', HERE, 'rev-parse', '--show-toplevel'], check=True, capture_output=True, text=True).stdout.strip()
GEN = os.path.join(HERE, '..', '..', 'guarded', 'generate.py')
REV_TREE = re.search(r"^REV_TREE = '([0-9a-f]{40})'", open(GEN).read(), re.M).group(1)
BASE_TREE = re.search(r"^BASE_TREE = '([0-9a-f]{40})'", open(GEN).read(), re.M).group(1)   # release 3's tree


def git(*a):
    return subprocess.run(['git', '-C', TOP, *a], check=True, capture_output=True).stdout


def release_files():
    names = git('diff', '--name-only', '--no-renames', '--diff-filter=A', BASE_TREE, REV_TREE).decode().split()
    assert len(names) == 21, names
    return [(n, git('show', f'{REV_TREE}:{n}')) for n in sorted(names)]
