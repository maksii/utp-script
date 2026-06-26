# MediaInfo Parser for Release

A userscript for UNIT3D trackers that parses a release's MediaInfo into a clean,
validated table of audio / video / subtitle tracks — on both the torrent
**view** page and the **upload / edit** page.

## Features

- **Live table on upload** — paste MediaInfo (or drag a `.txt` onto the control,
  or pick a file) and the track table updates as you type.
- **Track summary on view pages** — renders below the native MediaInfo block.
- **Convention validation** — each audio/subtitle row shows ✅ / ❌ for whether the
  uploader's track title matches the suggested `Language | Codec | Channels |
  Bitrate | …` format, with the expected string in the tooltip.
- **Click to copy** — click a Title or *Suggested format* cell to copy it (handy
  for fixing track titles on upload), with a toast confirmation.
- **Country flags & icons** for languages and track types.
- **Settings** via the userscript manager menu: toggle flags, invalid-row
  highlighting, and verbose logging (off by default — no console spam).

The parser is resilient to real-world data: it normalizes CRLF line endings
(uploaded `.txt` files and UNIT3D dumps use them), skips non-track sections
(General / Menu / Image) silently, keeps video tracks that omit a Language line,
and HTML-escapes all release-derived text before rendering.

## Development Setup

1. Install Node.js
2. Install dependencies: `npm install`

## Building

```bash
npm run build
```

This bundles `src/modules/*` + the metadata header from
`src/unit3d-info-generator.user.js` into the installable
`../unit3d-info-generator.user.js` at the repo root.

## Testing

```bash
npm test
```

Runs `test/parse.test.js` — a dependency-free regression suite over an embedded
CRLF fixture. Its headline guard is that CRLF input must not collapse to zero
rows and parsing must emit no console errors (the bug that silently broke v1.x on
real releases). To re-check against live tracker data, see
`indexer/validate_languages.py`, which pulls real MediaInfo from the UNIT3D API.

## Project Structure

```
unit3d-info-generator/
├── src/
│   ├── modules/
│   │   ├── Config.js          constants, selectors, flags, codec map, CSS, setting defaults
│   │   ├── Utils.js           logging, settings store, escaping, clipboard/toast, waitForElement
│   │   ├── DataValidator.js   title ⇄ suggested-format convention check
│   │   ├── MediaInfoParser.js section/field parsing + canonical-format building
│   │   └── UIHandler.js       page wiring, rendering, settings menu
│   └── unit3d-info-generator.user.js   metadata header + bootstrap
├── test/parse.test.js
├── build.js
├── package.json
└── README.md
```

## Development workflow

1. Edit modules in `src/modules/`
2. `npm test` to check parser behaviour
3. `npm run build` to regenerate the userscript
4. Reload it in your userscript manager

## License

[MIT License](../LICENSE)
