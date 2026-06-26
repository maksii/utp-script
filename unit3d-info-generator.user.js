// ==UserScript==
// @name         MediaInfo Parser for Release
// @namespace    https://github.com/maksii/utp-script
// @author       maksii
// @version      2.0.0
// @description  Parse MediaInfo on UNIT3D torrent create/view pages into a clean, validated track table with copy-to-clipboard.
// @match        *://*/torrents/*
// @run-at       document-idle
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @updateURL    https://raw.githubusercontent.com/maksii/utp-script/main/unit3d-info-generator.user.js
// @downloadURL  https://raw.githubusercontent.com/maksii/utp-script/main/unit3d-info-generator.user.js
// ==/UserScript==

class Config {
    constructor() {
        // CSS class prefix for everything this script injects, so styles stay
        // scoped and can't collide with the tracker theme or sibling scripts.
        this.NS = 'mip';

        this.SELECTORS = {
            // Create / edit page: the MediaInfo textarea and its form group.
            CREATE_TEXTAREA: '#upload-form-mediainfo',
            CREATE_GROUP: '.form__group',
            // Torrent view page: UNIT3D renders the raw dump into this <code>.
            VIEW_MEDIAINFO: 'code[x-ref="mediainfo"]',
            VIEW_SUBTITLES: '.mediainfo__subtitles',
            VIEW_AUDIO: '.mediainfo__audio',
            // Output container ids (kept stable for backwards compatibility).
            OUTPUT_CREATE_ID: 'output',
            OUTPUT_VIEW_ID: 'mediainfo-parser-output'
        };

        // Persisted user options (GM storage, falling back to localStorage).
        this.SETTINGS_DEFAULTS = {
            showFlags: true,          // render country flags next to languages
            highlightInvalid: true,   // accent rows whose title breaks convention
            verboseLogging: false,    // chatty console logging (off by default)
            tableExpanded: false      // track table starts collapsed; the summary header toggles it
        };

        // language name -> ISO-3166 code for /img/flags/<code>.png on UNIT3D.
        this.LANGUAGE_FLAGS = {
            Chinese: 'cn', Mandarin: 'cn', Cantonese: 'hk', Spanish: 'es',
            English: 'us', Hindi: 'in', Arabic: 'sa', Bengali: 'bd',
            Portuguese: 'pt', Russian: 'ru', Japanese: 'jp', Punjabi: 'in',
            German: 'de', Javanese: 'id', Korean: 'kr', French: 'fr',
            Telugu: 'in', Marathi: 'in', Turkish: 'tr', Tamil: 'in',
            Vietnamese: 'vn', Italian: 'it', Thai: 'th', Greek: 'gr',
            Dutch: 'nl', Polish: 'pl', Romanian: 'ro', Hungarian: 'hu',
            Czech: 'cz', Slovak: 'sk', Slovenian: 'si', Croatian: 'hr',
            Serbian: 'rs', Swedish: 'se', Bulgarian: 'bg', Danish: 'dk',
            Finnish: 'fi', Norwegian: 'no', Icelandic: 'is', Estonian: 'ee',
            Latvian: 'lv', Lithuanian: 'lt', Hebrew: 'il', Ukrainian: 'ua',
            Persian: 'ir', Indonesian: 'id', Malay: 'my', Urdu: 'pk',
            Azerbaijani: 'az', Armenian: 'am', Georgian: 'ge', Kazakh: 'kz',
            Kirghiz: 'kg', Kyrgyz: 'kg', Filipino: 'ph', Tagalog: 'ph',
            Catalan: 'es', Galician: 'es', Basque: 'es'
        };

        // MediaInfo Format value -> the codec label used in UTP track titles.
        // Only map where the convention differs from the raw Format; codecs the
        // community writes verbatim (E-AC-3, E-AC-3 JOC, AC-3, FLAC, DTS, Opus)
        // are intentionally left untouched so they validate against real titles.
        this.CODEC_FORMATTING = {
            'AAC LC': 'AAC',
            'AAC LC SBR': 'AAC',
            'MLP FBA': 'TrueHD',
            'MLP FBA 16-ch': 'TrueHD Atmos',
            'DTS XLL': 'DTS-HD MA',
            'DTS ES XLL': 'DTS-HD MA',
            'DTS XLL X': 'DTS:X',
            'DTS LBR': 'DTS Express'
        };

        this.TYPE_ICONS = {
            Video: '🎬',
            Audio: '🔊',
            Subtitles: '💬'
        };

        this.STYLES = this.buildStyles();
    }

    buildStyles() {
        const n = this.NS;
        return `
        .${n}-output { margin: 18px 0; font-size: 14px; line-height: 1.45; color: inherit;
            max-width: 100%; box-sizing: border-box; }
        .${n}-output *, .${n}-output *::before, .${n}-output *::after { box-sizing: border-box; }
        /* The head doubles as the collapse toggle: click/Enter shows-hides the table. */
        .${n}-head { display: flex; align-items: baseline; justify-content: space-between;
            flex-wrap: wrap; gap: 4px 14px; margin-bottom: 10px; cursor: pointer; user-select: none;
            padding: 8px 12px; border: 1px solid rgba(127,127,127,.22); border-radius: 8px;
            transition: background .12s ease, border-color .12s ease; }
        .${n}-head:hover { background: rgba(127,127,127,.07); border-color: rgba(127,127,127,.4); }
        .${n}-head:focus-visible { outline: 2px solid #58a6ff; outline-offset: 2px; }
        .${n}-title { font-weight: 600; font-size: 15px; display: inline-flex; align-items: center; gap: 8px; }
        .${n}-chevron { display: inline-block; width: 1em; text-align: center; opacity: .65; font-size: 11px; }
        .${n}-summary { opacity: .85; font-size: 13px; overflow-wrap: anywhere; }
        /* Scroll container so an extreme table can never push past the panel border. */
        .${n}-tablewrap { width: 100%; max-width: 100%; overflow-x: auto; -webkit-overflow-scrolling: touch; }
        .${n}-tablewrap[hidden] { display: none; }
        /* Fixed layout + wrapping = the table always fits its container; long
           formats and dotted release names wrap instead of overflowing. */
        .${n}-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
        .${n}-table th, .${n}-table td { padding: 7px 10px; text-align: left; vertical-align: top;
            border-bottom: 1px solid rgba(127,127,127,.22); overflow-wrap: anywhere; word-break: break-word; }
        .${n}-table th { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em;
            opacity: .65; vertical-align: middle; border-bottom: 2px solid rgba(127,127,127,.4); }
        /* Column sizing: pin the icon/flag columns, let Title + Format share the rest.
           Centered headers (Type/Def/Forced/OK) never wrap; each pinned width fits its
           widest header so "Type" and "Forced" stay on one line, and Language is tightened. */
        .${n}-table th.${n}-center { white-space: nowrap; }
        .${n}-table th:nth-child(1), .${n}-table td:nth-child(1) { width: 52px; }
        .${n}-table th:nth-child(2), .${n}-table td:nth-child(2) { width: 124px; }
        .${n}-table th:nth-child(3), .${n}-table td:nth-child(3) { width: 48px; }
        .${n}-table th:nth-child(4), .${n}-table td:nth-child(4) { width: 70px; }
        .${n}-table th:nth-child(7), .${n}-table td:nth-child(7) { width: 44px; }
        .${n}-table tbody tr { transition: background .12s ease; }
        .${n}-table tbody tr:hover { background: rgba(127,127,127,.09); }
        .${n}-row-bad { box-shadow: inset 3px 0 0 0 #e5534b; }
        /* Near-miss (title is <3 chars off the suggested format): amber, not red. */
        .${n}-row-near { box-shadow: inset 3px 0 0 0 #d29922; }
        /* The exact differing characters, highlighted in the Title / Suggested cells. */
        .${n}-diff { background: #ffd33d; color: #1b1f23; border-radius: 2px; padding: 0 1px;
            box-shadow: 0 0 0 1px rgba(0,0,0,.18); white-space: pre; }
        .${n}-center { text-align: center; }
        .${n}-fmt { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
            font-size: 12.5px; }
        .${n}-copy { cursor: copy; transition: background .12s ease, box-shadow .12s ease; }
        .${n}-copy:hover { background: rgba(88,166,255,.16); box-shadow: inset 0 0 0 1px rgba(88,166,255,.45); }
        .${n}-copy:active { background: rgba(88,166,255,.3); }
        .${n}-flag { width: 21px; height: 14px; margin-right: 7px; vertical-align: middle;
            border-radius: 2px; box-shadow: 0 0 0 1px rgba(127,127,127,.35); object-fit: cover; }
        .${n}-ok { color: #3fb950; } .${n}-bad { color: #e5534b; }
        .${n}-na { opacity: .4; }
        .${n}-empty { opacity: .65; font-style: italic; padding: 10px 2px; }
        .${n}-upload { display: flex; align-items: center; gap: 8px 14px; flex-wrap: wrap; max-width: 100%;
            margin: 12px 0; padding: 11px 14px; border: 1px dashed rgba(127,127,127,.45); border-radius: 9px; }
        .${n}-upload.dragover { border-color: #58a6ff; background: rgba(88,166,255,.08); }
        .${n}-upload label { font-weight: 600; white-space: nowrap; }
        .${n}-upload input[type=file] { max-width: 100%; flex: 1 1 180px; min-width: 0; }
        .${n}-hint { opacity: .6; font-size: 12px; flex: 1 1 auto; min-width: 0; }
        .${n}-toast { position: fixed; bottom: 26px; left: 50%; z-index: 99999; max-width: calc(100vw - 32px);
            transform: translateX(-50%) translateY(12px); background: #2ea043; color: #fff;
            padding: 9px 18px; border-radius: 7px; font-size: 13px; font-weight: 500;
            box-shadow: 0 6px 22px rgba(0,0,0,.32); opacity: 0; pointer-events: none;
            transition: opacity .18s ease, transform .18s ease; }
        .${n}-toast.${n}-show { opacity: 1; transform: translateX(-50%) translateY(0); }
        @media (max-width: 560px) {
            .${n}-output { font-size: 13px; }
            .${n}-table th, .${n}-table td { padding: 5px 7px; }
            .${n}-table th:nth-child(2), .${n}-table td:nth-child(2) { width: 92px; }
            .${n}-table th:nth-child(4), .${n}-table td:nth-child(4) { width: 64px; }
            .${n}-fmt { font-size: 11.5px; }
        }
        `;
    }
}

class Utils {
    constructor(config) {
        this.config = config;
        this._toastTimer = null;
    }

    // ----- logging (verbose logging is opt-in; errors always surface) --------
    log(message, data) {
        if (this.getSetting('verboseLogging')) {
            console.log(`[MediaInfo Parser] ${message}`, data !== undefined ? data : '');
        }
    }

    error(message, error) {
        console.error(`[MediaInfo Parser] ${message}`, error !== undefined ? error : '');
    }

    // ----- persisted settings (GM storage -> localStorage -> default) --------
    getSetting(key) {
        const def = this.config.SETTINGS_DEFAULTS[key];
        try {
            if (typeof GM_getValue === 'function') return GM_getValue(key, def);
        } catch (e) { /* fall through */ }
        try {
            const raw = localStorage.getItem(`${this.config.NS}_${key}`);
            if (raw !== null) return JSON.parse(raw);
        } catch (e) { /* fall through */ }
        return def;
    }

    setSetting(key, value) {
        try {
            if (typeof GM_setValue === 'function') { GM_setValue(key, value); return; }
        } catch (e) { /* fall through */ }
        try {
            localStorage.setItem(`${this.config.NS}_${key}`, JSON.stringify(value));
        } catch (e) { /* ignore */ }
    }

    // ----- string helpers ----------------------------------------------------
    escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // Real MediaInfo (uploaded .txt files, UNIT3D dumps) ships with CRLF. Collapse
    // every line ending to "\n" so section/field splitting is reliable. This is
    // THE fix for the parser silently producing zero rows on real releases.
    normalizeNewlines(text) {
        return String(text == null ? '' : text).replace(/\r\n?/g, '\n');
    }

    // Read a "Field : value" line from a section's lines, tolerant of the wide
    // column padding MediaInfo uses. Returns "" when the field is absent.
    getField(lines, field) {
        const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(`^${escaped}\\s*:\\s*(.+)`);
        for (const line of lines) {
            const m = line.match(re);
            if (m) return m[1].trim();
        }
        return '';
    }

    formatChannels(channels) {
        if (!channels) return '';
        const m = channels.match(/(\d+)\s*channels?/i);
        const n = m ? m[1] : null;
        if (n === '6') return '5.1';
        if (n === '8') return '7.1';
        if (n) return `${n}.0`;
        return channels.trim();
    }

    formatBitrate(bitrate) {
        if (!bitrate) return '';
        // "3 306 kb/s" -> "3306 kbps" (MediaInfo space-groups thousands).
        return bitrate.replace(/\bkb\/s\b/i, 'kbps').replace(/\s(?=\d)/g, '').trim();
    }

    formatLanguage(language) {
        // Take the language name only: drop any pipe-junk tail (UTP Language
        // fields occasionally carry "English | E-AC-3 | ..."), then a trailing
        // region/variant in parens, e.g. "English (US)" -> "English".
        return language.split('|')[0].replace(/\s*\([^)]*\)/g, '').trim();
    }

    formatCodec(codec, config) {
        return config.CODEC_FORMATTING[codec] || codec;
    }

    getTypeIcon(type, config) {
        return config.TYPE_ICONS[type] || this.escapeHtml(type);
    }

    getCountryFlag(language, config) {
        const code = config.LANGUAGE_FLAGS[language];
        if (!code) {
            // Generic "unknown language" siren shipped with UNIT3D.
            return `<img class="${config.NS}-flag" src="/vendor/joypixels/png/64/1f6a8.png" alt="?">`;
        }
        return `<img class="${config.NS}-flag" src="/img/flags/${code}.png" alt="${this.escapeHtml(language)}" data-${config.NS}-flag="1">`;
    }

    renderYesNoIcon(value) {
        return value === 'Yes'
            ? '✅'
            : `<span class="${this.config.NS}-na">·</span>`;
    }

    // ----- clipboard + toast -------------------------------------------------
    copyText(text) {
        const ok = () => this.toast('Copied to clipboard');
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(ok).catch(() => this._fallbackCopy(text, ok));
        } else {
            this._fallbackCopy(text, ok);
        }
    }

    _fallbackCopy(text, done) {
        try {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.setAttribute('readonly', '');
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            ta.remove();
            done();
        } catch (e) {
            this.error('Failed to copy text', e);
        }
    }

    toast(message) {
        let el = document.getElementById(`${this.config.NS}-toast`);
        if (!el) {
            el = document.createElement('div');
            el.id = `${this.config.NS}-toast`;
            el.className = `${this.config.NS}-toast`;
            document.body.appendChild(el);
        }
        el.textContent = message;
        // restart the CSS transition even on rapid repeat copies
        void el.offsetWidth;
        el.classList.add(`${this.config.NS}-show`);
        clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(() => el.classList.remove(`${this.config.NS}-show`), 1400);
    }

    // ----- DOM readiness -----------------------------------------------------
    // Resolve as soon as `getter()` returns a truthy element, via MutationObserver,
    // then stop. Bounded by `timeout` so we never poll forever on pages that match
    // the broad @match but have neither a textarea nor a MediaInfo block.
    waitForElement(getter, callback, { timeout = 15000 } = {}) {
        const initial = getter();
        if (initial) { callback(initial); return; }
        let done = false;
        const finish = (el) => {
            if (done) return;
            done = true;
            observer.disconnect();
            clearTimeout(timer);
            if (el) callback(el);
        };
        const observer = new MutationObserver(() => {
            const el = getter();
            if (el) finish(el);
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });
        const timer = setTimeout(() => finish(null), timeout);
    }

    injectStyles(css) {
        try {
            if (typeof GM_addStyle === 'function') { GM_addStyle(css); return; }
        } catch (e) { /* fall through */ }
        const style = document.createElement('style');
        style.textContent = css;
        (document.head || document.documentElement).appendChild(style);
    }
}

class DataValidator {
    // A MediaInfo blob is parseable if it's a non-empty string. Section/field
    // problems are handled per-section by the parser (which simply skips what it
    // can't use) rather than rejecting the whole dump.
    validateMediaInfo(text) {
        return typeof text === 'string' && text.trim().length > 0;
    }

    // Does the uploader's track Title already match the convention-canonical
    // Format the parser built? Compared segment-by-segment, trimmed, so spacing
    // quirks ("a |  b") don't cause false mismatches. This drives the Status
    // column; it is NOT used to drop rows.
    validateRow(title, format) {
        if (!title || !format) return false;
        const norm = (s) => s.split('|').map(p => p.trim()).filter(Boolean).join(' | ');
        return norm(title) === norm(format);
    }

    validateFormat(info) {
        return this.validateRow(info.title, info.format);
    }

    // Character-level diff of two short strings (track Title vs canonical Format),
    // used to spotlight near-misses. Returns segment lists for each side plus a
    // `distance` = inserted + deleted characters (a 1-char substitution counts as 2).
    // Segments are runs of `{ text, changed }` so the renderer can wrap only the
    // differing characters. O(n*m) via LCS — track titles are tens of chars, so cheap.
    charDiff(a, b) {
        a = String(a == null ? '' : a);
        b = String(b == null ? '' : b);
        const m = a.length, n = b.length;
        // dp[i][j] = length of the longest common subsequence of a[i:] and b[j:].
        const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
        for (let i = m - 1; i >= 0; i--) {
            for (let j = n - 1; j >= 0; j--) {
                dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
            }
        }
        const aSeg = [], bSeg = [];
        let distance = 0;
        const push = (segs, ch, changed) => {
            const last = segs[segs.length - 1];
            if (last && last.changed === changed) last.text += ch;
            else segs.push({ text: ch, changed });
        };
        let i = 0, j = 0;
        while (i < m && j < n) {
            if (a[i] === b[j]) { push(aSeg, a[i], false); push(bSeg, b[j], false); i++; j++; }
            else if (dp[i + 1][j] >= dp[i][j + 1]) { push(aSeg, a[i], true); distance++; i++; } // only in a (removed)
            else { push(bSeg, b[j], true); distance++; j++; }                                    // only in b (added)
        }
        while (i < m) { push(aSeg, a[i], true); distance++; i++; }
        while (j < n) { push(bSeg, b[j], true); distance++; j++; }
        return { distance, aSeg, bSeg };
    }
}

class MediaInfoParser {
    constructor(dataValidator, utils, config) {
        this.dataValidator = dataValidator;
        this.utils = utils;
        this.config = config;
    }

    parseMediaInfo(text) {
        try {
            if (!this.dataValidator.validateMediaInfo(text)) return [];

            // Normalize CRLF first, then split on blank lines (tolerating stray
            // whitespace). Without normalization, real CRLF dumps collapse into a
            // single section and nothing parses.
            const normalized = this.utils.normalizeNewlines(text);
            const sections = normalized.split(/\n[ \t]*\n/);

            const rows = [];
            for (const section of sections) {
                try {
                    const row = this.parseSection(section);
                    if (row) rows.push(row);
                } catch (error) {
                    this.utils.error('Error parsing section', error);
                }
            }
            return rows;
        } catch (error) {
            this.utils.error('Error parsing MediaInfo', error);
            return [];
        }
    }

    // Map one MediaInfo section to a row, or null when it isn't a track we render
    // (General, Menu/Chapters, Image, ReportBy, ...). Non-track sections are
    // skipped silently — they are not errors.
    parseSection(section) {
        const lines = section.split('\n').filter(line => line.trim() !== '');
        if (lines.length === 0) return null;

        // First token of the header: "Audio #1" -> "audio", "Text #2" -> "text".
        const kind = lines[0].trim().split(/\s+/)[0].toLowerCase();
        switch (kind) {
            case 'video': return this.parseVideoInfo(lines);
            case 'audio': return this.parseAudioInfo(lines);
            case 'text':  return this.parseSubtitleInfo(lines);
            default:      return null;
        }
    }

    extractCommonInfo(lines) {
        const language = this.utils.formatLanguage(this.utils.getField(lines, 'Language'));
        return {
            type: '',
            language: language || 'Unknown',
            default: this.utils.getField(lines, 'Default') === 'Yes' ? 'Yes' : 'No',
            forced: this.utils.getField(lines, 'Forced') === 'Yes' ? 'Yes' : 'No',
            enabled: this.utils.getField(lines, 'Enabled') === 'Yes' ? 'Yes' : 'No',
            title: this.utils.getField(lines, 'Title') || '',
            format: this.utils.getField(lines, 'Format') || 'Unknown'
        };
    }

    parseVideoInfo(lines) {
        // Video tracks frequently omit Language; that's fine. The Format stays the
        // raw codec (AVC/HEVC/...) and the video row isn't convention-validated.
        const info = this.extractCommonInfo(lines);
        info.type = 'Video';
        return info;
    }

    parseAudioInfo(lines) {
        const info = this.extractCommonInfo(lines);
        info.type = 'Audio';
        info.channels = this.utils.formatChannels(this.utils.getField(lines, 'Channel(s)'));
        info.bitrate = this.utils.formatBitrate(this.utils.getField(lines, 'Bit rate'));

        const codec = this.utils.formatCodec(info.format, this.config);
        // Build the canonical from the fields actually present — TrueHD/lossless
        // tracks often report only "Maximum bit rate", so MediaInfo has no usable
        // average. Omit a missing field rather than emitting a "?" placeholder.
        const parts = [info.language, codec];
        if (info.channels) parts.push(info.channels);
        if (info.bitrate) parts.push(info.bitrate);
        const baseFormat = parts.join(' | ');
        // Anchor on the bitrate SEGMENT (matched by shape, not exact text) so the
        // uploader's source/group/commentary tail survives even when their bitrate
        // text differs from MediaInfo's ("192kbps" vs "192 kbps", 3843 vs 3842).
        // When we have no bitrate of our own, anchor on the channel instead so the
        // title's own bitrate (and tail) is preserved rather than consumed.
        info.format = this.mergeTitle(baseFormat, info.title, info.language, (segs) => {
            if (info.bitrate) {
                const bi = segs.findIndex(s => /\d[\d ]*\s*kb(?:ps|\/s)\b/i.test(s));
                return bi !== -1 ? bi : segs.indexOf(info.bitrate);
            }
            return segs.indexOf(info.channels || codec);
        });
        return info;
    }

    parseSubtitleInfo(lines) {
        const info = this.extractCommonInfo(lines);
        info.type = 'Subtitles';
        const t = info.title || '';

        // Commentary subtitles carry a freeform descriptor ("Commentary #1",
        // "Commentary by director X") with no canonical form — preserve it as-is
        // rather than forcing it to Full/Forced/SDH and discarding the credit.
        if (/\bcommentary\b/i.test(t)) {
            const segs = t.split('|').map(s => s.trim());
            const rest = (segs[0] === info.language ? segs.slice(1) : segs).filter(Boolean).join(' | ');
            info.format = rest ? `${info.language} | ${rest}` : `${info.language} | Commentary`;
            return info;
        }

        // Classify the kind, preferring the title's stated kind (uploaders set it
        // there more reliably than the MediaInfo Forced flag). Track whether it
        // actually came from the title — that decides how we treat segment 2.
        let kind, kindFromTitle = true;
        if (/\bSDH\b/i.test(t)) kind = 'SDH';
        else if (/\bforced\b/i.test(t)) kind = 'Forced';
        else if (/\bfull\b/i.test(t)) kind = 'Full';
        else { kind = info.forced === 'Yes' ? 'Forced' : 'Full'; kindFromTitle = false; }

        const baseFormat = `${info.language} | ${kind}`;
        if (kindFromTitle) {
            // Anchor on the segment that BEARS the kind word (so "SDH-Colored",
            // "Full OCR" etc. are found), keeping whatever source tail follows.
            const re = new RegExp(`\\b${kind}\\b`, 'i');
            info.format = this.mergeTitle(baseFormat, info.title, info.language,
                (segs) => segs.findIndex(s => re.test(s)));
        } else {
            // No kind word in the title: segment 2 is a source/qualifier (UHD, BD,
            // PGS, a studio…), not a kind — keep it as the tail instead of dropping.
            const segs = t ? t.split('|').map(s => s.trim()) : [];
            const tail = (segs[0] === info.language ? segs.slice(1) : segs).filter(Boolean).join(' | ');
            info.format = tail ? `${baseFormat} | ${tail}` : baseFormat;
        }
        return info;
    }

    // Combine the convention-canonical `base` ("lang | codec | ch | br" or
    // "lang | kind") with any source/group/commentary tail the uploader kept in
    // `title`. `findAnchor(segs)` returns the index of the last canonical segment
    // (the bitrate for audio, the kind for subs); everything after it is the tail.
    // Handles the real-world title shapes seen on UTP:
    //   "Ukr | AC-3 | 5.1 | 640 kbps | MVO | Studio"  -> tail after bitrate
    //   "Ukr | AC-3 | 5.1 | 640 kbps"                 -> no tail, canonical
    //   "Eng | Compatibility Track | AC-3 | 448 kbps" -> tail after bitrate ("")
    //   "Ukr | AC-3 | 2.0 | 192kbps | DVO | ICTV"     -> tail kept despite "192kbps"
    //   "MVO | Studio" / "Original"                   -> pure tag, appended whole
    mergeTitle(base, title, language, findAnchor) {
        if (!title) return base;
        const segs = title.split('|').map(s => s.trim());
        const idx = findAnchor(segs);
        if (idx !== -1) {
            const tail = segs.slice(idx + 1).filter(Boolean).join(' | ');
            return tail ? `${base} | ${tail}` : base;
        }
        // No anchor segment found. A canonical-shaped title ("<lang> | ...") still
        // carries its tail positionally — keep it rather than dropping attribution.
        if (language && title.trim().startsWith(`${language} |`)) {
            const baseCount = base.split('|').length;
            return segs.length > baseCount ? `${base} | ${segs.slice(baseCount).join(' | ')}` : base;
        }
        return `${base} | ${title.trim()}`;
    }
}

class UIHandler {
    constructor(mediaInfoParser, utils, config, dataValidator) {
        this.parser = mediaInfoParser;
        this.utils = utils;
        this.config = config;
        this.validator = dataValidator;

        this.mode = null;          // 'create' | 'view'
        this.textarea = null;
        this.fileInput = null;
        this.output = null;
        this.sourceText = '';      // last MediaInfo text rendered (view mode)
        this.lastRows = [];
        this._debounce = null;
    }

    initialize() {
        this.utils.injectStyles(this.config.STYLES);
        this.registerMenu();
        this.utils.log('Initializing UI Handler');

        const sel = this.config.SELECTORS;
        // Whichever appears first decides the mode. Bounded, so non-applicable
        // /torrents/* pages stop watching instead of polling forever.
        this.utils.waitForElement(
            () => document.querySelector(sel.CREATE_TEXTAREA) || this.findMediainfoCode(),
            (el) => this.onReady(el),
            { timeout: 20000 }
        );
    }

    findMediainfoCode() {
        const sel = this.config.SELECTORS;
        return document.querySelector(sel.VIEW_MEDIAINFO)
            || document.querySelector('.mediainfo code')
            || document.querySelector('code.mediainfo')
            || null;
    }

    onReady(el) {
        const isTextarea = el.tagName === 'TEXTAREA'
            || el.id === this.config.SELECTORS.CREATE_TEXTAREA.replace('#', '');
        try {
            if (isTextarea) this.setupCreate(el);
            else this.setupView(el);
        } catch (error) {
            this.utils.error('Error setting up UI', error);
        }
    }

    // ----- create / edit page ------------------------------------------------
    setupCreate(textarea) {
        this.mode = 'create';
        this.textarea = textarea;

        const group = textarea.closest(this.config.SELECTORS.CREATE_GROUP) || textarea.parentElement;
        this.buildUploadControl(group);

        this.output = document.createElement('div');
        this.output.id = this.config.SELECTORS.OUTPUT_CREATE_ID;
        this.output.className = `${this.config.NS}-output`;
        // Live table sits directly below the textarea group.
        group.parentNode.insertBefore(this.output, group.nextSibling);

        textarea.addEventListener('input', () => {
            clearTimeout(this._debounce);
            this._debounce = setTimeout(() => this.refresh(), 180);
        });

        if (textarea.value.trim()) this.refresh();
        this.utils.log('Create page UI ready');
    }

    buildUploadControl(group) {
        const ns = this.config.NS;
        const wrap = document.createElement('div');
        wrap.className = `${ns}-upload`;

        const label = document.createElement('label');
        label.textContent = 'MediaInfo file:';
        label.htmlFor = `${ns}-file`;

        this.fileInput = document.createElement('input');
        this.fileInput.type = 'file';
        this.fileInput.id = `${ns}-file`;
        this.fileInput.accept = '.txt,.log,.nfo,text/plain';
        this.fileInput.addEventListener('change', (e) => {
            const file = e.target.files && e.target.files[0];
            if (file) this.loadFile(file);
        });

        const hint = document.createElement('span');
        hint.className = `${ns}-hint`;
        hint.textContent = 'or drag a .txt here / paste below — the table updates live.';

        wrap.append(label, this.fileInput, hint);

        // Drag & drop straight onto the control.
        wrap.addEventListener('dragover', (e) => { e.preventDefault(); wrap.classList.add('dragover'); });
        wrap.addEventListener('dragleave', () => wrap.classList.remove('dragover'));
        wrap.addEventListener('drop', (e) => {
            e.preventDefault();
            wrap.classList.remove('dragover');
            const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
            if (file) this.loadFile(file);
        });

        group.parentNode.insertBefore(wrap, group);
    }

    loadFile(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            this.textarea.value = e.target.result;
            this.refresh();
            this.utils.log('Loaded MediaInfo from file', file.name);
        };
        reader.onerror = () => this.utils.error('Could not read file', file.name);
        reader.readAsText(file);
    }

    // ----- torrent view page -------------------------------------------------
    setupView(codeEl) {
        this.mode = 'view';
        this.sourceText = codeEl.textContent || '';

        this.output = document.createElement('div');
        this.output.id = this.config.SELECTORS.OUTPUT_VIEW_ID;
        this.output.className = `${this.config.NS}-output`;

        const anchor = this.resolveViewAnchor(codeEl);
        anchor.parentNode.insertBefore(this.output, anchor.nextSibling);

        this.refresh();
        this.utils.log('View page UI ready');
    }

    // Place the summary after the native MediaInfo block. Prefer the subtitles
    // section (original placement) but fall back gracefully — many torrents have
    // no subtitles section at all, which previously blocked rendering entirely.
    resolveViewAnchor(codeEl) {
        const sel = this.config.SELECTORS;
        return document.querySelector(sel.VIEW_SUBTITLES)
            || document.querySelector(sel.VIEW_AUDIO)
            || codeEl.closest('.panelV2, .panel, section')
            || codeEl.parentElement
            || codeEl;
    }

    // ----- rendering ---------------------------------------------------------
    refresh() {
        const text = this.mode === 'create' ? (this.textarea ? this.textarea.value : '') : this.sourceText;
        if (!text || !text.trim()) {
            this.lastRows = [];
            if (this.output) this.output.innerHTML = '';
            return;
        }
        this.lastRows = this.parser.parseMediaInfo(text);
        this.render(this.lastRows);
    }

    statusOf(row) {
        if (row.type === 'Video') return { icon: '—', cls: 'na', tip: 'Video track — not validated' };
        if (!row.title) return { icon: '—', cls: 'na', tip: `No track title set. Suggested: ${row.format}` };
        const ok = this.validator.validateRow(row.title, row.format);
        return ok
            ? { icon: '✅', cls: 'ok', tip: 'Title matches the suggested format' }
            : { icon: '❌', cls: 'bad', tip: `Title should be: ${row.format}` };
    }

    render(rows) {
        this.output.innerHTML = this.buildHtml(rows);
        if (rows && rows.length) { this.wireHead(); this.wireRow(); }
    }

    // Render a charDiff segment list, wrapping only the differing characters so the
    // user sees exactly what's off. Text is escaped; the <mark> tags are ours.
    renderDiff(segs) {
        const ns = this.config.NS;
        const esc = (s) => this.utils.escapeHtml(s);
        return segs.map((p) => p.changed ? `<mark class="${ns}-diff">${esc(p.text)}</mark>` : esc(p.text)).join('');
    }

    // Pure markup builder (no DOM side effects) so it can be unit-tested and
    // previewed outside the browser.
    buildHtml(rows) {
        const ns = this.config.NS;
        const esc = (s) => this.utils.escapeHtml(s);

        if (!rows || rows.length === 0) {
            return `<div class="${ns}-empty">No video, audio or subtitle tracks found in this MediaInfo.</div>`;
        }

        const showFlags = this.utils.getSetting('showFlags');
        const highlight = this.utils.getSetting('highlightInvalid');
        const expanded = !!this.utils.getSetting('tableExpanded');

        // Evaluate each row once: validation status, and a char-diff for invalid rows
        // so we can flag near-misses (title <3 chars off the suggested format).
        const evaluated = rows.map((row) => {
            const st = this.statusOf(row);
            const isBad = st.cls === 'bad';
            const diff = isBad ? this.validator.charDiff(row.title, row.format) : null;
            const isNear = !!(diff && diff.distance > 0 && diff.distance < 3);
            return { row, st, isBad, diff, isNear };
        });

        // Summary: per-type counts, distinct languages, and an at-a-glance verdict
        // (so the collapsed header alone tells you whether anything needs fixing).
        const counts = { Video: 0, Audio: 0, Subtitles: 0 };
        const langs = [];
        let bad = 0, near = 0;
        evaluated.forEach(({ row, isBad, isNear }) => {
            counts[row.type] = (counts[row.type] || 0) + 1;
            if (row.language && row.language !== 'Unknown' && !langs.includes(row.language)) langs.push(row.language);
            if (isBad) bad++;
            if (isNear) near++;
        });
        const summaryBits = [];
        ['Video', 'Audio', 'Subtitles'].forEach((t) => {
            if (counts[t]) summaryBits.push(`${this.config.TYPE_ICONS[t]} ${counts[t]}`);
        });
        let summary = summaryBits.join(' · ') + (langs.length ? ` — ${esc(langs.join(', '))}` : '');
        const verdict = bad === 0
            ? `<span class="${ns}-ok">✅ all titles match</span>`
            : `<span class="${ns}-bad">❌ ${bad} to fix${near ? ` · ${near} near-miss` : ''}</span>`;
        summary += ` · ${verdict}`;

        const body = evaluated.map(({ row, st, isBad, diff, isNear }) => {
            const flag = showFlags ? this.utils.getCountryFlag(row.language, this.config) : '';
            const rowCls = (highlight && isBad) ? ` class="${ns}-row-${isNear ? 'near' : 'bad'}"` : '';
            // On a highlighted near-miss, mark the differing characters in both cells.
            const showDiff = highlight && isNear;
            const titleInner = showDiff ? this.renderDiff(diff.aSeg) : (row.title ? esc(row.title) : '');
            const fmtInner = showDiff ? this.renderDiff(diff.bSeg) : esc(row.format);
            const titleCell = row.title
                ? `<td class="${ns}-copy" data-copy="${esc(row.title)}" title="Click to copy">${titleInner}</td>`
                : `<td class="${ns}-na">—</td>`;
            const tip = isNear
                ? `Almost — ${diff.distance} character${diff.distance > 1 ? 's' : ''} off. Should be: ${row.format}`
                : st.tip;
            return `<tr${rowCls}>
                <td class="${ns}-center" title="${esc(row.type)}">${this.utils.getTypeIcon(row.type, this.config)}</td>
                <td>${flag}${esc(row.language)}</td>
                <td class="${ns}-center">${this.utils.renderYesNoIcon(row.default)}</td>
                <td class="${ns}-center">${this.utils.renderYesNoIcon(row.forced)}</td>
                ${titleCell}
                <td class="${ns}-copy ${ns}-fmt" data-copy="${esc(row.format)}" title="Click to copy the suggested title">${fmtInner}</td>
                <td class="${ns}-center ${ns}-${st.cls}" title="${esc(tip)}">${st.icon}</td>
            </tr>`;
        }).join('');

        // Head is the collapse toggle; the table is hidden until expanded (default collapsed).
        return `
            <div class="${ns}-head" role="button" tabindex="0" aria-expanded="${expanded}" aria-controls="${ns}-tablewrap"
                 title="Click to ${expanded ? 'collapse' : 'expand'} the track table">
                <div class="${ns}-title"><span class="${ns}-chevron">${expanded ? '▾' : '▸'}</span>${this.config.TYPE_ICONS.Audio} MediaInfo Summary</div>
                <div class="${ns}-summary">${summary}</div>
            </div>
            <div class="${ns}-tablewrap" id="${ns}-tablewrap"${expanded ? '' : ' hidden'}>
                <table class="${ns}-table">
                    <thead><tr>
                        <th class="${ns}-center">Type</th><th>Language</th>
                        <th class="${ns}-center">Def</th><th class="${ns}-center">Forced</th>
                        <th>Title</th><th>Suggested format</th><th class="${ns}-center">OK</th>
                    </tr></thead>
                    <tbody>${body}</tbody>
                </table>
            </div>`;
    }

    // Attach behaviour the CSP-safe way (no inline handlers): click-to-copy and
    // a graceful flag fallback when a flag image 404s.
    wireRow() {
        const ns = this.config.NS;
        this.output.querySelectorAll(`.${ns}-copy`).forEach((cell) => {
            cell.addEventListener('click', () => {
                const value = cell.getAttribute('data-copy');
                if (value) this.utils.copyText(value);
            });
        });
        this.output.querySelectorAll(`img[data-${ns}-flag]`).forEach((img) => {
            img.addEventListener('error', () => {
                img.removeAttribute(`data-${ns}-flag`);
                img.src = '/vendor/joypixels/png/64/1f6a8.png';
            }, { once: true });
        });
    }

    // Wire the summary header as a collapse toggle (click + keyboard). The open/closed
    // state is persisted so it survives the live re-renders on the create page.
    wireHead() {
        const ns = this.config.NS;
        const head = this.output.querySelector(`.${ns}-head`);
        const wrap = this.output.querySelector(`.${ns}-tablewrap`);
        if (!head || !wrap) return;
        const toggle = () => {
            const willExpand = wrap.hasAttribute('hidden');
            if (willExpand) wrap.removeAttribute('hidden'); else wrap.setAttribute('hidden', '');
            head.setAttribute('aria-expanded', String(willExpand));
            head.title = `Click to ${willExpand ? 'collapse' : 'expand'} the track table`;
            const chev = head.querySelector(`.${ns}-chevron`);
            if (chev) chev.textContent = willExpand ? '▾' : '▸';
            this.utils.setSetting('tableExpanded', willExpand);
        };
        head.addEventListener('click', toggle);
        head.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); toggle(); }
        });
    }

    // ----- settings menu -----------------------------------------------------
    registerMenu() {
        if (typeof GM_registerMenuCommand !== 'function') return;
        const toggle = (key, name) => {
            const next = !this.utils.getSetting(key);
            this.utils.setSetting(key, next);
            this.utils.toast(`${name}: ${next ? 'ON' : 'OFF'}`);
            this.refresh();
        };
        GM_registerMenuCommand('Toggle country flags', () => toggle('showFlags', 'Country flags'));
        GM_registerMenuCommand('Toggle invalid-row highlight', () => toggle('highlightInvalid', 'Highlight invalid'));
        GM_registerMenuCommand('Toggle verbose logging', () => toggle('verboseLogging', 'Verbose logging'));
    }
}

(function () {
    'use strict';

    // Initialize modules
    const config = new Config();
    const utils = new Utils(config);
    const dataValidator = new DataValidator();
    const mediaInfoParser = new MediaInfoParser(dataValidator, utils, config);
    const uiHandler = new UIHandler(mediaInfoParser, utils, config, dataValidator);

    // Start the application
    uiHandler.initialize();
})();
