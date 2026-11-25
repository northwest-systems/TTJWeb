"""Repository hygiene regression tests for all Git-tracked text files."""
import os
import re
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Build pattern fragments dynamically so this test file itself passes all checks.
_TS_NET_SUFFIX = r"\." + "ts" + r"\." + "net"
TS_NET_DOMAIN_RE = re.compile(
    r"(?<![A-Za-z0-9_-])([A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?" + _TS_NET_SUFFIX + r")(?![A-Za-z0-9_-])",
    re.IGNORECASE,
)
ALLOWED_SAMPLE_TS_NET_RE = re.compile(
    r"^sample-[a-z0-9-]+\.tail0000\." + "ts" + r"\." + "net$",
    re.IGNORECASE,
)

WIN_DRIVE_PATH_RE = re.compile(r"(?<![A-Za-z0-9_])[A-Za-z]:[/\\]")
ABS_OS_PATH_RE = re.compile(
    r"(?<![A-Za-z0-9_])(?:"
    + "/" + "mnt/[a-zA-Z]/"
    + "|" + "/" + "Users/"
    + "|" + "/" + "home/"
    + "|" + "/" + "opt/"
    + "|" + "/" + "path/to/"
    + ")"
)

IPV4_RE = re.compile(r"(?<![\d.])(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?![\d.])")

PINNED_DISTRO_RE = re.compile(
    r"\b(?:"
    + "ubun" + "tu"
    + "|" + "deb" + "ian"
    + "|" + "fed" + "ora"
    + "|" + "alp" + "ine"
    + "|" + "open" + "suse"
    + "|" + "ka" + "li"
    + r")-\d+(?:\.\d+)*\b",
    re.IGNORECASE,
)

FORBIDDEN_CLIENT_OR_WORKSPACE_RE = re.compile(
    r"(?:"
    + r"\b" + "her" + "dr" + r"\b"
    + "|" + "her" + "dr" + r"[-_]"
    + "|" + r"\borca[/\\]" + "work" + r"spaces[/\\]"
    + ")",
    re.IGNORECASE,
)


def _is_forbidden_ip(a, b, c, d):
    if not all(0 <= octet <= 255 for octet in (a, b, c, d)):
        return False
    # Tailscale CGNAT (RFC 6598)
    if a == 100 and 64 <= b <= 127:
        return True
    # RFC 1918 private networks
    if a == 10:
        return True
    if a == 192 and b == 168:
        return True
    if a == 172 and 16 <= b <= 31:
        return True
    return False


def scan_text(rel_path, text):
    """Return a list of hygiene violation descriptions for the given text."""
    violations = []
    for lineno, line in enumerate(text.splitlines(), start=1):
        for match in TS_NET_DOMAIN_RE.finditer(line):
            domain = match.group(1)
            if not ALLOWED_SAMPLE_TS_NET_RE.match(domain):
                violations.append(f"{rel_path}:{lineno}: non-sample Tailscale domain '{domain}'")

        for match in WIN_DRIVE_PATH_RE.finditer(line):
            violations.append(f"{rel_path}:{lineno}: Windows drive path literal '{match.group(0)}'")

        for match in ABS_OS_PATH_RE.finditer(line):
            violations.append(f"{rel_path}:{lineno}: OS/environment absolute path '{match.group(0)}'")

        for match in IPV4_RE.finditer(line):
            octets = tuple(int(part) for part in match.groups())
            if _is_forbidden_ip(*octets):
                violations.append(f"{rel_path}:{lineno}: non-loopback private/Tailscale IP '{match.group(0)}'")

        for match in PINNED_DISTRO_RE.finditer(line):
            violations.append(f"{rel_path}:{lineno}: version-pinned WSL distro name '{match.group(0)}'")

        for match in FORBIDDEN_CLIENT_OR_WORKSPACE_RE.finditer(line):
            violations.append(f"{rel_path}:{lineno}: forbidden client/workspace reference '{match.group(0)}'")

    return violations


_FALLBACK_SKIP_DIRS = {".git", "__pycache__", "node_modules", ".venv", "venv"}


def _list_repo_relative_paths():
    git_cmds = [["git", "-c", "safe.directory=*", "ls-files", "-z"]]
    if os.name == "posix" and shutil.which("git.exe"):
        git_cmds.append(["git.exe", "-c", "safe.directory=*", "ls-files", "-z"])
    for cmd in git_cmds:
        try:
            result = subprocess.run(
                cmd,
                cwd=ROOT,
                capture_output=True,
                check=True,
            )
            entries = [entry.decode("utf-8") for entry in result.stdout.split(b"\x00") if entry]
            if entries:
                return entries
        except (OSError, subprocess.CalledProcessError):
            continue

    fallback = []
    for path in sorted(ROOT.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(ROOT)
        if any(part in _FALLBACK_SKIP_DIRS for part in rel.parts):
            continue
        if rel.name.startswith(".env") or rel.suffix in {".pyc", ".sqlite"}:
            continue
        fallback.append(rel.as_posix())
    return fallback


def iter_tracked_text_files():
    entries = _list_repo_relative_paths()
    files = []
    for rel in entries:
        path = ROOT / rel
        if not path.is_file():
            continue
        raw = path.read_bytes()
        if b"\x00" in raw:
            continue
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            continue
        files.append((rel, text))
    return files


class RepoHygieneTests(unittest.TestCase):
    def test_hygiene_rules_detect_violations_and_allow_samples(self):
        # Allowed generic & standardized sample values
        clean_sample = "\n".join([
            "https://sample-host.tail0000." + "ts" + ".net:8878/",
            "sample-other.tail0000." + "ts" + ".net:8878",
            "~/sample/path/sample.profile",
            "~/sample/path/ttjcore",
            "~/sample/path/ttjweb",
            "sample-wsl-distro",
            "sample-token",
            "http://127.0.0.1:8878",
            "0.0.0.0",
            "TTJ/1.1.0",
            "https://example.com/",
        ])
        self.assertEqual(scan_text("sample.txt", clean_sample), [])

        # Synthetic violations built dynamically so this file stays clean
        bad_cases = [
            "my-host.tail1234." + "ts" + ".net",
            "your-host." + "ts" + ".net",
            "C" + ":/" + "work/profile",
            "D" + ":\\" + "proj\\ttjweb",
            "/" + "mnt/" + "c/work",
            "/" + "Users/" + "alice/proj",
            "/" + "home/" + "alice/proj",
            "/" + "opt/" + "ttj/ttjcore",
            "/" + "path/to/" + "profile",
            f"100.{64 + 1}.2.3",
            f"192.{160 + 8}.1.10",
            f"10.{0}.0.5",
            f"172.{15 + 1}.0.1",
            "Ubun" + "tu-22.04",
            "her" + "dr-mods",
            "orca/" + "work" + "spaces/proj",
        ]
        for case in bad_cases:
            found = scan_text("bad.txt", case)
            self.assertTrue(found, f"expected violation for synthetic input: {case!r}")

    def test_all_tracked_text_files_are_clean(self):
        tracked = iter_tracked_text_files()
        self.assertGreater(len(tracked), 0, "expected git-tracked text files")
        violations = []
        for rel, text in tracked:
            violations.extend(scan_text(rel, text))
        self.assertEqual(
            violations,
            [],
            "Repository hygiene violations detected:\n" + "\n".join(violations),
        )


if __name__ == "__main__":
    unittest.main()
