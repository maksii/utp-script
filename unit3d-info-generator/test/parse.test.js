/*
 * Regression tests for the MediaInfo parser — run with `npm test`.
 *
 * No test framework / dependencies: loads the source modules the same way
 * build.js bundles them, then asserts behaviour against an embedded CRLF dump
 * (real MediaInfo from UNIT3D / uploaded .txt files uses CRLF). The headline
 * guard: CRLF input must NOT collapse to zero rows, and parsing must emit no
 * console errors — the exact failure that silently broke v1.x on real releases.
 */
const fs = require('fs');
const path = require('path');

// --- load Config/Utils/DataValidator/MediaInfoParser from src -----------------
const MODULES = path.join(__dirname, '..', 'src', 'modules');
let src = '';
for (const name of ['Config', 'Utils', 'DataValidator', 'MediaInfoParser', 'UIHandler']) {
    src += fs.readFileSync(path.join(MODULES, name + '.js'), 'utf8').replace(/export\s+/g, '') + '\n';
}
src += 'module.exports = { Config, Utils, DataValidator, MediaInfoParser, UIHandler };';
const mod = { exports: {} };
new Function('module', 'console', src)(mod, { log() {}, error() {} });
const { Config, Utils, DataValidator, MediaInfoParser, UIHandler } = mod.exports;

// --- tiny harness -------------------------------------------------------------
let passed = 0;
const failures = [];
function check(name, cond) {
    if (cond) { passed++; } else { failures.push(name); }
}

// Capture any console.error the parser would surface to the user.
const errors = [];
const realError = console.error;
console.error = (...a) => errors.push(a.join(' '));

const config = new Config();
const utils = new Utils(config);
const validator = new DataValidator();
const parser = new MediaInfoParser(validator, utils, config);
// statusOf/buildHtml are DOM-free (the comment in UIHandler says so), so we can
// construct it here and exercise the validation status logic without a browser.
const uiHandler = new UIHandler(parser, utils, config, validator);

// CRLF fixture: General + Video (no Language) + 2 Audio + 2 Text + Menu.
const CRLF = [
    'General',
    'Unique ID                      : 123',
    'Complete name                  : Movie.2024.mkv',
    'Format                         : Matroska',
    '',
    'Video',
    'ID                             : 1',
    'Format                         : HEVC',
    'Bit rate                       : 69.5 Mb/s',
    'Width                          : 3 840 pixels',
    'Title                          : Movie.2024.2160p.DV.HDR-GRP',
    'Default                        : Yes',
    '',
    'Audio #1',
    'Format                         : AC-3',
    'Bit rate                       : 640 kb/s',
    'Channel(s)                     : 6 channels',
    'Title                          : Ukrainian | AC-3 | 5.1 | 640 kbps | MVO | Studio',
    'Language                       : Ukrainian',
    'Default                        : Yes',
    '',
    'Audio #2',
    'Format                         : MLP FBA 16-ch',
    'Bit rate                       : 3 928 kb/s',
    'Channel(s)                     : 8 channels',
    'Title                          : English | Compatibility Track | TrueHD Atmos | 7.1 | 3928 kbps',
    'Language                       : English (US)',
    'Forced                         : No',
    '',
    'Text #1',
    'Format                         : UTF-8',
    'Title                          : Ukrainian | Forced | Studio',
    'Language                       : Ukrainian',
    'Forced                         : No',
    '',
    'Text #2',
    'Format                         : PGS',
    'Title                          : English | SDH',
    'Language                       : English',
    'Forced                         : No',
    '',
    'Menu',
    '00:00:00.000                   : Chapter 01',
].join('\r\n');

const rows = parser.parseMediaInfo(CRLF);
const byType = (t) => rows.filter(r => r.type === t);

// 1. CRLF must parse — the v1.x catastrophe was zero rows here.
check('CRLF input parses to non-zero rows', rows.length > 0);
check('CRLF parsing emits no console errors', errors.length === 0);

// 2. Section coverage: General + Menu skipped silently; tracks produced.
check('1 video row', byType('Video').length === 1);
check('2 audio rows', byType('Audio').length === 2);
check('2 subtitle rows', byType('Subtitles').length === 2);
check('total 5 track rows (General/Menu skipped)', rows.length === 5);

// 3. Video without a Language line is kept (was dropped + errored in v1.x).
const video = byType('Video')[0];
check('video kept despite no Language', video && video.language === 'Unknown');
check('video format is the codec', video && video.format === 'HEVC');

// 4. Audio canonical: codec map + channels + bitrate + source tail.
const a1 = byType('Audio')[0];
check('audio #1 channels 5.1', a1.channels === '5.1');
check('audio #1 bitrate normalized', a1.bitrate === '640 kbps');
check('audio #1 keeps source tail', a1.format === 'Ukrainian | AC-3 | 5.1 | 640 kbps | MVO | Studio');
check('audio #1 validates', validator.validateRow(a1.title, a1.format));

// 5. Non-standard prefix must NOT duplicate the bitrate.
const a2 = byType('Audio')[1];
check('audio #2 region stripped from language', a2.language === 'English');
check('audio #2 thousands-separated bitrate', a2.bitrate === '3928 kbps');
check('audio #2 no duplicated bitrate', !/(\d+ kbps).*\1/.test(a2.format));
check('audio #2 8ch -> 7.1', a2.channels === '7.1');
check('audio #2 MLP FBA 16-ch -> TrueHD Atmos', a2.format.includes('TrueHD Atmos'));

// 6. Subtitle kind derived from title (Forced) even when the flag is No.
const s1 = byType('Subtitles')[0];
check('subtitle keeps Forced from title + studio tail', s1.format === 'Ukrainian | Forced | Studio');
check('subtitle #1 validates', validator.validateRow(s1.title, s1.format));
const s2 = byType('Subtitles')[1];
check('subtitle SDH detected', s2.format === 'English | SDH');

// 7. Line-ending independence: CRLF and LF must yield identical structure.
const lfRows = parser.parseMediaInfo(CRLF.replace(/\r\n/g, '\n'));
check('CRLF and LF produce identical row count', lfRows.length === rows.length);

// 8. No malformed canonical format anywhere.
check('no "| ?" placeholders leaked', !rows.some(r => /\|\s*\?/.test(r.format)));

// 9. Regression: a title bitrate that differs from MediaInfo's representation
// ("192kbps" vs "192 kbps", or an off-by-one value) must still keep the tail.
const mismatch = parser.parseMediaInfo([
    'Audio',
    'Format                         : AC-3',
    'Bit rate                       : 192 kb/s',
    'Channel(s)                     : 2 channels',
    'Title                          : Ukrainian | AC-3 | 2.0 | 192kbps | DVO | ICTV',
    'Language                       : Ukrainian',
    '',
].join('\r\n'));
check('bitrate-text mismatch keeps source tail',
    mismatch[0] && mismatch[0].format === 'Ukrainian | AC-3 | 2.0 | 192 kbps | DVO | ICTV');

// 10. Subtitle conventions: commentary descriptor preserved (not forced to Full),
// and a source tag in the kind slot is kept rather than dropped.
const subs = parser.parseMediaInfo([
    'Text #1',
    'Format                         : UTF-8',
    'Title                          : English | Commentary #1',
    'Language                       : English',
    'Forced                         : No',
    '',
    'Text #2',
    'Format                         : PGS',
    'Title                          : English | UHD',
    'Language                       : English',
    'Forced                         : No',
    '',
].join('\r\n'));
check('commentary subtitle descriptor preserved', subs[0] && subs[0].format === 'English | Commentary #1');
check('source-tag subtitle keeps the tag', subs[1] && subs[1].format === 'English | Full | UHD');

// 11. charDiff: distance + segments drive the near-miss highlight (<3 chars off).
const d0 = validator.charDiff('English | SDH', 'English | SDH');
check('charDiff identical -> distance 0', d0.distance === 0);
const d1 = validator.charDiff('Ukrainian | AC3 | 5.1', 'Ukrainian | AC-3 | 5.1');
check('charDiff one missing char -> distance 1', d1.distance === 1);
check('charDiff marks only the inserted "-" on the format side',
    d1.bSeg.filter(s => s.changed).map(s => s.text).join('') === '-'
    && d1.aSeg.every(s => !s.changed));
const d2 = validator.charDiff('English | DVO', 'English | MVO');
check('charDiff one substitution -> distance 2 (near-miss, <3)', d2.distance === 2);
const dFar = validator.charDiff('English | SDH', 'Ukrainian | AC-3 | 5.1 | 640 kbps | MVO');
check('charDiff unrelated strings -> distance >= 3 (not a near-miss)', dFar.distance >= 3);
check('charDiff segments reconstruct both inputs',
    d1.aSeg.map(s => s.text).join('') === 'Ukrainian | AC3 | 5.1'
    && d1.bSeg.map(s => s.text).join('') === 'Ukrainian | AC-3 | 5.1');

// 12. statusOf: a missing title on audio/subs is an ERROR (not "n/a"); video stays neutral.
check('no-title audio -> error', uiHandler.statusOf({ type: 'Audio', title: '', format: 'English | AC-3 | 5.1' }).cls === 'bad');
check('no-title subtitle -> error', uiHandler.statusOf({ type: 'Subtitles', title: '', format: 'English | Full' }).cls === 'bad');
check('no-title video -> not validated', uiHandler.statusOf({ type: 'Video', title: '', format: 'HEVC' }).cls === 'na');
check('matching title -> ok', uiHandler.statusOf({ type: 'Audio', title: 'English | AC-3 | 5.1', format: 'English | AC-3 | 5.1' }).cls === 'ok');
check('mismatching title -> error', uiHandler.statusOf({ type: 'Subtitles', title: 'English', format: 'English | Full | PGS' }).cls === 'bad');

// 13. A no-title audio track parsed end-to-end is counted as bad by statusOf.
const noTitle = parser.parseMediaInfo([
    'Audio',
    'Format                         : AC-3',
    'Channel(s)                     : 2 channels',
    'Language                       : English',
    '',
].join('\r\n'));
check('parsed no-title audio row exists', noTitle.length === 1 && !noTitle[0].title);
check('parsed no-title audio is flagged bad', noTitle[0] && uiHandler.statusOf(noTitle[0]).cls === 'bad');

console.error = realError;

// --- report -------------------------------------------------------------------
if (failures.length) {
    console.log(`\n  FAIL — ${passed} passed, ${failures.length} failed:`);
    failures.forEach(f => console.log('   ✗ ' + f));
    if (errors.length) console.log('   captured console.error: ' + JSON.stringify(errors));
    process.exit(1);
}
console.log(`  OK — all ${passed} assertions passed (CRLF parsing, no console errors).`);
