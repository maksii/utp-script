export class Config {
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
