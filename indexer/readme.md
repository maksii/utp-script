# UTOPIA Indexer for Prowlarr

An enhanced [Prowlarr](https://github.com/Prowlarr/Prowlarr) indexer definition for the [UTOPIA](https://utp.to/) tracker, with richer title formatting and MediaInfo-based language detection to improve matching in Sonarr and Radarr.

- **`utp-exp.yml`** — the custom indexer (shown in Prowlarr as *UTOPIA (API)-experimental*). This is the file you install.
- **`utopia.yml`** — the official definition shipped with Prowlarr ([source](https://github.com/Prowlarr/Indexers/blob/master/definitions/v11/utopia.yml)), kept here only as the upstream baseline for comparison.

## Installation

Place `utp-exp.yml` in Prowlarr's custom definitions folder (`Definitions/Custom/` inside your Prowlarr app-data directory), restart Prowlarr, then add the **UTOPIA (API)-experimental** indexer and enter your API key.

## Changes vs. the official `utopia.yml`

### Title & naming
- **`single_file_release_use_filename`** default changed from `true` to **`false`**.
- **`addukrainiantotitle` renamed to `add_ukrainian_to_title`** (snake_case). When enabled it now inserts `UKR` immediately after the resolution rather than appending it to the very end of the title.
- **`add_releasegroup_by_uploader`** *(new, default `true`)* — appends the uploader name as the release group when a release has none, improving custom-format detection. Also fires for dotted names containing a hyphenated token (e.g. `…WEB-DL.x264`), and only when an uploader is actually present.
- **`fix_tv_year`** *(new, default `true`)* — normalises a year next to the season token to the first season's release year (e.g. `Show S01 2021` → `Show 2019 S01`). Only a year adjacent to the season is touched, and only real `19xx`/`20xx` years, so resolutions (`1080p`, `2160p`, `4320p`) and year-named shows (`1923`, `2049`) are never altered. Multi-episode tokens (`S01E01E02`) are recognised.
- **Release tidy-ups** — `BDRemux` → `BluRay REMUX`, `BDRip` → `BluRay`; double spaces are collapsed and the title is trimmed.

### MediaInfo language detection *(new)*
Parses languages from each torrent's MediaInfo (`mediainfo` selector) into `audio_languages` and `subtitle_languages`, each inserted after the resolution and gated by its own toggle.

- **`use_mediainfo_audio_languages`** *(default `true`)* — appends audio track languages, e.g. `[Ukrainian+English]`.
- **`use_mediainfo_subtitle_languages`** *(default `true`)* — appends subtitle track languages tagged `Subs`, e.g. `[Subs English]`. **Requires Sonarr/Radarr custom formats that recognise the `Subs` tag** — without them the subtitle languages are read as audio/release languages and cause false-positive language detection.
- Audio and subtitles are independent toggles — enable either, both, or neither.
- Region/variant suffixes are stripped (`[English (GB)]` → `[English]`, `[Chinese (Simplified)]` → `[Chinese]`), duplicate tags are removed, and extraction is bounded to each track's MediaInfo block and to the leading run of `[language]` tags — so a stray `[` in MediaInfo can't leak the dump into the title, and an untagged audio track can't borrow a subtitle's language.

### Robustness
- New selectors surfaced from the API: `uploader`, `release_year`, `category_name` (alongside the new MediaInfo fields).
- Every nullable/absent JSON field — `mediainfo`, `uploader`, `release_year`, `infohash`, `imdbid`, `tmdbid`, `tvdbid` — is marked `optional: true`. Prowlarr's JSON parser aborts the **entire** search on a single non-optional null (no per-row recovery), so this stops one odd torrent from zeroing out all results. (`infohash`/`imdbid`/`tmdbid`/`tvdbid` are non-optional upstream.)
- `infohash` note: UNIT3D CE ≥ 9.x no longer returns `info_hash` at the top level (it lives only inside `magnet_link`); the field is harmless/empty if your instance doesn't expose it.
- Title regexes are written to avoid catastrophic backtracking (ReDoS-safe).

## Settings

| Setting | `utopia.yml` (official) | `utp-exp.yml` |
|---|---|---|
| `single_file_release_use_filename` | `true` | `false` |
| add UKR after resolution | `addukrainiantotitle`: `false` | `add_ukrainian_to_title`: `false` |
| `add_releasegroup_by_uploader` | — | `true` |
| `fix_tv_year` | — | `true` |
| `use_mediainfo_audio_languages` | — | `true` |
| `use_mediainfo_subtitle_languages` | — | `true` |

Settings shared unchanged with upstream (`apikey`, `freeleech`, `sort`, `type`) are omitted.
