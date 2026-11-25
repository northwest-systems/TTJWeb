"""Synchronize static TTJWeb assets into orca-plugin/panel/vendor and orca-plugin/assets."""
import argparse
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STATIC_DIR = ROOT / "static"
PLUGIN_DIR = ROOT / "orca-plugin"
VENDOR_DIR = PLUGIN_DIR / "panel" / "vendor"
PLUGIN_ICON = PLUGIN_DIR / "assets" / "icon.png"

SYNC_FILES = [
    "app.js",
    "view-model.mjs",
    "style.css",
]
SYNC_DIRS = [
    "icons",
    "assets",
]


def expected_mapping():
    mapping = {}
    for rel in SYNC_FILES:
        src = STATIC_DIR / rel
        if src.is_file():
            mapping[VENDOR_DIR / rel] = src
    for dirname in SYNC_DIRS:
        base = STATIC_DIR / dirname
        if not base.is_dir():
            continue
        for src in sorted(base.rglob("*")):
            if src.is_file():
                rel = src.relative_to(STATIC_DIR)
                mapping[VENDOR_DIR / rel] = src
    icon_src = STATIC_DIR / "assets" / "app-icon.png"
    if icon_src.is_file():
        mapping[PLUGIN_ICON] = icon_src
    return mapping


def check_sync():
    expected = expected_mapping()
    problems = []

    for dst, src in sorted(expected.items()):
        if not dst.is_file():
            problems.append(f"MISSING: {dst.relative_to(ROOT)} (from {src.relative_to(ROOT)})")
        elif dst.read_bytes() != src.read_bytes():
            problems.append(f"OUTDATED: {dst.relative_to(ROOT)} differs from {src.relative_to(ROOT)}")

    if VENDOR_DIR.is_dir():
        for existing in sorted(VENDOR_DIR.rglob("*")):
            if existing.is_file() and existing not in expected:
                problems.append(f"EXTRA: {existing.relative_to(ROOT)}")

    return problems


def sync():
    expected = expected_mapping()
    if VENDOR_DIR.exists():
        shutil.rmtree(VENDOR_DIR)
    VENDOR_DIR.mkdir(parents=True, exist_ok=True)
    PLUGIN_ICON.parent.mkdir(parents=True, exist_ok=True)

    for dst, src in sorted(expected.items()):
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)

    return len(expected)


def main():
    parser = argparse.ArgumentParser(description="Sync static/ assets into orca-plugin/")
    parser.add_argument("--check", action="store_true", help="Verify files are in sync without modifying them")
    args = parser.parse_args()

    if args.check:
        problems = check_sync()
        if problems:
            for problem in problems:
                print(problem, file=sys.stderr)
            print("Run `python scripts/sync_orca_plugin.py` to synchronize.", file=sys.stderr)
            return 1
        print("orca-plugin assets are in sync with static/.")
        return 0

    count = sync()
    print(f"Synced {count} files into orca-plugin/.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
