#!/usr/bin/env python3
"""
validate_languages.py - sanity-check the utp-exp.yml MediaInfo language
extraction against REAL torrents pulled from one or more UNIT3D trackers.

It fetches torrents via the UNIT3D filter API, runs the same audio/subtitle
language extraction that utp-exp.yml performs, and flags any tag that still
looks like junk (contains '|', digits, "kb/s", etc.) - i.e. a release whose
MediaInfo defeats the extractor and is worth turning into a regression case.

IMPORTANT: Prowlarr runs these filters on the .NET regex engine, which is the
source of truth. This script uses Python's `re` as a close stand-in: the
capture filter (where the bugs live) is identical; the one filter that uses a
variable-length lookbehind in the YAML (the region/variant strip) is
reimplemented equivalently here. Use this to FIND suspect releases on real
data, then confirm exact behaviour with the .NET/PowerShell harness.

Usage:
    python indexer/validate_languages.py                # scan recent torrents, print suspects
    python indexer/validate_languages.py -v             # print every torrent's tags
    python indexer/validate_languages.py -n 100         # scan up to 100 per instance
    python indexer/validate_languages.py "Mitchells"    # filter by name (find one release)

Config: API keys come from .env (searched from this file upward). Add more
trackers in INSTANCES below - an instance is skipped if its key isn't set.
"""

import os
import re
import sys
import json
import time
import urllib.request
import urllib.parse
import urllib.error

# ---------------------------------------------------------------------------
# Instances: (display name, base url, env var holding the API key).
# The UNIT3D filter API is identical across instances, so adding a tracker is
# just another line here plus its key in .env.
# ---------------------------------------------------------------------------
INSTANCES = [
    ("UTOPIA", "https://utp.to", "utp_api"),
    # ("Aither",   "https://aither.cc",   "aither_api"),
    # ("Blutopia", "https://blutopia.cc", "blutopia_api"),
]

RATE_LIMIT_SLEEP = 2.2  # UNIT3D allows ~30 req/min per host; stay under it


def load_env():
    """Load KEY=VALUE pairs from the nearest .env, walking up from this file."""
    here = os.path.dirname(os.path.abspath(__file__))
    for _ in range(6):
        candidate = os.path.join(here, ".env")
        if os.path.isfile(candidate):
            with open(candidate, encoding="utf-8") as fh:
                for line in fh:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    key, val = line.split("=", 1)
                    os.environ.setdefault(key.strip(), val.strip().strip('"').strip("'"))
            return candidate
        parent = os.path.dirname(here)
        if parent == here:
            break
        here = parent
    return None


# ---------------------------------------------------------------------------
# Language extraction - mirrors indexer/utp-exp.yml (.NET is authoritative).
# ---------------------------------------------------------------------------
def _extract(mediainfo, section):
    # filter 1: per-track language. Capture stops at the first '|' and trims, so
    # a Language field padded with codec/bitrate junk yields just the language.
    pattern = (
        r"(?s).*?" + section + r"(?:\s+#\d+)?\r?\n"
        r"(?:(?!\r?\n\r?\n).)*?Language\s+:\s+([^\r\n|]+?)\s*(?=[|\r\n]|$)"
    )
    s = re.sub(pattern, lambda m: "[" + m.group(1) + "]", mediainfo)
    # filter 2: keep only the leading run of [..] tags, drop the rest of the dump
    s = re.sub(r"^((?:\[[^\[\]]*\])*)[\s\S]*$", r"\1", s)
    # filter 3: strip a region/variant in parens inside a tag, eg [English (GB)] -> [English]
    #           (YAML uses a variable-length lookbehind; this is the equivalent here)
    s = re.sub(r"\s*\([^)]*\)", "", s)
    # filter 4: drop duplicate tags, eg [Ukrainian][Ukrainian] -> [Ukrainian]
    s = re.sub(r"\[(.*?)\](?=.*\[\1\])", "", s)
    # filter 5: ][ -> +
    s = s.replace("][", "+")
    return s


def audio_languages(mediainfo):
    return _extract(mediainfo, "Audio")


def subtitle_languages(mediainfo):
    s = _extract(mediainfo, "Text")
    return s.replace("[", "[Subs ")  # filter 6


# A clean language name never contains a pipe or a digit; codec/bitrate junk
# (E-AC-3, 5.1ch, 640kb/s, ...) always does. Keep it this tight so real
# language names ("French", "Spanish", ...) are never flagged.
_SUSPECT = re.compile(r"[|\d]")


def looks_bad(tag):
    """True if an extracted tag still carries codec/bitrate junk."""
    inner = tag.strip("[]").replace("Subs ", "")
    return bool(inner) and bool(_SUSPECT.search(inner))


def raw_language_lines(mediainfo):
    return [ln.strip() for ln in mediainfo.splitlines() if re.match(r"\s*Language\s+:", ln)]


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------
def fetch(base, key, params):
    url = base.rstrip("/") + "/api/torrents/filter?" + urllib.parse.urlencode(params, doseq=True)
    req = urllib.request.Request(url, headers={
        "Authorization": "Bearer " + key,
        "Accept": "application/json",
        # utp.to is behind Cloudflare, which 403s the default urllib UA
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    })
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.load(resp)


def scan_instance(name, base, key, want, query, verbose):
    scanned = flagged = 0
    page = 1
    while scanned < want:
        params = {"perPage": min(50, want - scanned), "page": page}
        if query:
            params["name"] = query
        try:
            payload = fetch(base, key, params)
        except urllib.error.HTTPError as e:
            print(f"[{name}] HTTP {e.code} {e.reason} - check the API key / rate limit")
            return
        except Exception as e:  # noqa: BLE001 - report and move on
            print(f"[{name}] request failed: {e}")
            return

        rows = payload.get("data") or []
        if not rows:
            break
        for row in rows:
            attr = row.get("attributes", row)
            mediainfo = attr.get("media_info") or ""
            if not mediainfo:
                continue
            scanned += 1
            audio = audio_languages(mediainfo)
            subs = subtitle_languages(mediainfo)
            bad = looks_bad(audio) or looks_bad(subs)
            flagged += bad
            if bad or verbose:
                print(f"[{name}] {attr.get('name', '?')}")
                print(f"        audio={audio!r}  subs={subs!r}" + ("   <-- SUSPECT" if bad else ""))
                if bad:
                    for ln in raw_language_lines(mediainfo):
                        print(f"        raw: {ln}")
        page += 1
        time.sleep(RATE_LIMIT_SLEEP)
    print(f"[{name}] scanned {scanned} torrents with MediaInfo - {flagged} suspect")


def main():
    # torrent names contain Cyrillic etc.; avoid cp1252 crashes on Windows consoles
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa: BLE001
        pass
    argv = sys.argv[1:]
    verbose = "-v" in argv or "--verbose" in argv
    want = 50
    if "-n" in argv:
        i = argv.index("-n")
        want = int(argv[i + 1])
        del argv[i:i + 2]
    query = next((a for a in argv if not a.startswith("-")), None)

    load_env()
    ran = False
    for name, base, env_var in INSTANCES:
        key = os.environ.get(env_var, "").strip()
        if not key:
            print(f"[{name}] skipped - no '{env_var}' in .env/environment")
            continue
        ran = True
        scan_instance(name, base, key, want, query, verbose)
    if not ran:
        print("No instances had API keys. Populate .env (eg: utp_api=YOUR_KEY).")


if __name__ == "__main__":
    main()
