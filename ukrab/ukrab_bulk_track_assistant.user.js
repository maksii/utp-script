// ==UserScript==
// @name         Ukrab.work Bulk Track Assistant
// @namespace    https://ukrab.work/
// @version      0.6.0
// @description  Load unlinked tracks, parse filenames, optionally enrich from folder-tree JSON, match TMDB, and link tracks in bulk.
// @match        https://ukrab.work/*
// @run-at       document-start
// @grant        unsafeWindow
// @updateURL    https://raw.githubusercontent.com/maksii/utp-script/main/ukrab/ukrab_bulk_track_assistant.user.js
// @downloadURL  https://raw.githubusercontent.com/maksii/utp-script/main/ukrab/ukrab_bulk_track_assistant.user.js
// ==/UserScript==

(() => {
  'use strict';

  const CSRF_COOKIE = 'audio_bucket_csrf';
  const UNLINKED_QUERY = 'sort_by=size_bytes&sort_direction=desc&page=1&per_page=all';
  const UNLINKED_ENDPOINTS = {
    '/tracks/unlinked': `/api/admin/tracks/unlinked?${UNLINKED_QUERY}`,
    '/my-tracks/unlinked': `/api/my-library/unlinked?${UNLINKED_QUERY}`,
  };
  const TARGET_PATHS_LABEL = Object.keys(UNLINKED_ENDPOINTS).join(' or ');
  const PANEL_ID = 'ukrab-bulk-assistant';
  const STYLE_ID = 'ukrab-bulk-assistant-style';
  const UNPARSED_GROUP = '__UBA_UNPARSED__';
  const DEFAULT_RENDER_LIMIT = 250;
  const TMDB_CACHE_KEY = 'ukrab_bulk_assistant_tmdb_cache_v1';
  const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w154';
  const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

  const PATTERN_FRAGMENTS = {
    seasonLabel: String.raw`^(?<title>.+?)\s*\(\s*(?:Сезон|Season)\s*(?<season>\d{1,3})\s*\)\s*[-–—]\s*(?<episode>\d{1,5})(?=\D|$)`,
    // Title.S01E02 / Title S01 E02 / Title.S02.E04 / Title S02EP10
    sxxExx: String.raw`^(?<title>.+?)[\s._\-–—]+S(?<season>\d{1,3})(?:P\d{1,3})?[\s._-]*(?:EP|E)(?<episode>\d{1,5})(?=\D|$)`,
    sxxexxLower: String.raw`^(?<title>.+?)[\s._\-–—]+s(?<season>\d{1,3})(?:p\d{1,3})?[\s._-]*e(?<episode>\d{1,5})(?=\D|$)`,
    sSeasonDashEp: String.raw`^(?<title>.+?)\s+s(?<season>\d{1,3})\s*[-–—]\s*(?<episode>\d{1,5})(?=\D|$)`,
    titleSeasonEpDash: String.raw`^(?<title>.+?)\s*[-–—]\s*(?<season>\d{1,3})\s*[-–—]\s*(?<episode>\d{1,5})(?=\D|$)`,
    // Title 2 - Серія 01 - Name / Title - Episode 5
    seriaBefore: String.raw`^(?<title>.+?)(?:\s+(?<season>\d{1,2}))?\s*[-–—]\s*(?:серія|серия|episode|ep\.?)\s*(?<episode>\d{1,4})(?=\D|$)`,
    // Title 1 серія СКО / Title - 03 СЕРІЯ(group)
    seriaAfter: String.raw`^(?<title>.+?)[\s._\-–—]+(?<episode>\d{1,4})[\s._-]*(?:серія|серия)(?=[\s._\-()\[\]]|$)`,
    // Title 3 - 01 / Title 4 - 22 (season before dash-episode)
    titleSeasonDashEp: String.raw`^(?<title>.+?)\s+(?<season>\d{1,3})\s*[-–—]\s*(?<episode>\d{1,5})(?=\s|_track|\[|\(|\.|$)`,
    titleSpaceSeasonEp: String.raw`^(?<title>.+?)\s+(?<season>\d{1,3})\s+(?<episode>\d{1,5})(?=_track)`,
    titleSpaceEpTrack: String.raw`^(?<title>.+?)[\s_]+(?<episode>\d{1,5})(?=_track)`,
    // Title_01_track2 / Title_01_Group_track2 / Two_Words_01_Group_SUB_track2
    titleUnderscoreEp: String.raw`^(?<title>[^_].*?)_(?<episode>\d{1,3})(?=_|\.[^.]+$|$)`,
    // РГ / Ukrainian: Title [01 з 12] [WEBRip …]_track / Title [01 з ХХ] (total not yet known)
    rgBracketEpOfTotal: String.raw`^(?<title>.+?)\s*\[(?<episode>\d{1,3})\s*(?:з|із|из|of)\s*(?:\d{1,3}|[XХ?]{1,3})\]`,
    dashEp: String.raw`^(?<title>.+?)\s*[-–—]\s*(?<episode>\d{1,5})(?=\s|_track|\[|\(|\.|$)`,
    aniuaBracketEp: String.raw`^(?:\[[^\]]+\]_)?(?<title>.+?)_\[(?<episode>\d{1,5})\]_`,
    specVypusk: String.raw`^(?<title>.+?)\s*[-–—]\s*(?:спецвипуск|спец\.?\s*вип\.?|special)\s*(?<episode>\d{1,5})`,
    bracketEpBeforeParen: String.raw`^(?<title>.+?)\s*\[(?<episode>\d{1,5})\]\s*\(`,
    titleSpaceEpParen: String.raw`^(?<title>.+?)\s+(?<episode>\d{1,5})\s*\(`,
    titleSpaceEpBracket: String.raw`^(?<title>.+?)\s+(?<episode>\d{1,5})\s*\[`,
    multiBracketEp: String.raw`^\[(?<title>.+?)\](?:\[[^\]]+\])+\[(?<episode>\d{1,5})\]`,
    eEpisode: String.raw`^(?<title>.+?)\s+E(?<episode>\d{1,5})(?=\s|\[|_|-|$)`,
    // Title 01 - OVA
    titleEpDashTag: String.raw`^(?<title>.+?)\s+(?<episode>\d{1,3})\s*[-–—]\s*(?:OVA|ONA|OAD|SP)(?=[\s._\-()\[\]]|$)`,
    dashOvaEp: String.raw`^(?<title>.+?)\s*[-–—]\s*OVA\s*(?<episode>\d{1,5})?(?=\s|\[|_|\(|\.|$)`,
    dashEpBeforeParen: String.raw`^(?<title>.+?)\s*[-–—]\s*.+?\s+(?<episode>\d{1,5})\s*\(`,
    // Episode-only filenames (title lives in parent folder — use folder-tree JSON to fill title)
    epOnlySxxExx: String.raw`^[Ss](?<season>\d{1,3})(?:P\d{1,3})?[\s._-]*[Ee](?<episode>\d{1,5})(?:[-–—][Ee]?(?<episode2>\d{1,5}))?(?=\D|$)`,
    epOnlySeria: String.raw`^(?:серія|серия|episode)\s*(?<episode>\d{1,4})(?=\D|$)`,
    epOnlyParenNxN: String.raw`^\((?<season>\d{1,2})[xX](?<episode>\d{1,3})\)`,
    epOnlyNxN: String.raw`^(?<season>\d{1,2})[xX](?<episode>\d{1,3})(?=\D|$)`,
    // Absolute episode index: 067.Title.DVDRip (DuckTales 1989, etc.)
    leadingAbsEpisode: String.raw`^(?<episode>\d{2,3})\.(?<title>.+?)(?:\.(?:DVDRip|WEB-?DL(?:Rip)?|WEBRip|BDRip|Blu-?Ray|HDTV|TVRip|SATRip).*)?(?:_track\d+)?(?:\.[^.]+)?$`,
    bracketNumPrefix: String.raw`^\[\d{1,3}\]\s*(?<title>.+?)(?:_track\d+)?(?:\.[^.]+)?$`,
    // Scene names: Title.2019.1080p… / Title (2011) WEB-DL… — greedy title so the last year wins (Blade.Runner.2049.2017)
    movieYear: String.raw`^(?<title>.+)[\s._(\[]+(?<year>(?:19|20)\d{2})(?=[\s._)\]-]|$)`,
    movieNoYear: String.raw`^(?<title>.+?)[\s._(\[]+(?:WEBRip|WEB-?DL(?:Rip)?|WEBDL|BDRip|BDRemux|Remux|Blu-?Ray|HDTV|DVDRip|TVRip|SATRip|IPTVRip|\d{3,4}p)(?=[\s._)\]-]|$)`,
    numberedListPrefix: String.raw`^\d{1,2}\.?\s*(?<title>[A-Za-zА-Яа-яІіЇїЄєҐґ].+?)(?:_track\d+)?(?:\.[^.]+)?$`,
    movie: String.raw`^(?<title>.+?)(?:_track\d+)?(?:\.[^.]+)?$`,
  };

  const EP_ONLY_PATTERNS = [
    PATTERN_FRAGMENTS.epOnlySxxExx,
    PATTERN_FRAGMENTS.epOnlySeria,
    PATTERN_FRAGMENTS.epOnlyParenNxN,
    PATTERN_FRAGMENTS.epOnlyNxN,
    PATTERN_FRAGMENTS.leadingAbsEpisode,
  ];
  const ABSOLUTE_EPISODE_PATTERNS = new Set([PATTERN_FRAGMENTS.leadingAbsEpisode]);
  const DEFAULT_SEASON_WHEN_EPISODE_ONLY = 1;

  const TV_PATTERNS = [
    PATTERN_FRAGMENTS.seasonLabel,
    PATTERN_FRAGMENTS.sxxExx,
    PATTERN_FRAGMENTS.sxxexxLower,
    PATTERN_FRAGMENTS.epOnlySxxExx,
    PATTERN_FRAGMENTS.rgBracketEpOfTotal,
    PATTERN_FRAGMENTS.sSeasonDashEp,
    PATTERN_FRAGMENTS.titleSeasonEpDash,
    PATTERN_FRAGMENTS.seriaBefore,
    PATTERN_FRAGMENTS.seriaAfter,
    PATTERN_FRAGMENTS.epOnlySeria,
    PATTERN_FRAGMENTS.titleSeasonDashEp,
    PATTERN_FRAGMENTS.titleSpaceSeasonEp,
    PATTERN_FRAGMENTS.dashEp,
    PATTERN_FRAGMENTS.titleUnderscoreEp,
    PATTERN_FRAGMENTS.titleSpaceEpTrack,
    PATTERN_FRAGMENTS.aniuaBracketEp,
    PATTERN_FRAGMENTS.specVypusk,
    PATTERN_FRAGMENTS.bracketEpBeforeParen,
    PATTERN_FRAGMENTS.titleSpaceEpParen,
    PATTERN_FRAGMENTS.titleSpaceEpBracket,
    PATTERN_FRAGMENTS.multiBracketEp,
    PATTERN_FRAGMENTS.eEpisode,
    PATTERN_FRAGMENTS.titleEpDashTag,
    PATTERN_FRAGMENTS.dashOvaEp,
    PATTERN_FRAGMENTS.dashEpBeforeParen,
    PATTERN_FRAGMENTS.epOnlyParenNxN,
    PATTERN_FRAGMENTS.epOnlyNxN,
    PATTERN_FRAGMENTS.leadingAbsEpisode,
  ];

  const AUTO_PATTERNS = [
    ...TV_PATTERNS,
    PATTERN_FRAGMENTS.bracketNumPrefix,
    PATTERN_FRAGMENTS.movieYear,
    PATTERN_FRAGMENTS.movieNoYear,
    PATTERN_FRAGMENTS.numberedListPrefix,
    PATTERN_FRAGMENTS.movie,
  ];

  const TREE_NOISE_DIR_RE =
    /^(?:toloka|qbittorrent|downloads|films?|movies?|series|serials?|tv|anime|torrents?|video|media)$/i;
  // Skip these when walking up for a show title (keep looking at parent).
  const TREE_SKIP_DIR_RE =
    /^(?:specials?|extras?|bonuses?|bonus|samples?|sample|featurettes?|ovas?|onas?|ncop|nced|misc|other|scans?|soundtrack|ost)$/i;
  const TREE_SEASON_DIR_RE =
    /^(?:Season|Сезон|Saison|Temporada)\s*0*(\d{1,3})\b|^S0*(\d{1,3})$|^\(?\s*0*(\d{1,3})\s*(?:сезон|season)\s*\)?$|^.*?\(\s*0*(\d{1,3})\s*(?:сезон|season)\s*\)$/i;
  const TREE_SEASON_EMBED_RE =
    /^(?<title>.+?)(?:[.\s_-]+|[-–—]\s*)(?:Сезон|Season)\s*(?<season>\d{1,3})\b/i;
  const TREE_SEASON_BRACKET_RE = /\[(?:Season|Сезон)\s*(?<season>\d{1,3})\]/i;
  const TREE_SXX_IN_FOLDER_RE =
    /^(?<title>.+?)(?:[.\s_-]+)S(?<season>\d{1,3})(?![Ee])(?:[.\s_-]+(?<year>\d{4}(?:\s*[-–—]\s*\d{4})?))?(?:[.\s_-]|$)/i;
  const TREE_SEASON_RANGE_PAREN_RE = /\s*\(\s*(?:Season|Сезон)\s*\d{1,3}(?:\s*[,;]\s*Part\s*\d{1,3}|\s*[-–—]\s*\d{1,3})\s*\)\s*/i;
  const TREE_SEASON_PAREN_RE = /\s*\(\s*(?:Season|Сезон)\s*(?<season>\d{1,3})[^)]*\)\s*/i;
  const TREE_YEAR_RANGE_PAREN_RE = /\s*\(\d{4}(?:\s*[-–—]\s*\d{4})?\)\s*/;
  const TREE_RELEASE_DASH_RE =
    /\s*[-–—]\s*(?:WEB-?DL|WEBDL|WEBRip|BDRip|BDRemux|Blu-?Ray|HDTV|DVDRip|DVD|SATRip|IPTV|TVRip|720p|1080p|2160p).*$/i;
  // Codec suffix optional so "DVDRip-AVC" / "WEB-DLRip-AVC, TVRip-AVC" strip fully.
  const TREE_QUALITY_TOKEN_RE =
    String.raw`(?:\[[^\]]+\]|\([^)]*(?:WEB|BDRip|Blu|HDTV|DVD|SAT|IPTV|Rip|1080|720|Ukr|UKR|Hurtom|Sub)[^)]*\)|\b(?:WEB-?DL(?:Rip)?|WEBDL|WEBRip|BDRip|BDRemux|Blu-?Ray|HDTV|DVDRip|SATRip|IPTV(?:Rip)?|TVRip|AMZN|NF|CR|x264|x265|H\.?\s*26[45]|HEVC|AVC|AAC|DTS(?:-HD)?|MP2|DD(?:P)?|1080p|1080i|720p|2160p|576p|480p|UKR|Ukr|UA|ENG|Multi|AI\s*Upscale|Remux|REMUX)\b(?:[-._]?AVC|[-._]?HEVC)?|\b\d+x(?:UKR|UA|Ukr)?\b)`;
  const TREE_QUALITY_TAIL_RE = new RegExp(
    String.raw`(?:\s*[,;]\s*|\s+)*${TREE_QUALITY_TOKEN_RE}(?:(?:\s*[,;]\s*|\s+)+${TREE_QUALITY_TOKEN_RE})*\s*$`,
    'i',
  );
  const TRACK_SUFFIX_RE = /_track\d+(?:-[a-f0-9]+)?$/i;
  const TREE_FILE_CODE_PATTERNS = [
    /\[(?<season>\d{1,2})[xX](?<episode>\d{1,3})\]/,
    /\((?<season>\d{1,2})[xX](?<episode>\d{1,3})\)/,
    /\[(?<episode>\d{1,3})\s*(?:з|із|из|of)\s*(?:\d{1,3}|[XХ?]{1,3})\]/i,
    /(?:^|[\s._\-–—])[Ss](?<season>\d{1,3})(?:P\d{1,3})?[Ee](?<episode>\d{1,5})(?=\D|$)/,
    /(?:^|[\s._\-–—\[])(?<season>\d{1,2})[xX](?<episode>\d{1,3})(?=\D|$)/,
    /^(?<episode>\d{2,3})\./,
  ];

  const PRESETS = {
    'auto-anime': {
      label: 'Auto: all TV patterns (recommended)',
      patterns: AUTO_PATTERNS,
    },
    'dash-episode': {
      label: 'Title -/–/— Episode ...',
      patterns: [PATTERN_FRAGMENTS.dashEp],
    },
    sxxexx: {
      label: 'Title SxxExx / sxxexx ...',
      patterns: [PATTERN_FRAGMENTS.sxxExx, PATTERN_FRAGMENTS.sxxexxLower],
    },
    's-dash-ep': {
      label: 'Title sN -/–/— Episode ...',
      patterns: [PATTERN_FRAGMENTS.sSeasonDashEp],
    },
    'season-label': {
      label: 'Title (Сезон N) -/–/— Episode ...',
      patterns: [PATTERN_FRAGMENTS.seasonLabel],
    },
    'title-season-episode': {
      label: 'Title - Season - Episode - ...',
      patterns: [PATTERN_FRAGMENTS.titleSeasonEpDash],
    },
    'rg-space': {
      label: 'Title Season Episode _track / Title [NN з MM]_track (РГ style)',
      patterns: [PATTERN_FRAGMENTS.rgBracketEpOfTotal, PATTERN_FRAGMENTS.titleSpaceSeasonEp, PATTERN_FRAGMENTS.titleSpaceEpTrack],
    },
    'aniua-bracket': {
      label: 'AniUA: Title_[Episode]_...',
      patterns: [PATTERN_FRAGMENTS.aniuaBracketEp],
    },
    seria: {
      label: 'Title N серія / Title - Серія N / Title_NN_...',
      patterns: [PATTERN_FRAGMENTS.seriaBefore, PATTERN_FRAGMENTS.seriaAfter, PATTERN_FRAGMENTS.epOnlySeria, PATTERN_FRAGMENTS.titleUnderscoreEp],
    },
    'spec-vypusk': {
      label: 'Title - спецвипуск NN ...',
      patterns: [PATTERN_FRAGMENTS.specVypusk],
    },
    'title-space-ep': {
      label: 'Title NN (release) / Title NN [release]',
      patterns: [PATTERN_FRAGMENTS.titleSpaceEpParen, PATTERN_FRAGMENTS.titleSpaceEpBracket],
    },
    'ep-only': {
      label: 'Episode-only: SxxExx / NxN / (NxN) (needs folder tree for title)',
      patterns: EP_ONLY_PATTERNS,
    },
    movie: {
      label: 'Movie: use filename as title',
      patterns: [PATTERN_FRAGMENTS.movie],
    },
  };

  const state = {
    tracks: [],
    selectedIds: new Set(),
    statuses: new Map(),
    titleGroups: new Map(),
    groupMeta: new Map(),
    csrfToken: '',
    loading: false,
    loadedEndpoint: null,
    running: false,
    abortController: null,
    tmdbDetails: null,
    tmdbResults: [],
    lastRouteEndpoint: null,
    lastRun: null,
    tmdbCache: {},
    selectedTmdbIndex: -1,
    groupOrder: [],
    linkQueue: [],
    groupTrackIds: new Map(),
    groupStatsCache: new Map(),
    manualOverrides: new Map(),
    folderTree: null,
    groupFromTree: new Set(),
    confirmResolver: null,
    searchSeq: 0,
    titleDetails: new Map(),
    seasonCounts: null,
    seasonCountsKey: '',
  };

  const TOAST_DEFAULT_MS = 6000;

  const ui = {};

  function getUnlinkedEndpoint() {
    return UNLINKED_ENDPOINTS[location.pathname.replace(/\/+$/, '')] ?? null;
  }

  function isTargetRoute() {
    return getUnlinkedEndpoint() !== null;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function readCsrfToken() {
    const prefix = `${CSRF_COOKIE}=`;
    const cookie = document.cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith(prefix));
    state.csrfToken = cookie ? decodeURIComponent(cookie.slice(prefix.length)) : '';
    updateAuthIndicator();
    return !!state.csrfToken;
  }

  function addStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${PANEL_ID} {
        position: fixed;
        top: 64px;
        right: 14px;
        z-index: 2147483640;
        width: min(1180px, calc(100vw - 28px));
        max-height: calc(100vh - 82px);
        overflow: hidden;
        display: flex;
        flex-direction: column;
        border: 1px solid #adb5bd;
        border-radius: 8px;
        background: #fff;
        color: #212529;
        box-shadow: 0 12px 36px rgba(0, 0, 0, .25);
        font: 13px/1.35 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      #${PANEL_ID}[data-collapsed="true"] .uba-body { display: none; }
      #${PANEL_ID} * { box-sizing: border-box; }
      #${PANEL_ID} .uba-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 10px 12px;
        background: #212529;
        color: #fff;
        cursor: move;
        user-select: none;
      }
      #${PANEL_ID} .uba-title { font-weight: 700; }
      #${PANEL_ID} .uba-header-actions { display: flex; gap: 6px; }
      #${PANEL_ID} .uba-header button {
        border: 1px solid rgba(255,255,255,.45);
        border-radius: 4px;
        background: transparent;
        color: #fff;
        min-width: 28px;
        height: 28px;
        cursor: pointer;
      }
      #${PANEL_ID} .uba-body { overflow: auto; padding: 12px; }
      #${PANEL_ID} .uba-grid {
        display: grid;
        grid-template-columns: repeat(12, minmax(0, 1fr));
        gap: 8px;
        align-items: start;
      }
      #${PANEL_ID} .uba-col-12 { grid-column: span 12; }
      #${PANEL_ID} .uba-col-11 { grid-column: span 11; }
      #${PANEL_ID} .uba-col-10 { grid-column: span 10; }
      #${PANEL_ID} .uba-col-9 { grid-column: span 9; }
      #${PANEL_ID} .uba-col-8 { grid-column: span 8; }
      #${PANEL_ID} .uba-col-7 { grid-column: span 7; }
      #${PANEL_ID} .uba-col-6 { grid-column: span 6; }
      #${PANEL_ID} .uba-col-5 { grid-column: span 5; }
      #${PANEL_ID} .uba-col-4 { grid-column: span 4; }
      #${PANEL_ID} .uba-col-3 { grid-column: span 3; }
      #${PANEL_ID} .uba-col-2 { grid-column: span 2; }
      #${PANEL_ID} .uba-status-row {
        grid-column: span 12;
        display: grid;
        grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
        gap: 8px;
      }
      #${PANEL_ID} .uba-split {
        display: grid;
        grid-template-columns: minmax(220px, 30%) minmax(0, 1fr);
        gap: 10px;
        align-items: start;
        margin-top: 8px;
      }
      #${PANEL_ID} .uba-split-side { min-width: 0; }
      #${PANEL_ID} .uba-split-main { min-width: 0; }
      #${PANEL_ID} label { display: block; font-weight: 600; margin-bottom: 3px; }
      #${PANEL_ID} input,
      #${PANEL_ID} select,
      #${PANEL_ID} textarea,
      #${PANEL_ID} button { font: inherit; }
      #${PANEL_ID} input[type="text"],
      #${PANEL_ID} input[type="number"],
      #${PANEL_ID} input[type="password"],
      #${PANEL_ID} select,
      #${PANEL_ID} textarea {
        width: 100%;
        border: 1px solid #ced4da;
        border-radius: 4px;
        padding: 6px 8px;
        background: #fff;
        color: #212529;
      }
      #${PANEL_ID} textarea {
        min-height: 54px;
        resize: vertical;
        font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
      }
      #${PANEL_ID} .uba-buttons { display: flex; flex-wrap: wrap; gap: 6px; }
      #${PANEL_ID} .uba-btn {
        border: 1px solid #6c757d;
        border-radius: 4px;
        padding: 6px 10px;
        background: #fff;
        color: #212529;
        cursor: pointer;
      }
      #${PANEL_ID} .uba-btn:hover:not(:disabled) { background: #f1f3f5; }
      #${PANEL_ID} .uba-btn:disabled { opacity: .55; cursor: not-allowed; }
      #${PANEL_ID} .uba-btn-primary { border-color: #0d6efd; background: #0d6efd; color: #fff; }
      #${PANEL_ID} .uba-btn-success { border-color: #198754; background: #198754; color: #fff; }
      #${PANEL_ID} .uba-btn-danger { border-color: #dc3545; background: #dc3545; color: #fff; }
      #${PANEL_ID} .uba-section { margin-top: 12px; padding-top: 12px; border-top: 1px solid #dee2e6; }
      #${PANEL_ID} .uba-section > .uba-notice { margin-top: 8px; }
      #${PANEL_ID} .uba-full { grid-column: 1 / -1; width: 100%; }
      #${PANEL_ID} .uba-notice {
        display: block;
        width: 100%;
        padding: 8px 10px;
        border-radius: 4px;
        background: #f1f3f5;
        line-height: 1.45;
        font-size: 12px;
        word-break: normal;
        overflow-wrap: break-word;
      }
      #${PANEL_ID} .uba-help { color: #6c757d; font-size: 12px; }
      #${PANEL_ID} .uba-ok { color: #146c43; }
      #${PANEL_ID} .uba-error { color: #b02a37; }
      #${PANEL_ID} .uba-warning { color: #997404; }
      #${PANEL_ID} .uba-table-wrap {
        max-height: 310px;
        overflow: auto;
        border: 1px solid #dee2e6;
        border-radius: 4px;
      }
      #${PANEL_ID} table { width: 100%; border-collapse: collapse; font-size: 12px; }
      #${PANEL_ID} th,
      #${PANEL_ID} td { padding: 5px 6px; border-bottom: 1px solid #e9ecef; text-align: left; vertical-align: top; }
      #${PANEL_ID} th { position: sticky; top: 0; z-index: 1; background: #f8f9fa; }
      #${PANEL_ID} tr[data-status="success"] { background: #d1e7dd; }
      #${PANEL_ID} tr[data-status="error"] { background: #f8d7da; }
      #${PANEL_ID} tr[data-status="running"] { background: #fff3cd; }
      #${PANEL_ID} .uba-file { max-width: 370px; overflow-wrap: anywhere; }
      #${PANEL_ID} .uba-number { text-align: right; white-space: nowrap; }
      #${PANEL_ID} .uba-ep-offset {
        color: #b45309;
        font-weight: 600;
        background: #fff3cd;
        padding: 1px 5px;
        border-radius: 3px;
      }
      #${PANEL_ID} .uba-cell-input {
        width: 52px;
        padding: 2px 4px;
        font-size: 12px;
        text-align: right;
        border: 1px solid #ced4da;
        border-radius: 3px;
        background: #fff;
      }
      #${PANEL_ID} .uba-cell-input.uba-manual-input {
        border-color: #0d6efd;
        background: #e7f1ff;
      }
      #${PANEL_ID} .uba-cell-input.uba-has-offset:not(.uba-manual-input) {
        border-color: #ffc107;
        background: #fff8e1;
      }
      #${PANEL_ID} .uba-cell-input.uba-out-of-range {
        border-color: #dc3545;
        background: #f8d7da;
      }
      #${PANEL_ID} .uba-cell-input:disabled {
        opacity: .65;
        cursor: not-allowed;
      }
      #${PANEL_ID} .uba-fixed-value { color: #6c757d; }
      #${PANEL_ID} .uba-inline { display: flex; align-items: center; gap: 6px; }
      #${PANEL_ID} .uba-inline input[type="checkbox"] { width: auto; }
      #${PANEL_ID} .uba-hidden { display: none !important; }
      #${PANEL_ID} .uba-toast-stack {
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin-bottom: 8px;
      }
      #${PANEL_ID} .uba-toast {
        padding: 8px 10px;
        border-radius: 4px;
        border: 1px solid #ced4da;
        background: #f8f9fa;
        font-size: 12px;
        line-height: 1.4;
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 10px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, .08);
      }
      #${PANEL_ID} .uba-toast-ok { border-color: #badbcc; background: #d1e7dd; color: #0f5132; }
      #${PANEL_ID} .uba-toast-error { border-color: #f5c2c7; background: #f8d7da; color: #842029; }
      #${PANEL_ID} .uba-toast-warning { border-color: #ffecb5; background: #fff3cd; color: #664d03; }
      #${PANEL_ID} .uba-toast-info { border-color: #b6d4fe; background: #cfe2ff; color: #084298; }
      #${PANEL_ID} .uba-toast-actions {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-shrink: 0;
      }
      #${PANEL_ID} .uba-toast-close {
        border: none;
        background: transparent;
        cursor: pointer;
        font-size: 16px;
        line-height: 1;
        padding: 0;
        color: inherit;
        opacity: .7;
      }
      #${PANEL_ID} .uba-toast-close:hover { opacity: 1; }
      #${PANEL_ID} .uba-confirm-backdrop {
        position: absolute;
        inset: 0;
        z-index: 6;
        background: rgba(33, 37, 41, .45);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 16px;
      }
      #${PANEL_ID} .uba-confirm {
        width: min(520px, 100%);
        max-height: calc(100% - 32px);
        overflow: auto;
        background: #fff;
        border-radius: 8px;
        border: 1px solid #adb5bd;
        box-shadow: 0 12px 36px rgba(0, 0, 0, .25);
        padding: 14px;
      }
      #${PANEL_ID} .uba-confirm-title {
        font-weight: 700;
        font-size: 15px;
        margin-bottom: 10px;
      }
      #${PANEL_ID} .uba-confirm-body { font-size: 13px; line-height: 1.45; }
      #${PANEL_ID} .uba-confirm-dl {
        margin: 0 0 10px;
        display: grid;
        grid-template-columns: minmax(0, 9rem) minmax(0, 1fr);
        gap: 4px 10px;
      }
      #${PANEL_ID} .uba-confirm-dl dt {
        margin: 0;
        font-weight: 600;
        color: #6c757d;
      }
      #${PANEL_ID} .uba-confirm-dl dd {
        margin: 0;
        word-break: break-word;
      }
      #${PANEL_ID} .uba-confirm-actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        margin-top: 14px;
      }
      #${PANEL_ID} progress { width: 100%; height: 18px; }
      #${PANEL_ID} .uba-log {
        max-height: 170px;
        overflow: auto;
        padding: 8px;
        border: 1px solid #dee2e6;
        border-radius: 4px;
        background: #111827;
        color: #e5e7eb;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        font: 12px/1.4 ui-monospace, SFMono-Regular, Consolas, monospace;
      }
      #${PANEL_ID} .uba-tmdb-title { font-weight: 600; }
      #${PANEL_ID} .uba-tmdb-overview { max-width: 410px; color: #6c757d; }
      #${PANEL_ID} .uba-workflow {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        align-items: center;
      }
      #${PANEL_ID} .uba-group-nav {
        display: flex;
        gap: 4px;
        align-items: center;
        flex: 1;
        min-width: 200px;
      }
      #${PANEL_ID} .uba-group-nav select { flex: 1; min-width: 0; }
      #${PANEL_ID} .uba-group-list {
        max-height: 310px;
        overflow: auto;
        border: 1px solid #dee2e6;
        border-radius: 4px;
        font-size: 12px;
      }
      #${PANEL_ID} .uba-group-item {
        display: flex;
        justify-content: space-between;
        gap: 8px;
        padding: 5px 8px;
        border-bottom: 1px solid #f1f3f5;
        cursor: pointer;
      }
      #${PANEL_ID} .uba-group-item:hover { background: #f8f9fa; }
      #${PANEL_ID} .uba-group-item[data-active="true"] { background: #cfe2ff; }
      #${PANEL_ID} .uba-group-meta {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 2px;
        flex-shrink: 0;
      }
      #${PANEL_ID} .uba-group-state {
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: .02em;
        padding: 1px 5px;
        border-radius: 3px;
        white-space: nowrap;
      }
      #${PANEL_ID} .uba-group-item[data-work-state="untouched"] .uba-group-state { background: #e9ecef; color: #6c757d; }
      #${PANEL_ID} .uba-group-item[data-work-state="ready"] .uba-group-state { background: #cfe2ff; color: #084298; }
      #${PANEL_ID} .uba-group-item[data-work-state="queued"] .uba-group-state { background: #fff3cd; color: #664d03; }
      #${PANEL_ID} .uba-group-item[data-work-state="running"] .uba-group-state { background: #cff4fc; color: #055160; }
      #${PANEL_ID} .uba-group-item[data-work-state="partial"] .uba-group-state { background: #e2d9f3; color: #432874; }
      #${PANEL_ID} .uba-group-item[data-work-state="done"] .uba-group-state { background: #d1e7dd; color: #0f5132; }
      #${PANEL_ID} .uba-group-item .uba-badge {
        font-size: 11px;
        color: #6c757d;
        white-space: nowrap;
      }
      #${PANEL_ID} .uba-group-item[data-done="true"] { opacity: .72; }
      #${PANEL_ID} .uba-group-item[data-done="true"] .uba-badge { color: #146c43; }
      #${PANEL_ID} .uba-queue-list {
        margin: 0;
        padding: 0 0 0 18px;
        font-size: 12px;
        line-height: 1.5;
      }
      #${PANEL_ID} .uba-queue-list li { margin-bottom: 4px; }
      #${PANEL_ID} .uba-queue-list .uba-queue-meta { color: #6c757d; }
      #${PANEL_ID} .uba-pattern-tag {
        font-size: 10px;
        color: #6c757d;
        font-family: ui-monospace, monospace;
      }
      #${PANEL_ID} .uba-tree-tag {
        display: inline-block;
        margin-left: 6px;
        padding: 0 5px;
        border-radius: 3px;
        font-size: 10px;
        font-weight: 600;
        background: #d1e7dd;
        color: #0f5132;
        vertical-align: middle;
      }
      #${PANEL_ID} .uba-group-item[data-tree="true"] .uba-group-label::after {
        content: " · tree";
        color: #0f5132;
        font-size: 10px;
        font-weight: 600;
      }
      #${PANEL_ID} .uba-tree-status[data-kind="ok"] { color: #0f5132; }
      #${PANEL_ID} .uba-tree-status[data-kind="error"] { color: #842029; }
      #${PANEL_ID} .uba-tmdb-selected {
        display: flex;
        gap: 12px;
        align-items: flex-start;
        padding: 10px;
        border: 1px solid #b6d4fe;
        border-radius: 6px;
        background: #e7f1ff;
      }
      #${PANEL_ID} .uba-tmdb-selected img,
      #${PANEL_ID} .uba-tmdb-poster {
        width: 64px;
        height: 96px;
        object-fit: cover;
        border-radius: 4px;
        background: #dee2e6;
        flex-shrink: 0;
      }
      #${PANEL_ID} .uba-tmdb-poster-placeholder {
        display: flex;
        align-items: center;
        justify-content: center;
        color: #6c757d;
        font-size: 11px;
        text-align: center;
        padding: 4px;
      }
      #${PANEL_ID} .uba-tmdb-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
        gap: 8px;
        max-height: 360px;
        overflow: auto;
        padding: 4px;
      }
      #${PANEL_ID} .uba-tmdb-card {
        display: flex;
        gap: 10px;
        padding: 8px;
        border: 1px solid #dee2e6;
        border-radius: 6px;
        background: #fff;
        cursor: pointer;
        text-align: left;
      }
      #${PANEL_ID} .uba-tmdb-card:hover { border-color: #86b7fe; background: #f8f9fa; }
      #${PANEL_ID} .uba-tmdb-card[data-selected="true"] {
        border-color: #0d6efd;
        background: #e7f1ff;
        box-shadow: 0 0 0 1px #0d6efd;
      }
      #${PANEL_ID} .uba-tmdb-card-body { flex: 1; min-width: 0; }
      #${PANEL_ID} .uba-tmdb-card-title { font-weight: 600; margin-bottom: 4px; }
      #${PANEL_ID} .uba-tmdb-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        align-items: center;
        margin-bottom: 4px;
      }
      #${PANEL_ID} .uba-badge {
        display: inline-block;
        padding: 1px 6px;
        border-radius: 999px;
        font-size: 11px;
        font-weight: 600;
        line-height: 1.4;
      }
      #${PANEL_ID} .uba-badge-tv { background: #cfe2ff; color: #084298; }
      #${PANEL_ID} .uba-badge-movie { background: #fff3cd; color: #997404; }
      #${PANEL_ID} .uba-badge-muted { background: #e9ecef; color: #495057; }
      #${PANEL_ID} .uba-badge-best { background: #d1e7dd; color: #0f5132; }
      #${PANEL_ID} .uba-tmdb-card-overview {
        color: #6c757d;
        font-size: 11px;
        line-height: 1.35;
        display: -webkit-box;
        -webkit-line-clamp: 3;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
      #${PANEL_ID} .uba-tmdb-links a {
        color: #0d6efd;
        font-size: 11px;
        text-decoration: none;
      }
      #${PANEL_ID} .uba-tmdb-links a:hover { text-decoration: underline; }
      @media (max-width: 850px) {
        #${PANEL_ID} { top: 8px; right: 8px; width: calc(100vw - 16px); max-height: calc(100vh - 16px); }
        #${PANEL_ID} .uba-col-9,
        #${PANEL_ID} .uba-col-8,
        #${PANEL_ID} .uba-col-7,
        #${PANEL_ID} .uba-col-6,
        #${PANEL_ID} .uba-col-5,
        #${PANEL_ID} .uba-col-4,
        #${PANEL_ID} .uba-col-3,
        #${PANEL_ID} .uba-col-2 { grid-column: span 12; }
        #${PANEL_ID} .uba-status-row { grid-template-columns: 1fr; }
        #${PANEL_ID} .uba-split { grid-template-columns: 1fr; }
      }
    `;
    document.head.appendChild(style);
  }

  function createPanel() {
    if (document.getElementById(PANEL_ID)) return;
    addStyles();

    const panel = document.createElement('section');
    panel.id = PANEL_ID;
    panel.dataset.collapsed = 'false';
    panel.innerHTML = `
      <div class="uba-header">
        <div class="uba-title">Ukrab Bulk Track Assistant v0.6.0</div>
        <div class="uba-header-actions">
          <button type="button" data-action="collapse" title="Collapse">−</button>
          <button type="button" data-action="close" title="Hide">×</button>
        </div>
      </div>
      <div class="uba-body">
        <div class="uba-toast-stack" data-role="toast-stack"></div>
        <div class="uba-grid">
          <div class="uba-status-row">
            <div class="uba-notice" data-role="route-status"></div>
            <div class="uba-notice" data-role="auth-status">Checking session…</div>
          </div>
        </div>
        <div class="uba-section">
          <div class="uba-grid">
            <div class="uba-col-12">
              <div class="uba-buttons">
                <button class="uba-btn uba-btn-primary" type="button" data-action="load-api">Load / reload unlinked tracks</button>
              </div>
            </div>
          </div>
          <div class="uba-notice" data-role="data-status">No API data loaded.</div>
        </div>

        <div class="uba-section">
          <div class="uba-grid">
            <div class="uba-col-12">
              <label>Optional folder tree JSON</label>
              <div class="uba-help" style="margin-bottom:6px">
                From <code>export_folder_tree.py</code>. When loaded, folder-tree metadata has priority over
                filename parsing for title/season/episode (e.g. <code>[13x03] Baking Bad…</code> →
                <strong>Family Guy</strong> S13E03 from the path). Still optional — without a tree, filename
                patterns are used alone.
              </div>
              <div class="uba-buttons">
                <button class="uba-btn" type="button" data-action="load-tree">Load folder tree JSON…</button>
                <button class="uba-btn" type="button" data-action="clear-tree" data-role="clear-tree" disabled>Clear tree</button>
                <input id="uba-tree-file" type="file" accept=".json,application/json" hidden>
              </div>
            </div>
            <div class="uba-col-12">
              <div class="uba-notice uba-tree-status" data-role="tree-status">No folder tree loaded.</div>
            </div>
          </div>
        </div>

        <div class="uba-section uba-grid">
          <div class="uba-col-9">
            <label for="uba-preset">Filename pattern</label>
            <select id="uba-preset">
              <option value="auto-anime" selected>Auto: all patterns (TV + movies, recommended)</option>
              <option value="dash-episode">Title -/–/— Episode ...</option>
              <option value="sxxexx">Title SxxExx / sxxexx ...</option>
              <option value="s-dash-ep">Title sN -/–/— Episode ...</option>
              <option value="season-label">Title (Сезон N) -/–/— Episode ...</option>
              <option value="title-season-episode">Title - Season - Episode - ...</option>
              <option value="rg-space">Title [NN з MM]_track / Season Episode _track (РГ style)</option>
              <option value="aniua-bracket">AniUA: Title_[Episode]_...</option>
              <option value="seria">Title N серія / Title - Серія N / Title_NN_...</option>
              <option value="spec-vypusk">Title - спецвипуск NN ...</option>
              <option value="title-space-ep">Title NN (release) / Title NN [release]</option>
              <option value="ep-only">Episode-only: SxxExx / NxN / (NxN) + folder tree</option>
              <option value="movie">Movie: use filename as title</option>
              <option value="custom">Custom regex</option>
            </select>
          </div>
          <div class="uba-col-3">
            <label for="uba-delay">Delay between requests, ms</label>
            <input id="uba-delay" type="number" value="1000" min="0" step="100">
          </div>
          <div class="uba-col-12">
            <label for="uba-pattern">Active pattern(s); custom regex supports named groups: title, season, episode</label>
            <textarea id="uba-pattern" spellcheck="false"></textarea>
          </div>
        </div>

        <div class="uba-section">
          <div class="uba-grid">
            <div class="uba-col-12">
              <label>Title group workflow</label>
              <div class="uba-workflow">
                <div class="uba-group-nav">
                  <button class="uba-btn" type="button" data-action="prev-group" title="Previous group">◀</button>
                  <select id="uba-title-group">
                    <option value="">All parsed titles</option>
                  </select>
                  <button class="uba-btn" type="button" data-action="next-group" title="Next group">▶</button>
                </div>
                <button class="uba-btn" type="button" data-action="select-group-pending">Select pending in group</button>
              </div>
            </div>
            <div class="uba-col-6">
              <label for="uba-filter">Filename / title / tree-path filter</label>
              <input id="uba-filter" type="text" placeholder="Example: Злюки бобри · S02E11 · Oggy">
            </div>
            <div class="uba-col-3">
              <label for="uba-status-filter">Show tracks</label>
              <select id="uba-status-filter">
                <option value="pending" selected>Pending (not linked)</option>
                <option value="all">All</option>
                <option value="linked">Linked only</option>
                <option value="failed">Failed only</option>
              </select>
            </div>
            <div class="uba-col-3">
              <label for="uba-render-limit">Render rows</label>
              <select id="uba-render-limit">
                <option value="100">100</option>
                <option value="250" selected>250</option>
                <option value="500">500</option>
                <option value="1000">1000</option>
              </select>
            </div>
            <div class="uba-col-12 uba-inline">
              <input id="uba-strip-bracket" type="checkbox" checked>
              <label for="uba-strip-bracket" style="margin:0">Strip [tag] prefix for grouping and TMDB search</label>
            </div>
            <div class="uba-col-12 uba-inline">
              <input id="uba-auto-advance" type="checkbox" checked>
              <label for="uba-auto-advance" style="margin:0">After a group finishes linking, advance to the next group with cached TMDB and pending tracks</label>
            </div>
            <div class="uba-col-12 uba-inline">
              <input id="uba-auto-search" type="checkbox" checked>
              <label for="uba-auto-search" style="margin:0">Search TMDB automatically when opening a group without a cached match</label>
            </div>
            <div class="uba-col-12">
              <div class="uba-buttons">
                <button class="uba-btn" type="button" data-action="select-matching">Select all matching</button>
                <button class="uba-btn" type="button" data-action="deselect-matching">Deselect matching</button>
                <button class="uba-btn" type="button" data-action="select-none">Select none</button>
                <button class="uba-btn" type="button" data-action="select-failed">Select failed</button>
                <button class="uba-btn" type="button" data-action="remap-tmdb" disabled title="Convert per-season numbering of selected out-of-range tracks to TMDB's (sets manual S/E)">Remap to TMDB numbering</button>
                <button class="uba-btn" type="button" data-action="reset-manual-se" disabled>Reset manual S/E</button>
                <button class="uba-btn" type="button" data-action="reparse">Reparse all</button>
              </div>
            </div>
          </div>
          <div class="uba-notice" data-role="selection-summary">No tracks loaded.</div>
          <div class="uba-split">
            <div class="uba-split-side">
              <label>Quick group list (click to jump)</label>
              <div class="uba-help" style="margin-bottom:6px">
                Status pills: <strong>New</strong> (untouched), <strong>Ready</strong> (TMDB picked), <strong>Queued</strong>, <strong>Linking</strong>, <strong>Started</strong> (partial), <strong>Done</strong>.
              </div>
              <div class="uba-group-list" data-role="group-list"></div>
            </div>
            <div class="uba-split-main">
              <div class="uba-table-wrap" style="max-height:310px">
                <table>
                  <thead>
                    <tr>
                      <th><input type="checkbox" data-role="toggle-matching" title="Toggle all matching tracks"></th>
                      <th>ID</th>
                      <th>Title</th>
                      <th>S</th>
                      <th>E</th>
                      <th>Status</th>
                      <th>Filename</th>
                    </tr>
                  </thead>
                  <tbody data-role="track-body"></tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        <div class="uba-section">
          <div class="uba-grid">
            <div class="uba-col-5">
              <label for="uba-tmdb-query">TMDB title search (or paste a TMDB URL / tv/123)</label>
              <input id="uba-tmdb-query" type="text" placeholder="Uma Musume · themoviedb.org/tv/12345">
            </div>
            <div class="uba-col-2">
              <label for="uba-search-media-type">API search type</label>
              <select id="uba-search-media-type">
                <option value="multi" selected>Movies and TV</option>
                <option value="tv">TV only</option>
                <option value="movie">Movies only</option>
              </select>
            </div>
            <div class="uba-col-2">
              <label for="uba-tmdb-result-filter">Show results</label>
              <select id="uba-tmdb-result-filter">
                <option value="all" selected>All types</option>
                <option value="tv">TV only</option>
                <option value="movie">Movies only</option>
              </select>
            </div>
            <div class="uba-col-3">
              <div class="uba-buttons">
                <button class="uba-btn uba-btn-primary" type="button" data-action="search-tmdb">Search TMDB</button>
              </div>
            </div>
            <div class="uba-col-12 uba-hidden" data-role="tmdb-selected-wrap">
              <label>Selected title</label>
              <div data-role="tmdb-selected"></div>
            </div>
            <div class="uba-col-12 uba-hidden" data-role="tmdb-results-wrap">
              <label>Search results (click a card to use)</label>
              <div class="uba-tmdb-grid" data-role="tmdb-results-grid"></div>
            </div>
          </div>
          <div class="uba-notice" data-role="tmdb-search-status">Search for a title or pick a result below.</div>
        </div>

        <div class="uba-section uba-grid">
          <div class="uba-col-3">
            <label for="uba-media-type">Target media type</label>
            <select id="uba-media-type">
              <option value="tv">TV</option>
              <option value="movie">Movie</option>
            </select>
          </div>
          <div class="uba-col-3">
            <label for="uba-tmdb-id">TMDB ID</label>
            <input id="uba-tmdb-id" type="number" min="1" step="1" placeholder="37854">
          </div>
          <div class="uba-col-3" data-role="season-mode-wrap">
            <label for="uba-season-mode">Season value</label>
            <select id="uba-season-mode">
              <option value="parsed" selected>Parsed from filename</option>
              <option value="fixed">Fixed value</option>
              <option value="null">Send null</option>
            </select>
          </div>
          <div class="uba-col-3" data-role="fixed-season-wrap">
            <label for="uba-fixed-season">Fixed season</label>
            <input id="uba-fixed-season" type="number" min="0" step="1" value="1">
          </div>
          <div class="uba-col-3" data-role="episode-offset-wrap">
            <label for="uba-episode-offset">Episode offset</label>
            <input id="uba-episode-offset" type="number" value="0" step="1">
          </div>
          <div class="uba-col-12 uba-help" data-role="tv-episode-help-wrap">
            Episode offset is added to each parsed episode before linking. Manual per-track E values in the table override the offset. When only an episode is parsed (no season), season defaults to 1. Fixed season applies to all tracks and overrides per-track S edits.
          </div>
        </div>

        <div class="uba-section">
          <div class="uba-grid">
            <div class="uba-col-12 uba-inline">
              <input id="uba-allow-mixed" type="checkbox">
              <label for="uba-allow-mixed" style="margin:0">Allow selected tracks from multiple parsed title groups</label>
            </div>
            <div class="uba-col-12">
              <div class="uba-buttons">
                <button class="uba-btn uba-btn-success" type="button" data-action="start">Link selected tracks</button>
                <button class="uba-btn uba-btn-danger" type="button" data-action="abort" disabled>Abort</button>
                <button class="uba-btn" type="button" data-action="copy-report">Copy run report</button>
              </div>
            </div>
          </div>
          <div class="uba-notice" data-role="link-status">Ready to link.</div>
          <div class="uba-notice uba-help" data-role="queue-status"></div>
        </div>

        <div class="uba-section">
          <progress data-role="progress" value="0" max="1"></progress>
          <div class="uba-notice" data-role="progress-text" style="margin-top:6px">Idle.</div>
          <div class="uba-log" data-role="log" style="margin-top:8px">Ready.</div>
        </div>
      </div>
      <div class="uba-confirm-backdrop uba-hidden" data-role="confirm-backdrop">
        <div class="uba-confirm" role="dialog" aria-modal="true" aria-labelledby="uba-confirm-title">
          <div class="uba-confirm-title" id="uba-confirm-title" data-role="confirm-title"></div>
          <div class="uba-confirm-body" data-role="confirm-body"></div>
          <div class="uba-confirm-actions">
            <button class="uba-btn" type="button" data-action="confirm-cancel" data-role="confirm-cancel">Cancel</button>
            <button class="uba-btn uba-btn-primary" type="button" data-action="confirm-ok" data-role="confirm-ok">Confirm</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(panel);

    Object.assign(ui, {
      panel,
      routeStatus: panel.querySelector('[data-role="route-status"]'),
      authStatus: panel.querySelector('[data-role="auth-status"]'),
      dataStatus: panel.querySelector('[data-role="data-status"]'),
      treeStatus: panel.querySelector('[data-role="tree-status"]'),
      treeFile: panel.querySelector('#uba-tree-file'),
      clearTree: panel.querySelector('[data-role="clear-tree"]'),
      preset: panel.querySelector('#uba-preset'),
      pattern: panel.querySelector('#uba-pattern'),
      episodeOffset: panel.querySelector('#uba-episode-offset'),
      delay: panel.querySelector('#uba-delay'),
      titleGroup: panel.querySelector('#uba-title-group'),
      filter: panel.querySelector('#uba-filter'),
      statusFilter: panel.querySelector('#uba-status-filter'),
      stripBracket: panel.querySelector('#uba-strip-bracket'),
      autoAdvance: panel.querySelector('#uba-auto-advance'),
      autoSearch: panel.querySelector('#uba-auto-search'),
      renderLimit: panel.querySelector('#uba-render-limit'),
      groupList: panel.querySelector('[data-role="group-list"]'),
      selectionSummary: panel.querySelector('[data-role="selection-summary"]'),
      toggleMatching: panel.querySelector('[data-role="toggle-matching"]'),
      trackBody: panel.querySelector('[data-role="track-body"]'),
      tmdbQuery: panel.querySelector('#uba-tmdb-query'),
      searchMediaType: panel.querySelector('#uba-search-media-type'),
      tmdbResultFilter: panel.querySelector('#uba-tmdb-result-filter'),
      tmdbSearchStatus: panel.querySelector('[data-role="tmdb-search-status"]'),
      tmdbSelectedWrap: panel.querySelector('[data-role="tmdb-selected-wrap"]'),
      tmdbSelected: panel.querySelector('[data-role="tmdb-selected"]'),
      tmdbResultsWrap: panel.querySelector('[data-role="tmdb-results-wrap"]'),
      tmdbResultsGrid: panel.querySelector('[data-role="tmdb-results-grid"]'),
      mediaType: panel.querySelector('#uba-media-type'),
      tmdbId: panel.querySelector('#uba-tmdb-id'),
      seasonMode: panel.querySelector('#uba-season-mode'),
      fixedSeason: panel.querySelector('#uba-fixed-season'),
      seasonModeWrap: panel.querySelector('[data-role="season-mode-wrap"]'),
      fixedSeasonWrap: panel.querySelector('[data-role="fixed-season-wrap"]'),
      episodeOffsetWrap: panel.querySelector('[data-role="episode-offset-wrap"]'),
      tvEpisodeHelpWrap: panel.querySelector('[data-role="tv-episode-help-wrap"]'),
      allowMixed: panel.querySelector('#uba-allow-mixed'),
      linkStatus: panel.querySelector('[data-role="link-status"]'),
      queueStatus: panel.querySelector('[data-role="queue-status"]'),
      progress: panel.querySelector('[data-role="progress"]'),
      progressText: panel.querySelector('[data-role="progress-text"]'),
      log: panel.querySelector('[data-role="log"]'),
      toastStack: panel.querySelector('[data-role="toast-stack"]'),
      confirmBackdrop: panel.querySelector('[data-role="confirm-backdrop"]'),
      confirmTitle: panel.querySelector('[data-role="confirm-title"]'),
      confirmBody: panel.querySelector('[data-role="confirm-body"]'),
      confirmOk: panel.querySelector('[data-role="confirm-ok"]'),
      confirmCancel: panel.querySelector('[data-role="confirm-cancel"]'),
      start: panel.querySelector('[data-action="start"]'),
      abort: panel.querySelector('[data-action="abort"]'),
      resetManualSe: panel.querySelector('[data-action="reset-manual-se"]'),
      remapTmdb: panel.querySelector('[data-action="remap-tmdb"]'),
    });

    loadTmdbCache();

    ui.pattern.value = PRESETS['auto-anime'].patterns.join('\n\nOR\n\n');
    ui.pattern.readOnly = true;

    panel.addEventListener('click', handlePanelClick);
    panel.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && ui.confirmBackdrop && !ui.confirmBackdrop.classList.contains('uba-hidden')) {
        event.preventDefault();
        closeConfirm(false);
      }
    });
    ui.preset.addEventListener('change', applyPreset);
    ui.pattern.addEventListener('input', () => {
      if (!ui.pattern.readOnly) ui.preset.value = 'custom';
    });
    ui.episodeOffset.addEventListener('input', () => {
      renderTrackTable();
      updateSelectionSummary();
    });
    ui.titleGroup.addEventListener('change', () => {
      applyGroupContext();
      renderTrackTable();
      syncGroupListActiveState();
    });
    ui.filter.addEventListener('input', renderTrackTable);
    ui.statusFilter.addEventListener('change', renderTrackTable);
    ui.stripBracket.addEventListener('change', () => {
      state.tracks = state.tracks.map(withGroupKey);
      rebuildTitleGroups();
      refreshTitleGroupSelect();
      renderGroupList();
      renderTrackTable();
    });
    ui.renderLimit.addEventListener('change', renderTrackTable);
    ui.toggleMatching.addEventListener('change', () => selectMatching(ui.toggleMatching.checked));
    ui.mediaType.addEventListener('change', () => {
      state.tmdbDetails = null;
      state.selectedTmdbIndex = -1;
      updateMediaTypeControls();
      updateLinkStatus('TMDB selection cleared — pick a search result or cached title.');
      renderTmdbSelected(null);
      renderTrackTable();
      refreshSeasonCounts();
    });
    ui.tmdbId.addEventListener('change', refreshSeasonCounts);
    ui.tmdbId.addEventListener('input', () => {
      state.tmdbDetails = null;
      state.selectedTmdbIndex = -1;
      updateLinkStatus('TMDB ID changed — pick a search result to confirm the title.');
      renderTmdbSelected(null);
    });
    ui.seasonMode.addEventListener('change', () => {
      if (ui.seasonMode.value !== 'parsed') clearManualSeasonOverrides();
      updateMediaTypeControls();
      renderTrackTable();
    });
    ui.fixedSeason.addEventListener('input', renderTrackTable);

    ui.groupList?.addEventListener('click', (event) => {
      const item = event.target.closest('[data-group-key]');
      if (!item) return;
      ui.titleGroup.value = item.dataset.groupKey;
      applyGroupContext();
      renderTrackTable();
      syncGroupListActiveState();
    });
    ui.treeFile?.addEventListener('change', () => {
      const file = ui.treeFile.files?.[0];
      if (file) loadFolderTreeFile(file);
      ui.treeFile.value = '';
    });
    ui.tmdbQuery.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        searchTmdb();
      }
    });
    ui.tmdbResultFilter?.addEventListener('change', renderTmdbResults);

    makePanelDraggable(panel);
    updateRouteStatus();
    readCsrfToken();
    updateMediaTypeControls();
    renderTrackTable();
    updateQueueStatus();
    updateTreeStatus();

    if (isTargetRoute() && !state.loadedEndpoint && !state.loading) {
      setTimeout(loadUnlinkedTracks, 500);
    }
  }

  function makePanelDraggable(panel) {
    const header = panel.querySelector('.uba-header');
    let active = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;

    header.addEventListener('pointerdown', (event) => {
      if (event.target.closest('button')) return;
      active = true;
      startX = event.clientX;
      startY = event.clientY;
      const rect = panel.getBoundingClientRect();
      startLeft = rect.left;
      startTop = rect.top;
      panel.style.right = 'auto';
      header.setPointerCapture(event.pointerId);
    });

    header.addEventListener('pointermove', (event) => {
      if (!active) return;
      const nextLeft = Math.max(0, Math.min(window.innerWidth - panel.offsetWidth, startLeft + event.clientX - startX));
      const nextTop = Math.max(0, Math.min(window.innerHeight - 40, startTop + event.clientY - startY));
      panel.style.left = `${nextLeft}px`;
      panel.style.top = `${nextTop}px`;
    });

    header.addEventListener('pointerup', () => {
      active = false;
    });
  }

  function handlePanelClick(event) {
    if (event.target === ui.confirmBackdrop) {
      closeConfirm(false);
      return;
    }

    const tmdbPick = event.target.closest('[data-tmdb-index]');
    if (tmdbPick) {
      chooseTmdbResult(Number.parseInt(tmdbPick.dataset.tmdbIndex, 10));
      return;
    }

    const button = event.target.closest('[data-action]');
    if (!button) return;
    const action = button.dataset.action;

    if (action === 'collapse') {
      const collapsed = ui.panel.dataset.collapsed === 'true';
      ui.panel.dataset.collapsed = String(!collapsed);
      button.textContent = collapsed ? '−' : '+';
      return;
    }
    if (action === 'close') {
      ui.panel.remove();
      return;
    }
    if (action === 'confirm-ok') {
      closeConfirm(true);
      return;
    }
    if (action === 'confirm-cancel') {
      closeConfirm(false);
      return;
    }
    if (state.running && ['load-api', 'reparse', 'load-tree', 'clear-tree'].includes(action)) return;

    const actions = {
      'load-api': loadUnlinkedTracks,
      reparse: reparseTracks,
      'load-tree': () => ui.treeFile?.click(),
      'clear-tree': clearFolderTree,
      'prev-group': () => navigateGroup(-1),
      'next-group': () => navigateGroup(1),
      'select-group-pending': selectGroupPending,
      'select-matching': () => selectMatching(true),
      'deselect-matching': () => selectMatching(false),
      'select-none': selectNone,
      'select-failed': selectFailed,
      'reset-manual-se': resetManualOverrides,
      'remap-tmdb': remapToTmdbNumbering,
      'search-tmdb': searchTmdb,
      start: startBulkLink,
      abort: abortBulkLink,
      'copy-report': copyReport,
    };

    Promise.resolve(actions[action]?.()).catch((error) => {
      const message = formatError(error);
      log(`Unexpected error: ${message}`, 'error');
      showToast(message, { kind: 'error' });
      console.error('[Ukrab Bulk Assistant]', error);
    });
  }

  function applyPreset() {
    const preset = PRESETS[ui.preset.value];
    if (preset) {
      ui.pattern.readOnly = true;
      ui.pattern.value = preset.patterns.join('\n\nOR\n\n');
      reparseTracks();
      return;
    }

    ui.pattern.readOnly = false;
    if (!ui.pattern.value || ui.pattern.value.includes('\n\nOR\n\n')) {
      ui.pattern.value = PRESETS['dash-episode'].patterns[0];
    }
  }

  function getActivePatternSources() {
    const preset = PRESETS[ui.preset.value];
    return preset?.patterns ?? [ui.pattern.value];
  }

  function applyDefaultSeasonWhenEpisodeOnly(season, episode, { skipDefault = false } = {}) {
    if (skipDefault || Number.isInteger(season)) return season;
    return Number.isInteger(episode) ? DEFAULT_SEASON_WHEN_EPISODE_ONLY : null;
  }

  let compiledPatterns = { key: null, regexes: [] };

  function compilePatterns() {
    const sources = getActivePatternSources();
    const key = sources.join('\n');
    if (compiledPatterns.key === key) return compiledPatterns.regexes;
    try {
      compiledPatterns = { key, regexes: sources.map((pattern) => new RegExp(pattern, 'i')) };
    } catch (error) {
      throw new Error(`Invalid filename regex: ${error.message}`);
    }
    return compiledPatterns.regexes;
  }

  function normaliseParsedTitle(value) {
    let title = String(value ?? '')
      .normalize('NFC')
      .trim()
      .replace(/[._]+/g, ' ')
      .replace(/,(?=[^\s\d])/g, ', ')
      .replace(/\s+/g, ' ')
      .trim();

    let previous = null;
    while (previous !== title) {
      previous = title;
      title = title
        .replace(/\s*\[[^\]]*\]\s*$/g, '')
        .replace(/\s+(?:\d+x)?(?:UKR|UA|Ukr|ENG|RUS|DVO|MVO|SUB\+?)(?:\s+(?:DVO|MVO|SUB\+?|UKR|UA|Ukr|ENG|RUS))*\s*$/i, '')
        .replace(
          /\s*\([^)]*(?:WEB-?DL(?:Rip)?|WEBDL|BDRip|BluRay|HDTV|DVDRip|TVRip|SATRip|IPTV|x264|x265|HEVC|AAC|DTS|1080p|720p|2160p|480p|2k|4k|Ukr|UKR|UA|DVO|SUB|Multi)[^)]*\)\s*$/i,
          '',
        )
        .replace(
          /\s+(?:WEB-?DL(?:Rip)?|WEBDL|BDRip|BDRemux|Remux|Blu-?Ray|HDTV|DVDRip|TVRip|SATRip(?:-AVC)?|IPTVRip(?:-AVC)?|x264|x265|HEVC|AAC|DTS|\d{3,4}p|2k|4k)\b.*$/i,
          '',
        )
        // Case-sensitive: short tags like MA/NF would otherwise eat real words.
        .replace(/\s+(?:NORDiC|HYBRID|REPACK|PROPER|REMASTERED|UNCUT|UNRATED|IMAX|AMZN|ATVP|DSNP|HMAX|NF|MA)$/, '')
        .replace(/\s+(?:Kioto anime|СКО|Юіґень)$/i, '')
        .replace(/\s+by\s+\S+\s*$/i, '')
        .replace(/\s*\([^)]*$/g, '')
        .replace(/\s*[-–—.:|,;]+$/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    }

    return title;
  }

  function stripBracketPrefix(value) {
    return String(value ?? '')
      .replace(/^(\[[^\]]+\]\s*)+/g, '')
      .trim();
  }

  function shouldStripBracket() {
    return ui.stripBracket?.checked ?? true;
  }

  function getDisplayTitle(rawTitle) {
    let title = String(rawTitle ?? '').trim();
    if (!title) return '';
    if (shouldStripBracket()) title = stripBracketPrefix(title);
    return normaliseParsedTitle(title);
  }

  function foldTitle(value) {
    return String(value ?? '')
      .normalize('NFC')
      .toLocaleLowerCase()
      .replace(/['ʼ’`´]/g, '')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
  }

  // TV groups by title only (release years differ per season); movies need the year to tell remakes apart.
  function computeGroupKey(track) {
    const folded = foldTitle(track.displayTitle);
    if (!folded) return UNPARSED_GROUP;
    return !Number.isInteger(track.episode) && track.year ? `${folded} ${track.year}` : folded;
  }

  function withGroupKey(track) {
    const next = { ...track, displayTitle: getDisplayTitle(track.title) };
    next.groupKey = computeGroupKey(next);
    return next;
  }

  function getTrackGroupKey(track) {
    return track.groupKey || UNPARSED_GROUP;
  }

  function getGroupMeta(groupKey) {
    return state.groupMeta.get(groupKey) || { label: groupKey, searchTitle: '', year: null, mediaType: '' };
  }

  function getGroupLabel(groupKey) {
    if (!groupKey) return 'mixed titles';
    return groupKey === UNPARSED_GROUP ? 'Unparsed' : getGroupMeta(groupKey).label || groupKey;
  }

  function extractBracketTag(filename) {
    const match = String(filename ?? '').match(/^\[(?<tag>[^\]]+)\]/);
    return match?.groups?.tag?.trim() || '';
  }

  function loadTmdbCache() {
    try {
      const raw = pageWindow.localStorage?.getItem(TMDB_CACHE_KEY);
      state.tmdbCache = raw ? JSON.parse(raw) : {};
    } catch {
      state.tmdbCache = {};
    }
  }

  function saveTmdbCache() {
    try {
      pageWindow.localStorage?.setItem(TMDB_CACHE_KEY, JSON.stringify(state.tmdbCache));
    } catch (error) {
      console.debug('[Ukrab Bulk Assistant] Could not save TMDB cache:', error);
    }
  }

  function cacheTmdbForTitle(titleKey, mediaType, tmdbId, label = '') {
    if (!titleKey || titleKey === UNPARSED_GROUP) return;
    state.tmdbCache[titleKey] = {
      mediaType,
      tmdbId,
      label: label || `${mediaType} ${tmdbId}`,
      updatedAt: new Date().toISOString(),
    };
    saveTmdbCache();
  }

  function getCachedTmdb(groupKey) {
    if (!groupKey || groupKey === UNPARSED_GROUP) return null;
    // Entries saved before v0.6 are keyed by the display title.
    return state.tmdbCache[groupKey] || state.tmdbCache[getGroupMeta(groupKey).searchTitle] || null;
  }

  function isTrackLinked(trackId) {
    return state.statuses.get(trackId)?.state === 'success';
  }

  function isTrackFailed(trackId) {
    return state.statuses.get(trackId)?.state === 'error';
  }

  function isTrackPending(trackId) {
    const status = state.statuses.get(trackId);
    return !status || status.state !== 'success';
  }

  function matchesStatusFilter(track) {
    const filter = ui.statusFilter?.value || 'pending';
    if (filter === 'all') return true;
    if (filter === 'linked') return isTrackLinked(track.id);
    if (filter === 'failed') return isTrackFailed(track.id);
    return isTrackPending(track.id);
  }

  function getGroupStats(groupKey) {
    if (state.groupStatsCache.has(groupKey)) return state.groupStatsCache.get(groupKey);

    const trackIds = state.groupTrackIds.get(groupKey) || [];
    let linked = 0;
    let failed = 0;
    let running = 0;
    for (const id of trackIds) {
      const trackState = state.statuses.get(id)?.state;
      if (trackState === 'success') linked += 1;
      else if (trackState === 'error') failed += 1;
      else if (trackState === 'running') running += 1;
    }
    const stats = {
      total: trackIds.length,
      linked,
      failed,
      running,
      pending: trackIds.length - linked,
    };
    state.groupStatsCache.set(groupKey, stats);
    return stats;
  }

  function invalidateGroupStats(groupKey = '') {
    if (groupKey) state.groupStatsCache.delete(groupKey);
    else state.groupStatsCache.clear();
  }

  function getGroupWorkState(groupKey) {
    if (!groupKey) return 'untouched';
    if (state.running && state.lastRun?.groupKey === groupKey) return 'running';
    if (state.linkQueue.some((job) => job.groupKey === groupKey)) return 'queued';
    const stats = getGroupStats(groupKey);
    if (stats.total > 0 && stats.pending === 0) return 'done';
    if (stats.linked > 0 || stats.failed > 0) return 'partial';
    if (getCachedTmdb(groupKey)) return 'ready';
    return 'untouched';
  }

  function formatGroupWorkStateLabel(workState) {
    switch (workState) {
      case 'running':
        return 'Linking';
      case 'queued':
        return 'Queued';
      case 'done':
        return 'Done';
      case 'partial':
        return 'Started';
      case 'ready':
        return 'Ready';
      default:
        return 'New';
    }
  }

  function formatGroupWorkStateTitle(workState) {
    switch (workState) {
      case 'running':
        return 'This group is currently being linked.';
      case 'queued':
        return 'Waiting in the link queue.';
      case 'ready':
        return 'TMDB title selected; ready to link.';
      case 'untouched':
        return 'No TMDB match yet; not linked.';
      case 'partial':
        return 'Some tracks linked; more remain.';
      case 'done':
        return 'All tracks in this group are linked.';
      default:
        return '';
    }
  }

  function formatGroupBadge(stats) {
    const parts = [];
    if (stats.running > 0) parts.push(`${stats.running} linking`);
    const awaiting = Math.max(0, stats.pending - stats.running - stats.failed);
    if (awaiting > 0) parts.push(`${awaiting} pending`);
    else if (stats.pending > 0 && stats.running === 0) parts.push(`${stats.pending} pending`);
    if (stats.linked > 0) parts.push(`${stats.linked} linked`);
    if (stats.failed > 0) parts.push(`${stats.failed} failed`);
    return parts.join(' · ');
  }

  function formatTitleGroupOptionLabel(groupKey) {
    const count = state.titleGroups.get(groupKey) || 0;
    const stats = getGroupStats(groupKey);
    const treeMark = state.groupFromTree?.has(groupKey) ? ' · tree' : '';
    const stateMark = `[${formatGroupWorkStateLabel(getGroupWorkState(groupKey))}] `;
    return `${stateMark}${getGroupLabel(groupKey)}${treeMark} (${formatGroupBadge(stats)} / ${count.toLocaleString()})`;
  }

  function ensureGroupListItem(groupKey) {
    let item = ui.groupList.querySelector(`[data-group-key="${CSS.escape(groupKey)}"]`);
    if (!item) {
      item = document.createElement('div');
      item.className = 'uba-group-item';
      item.dataset.groupKey = groupKey;
      item.innerHTML = `
        <span class="uba-group-label"></span>
        <span class="uba-group-meta">
          <span class="uba-group-state"></span>
          <span class="uba-badge"></span>
        </span>
      `;
      ui.groupList.appendChild(item);
    }
    return item;
  }

  function applyGroupListItemState(item, groupKey) {
    const count = state.titleGroups.get(groupKey) || 0;
    const stats = getGroupStats(groupKey);
    const active = ui.titleGroup?.value || '';
    const workState = getGroupWorkState(groupKey);
    const label = getGroupLabel(groupKey);
    const done = stats.pending === 0 && stats.total > 0;

    item.dataset.active = String(groupKey === active);
    item.dataset.done = String(done);
    item.dataset.tree = String(state.groupFromTree?.has(groupKey) || false);
    item.dataset.workState = workState;

    const labelEl = item.querySelector('.uba-group-label');
    if (labelEl) labelEl.textContent = label;

    const stateEl = item.querySelector('.uba-group-state');
    if (stateEl) {
      stateEl.textContent = formatGroupWorkStateLabel(workState);
      stateEl.title = formatGroupWorkStateTitle(workState);
    }

    const badgeEl = item.querySelector('.uba-badge');
    if (badgeEl) badgeEl.textContent = `${formatGroupBadge(stats)} / ${count.toLocaleString()}`;
  }

  function updateGroupListItem(groupKey) {
    if (!ui.groupList || !groupKey) return;
    applyGroupListItemState(ensureGroupListItem(groupKey), groupKey);
  }

  function syncGroupListActiveState() {
    if (!ui.groupList) return;
    const active = ui.titleGroup?.value || '';
    for (const item of ui.groupList.querySelectorAll('[data-group-key]')) {
      item.dataset.active = String(item.dataset.groupKey === active);
    }
  }

  function ensureTitleGroupOption(groupKey) {
    let option = [...ui.titleGroup.options].find((opt) => opt.value === groupKey);
    if (!option) {
      option = document.createElement('option');
      option.value = groupKey;
      ui.titleGroup.appendChild(option);
    }
    return option;
  }

  function updateTitleGroupOption(groupKey) {
    if (!ui.titleGroup || !groupKey) return;
    const option = ensureTitleGroupOption(groupKey);
    const workState = getGroupWorkState(groupKey);
    option.textContent = formatTitleGroupOptionLabel(groupKey);
    option.dataset.workState = workState;
    option.title = formatGroupWorkStateTitle(workState);
  }

  function refreshGroupWorkStates(groupKeys = []) {
    const keys = groupKeys.length ? [...new Set(groupKeys.filter(Boolean))] : [...state.titleGroups.keys()];
    for (const key of keys) {
      updateGroupListItem(key);
      updateTitleGroupOption(key);
    }
  }

  function refreshGroupUi(options = {}) {
    if (options.rebuild) rebuildTitleGroups();
    refreshTitleGroupSelect();
    renderGroupList();
  }

  function notifyGroupProgress(groupKey) {
    if (!groupKey) return;
    invalidateGroupStats(groupKey);
    updateGroupListItem(groupKey);
    updateTitleGroupOption(groupKey);
  }

  function formatJobGroupLabel(groupKey) {
    return getGroupLabel(groupKey);
  }

  function formatJobSettingsSummary(job) {
    const settings = { ...job.settings, mediaType: job.mediaType };
    const parts = [`${job.mediaType}`, `TMDB ${job.tmdbId}`, `${job.trackIds.length} track(s)`];

    if (job.mediaType === 'tv') {
      if (settings.seasonMode === 'fixed') {
        parts.push(`fixed season ${settings.fixedSeason}`);
      } else if (settings.seasonMode === 'parsed') {
        parts.push('season from filename');
      } else {
        parts.push('season null');
      }

      const offset = getEpisodeOffset(settings);
      if (offset !== 0) parts.push(`episode offset ${offset > 0 ? '+' : ''}${offset}`);
      else parts.push('episode from filename');
    }

    return parts.join(' · ');
  }

  function clearJobSelection(job) {
    for (const id of job.trackIds) state.selectedIds.delete(id);
    renderTrackTable();
  }

  function getTrackStatusLabel(trackId) {
    const status = state.statuses.get(trackId);
    if (status?.state === 'success') return '✓';
    if (status?.state === 'error') return '✗';
    if (status?.state === 'running') return '…';
    return '—';
  }

  function updateTrackRowStatus(trackId) {
    if (!ui.trackBody) return false;
    const row = ui.trackBody.querySelector(`tr[data-track-id="${CSS.escape(trackId)}"]`);
    if (!row) return false;

    const status = state.statuses.get(trackId);
    row.dataset.status = status?.state || '';

    const statusCell = row.children[5];
    if (statusCell) statusCell.textContent = getTrackStatusLabel(trackId);

    const checkbox = row.querySelector('[data-track-checkbox]');
    if (checkbox) {
      checkbox.checked = state.selectedIds.has(trackId);
    }

    return true;
  }

  function applyGroupContext() {
    const groupKey = getSelectedGroupKey();
    const meta = getGroupMeta(groupKey);
    if (groupKey) {
      ui.tmdbQuery.value = meta.searchTitle;
      state.tmdbResults = [];
      state.selectedTmdbIndex = -1;
      renderTmdbResults();
    }

    const cached = getCachedTmdb(groupKey);
    if (cached) {
      ui.mediaType.value = cached.mediaType;
      ui.tmdbId.value = String(cached.tmdbId);
      state.tmdbDetails = {
        mediaType: cached.mediaType,
        tmdbId: cached.tmdbId,
        details: null,
        source: 'cache',
      };
      updateLinkStatus(`Cached TMDB: ${cached.label}`, 'ok');
      updateMediaTypeControls();
      renderTmdbSelected({
        id: cached.tmdbId,
        mediaType: cached.mediaType,
        title: cached.label,
      });
      refreshSeasonCounts();
      return;
    }

    state.tmdbDetails = null;
    state.selectedTmdbIndex = -1;
    ui.tmdbId.value = '';
    if (groupKey && meta.mediaType) ui.mediaType.value = meta.mediaType;
    updateMediaTypeControls();
    renderTmdbSelected(null);
    refreshSeasonCounts();
    updateLinkStatus(groupKey ? 'Search TMDB and pick a result for this group.' : 'Select a title group to begin.');
    if (groupKey && meta.searchTitle && ui.autoSearch?.checked) searchTmdb();
  }

  function selectCurrentGroupTracks(options = {}) {
    const { silent = false } = options;
    const group = ui.titleGroup?.value || '';
    if (!group) {
      if (!silent) {
        const message = 'Select a title group first.';
        updateLinkStatus(message, 'error');
        showToast(message, { kind: 'warning' });
      }
      return false;
    }
    state.selectedIds.clear();
    for (const track of state.tracks) {
      if (getTrackGroupKey(track) !== group) continue;
      if (!isTrackPending(track.id)) continue;
      state.selectedIds.add(track.id);
    }
    renderTrackTable();
    if (!silent) log(`Selected pending tracks in group “${getGroupLabel(group)}”.`);
    return true;
  }

  function selectGroupPending() {
    selectCurrentGroupTracks();
  }

  function navigateGroup(delta) {
    const keys = state.groupOrder;
    if (!keys.length) return;
    const current = ui.titleGroup?.value || '';
    let index = keys.indexOf(current);
    if (index < 0) index = delta > 0 ? -1 : keys.length;
    const nextIndex = Math.max(0, Math.min(keys.length - 1, index + delta));
    ui.titleGroup.value = keys[nextIndex];
    applyGroupContext();
    renderTrackTable();
    syncGroupListActiveState();
  }

  function findNextReadyGroup(startKey = '') {
    const keys = state.groupOrder;
    const startIndex = startKey ? keys.indexOf(startKey) + 1 : 0;
    for (let index = startIndex; index < keys.length; index += 1) {
      const key = keys[index];
      if (key === UNPARSED_GROUP) continue;
      if (getGroupStats(key).pending > 0 && getCachedTmdb(key)) return key;
    }
    return '';
  }

  function advanceToNextReadyGroup(currentKey, autoStart = false) {
    const nextKey = findNextReadyGroup(currentKey);
    if (!nextKey) {
      log('No more groups with cached TMDB and pending tracks.');
      return false;
    }
    ui.titleGroup.value = nextKey;
    applyGroupContext();
    selectGroupPending();
    syncGroupListActiveState();
    renderTrackTable();
    log(`Advanced to ready group: “${getGroupLabel(nextKey)}”.`);
    if (autoStart) setTimeout(() => startBulkLink({ skipConfirm: true }), 0);
    return true;
  }

  function snapshotLinkSettings() {
    return {
      seasonMode: ui.seasonMode.value,
      fixedSeason: ui.fixedSeason.value,
      episodeOffset: getEpisodeOffset(),
    };
  }

  function buildLinkJob(selected, mediaType, tmdbId) {
    const groupKeys = [...new Set(selected.map(getTrackGroupKey))];
    return {
      groupKey: ui.titleGroup?.value || (groupKeys.length === 1 ? groupKeys[0] : ''),
      trackIds: selected.map((track) => track.id),
      mediaType,
      tmdbId,
      groupKeys,
      settings: snapshotLinkSettings(),
    };
  }

  function getTracksForJob(job) {
    const idSet = new Set(job.trackIds);
    return state.tracks.filter((track) => idSet.has(track.id));
  }

  function updateQueueStatus() {
    if (!ui.queueStatus) return;
    if (!state.linkQueue.length) {
      ui.queueStatus.innerHTML = '';
      ui.queueStatus.className = 'uba-notice uba-help';
    } else {
      const items = state.linkQueue
        .map((job, index) => {
          const title = escapeHtml(formatJobGroupLabel(job.groupKey));
          const details = escapeHtml(formatJobSettingsSummary(job));
          return `<li><strong>${index + 1}. ${title}</strong><div class="uba-queue-meta">${details}</div></li>`;
        })
        .join('');

      ui.queueStatus.innerHTML = `<div><strong>Queued (${state.linkQueue.length})</strong></div><ol class="uba-queue-list">${items}</ol>`;
      ui.queueStatus.className = 'uba-notice';
    }

    const workStateKeys = [
      ...(state.running && state.lastRun?.groupKey ? [state.lastRun.groupKey] : []),
      ...state.linkQueue.map((job) => job.groupKey),
    ].filter(Boolean);
    if (workStateKeys.length) refreshGroupWorkStates(workStateKeys);
  }

  function ingestTrackPayload(payload, sourceLabel = 'API') {
    const normalised = normaliseApiTracks(payload);
    const existingIds = new Set(normalised.tracks.map((track) => track.id));

    state.tracks = normalised.tracks;
    state.selectedIds = new Set([...state.selectedIds].filter((id) => existingIds.has(id)));
    state.statuses = new Map([...state.statuses].filter(([id]) => existingIds.has(id)));
    state.manualOverrides = new Map([...state.manualOverrides].filter(([id]) => existingIds.has(id)));

    rebuildTitleGroups();
    refreshTitleGroupSelect();
    renderGroupList();
    renderTrackTable();
    updateTreeStatus();
    updateDataStatus(
      `Loaded ${state.tracks.length.toLocaleString()} unique track(s) from ${normalised.groupCount.toLocaleString()} group(s) via ${sourceLabel}` +
        (normalised.declaredTrackCount && normalised.declaredTrackCount !== state.tracks.length
          ? `; API-declared count ${normalised.declaredTrackCount.toLocaleString()}.`
          : '.') +
        (state.folderTree
          ? ` Tree-enriched ${countTreeEnriched().toLocaleString()}.`
          : ''),
      'ok',
    );
    log(`Loaded ${state.tracks.length.toLocaleString()} track(s) from ${sourceLabel}.`);
  }

  function fileStem(filename) {
    const base = String(filename ?? '').split(/[/\\]/).pop() || '';
    const dot = base.lastIndexOf('.');
    return dot > 0 ? base.slice(0, dot) : base;
  }

  function audioStemFromFilename(filename) {
    return fileStem(filename).replace(TRACK_SUFFIX_RE, '');
  }

  function normaliseTreeKey(value) {
    return String(value ?? '')
      .toLocaleLowerCase()
      .replace(/[._]+/g, ' ')
      .replace(/[^a-z0-9а-яіїєґ]+/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function cleanFolderShowTitle(name) {
    let title = stripBracketPrefix(String(name ?? '').replace(/[._]+/g, ' '));
    let season = null;

    const seasonBracket = title.match(TREE_SEASON_BRACKET_RE);
    if (seasonBracket?.groups?.season) {
      const parsed = Number.parseInt(seasonBracket.groups.season, 10);
      if (Number.isInteger(parsed)) season = parsed;
      title = title.replace(TREE_SEASON_BRACKET_RE, ' ').trim();
    }

    // Ranges first — "(Season 1-10)" must not become season=1.
    if (TREE_SEASON_RANGE_PAREN_RE.test(title)) {
      title = title.replace(TREE_SEASON_RANGE_PAREN_RE, ' ').trim();
    } else {
      const seasonParen = title.match(TREE_SEASON_PAREN_RE);
      if (seasonParen?.groups?.season) {
        const parsed = Number.parseInt(seasonParen.groups.season, 10);
        if (Number.isInteger(parsed) && season == null) season = parsed;
        title = title.replace(TREE_SEASON_PAREN_RE, ' ').trim();
      }
    }

    const embed = title.match(TREE_SEASON_EMBED_RE);
    if (embed?.groups) {
      title = String(embed.groups.title || '').trim();
      const parsed = Number.parseInt(embed.groups.season, 10);
      if (Number.isInteger(parsed) && season == null) season = parsed;
    }

    if (season == null) {
      const sxx = title.match(TREE_SXX_IN_FOLDER_RE);
      if (sxx?.groups?.title) {
        title = String(sxx.groups.title || '').trim();
        const parsed = Number.parseInt(sxx.groups.season, 10);
        if (Number.isInteger(parsed)) season = parsed;
      }
    }

    title = title.replace(TREE_RELEASE_DASH_RE, '').trim();

    let previous = null;
    while (previous !== title) {
      previous = title;
      title = title.replace(TREE_QUALITY_TAIL_RE, '').trim();
      title = title.replace(/\s*\[[^\]]*\]\s*$/g, '').trim();
      title = title.replace(/\s*\([^)]*(?:WEB|BDRip|Blu|HDTV|DVD|SAT|IPTV|Rip|1080|720|Ukr|UKR|Hurtom|Sub)[^)]*\)\s*$/i, '').trim();
      title = title.replace(/\s+by\s+\S+\s*$/i, '').trim();
      title = title.replace(/\s*\(\d{4}(?:\s*[-–—]\s*\d{4})?\)\s*/g, ' ').trim();
      title = title.replace(/\s+\d{4}\s*[-–—]\s*\d{4}\s*$/g, '').trim();
      title = title.replace(/\s+(?:Specials?|Extras?|Bonus)\b/gi, ' ').trim();
      title = title.replace(/\s+(?:Season|Сезон)\s*$/i, '').trim();
      title = title.replace(/\s*[-–—.:|,;]+$/g, '').trim();
      title = title.replace(/\s+/g, ' ').trim();
    }

    // Year before Sxx/Season in release folders ("Show 2026 1080p S03") — keep bare "DuckTales 1989".
    if (season != null) {
      title = title.replace(/\s+\d{4}\s*$/g, '').trim();
    }

    title = normaliseParsedTitle(title);
    if (/^(?:specials?|extras?|bonuses?|ovas?|onas?)$/i.test(title)) title = '';
    return { title, season };
  }

  function parseMediaCodesFromName(name) {
    const value = fileStem(name);
    const absoluteEpisodePattern = TREE_FILE_CODE_PATTERNS[TREE_FILE_CODE_PATTERNS.length - 1];
    for (const pattern of TREE_FILE_CODE_PATTERNS) {
      const match = value.match(pattern);
      if (!match?.groups) continue;
      const seasonRaw = match.groups.season;
      const episodeRaw = match.groups.episode;
      const season = seasonRaw == null || seasonRaw === '' ? null : Number.parseInt(seasonRaw, 10);
      const episode = episodeRaw == null || episodeRaw === '' ? null : Number.parseInt(episodeRaw, 10);
      if (!Number.isInteger(episode)) continue;
      return {
        season: applyDefaultSeasonWhenEpisodeOnly(
          Number.isInteger(season) ? season : null,
          episode,
          { skipDefault: pattern === absoluteEpisodePattern },
        ),
        episode,
      };
    }
    return { season: null, episode: null };
  }

  function resolveTitleFromPathParts(parts) {
    const dirs = parts.slice(0, -1).filter((part) => part && !TREE_NOISE_DIR_RE.test(part));
    let seasonFromDir = null;
    let title = '';

    for (let index = dirs.length - 1; index >= 0; index -= 1) {
      const dir = dirs[index];
      if (TREE_SKIP_DIR_RE.test(dir.trim())) continue;

      const seasonMatch = dir.trim().match(TREE_SEASON_DIR_RE);
      if (seasonMatch) {
        for (const group of seasonMatch.slice(1)) {
          if (group == null) continue;
          const parsed = Number.parseInt(group, 10);
          if (Number.isInteger(parsed)) {
            seasonFromDir = parsed;
            break;
          }
        }
        continue;
      }

      const cleaned = cleanFolderShowTitle(dir);
      if (cleaned.season != null && seasonFromDir == null) seasonFromDir = cleaned.season;
      if (cleaned.title) {
        title = cleaned.title;
        break;
      }
    }

    return { title, season: seasonFromDir };
  }

  function collectTreeFiles(payload) {
    if (Array.isArray(payload?.files)) {
      return payload.files.filter((file) => file && (file.name || file.rel_path));
    }

    const files = [];
    function walk(node, parts = []) {
      if (!node || typeof node !== 'object') return;
      const name = node.name || parts[parts.length - 1] || '';
      const nextParts = node.rel_path && node.rel_path !== '.'
        ? String(node.rel_path).split('/').filter(Boolean)
        : name
          ? [...parts, name]
          : parts;

      if (node.type === 'file' || (!node.children && name)) {
        files.push({
          name: name || nextParts[nextParts.length - 1] || '',
          rel_path: node.rel_path || nextParts.join('/'),
          parts: nextParts,
          ext: node.ext || '',
        });
        return;
      }

      for (const child of node.children || []) walk(child, nextParts);
    }

    if (payload?.tree) walk(payload.tree);
    return files;
  }

  function buildFolderTreeIndex(payload) {
    const byExact = new Map();
    const byNorm = new Map();
    const files = collectTreeFiles(payload);

    const push = (map, key, entry) => {
      if (!key) return;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(entry);
    };

    for (const file of files) {
      const name = String(file.name || file.rel_path?.split('/').pop() || '');
      const parts = Array.isArray(file.parts) && file.parts.length
        ? file.parts.map(String)
        : String(file.rel_path || name).split('/').filter(Boolean);
      const resolved = resolveTitleFromPathParts(parts);
      const codes = parseMediaCodesFromName(name);
      const stem = fileStem(name);
      const entry = {
        name,
        relPath: parts.join('/'),
        title: resolved.title,
        season: Number.isInteger(resolved.season) ? resolved.season : codes.season,
        episode: codes.episode,
      };
      push(byExact, stem.toLocaleLowerCase(), entry);
      push(byNorm, normaliseTreeKey(stem), entry);
    }

    return {
      root: String(payload?.root || ''),
      rootName: String(payload?.root_name || ''),
      fileCount: files.length,
      byExact,
      byNorm,
    };
  }

  function pickTreeHit(hits) {
    if (!hits?.length) return null;
    const titled = hits.filter((hit) => hit.title);
    const pool = titled.length ? titled : hits;
    const titles = new Set(pool.map((hit) => hit.title).filter(Boolean));
    if (titles.size > 1) {
      // Prefer the most common resolved title among duplicates
      const counts = new Map();
      for (const hit of pool) {
        if (!hit.title) continue;
        counts.set(hit.title, (counts.get(hit.title) || 0) + 1);
      }
      let best = '';
      let bestCount = 0;
      for (const [title, count] of counts) {
        if (count > bestCount) {
          best = title;
          bestCount = count;
        }
      }
      return pool.find((hit) => hit.title === best) || null;
    }
    return pool[0];
  }

  function lookupTreeFile(filename) {
    if (!state.folderTree) return null;
    const stem = audioStemFromFilename(filename);
    const exact = state.folderTree.byExact.get(stem.toLocaleLowerCase());
    const hit = pickTreeHit(exact);
    if (hit) return hit;
    return pickTreeHit(state.folderTree.byNorm.get(normaliseTreeKey(stem)));
  }

  function enrichTrackFromTree(track) {
    const base = {
      ...track,
      titleSource: track.titleSource || 'filename',
      seasonSource: track.seasonSource || 'filename',
      episodeSource: track.episodeSource || 'filename',
      treeMatch: null,
    };

    if (!state.folderTree) return base;

    const hit = lookupTreeFile(track.filename);
    if (!hit) return base;

    const next = {
      ...base,
      treeMatch: {
        relPath: hit.relPath,
        title: hit.title,
        season: hit.season,
        episode: hit.episode,
      },
    };

    // Tree path is authoritative when a video file match exists.
    if (hit.title) {
      next.title = hit.title;
      next.titleSource = 'tree';
      next.parseError = '';
    }

    if (Number.isInteger(hit.season)) {
      next.season = hit.season;
      next.seasonSource = 'tree';
    }

    if (Number.isInteger(hit.episode)) {
      next.episode = hit.episode;
      next.episodeSource = 'tree';
    }

    return next;
  }

  const TRACK_BASE_FIELDS = ['id', 'filename', 'displayName', 'type', 'language', 'createdAt', 'uploader', 'apiGroupKey'];

  function buildTrack(source) {
    const base = Object.fromEntries(TRACK_BASE_FIELDS.map((field) => [field, source[field] ?? null]));
    return withGroupKey(enrichTrackFromTree({ ...base, ...parseFilename(base.filename) }));
  }

  function rebuildTracks() {
    compilePatterns();
    state.tracks = state.tracks.map(buildTrack);
    rebuildTitleGroups();
    refreshTitleGroupSelect();
    renderGroupList();
    renderTrackTable();
  }

  function countTreeEnriched(tracks = state.tracks) {
    return tracks.reduce(
      (total, track) =>
        total + (track.titleSource === 'tree' || track.seasonSource === 'tree' || track.episodeSource === 'tree' ? 1 : 0),
      0,
    );
  }

  function updateTreeStatus(message = '', kind = '') {
    if (!ui.treeStatus) return;
    if (!message) {
      if (!state.folderTree) {
        ui.treeStatus.textContent = 'No folder tree loaded.';
        ui.treeStatus.dataset.kind = '';
      } else {
        const enriched = countTreeEnriched();
        const loaded = state.tracks.length;
        ui.treeStatus.textContent =
          `Tree ready: ${state.folderTree.fileCount.toLocaleString()} file(s)` +
          (state.folderTree.rootName ? ` from “${state.folderTree.rootName}”` : '') +
          (loaded
            ? ` · enriched ${enriched.toLocaleString()} / ${loaded.toLocaleString()} loaded track(s).`
            : '. Load unlinked tracks to apply.');
        ui.treeStatus.dataset.kind = 'ok';
      }
      return;
    }
    ui.treeStatus.textContent = message;
    ui.treeStatus.dataset.kind = kind;
  }

  function refreshAfterTreeChange() {
    if (state.tracks.length) rebuildTracks();
    if (ui.clearTree) ui.clearTree.disabled = !state.folderTree;
    updateTreeStatus();
  }

  function clearFolderTree() {
    state.folderTree = null;
    refreshAfterTreeChange();
    log('Cleared folder tree JSON.');
  }

  async function loadFolderTreeFile(file) {
    updateTreeStatus(`Reading ${file.name}…`);
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      const index = buildFolderTreeIndex(payload);
      if (!index.fileCount) throw new Error('JSON has no files (expected export_folder_tree.py output).');
      state.folderTree = index;
      refreshAfterTreeChange();
      log(`Loaded folder tree “${file.name}”: ${index.fileCount.toLocaleString()} file(s), enriched ${countTreeEnriched().toLocaleString()} track(s).`);
    } catch (error) {
      const message = formatError(error);
      updateTreeStatus(`Tree load failed: ${message}`, 'error');
      log(`Tree load failed: ${message}`, 'error');
      showToast(`Folder tree JSON failed: ${message}`, { kind: 'error' });
    }
  }

  // "Show 2 Part 2 - 05" → "Show 2 - 05": cour/part markers are not seasons.
  const PART_MARKER_RE = /\s*[(\[]?\s*(?:part|частина|cour)\s*\d{1,2}\s*[)\]]?(?=\s*[-–—]\s*\d|\s+\d|_)/gi;
  const SEASON_HINT_RE = /(?:сезон|season)[\s._-]*0*(\d{1,2})(?!\d)|(?<!\d)(\d{1,2})[\s._-]*(?:сезон|season)/i;
  const RESOLUTION_NUMBERS = new Set([360, 480, 540, 576, 720, 816, 1080, 1440, 2160]);
  const AKA_RE = /\s+(?:AKA|a\.k\.a\.?)\s+/i;

  function toInt(value) {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) ? parsed : null;
  }

  function splitTitleYear(title) {
    const match = String(title ?? '').match(/^(?<title>.+?)(?:[\s._]+[(\[]?|[(\[])(?<year>(?:19|20)\d{2})[)\]]?$/);
    const year = toInt(match?.groups?.year);
    if (!match || year > new Date().getFullYear() + 1) return { title: String(title ?? ''), year: null };
    return { title: match.groups.title.trim(), year };
  }

  function parseFilename(filename) {
    const original = String(filename ?? '').normalize('NFC');
    const bracketTag = extractBracketTag(original);
    const value = PRESETS[ui.preset?.value] ? original.replace(PART_MARKER_RE, '') : original;
    const stripped = stripBracketPrefix(value);
    const regexes = compilePatterns();
    let match = null;
    let patternIndex = -1;

    for (let index = 0; index < regexes.length; index += 1) {
      const candidate = value.match(regexes[index]) || (stripped !== value ? stripped.match(regexes[index]) : null);
      if (!candidate || RESOLUTION_NUMBERS.has(toInt(candidate.groups?.episode))) continue;
      match = candidate;
      patternIndex = index;
      break;
    }

    if (!match) {
      return { title: '', year: null, season: null, episode: null, parseError: 'No match', patternIndex: -1, bracketTag };
    }

    const groups = match.groups || {};
    const named = splitTitleYear(normaliseParsedTitle(groups.title).split(AKA_RE)[0].trim());
    const title = named.title;
    const episode = toInt(groups.episode);
    let season = toInt(groups.season);
    if (season == null && episode != null) {
      const hint = value.match(SEASON_HINT_RE);
      season = toInt(hint?.[1] ?? hint?.[2]);
    }
    const sourcePatterns = getActivePatternSources();
    const skipDefaultSeason = ABSOLUTE_EPISODE_PATTERNS.has(sourcePatterns[patternIndex]);

    return {
      title,
      year: toInt(groups.year) ?? named.year,
      season: applyDefaultSeasonWhenEpisodeOnly(season, episode, { skipDefault: skipDefaultSeason }),
      episode,
      parseError: title ? '' : season != null || episode != null ? 'No title in filename' : 'Missing title group',
      patternIndex,
      bracketTag,
    };
  }

  function collectTrackGroups(payload) {
    const groups = [];
    const seen = new WeakSet();

    function visit(value, path = 'root') {
      if (value == null) return;
      if (Array.isArray(value)) {
        value.forEach((child, index) => visit(child, `${path}[${index}]`));
        return;
      }
      if (typeof value !== 'object' || seen.has(value)) return;
      seen.add(value);

      if (Array.isArray(value.tracks)) {
        groups.push({
          groupKey: value.group_key ?? value.id ?? path,
          mediaTitle: value.media_title ?? null,
          declaredTrackCount: value.track_count ?? value.tracks.length,
          tracks: value.tracks,
        });
        return;
      }

      for (const key of ['groups', 'items', 'results', 'data', 'unlinked']) {
        if (value[key] != null) visit(value[key], `${path}.${key}`);
      }
    }

    visit(payload);
    return groups;
  }

  function normaliseApiTracks(payload) {
    const groups = collectTrackGroups(payload);
    const found = new Map();

    for (const group of groups) {
      for (const rawTrack of group.tracks) {
        const idNumber = Number.parseInt(rawTrack?.id, 10);
        if (!Number.isInteger(idNumber) || idNumber <= 0) continue;
        const id = String(idNumber);
        const filename = String(rawTrack.filename || rawTrack.display_name || '').trim();
        if (!filename) continue;
        found.set(id, {
          id,
          filename: filename.normalize('NFC'),
          displayName: String(rawTrack.display_name || filename),
          type: rawTrack.type ?? null,
          language: rawTrack.language ?? null,
          createdAt: rawTrack.created_at ?? null,
          uploader: rawTrack.uploaded_by?.username ?? null,
          apiGroupKey: group.groupKey,
        });
      }
    }

    return {
      tracks: [...found.values()].map(buildTrack),
      groupCount: groups.length,
      declaredTrackCount: groups.reduce((total, group) => total + (Number(group.declaredTrackCount) || 0), 0),
    };
  }

  async function loadUnlinkedTracks() {
    if (state.loading || state.running) return;
    const endpoint = getUnlinkedEndpoint();
    if (!endpoint) {
      updateRouteStatus();
      log(`Open ${TARGET_PATHS_LABEL} before loading.`, 'error');
      return;
    }

    try {
      compilePatterns();
    } catch (error) {
      const message = formatError(error);
      updateDataStatus(`Invalid filename regex: ${message}`, 'error');
      log(message, 'error');
      showToast(message, { kind: 'error' });
      return;
    }

    readCsrfToken();
    state.loading = true;
    setLoadingUi(true);
    updateDataStatus('Loading the unlinked-track JSON response…');
    log(`Loading ${endpoint}.`);

    try {
      const payload = await apiRequest(endpoint, {
        method: 'GET',
        headers: getAuthHeaders(false),
      });
      ingestTrackPayload(payload, endpoint);
      state.loadedEndpoint = endpoint;
    } catch (error) {
      if (error.status === 401 || error.status === 403) readCsrfToken();
      updateDataStatus(`API load failed: ${formatError(error)}`, 'error');
      log(`API load failed: ${formatError(error)}`, 'error');
    } finally {
      state.loading = false;
      setLoadingUi(false);
    }
  }

  function reparseTracks() {
    try {
      rebuildTracks();
      updateTreeStatus();
      log(
        `Reparsed ${state.tracks.length.toLocaleString()} track(s)` +
          (state.folderTree ? `; tree-enriched ${countTreeEnriched().toLocaleString()}.` : '.'),
      );
    } catch (error) {
      const message = formatError(error);
      log(message, 'error');
      showToast(message, { kind: 'error' });
    }
  }

  function mostCommon(counts) {
    let best = null;
    let bestCount = 0;
    for (const [value, count] of counts) {
      if (count > bestCount) {
        best = value;
        bestCount = count;
      }
    }
    return best;
  }

  function rebuildTitleGroups() {
    const groups = new Map();
    const votes = new Map();
    state.groupTrackIds = new Map();
    state.groupFromTree = new Set();
    for (const track of state.tracks) {
      const key = getTrackGroupKey(track);
      groups.set(key, (groups.get(key) || 0) + 1);
      if (!state.groupTrackIds.has(key)) state.groupTrackIds.set(key, []);
      state.groupTrackIds.get(key).push(track.id);
      if (track.titleSource === 'tree' && key !== UNPARSED_GROUP) state.groupFromTree.add(key);

      if (!votes.has(key)) votes.set(key, { titles: new Map(), years: new Map(), episodes: 0 });
      const vote = votes.get(key);
      if (track.displayTitle) vote.titles.set(track.displayTitle, (vote.titles.get(track.displayTitle) || 0) + 1);
      if (track.year) vote.years.set(track.year, (vote.years.get(track.year) || 0) + 1);
      if (Number.isInteger(track.episode)) vote.episodes += 1;
    }

    state.groupMeta = new Map();
    for (const [key, vote] of votes) {
      const searchTitle = mostCommon(vote.titles) || '';
      const year = mostCommon(vote.years);
      const mediaType = vote.episodes * 2 >= groups.get(key) ? 'tv' : 'movie';
      const label = key === UNPARSED_GROUP ? 'Unparsed' : mediaType === 'movie' && year ? `${searchTitle} (${year})` : searchTitle;
      state.groupMeta.set(key, { label, searchTitle, year, mediaType });
    }
    state.groupStatsCache.clear();
    state.titleGroups = new Map(
      [...groups.entries()].sort(([titleA, countA], [titleB, countB]) => {
        if (titleA === UNPARSED_GROUP) return 1;
        if (titleB === UNPARSED_GROUP) return -1;
        const pendingA = getGroupStats(titleA).pending;
        const pendingB = getGroupStats(titleB).pending;
        if (pendingB !== pendingA) return pendingB - pendingA;
        if (countB !== countA) return countB - countA;
        return getGroupLabel(titleA).localeCompare(getGroupLabel(titleB), undefined, { sensitivity: 'base', numeric: true });
      }),
    );
    state.groupOrder = [...state.titleGroups.keys()];
  }

  function renderGroupList() {
    if (!ui.groupList) return;
    const scrollTop = ui.groupList.scrollTop;
    const nextKeys = new Set(state.titleGroups.keys());

    for (const item of [...ui.groupList.querySelectorAll('[data-group-key]')]) {
      if (!nextKeys.has(item.dataset.groupKey)) item.remove();
    }

    for (const key of nextKeys) {
      const item = ensureGroupListItem(key);
      applyGroupListItemState(item, key);
      ui.groupList.appendChild(item);
    }

    ui.groupList.scrollTop = scrollTop;
  }

  function refreshTitleGroupSelect() {
    if (!ui.titleGroup) return;
    const previous = ui.titleGroup.value;

    let allOption = [...ui.titleGroup.options].find((option) => option.value === '');
    if (!allOption) {
      ui.titleGroup.textContent = '';
      allOption = document.createElement('option');
      allOption.value = '';
      allOption.textContent = 'All parsed titles';
      ui.titleGroup.appendChild(allOption);
    }

    const nextKeys = new Set(state.titleGroups.keys());
    for (const option of [...ui.titleGroup.options]) {
      if (option.value && !nextKeys.has(option.value)) option.remove();
    }

    for (const key of state.titleGroups.keys()) {
      updateTitleGroupOption(key);
      ui.titleGroup.appendChild(ensureTitleGroupOption(key));
    }

    if ([...ui.titleGroup.options].some((option) => option.value === previous)) {
      ui.titleGroup.value = previous;
    }
  }

  function getSelectedGroupKey() {
    const value = ui.titleGroup?.value || '';
    return value && value !== UNPARSED_GROUP ? value : '';
  }

  function getMatchingTracks() {
    const group = ui.titleGroup?.value || '';
    const filter = ui.filter?.value.trim().toLocaleLowerCase() || '';
    return state.tracks.filter((track) => {
      if (!matchesStatusFilter(track)) return false;
      if (group && getTrackGroupKey(track) !== group) return false;
      const haystack = [track.displayTitle, track.title, track.filename, track.treeMatch?.relPath, track.uploader];
      return !filter || haystack.join('\n').toLocaleLowerCase().includes(filter);
    });
  }

  function getEpisodeOffset(settings = null) {
    const raw = settings?.episodeOffset ?? ui.episodeOffset?.value;
    const offset = Number.parseInt(raw, 10);
    return Number.isInteger(offset) ? offset : 0;
  }

  function hasManualOverride(trackId, field) {
    const override = state.manualOverrides.get(trackId);
    return override != null && field in override;
  }

  function setManualOverride(trackId, field, value) {
    let entry = state.manualOverrides.get(trackId);
    if (value === undefined) {
      if (!entry) return;
      delete entry[field];
      if (!Object.keys(entry).length) state.manualOverrides.delete(trackId);
      return;
    }
    if (!entry) {
      entry = {};
      state.manualOverrides.set(trackId, entry);
    }
    entry[field] = value;
  }

  function clearManualSeasonOverrides() {
    for (const [trackId, entry] of state.manualOverrides) {
      delete entry.season;
      if (!Object.keys(entry).length) state.manualOverrides.delete(trackId);
    }
  }

  function resetManualOverrides() {
    if (!state.manualOverrides.size) return;
    state.manualOverrides.clear();
    renderTrackTable();
    log('Cleared all manual season/episode overrides.');
  }

  function updateResetManualButton() {
    if (!ui.resetManualSe) return;
    ui.resetManualSe.disabled = state.manualOverrides.size === 0;
  }

  function parseManualNumberInput(rawValue) {
    const trimmed = String(rawValue ?? '').trim();
    if (!trimmed || trimmed === '—') return { empty: true };
    const value = Number.parseInt(trimmed, 10);
    if (!Number.isInteger(value) || value < 0) return { invalid: true };
    return { value };
  }

  function isSeasonEditable() {
    return ui.mediaType?.value === 'tv' && ui.seasonMode?.value === 'parsed';
  }

  function getDefaultEpisodeForTrack(track) {
    if (!Number.isInteger(track.episode)) return null;
    return track.episode + getEpisodeOffset();
  }

  function handleManualSeasonInput(trackId, rawValue) {
    if (!isSeasonEditable()) return;
    const track = state.tracks.find((item) => item.id === trackId);
    if (!track) return;

    const parsed = parseManualNumberInput(rawValue);
    if (parsed.invalid) return;

    if (parsed.empty) {
      setManualOverride(trackId, 'season', undefined);
    } else {
      const defaultSeason = Number.isInteger(track.season) ? track.season : null;
      if (parsed.value === defaultSeason) setManualOverride(trackId, 'season', undefined);
      else setManualOverride(trackId, 'season', parsed.value);
    }
    renderTrackTable();
  }

  function handleManualEpisodeInput(trackId, rawValue) {
    const track = state.tracks.find((item) => item.id === trackId);
    if (!track) return;

    const parsed = parseManualNumberInput(rawValue);
    if (parsed.invalid) return;

    if (parsed.empty) {
      setManualOverride(trackId, 'episode', undefined);
    } else {
      const defaultEpisode = getDefaultEpisodeForTrack(track);
      if (parsed.value === defaultEpisode) setManualOverride(trackId, 'episode', undefined);
      else setManualOverride(trackId, 'episode', parsed.value);
    }
    renderTrackTable();
  }

  function getApiEpisode(track, settings = null) {
    if ((settings?.mediaType ?? ui.mediaType.value) !== 'tv') return null;

    if (hasManualOverride(track.id, 'episode')) {
      const episode = state.manualOverrides.get(track.id).episode;
      return Number.isInteger(episode) ? episode : null;
    }

    if (!Number.isInteger(track.episode)) return null;
    return track.episode + getEpisodeOffset(settings);
  }

  function formatEpisodeCell(track) {
    if (ui.mediaType?.value !== 'tv') {
      if (!Number.isInteger(track.episode)) return '—';
      return String(track.episode);
    }

    const apiEpisode = getApiEpisode(track);
    const manual = hasManualOverride(track.id, 'episode');
    const offset = getEpisodeOffset();
    const rangeIssue = getEpisodeRangeIssue(track);
    const suggestion = rangeIssue ? suggestTmdbNumbering(track) : null;
    let title = manual ? 'Manual override (episode offset ignored)' : `Parsed ${track.episode ?? '—'}`;
    if (!manual && offset !== 0) title += `, offset ${offset}`;
    if (rangeIssue) title += ` — ${rangeIssue}${suggestion ? `; TMDB numbering: S${suggestion.season}E${suggestion.episode}` : ''}`;

    const className = [
      manual ? 'uba-manual-input' : offset !== 0 && Number.isInteger(track.episode) ? 'uba-has-offset' : '',
      rangeIssue ? 'uba-out-of-range' : '',
    ].join(' ');
    const inputValue = Number.isInteger(apiEpisode) ? apiEpisode : '';
    return `<input type="number" class="uba-cell-input ${className}" data-manual-episode="${escapeHtml(track.id)}" min="0" step="1" value="${inputValue}" placeholder="—" title="${escapeHtml(title)}">`;
  }

  function formatSeasonCell(track) {
    if (ui.mediaType?.value !== 'tv') return '—';

    const seasonMode = ui.seasonMode.value;
    if (seasonMode === 'fixed') {
      const fixed = getApiSeason(track);
      return `<span class="uba-fixed-value" title="Fixed season applies to all tracks">${fixed ?? '—'}</span>`;
    }
    if (seasonMode === 'null') {
      return `<span class="uba-fixed-value" title="Season is sent as null">—</span>`;
    }

    const apiSeason = getApiSeason(track);
    const manual = hasManualOverride(track.id, 'season');
    const title = manual ? 'Manual override' : 'Parsed from filename; editable per track';
    const inputValue = Number.isInteger(apiSeason) ? apiSeason : '';
    const className = manual ? 'uba-manual-input' : '';
    return `<input type="number" class="uba-cell-input ${className}" data-manual-season="${escapeHtml(track.id)}" min="0" step="1" value="${inputValue}" placeholder="—" title="${escapeHtml(title)}">`;
  }

  function sortTracksForDisplay(tracks) {
    return [...tracks].sort((trackA, trackB) => {
      const seasonA = getApiSeason(trackA);
      const seasonB = getApiSeason(trackB);
      const seasonNumA = Number.isInteger(seasonA) ? seasonA : -1;
      const seasonNumB = Number.isInteger(seasonB) ? seasonB : -1;
      if (seasonNumA !== seasonNumB) return seasonNumA - seasonNumB;

      const episodeA = getApiEpisode(trackA);
      const episodeB = getApiEpisode(trackB);
      const episodeNumA = Number.isInteger(episodeA) ? episodeA : -1;
      const episodeNumB = Number.isInteger(episodeB) ? episodeB : -1;
      if (episodeNumA !== episodeNumB) return episodeNumA - episodeNumB;

      return Number.parseInt(trackA.id, 10) - Number.parseInt(trackB.id, 10);
    });
  }

  function getApiSeason(track, settings = null) {
    const mediaType = settings?.mediaType ?? ui.mediaType.value;
    if (mediaType !== 'tv') return null;
    const seasonMode = settings?.seasonMode ?? ui.seasonMode.value;
    if (seasonMode === 'null') return null;
    if (seasonMode === 'fixed') {
      const raw = settings?.fixedSeason ?? ui.fixedSeason.value;
      const fixed = Number.parseInt(raw, 10);
      return Number.isInteger(fixed) ? fixed : null;
    }
    if (hasManualOverride(track.id, 'season')) {
      const season = state.manualOverrides.get(track.id).season;
      return Number.isInteger(season) ? season : null;
    }
    return Number.isInteger(track.season) ? track.season : null;
  }

  function captureTableFocus() {
    const activeElement = document.activeElement;
    if (!ui.trackBody?.contains(activeElement)) return null;
    const trackId = activeElement.dataset?.manualSeason || activeElement.dataset?.manualEpisode;
    if (!trackId) return null;
    return {
      trackId,
      field: activeElement.dataset.manualSeason ? 'season' : 'episode',
      selectionStart: activeElement.selectionStart,
      selectionEnd: activeElement.selectionEnd,
    };
  }

  function restoreTableFocus(snapshot) {
    if (!snapshot || !ui.trackBody) return;
    const selector =
      snapshot.field === 'season'
        ? `[data-manual-season="${CSS.escape(snapshot.trackId)}"]`
        : `[data-manual-episode="${CSS.escape(snapshot.trackId)}"]`;
    const input = ui.trackBody.querySelector(selector);
    if (!input) return;
    input.focus();
    if (typeof snapshot.selectionStart === 'number' && typeof input.setSelectionRange === 'function') {
      input.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd);
    }
  }

  function renderTrackTable(options = {}) {
    if (!ui.trackBody) return;
    const focusSnapshot = options.preserveFocus === false ? null : captureTableFocus();
    const tableWrap = ui.trackBody.closest('.uba-table-wrap');
    const scrollTop = tableWrap?.scrollTop ?? 0;
    const matching = sortTracksForDisplay(getMatchingTracks());
    const limit = Math.max(1, Number.parseInt(ui.renderLimit.value, 10) || DEFAULT_RENDER_LIMIT);
    const rendered = matching.slice(0, limit);

    ui.trackBody.innerHTML = rendered
      .map((track) => {
        const status = state.statuses.get(track.id);
        const checked = state.selectedIds.has(track.id) ? 'checked' : '';
        const displayTitle = track.displayTitle || `⚠ ${track.parseError || 'Unparsed'}`;
        const statusLabel = getTrackStatusLabel(track.id);
        const patternHint = Number.isInteger(track.patternIndex) && track.patternIndex >= 0 ? `#${track.patternIndex + 1}` : '';
        const treeHint =
          track.titleSource === 'tree'
            ? `<span class="uba-tree-tag" title="${escapeHtml(track.treeMatch?.relPath || 'from folder tree')}">tree</span>`
            : '';
        const titleTooltip = track.treeMatch?.relPath
          ? ` title="${escapeHtml(track.treeMatch.relPath)}"`
          : '';
        return `
          <tr data-track-id="${track.id}" data-status="${escapeHtml(status?.state || '')}">
            <td><input type="checkbox" data-track-checkbox="${track.id}" ${checked}></td>
            <td class="uba-number">${track.id}</td>
            <td${titleTooltip}>${escapeHtml(displayTitle)}${treeHint}${patternHint ? `<div class="uba-pattern-tag">${patternHint}</div>` : ''}</td>
            <td class="uba-number">${formatSeasonCell(track)}</td>
            <td class="uba-number">${formatEpisodeCell(track)}</td>
            <td>${escapeHtml(statusLabel)}</td>
            <td class="uba-file" title="${escapeHtml(track.uploader ? `${track.filename}\nUploaded by ${track.uploader}` : track.filename)}">${escapeHtml(track.filename)}</td>
          </tr>
        `;
      })
      .join('');

    ui.trackBody.querySelectorAll('[data-track-checkbox]').forEach((checkbox) => {
      checkbox.addEventListener('change', () => {
        const id = checkbox.dataset.trackCheckbox;
        if (checkbox.checked) state.selectedIds.add(id);
        else state.selectedIds.delete(id);
        updateSelectionSummary(matching, rendered.length);
        updateMatchingToggle(matching);
      });
    });

    ui.trackBody.querySelectorAll('[data-manual-season]').forEach((input) => {
      input.addEventListener('change', () => handleManualSeasonInput(input.dataset.manualSeason, input.value));
    });
    ui.trackBody.querySelectorAll('[data-manual-episode]').forEach((input) => {
      input.addEventListener('change', () => handleManualEpisodeInput(input.dataset.manualEpisode, input.value));
    });

    updateResetManualButton();
    updateSelectionSummary(matching, rendered.length);
    updateMatchingToggle(matching);
    if (tableWrap) tableWrap.scrollTop = scrollTop;
    restoreTableFocus(focusSnapshot);
  }

  function updateSelectionSummary(matching = getMatchingTracks(), renderedCount = null) {
    if (!ui.selectionSummary) return;
    const selected = state.tracks.filter((track) => state.selectedIds.has(track.id));
    const selectedParseFailures = selected.filter(
      (track) => ui.mediaType.value === 'tv' && !Number.isInteger(getApiEpisode(track)),
    );
    const outOfRange = selected.filter((track) => getEpisodeRangeIssue(track)).length;
    const remappable = outOfRange ? selected.filter((track) => suggestTmdbNumbering(track)).length : 0;
    if (ui.remapTmdb) {
      ui.remapTmdb.disabled = !remappable || state.running;
      ui.remapTmdb.textContent = remappable ? `Remap ${remappable.toLocaleString()} to TMDB numbering` : 'Remap to TMDB numbering';
    }
    const displayCount = renderedCount ?? Math.min(matching.length, Number.parseInt(ui.renderLimit.value, 10) || DEFAULT_RENDER_LIMIT);
    ui.selectionSummary.textContent =
      `${state.tracks.length.toLocaleString()} loaded · ${matching.length.toLocaleString()} matching · ` +
      `${displayCount.toLocaleString()} rendered · ${selected.length.toLocaleString()} selected · ` +
      `${selectedParseFailures.length.toLocaleString()} selected without an episode` +
      (outOfRange ? ` · ${outOfRange.toLocaleString()} selected outside TMDB season/episode range` : '');
    ui.selectionSummary.className = `uba-notice ${selectedParseFailures.length || outOfRange ? 'uba-warning' : ''}`;
  }

  function updateMatchingToggle(matching = getMatchingTracks()) {
    if (!ui.toggleMatching) return;
    const selectedCount = matching.filter((track) => state.selectedIds.has(track.id)).length;
    ui.toggleMatching.checked = matching.length > 0 && selectedCount === matching.length;
    ui.toggleMatching.indeterminate = selectedCount > 0 && selectedCount < matching.length;
  }

  function selectMatching(select) {
    for (const track of getMatchingTracks()) {
      if (select) state.selectedIds.add(track.id);
      else state.selectedIds.delete(track.id);
    }
    renderTrackTable();
  }

  function selectNone() {
    state.selectedIds.clear();
    renderTrackTable();
  }

  function selectFailed() {
    state.selectedIds.clear();
    for (const [id, status] of state.statuses) {
      if (status.state === 'error') state.selectedIds.add(id);
    }
    renderTrackTable();
  }

  function updateRouteStatus() {
    if (!ui.routeStatus) return;
    if (isTargetRoute()) {
      ui.routeStatus.textContent = `Target route detected. Track data is loaded from ${getUnlinkedEndpoint().split('?')[0]}.`;
      ui.routeStatus.className = 'uba-notice uba-ok';
    } else {
      ui.routeStatus.textContent = `Inactive on this route. Open ${TARGET_PATHS_LABEL}.`;
      ui.routeStatus.className = 'uba-notice uba-warning';
    }
  }

  function updateAuthIndicator() {
    if (!ui.authStatus) return;
    if (state.csrfToken) {
      ui.authStatus.textContent = 'Signed in — session cookie found.';
      ui.authStatus.className = 'uba-notice uba-ok';
    } else {
      ui.authStatus.textContent = `Not signed in — log in on ukrab.work (no ${CSRF_COOKIE} cookie).`;
      ui.authStatus.className = 'uba-notice uba-error';
    }
  }

  function updateDataStatus(message, kind = '') {
    if (!ui.dataStatus) return;
    ui.dataStatus.textContent = message;
    ui.dataStatus.className = `uba-notice ${kind === 'ok' ? 'uba-ok' : kind === 'error' ? 'uba-error' : ''}`;
  }

  function updateLinkStatus(message, kind = '') {
    if (!ui.linkStatus) return;
    ui.linkStatus.textContent = message;
    ui.linkStatus.className = `uba-notice ${kind === 'ok' ? 'uba-ok' : kind === 'error' ? 'uba-error' : ''}`;
  }

  function updateTmdbSearchStatus(message, kind = '') {
    if (!ui.tmdbSearchStatus) return;
    ui.tmdbSearchStatus.textContent = message;
    ui.tmdbSearchStatus.className = `uba-notice ${kind === 'ok' ? 'uba-ok' : kind === 'error' ? 'uba-error' : ''}`;
  }

  function updateMediaTypeControls() {
    if (!ui.mediaType) return;
    const isTv = ui.mediaType.value === 'tv';
    ui.seasonModeWrap.classList.toggle('uba-hidden', !isTv);
    ui.fixedSeasonWrap.classList.toggle('uba-hidden', !isTv || ui.seasonMode.value !== 'fixed');
    ui.episodeOffsetWrap?.classList.toggle('uba-hidden', !isTv);
    ui.tvEpisodeHelpWrap?.classList.toggle('uba-hidden', !isTv);
  }

  function setLoadingUi(loading) {
    if (!ui.panel) return;
    ui.panel.querySelectorAll('button, input, select, textarea').forEach((element) => {
      if (element.dataset.action === 'collapse' || element.dataset.action === 'close') return;
      element.disabled = loading;
    });
    ui.abort.disabled = true;
    if (!loading) {
      updateResetManualButton();
      updateSelectionSummary();
    }
  }

  function setRunningUi(running) {
    ui.abort.disabled = !running;
    if (ui.start) ui.start.textContent = running ? 'Queue link' : 'Link selected tracks';
  }

  function getAuthHeaders(includeJson = false) {
    readCsrfToken();
    const headers = new (pageWindow.Headers || Headers)();
    headers.set('Accept', 'application/json');
    if (includeJson) headers.set('Content-Type', 'application/json');
    if (state.csrfToken) headers.set('X-CSRF-Token', state.csrfToken);
    return headers;
  }

  async function apiRequest(path, options = {}) {
    readCsrfToken();
    const fetchImpl = pageWindow.fetch || window.fetch;
    const response = await fetchImpl.call(pageWindow, path, {
      credentials: 'include',
      cache: 'no-store',
      ...options,
    });

    const contentType = response.headers.get('content-type') || '';
    let body = null;
    if (response.status !== 204) {
      try {
        body = contentType.includes('application/json') ? await response.json() : await response.text();
      } catch {
        body = null;
      }
    }

    if (!response.ok) {
      const error = new Error(`HTTP ${response.status} ${response.statusText}`);
      error.status = response.status;
      error.body = body;
      throw error;
    }
    return body;
  }

  function collectTmdbCandidates(payload, requestedType) {
    const candidates = [];
    const seenObjects = new WeakSet();
    const seenResults = new Set();

    function visit(value, depth = 0) {
      if (depth > 6 || value == null) return;
      if (Array.isArray(value)) {
        value.forEach((item) => visit(item, depth + 1));
        return;
      }
      if (typeof value !== 'object' || seenObjects.has(value)) return;
      seenObjects.add(value);

      const id = Number.parseInt(value.tmdb_id ?? value.id, 10);
      const title = String(value.title || value.name || value.original_title || value.original_name || '').trim();
      const inferredType = value.media_type || value.type || (value.first_air_date ? 'tv' : value.release_date ? 'movie' : '');
      const mediaType = inferredType === 'tv' || inferredType === 'movie' ? inferredType : requestedType !== 'multi' ? requestedType : '';

      if (Number.isInteger(id) && id > 0 && title && (mediaType === 'tv' || mediaType === 'movie')) {
        const key = `${mediaType}:${id}`;
        if (!seenResults.has(key)) {
          seenResults.add(key);
          const date = String(value.first_air_date || value.release_date || value.air_date || '').trim();
          candidates.push({
            id,
            mediaType,
            title,
            originalTitle: String(value.original_title || value.original_name || '').trim(),
            year: /^\d{4}/.test(date) ? date.slice(0, 4) : '',
            overview: String(value.overview || value.description || '').trim(),
            posterPath: String(value.poster_path || value.poster_url || '').trim(),
            imdbId: String(value.imdb_id || '').trim(),
            releaseDate: date,
            raw: value,
          });
        }
      }

      for (const key of ['results', 'items', 'data', 'titles', 'movies', 'tv', 'shows']) {
        if (value[key] != null) visit(value[key], depth + 1);
      }
    }

    visit(payload);
    return candidates;
  }

  function getTmdbPosterUrl(posterPath) {
    if (!posterPath) return '';
    if (/^https?:\/\//i.test(posterPath)) return posterPath;
    return `${TMDB_IMAGE_BASE}${posterPath.startsWith('/') ? posterPath : `/${posterPath}`}`;
  }

  const BEST_MATCH_SCORE = 130;

  function scoreTmdbResult(result, { title, year, mediaType }) {
    const wanted = foldTitle(title);
    const names = [result.title, result.originalTitle].map(foldTitle).filter(Boolean);
    let score = 0;
    if (wanted && names.includes(wanted)) {
      score += 100;
    } else if (wanted && names.some((name) => name.startsWith(wanted) || wanted.startsWith(name))) {
      score += 50;
    } else if (wanted) {
      const words = new Set(wanted.split(' '));
      const overlap = Math.max(0, ...names.map((name) => {
        const tokens = name.split(' ');
        return tokens.filter((token) => words.has(token)).length / Math.max(words.size, tokens.length);
      }));
      score += Math.round(overlap * 40);
    }
    if (mediaType && result.mediaType === mediaType) score += 30;
    const resultYear = toInt(result.year);
    if (year && resultYear) score += Math.max(0, 25 - Math.abs(year - resultYear) * 5);
    return score;
  }

  function rankTmdbResults(results, context) {
    return results
      .map((result, index) => ({ ...result, score: scoreTmdbResult(result, context), apiIndex: index }))
      .sort((a, b) => b.score - a.score || a.apiIndex - b.apiIndex);
  }

  function parseTmdbReference(text) {
    const value = String(text ?? '').trim();
    const match = value.match(/themoviedb\.org\/(movie|tv)\/(\d+)/i) || value.match(/^(movie|tv)[\s/:#-]+(\d+)$/i);
    return match ? { mediaType: match[1].toLowerCase(), tmdbId: Number(match[2]) } : null;
  }

  function fetchTitleDetails(mediaType, tmdbId) {
    const key = `${mediaType}:${tmdbId}`;
    if (!state.titleDetails.has(key)) {
      const query = new URLSearchParams({ media_type: mediaType, tmdb_id: String(tmdbId) });
      const request = apiRequest(`/api/titles/details?${query}`, { method: 'GET', headers: getAuthHeaders(false) });
      request.catch(() => state.titleDetails.delete(key));
      state.titleDetails.set(key, request);
    }
    return state.titleDetails.get(key);
  }

  function candidateFromDetails(details, mediaType, tmdbId) {
    const entries = Array.isArray(details?.metadata_entries) ? details.metadata_entries : [];
    const entry = entries.find((item) => item.language === 'en' && item.title) || entries.find((item) => item.title) || {};
    return {
      id: tmdbId,
      mediaType,
      title: entry.title || `TMDB ${tmdbId}`,
      originalTitle: '',
      year: details?.year ? String(details.year) : '',
      overview: String(entry.overview || '').trim(),
      posterPath: String(details?.poster_url || '').trim(),
      imdbId: String(details?.imdb_id || '').trim(),
      releaseDate: String(details?.release_date || ''),
      raw: details,
    };
  }

  function getSeasonEpisodeCounts(details) {
    const counts = { tmdb: new Map(), tvdb: new Map() };
    for (const season of Array.isArray(details?.seasons) ? details.seasons : []) {
      const map = counts[season.source];
      const number = toInt(season.season_number);
      const count = toInt(season.episode_count);
      if (map && number != null && count != null) map.set(number, Math.max(count, map.get(number) || 0));
    }
    if (!counts.tmdb.size) counts.tmdb = counts.tvdb;
    return counts;
  }

  async function refreshSeasonCounts() {
    const tmdbId = toInt(ui.tmdbId?.value);
    const key = ui.mediaType?.value === 'tv' && tmdbId > 0 ? `tv:${tmdbId}` : '';
    if (key === state.seasonCountsKey && (state.seasonCounts || !key)) return;
    state.seasonCountsKey = key;
    state.seasonCounts = null;
    if (key) {
      try {
        const counts = getSeasonEpisodeCounts(await fetchTitleDetails('tv', tmdbId));
        if (state.seasonCountsKey !== key) return;
        state.seasonCounts = counts.tmdb.size ? counts : null;
      } catch (error) {
        log(`Could not load TMDB seasons for tv ${tmdbId}: ${formatError(error)}`, 'error');
      }
    }
    renderTrackTable();
  }

  function getEpisodeRangeIssue(track, settings = null) {
    if (!state.seasonCounts) return '';
    const { tmdb } = state.seasonCounts;
    const episode = getApiEpisode(track, settings);
    const season = getApiSeason(track, settings);
    if (!Number.isInteger(episode) || !Number.isInteger(season)) return '';
    if (!tmdb.has(season)) return `TMDB has no season ${season}`;
    const count = tmdb.get(season);
    return count > 0 && episode > count ? `TMDB season ${season} has ${count} episode(s)` : '';
  }

  // TMDB often keeps anime as one long season while files follow TVDB's split (S2E02 → TMDB S1E14).
  function suggestTmdbNumbering(track) {
    if (!getEpisodeRangeIssue(track)) return null;
    const { tmdb, tvdb } = state.seasonCounts;
    const season = getApiSeason(track);
    const episode = getApiEpisode(track);
    if (!(season > 0) || !(episode > 0)) return null;
    let absolute = episode;
    for (let number = 1; number < season; number += 1) {
      if (!tvdb.get(number)) return null;
      absolute += tvdb.get(number);
    }
    for (const number of [...tmdb.keys()].filter((value) => value > 0).sort((a, b) => a - b)) {
      const count = tmdb.get(number);
      if (absolute <= count) return { season: number, episode: absolute };
      absolute -= count;
    }
    return null;
  }

  function remapToTmdbNumbering() {
    if (ui.seasonMode.value !== 'parsed') {
      showToast('Set “Season value” to “Parsed from filename” before remapping.', { kind: 'warning' });
      return;
    }
    let count = 0;
    for (const track of state.tracks) {
      if (!state.selectedIds.has(track.id)) continue;
      const suggestion = suggestTmdbNumbering(track);
      if (!suggestion) continue;
      setManualOverride(track.id, 'season', suggestion.season);
      setManualOverride(track.id, 'episode', suggestion.episode);
      count += 1;
    }
    renderTrackTable();
    const message = `Remapped ${count.toLocaleString()} selected track(s) to TMDB season/episode numbering. Undo with “Reset manual S/E”.`;
    log(message);
    showToast(message, { kind: 'ok' });
  }

  function getFilteredTmdbResults() {
    const filter = ui.tmdbResultFilter?.value || 'all';
    if (filter === 'all') return state.tmdbResults;
    return state.tmdbResults.filter((result) => result.mediaType === filter);
  }

  function buildTmdbPosterMarkup(result, className = 'uba-tmdb-poster') {
    const posterUrl = getTmdbPosterUrl(result?.posterPath);
    if (posterUrl) {
      return `<img class="${className}" src="${escapeHtml(posterUrl)}" alt="" loading="lazy">`;
    }
    return `<div class="${className} uba-tmdb-poster-placeholder">No poster</div>`;
  }

  function buildTmdbLinksMarkup(result) {
    const links = [];
    links.push(`<a href="https://www.themoviedb.org/${result.mediaType}/${result.id}" target="_blank" rel="noopener">TMDB ${result.id}</a>`);
    if (result.imdbId) {
      links.push(`<a href="https://www.imdb.com/title/${escapeHtml(result.imdbId)}/" target="_blank" rel="noopener">IMDb</a>`);
    }
    return links.join(' · ');
  }

  function renderTmdbSelected(result = null) {
    if (!ui.tmdbSelected || !ui.tmdbSelectedWrap) return;
    const selected =
      result ||
      (state.tmdbDetails
        ? {
            id: state.tmdbDetails.tmdbId,
            mediaType: state.tmdbDetails.mediaType,
            title: findLikelyTitle(state.tmdbDetails.details) || `TMDB ${state.tmdbDetails.tmdbId}`,
            year: '',
            overview: String(state.tmdbDetails.details?.overview || '').trim(),
            posterPath: String(state.tmdbDetails.details?.poster_path || '').trim(),
            imdbId: String(state.tmdbDetails.details?.imdb_id || '').trim(),
          }
        : null);

    if (!selected) {
      ui.tmdbSelectedWrap.classList.add('uba-hidden');
      ui.tmdbSelected.innerHTML = '';
      return;
    }

    ui.tmdbSelectedWrap.classList.remove('uba-hidden');
    const badgeClass = selected.mediaType === 'tv' ? 'uba-badge-tv' : 'uba-badge-movie';
    ui.tmdbSelected.innerHTML = `
      <div class="uba-tmdb-selected">
        ${buildTmdbPosterMarkup(selected)}
        <div>
          <div class="uba-tmdb-meta">
            <span class="uba-badge ${badgeClass}">${escapeHtml(selected.mediaType)}</span>
            ${selected.year ? `<span class="uba-badge uba-badge-muted">${escapeHtml(selected.year)}</span>` : ''}
            <span class="uba-badge uba-badge-muted">ID ${selected.id}</span>
          </div>
          <div class="uba-tmdb-card-title">${escapeHtml(selected.title)}</div>
          ${selected.overview ? `<div class="uba-tmdb-card-overview">${escapeHtml(selected.overview.slice(0, 280))}</div>` : ''}
          <div class="uba-tmdb-links">${buildTmdbLinksMarkup(selected)}</div>
        </div>
      </div>
    `;
  }

  function deriveTmdbQuery() {
    const explicit = ui.tmdbQuery.value.trim();
    if (explicit) return explicit;
    const groupKey = getSelectedGroupKey();
    if (groupKey) return getGroupMeta(groupKey).searchTitle;

    const counts = new Map();
    for (const track of state.tracks) {
      if (state.selectedIds.has(track.id) && track.displayTitle) {
        counts.set(track.displayTitle, (counts.get(track.displayTitle) || 0) + 1);
      }
    }
    return mostCommon(counts) || ui.filter.value.trim();
  }

  async function searchTmdb() {
    selectCurrentGroupTracks({ silent: true });
    const queryText = deriveTmdbQuery();
    const requestedType = ui.searchMediaType.value;
    if (!queryText) {
      const message = 'Enter a TMDB search query or select a parsed title group.';
      updateTmdbSearchStatus(message, 'error');
      showToast(message, { kind: 'warning' });
      return;
    }

    ui.tmdbQuery.value = queryText;
    const seq = ++state.searchSeq;
    state.tmdbResults = [];
    state.selectedTmdbIndex = -1;
    renderTmdbResults();
    renderTmdbSelected(null);

    // The search API returns nothing when the query carries a year or an "AKA" alternative.
    const reference = parseTmdbReference(queryText);
    const { title: cleanQuery, year: queryYear } = splitTitleYear(queryText.split(AKA_RE)[0].trim());
    const meta = getGroupMeta(getSelectedGroupKey());
    updateTmdbSearchStatus(reference ? `Looking up ${reference.mediaType} ${reference.tmdbId}…` : `Searching for “${cleanQuery}”…`);

    try {
      if (reference) {
        const details = await fetchTitleDetails(reference.mediaType, reference.tmdbId);
        if (seq !== state.searchSeq) return;
        state.tmdbResults = [candidateFromDetails(details, reference.mediaType, reference.tmdbId)];
        chooseTmdbResult(0);
        updateTmdbSearchStatus(`Loaded ${reference.mediaType} ${reference.tmdbId} by ID.`, 'ok');
        return;
      }

      const query = new URLSearchParams({ q: cleanQuery, media_type: requestedType });
      const payload = await apiRequest(`/api/titles/search?${query}`, {
        method: 'GET',
        headers: getAuthHeaders(false),
      });
      if (seq !== state.searchSeq) return;
      state.tmdbResults = rankTmdbResults(collectTmdbCandidates(payload, requestedType), {
        title: cleanQuery,
        year: queryYear ?? meta.year,
        mediaType: meta.mediaType || ui.mediaType.value,
      }).slice(0, 50);
      renderTmdbResults();
      const best = state.tmdbResults[0];
      const count = state.tmdbResults.length;
      updateTmdbSearchStatus(
        !count
          ? `No results for “${cleanQuery}”. Try the English or original title, or paste a TMDB URL (themoviedb.org/tv/…).`
          : best.score >= BEST_MATCH_SCORE
            ? `Found ${count} result(s). Best match: ${best.title} (${best.mediaType}${best.year ? `, ${best.year}` : ''}) — click to confirm.`
            : `Found ${count} result(s). Select the correct title.`,
        count ? 'ok' : 'error',
      );
      log(`TMDB search returned ${count} usable result(s) for “${cleanQuery}”.`);
    } catch (error) {
      if (seq !== state.searchSeq) return;
      updateTmdbSearchStatus(`TMDB search failed: ${formatError(error)}`, 'error');
      log(`TMDB search failed: ${formatError(error)}`, 'error');
    }
  }

  function renderTmdbResults() {
    if (!ui.tmdbResultsGrid) return;
    const results = getFilteredTmdbResults();
    ui.tmdbResultsWrap.classList.toggle('uba-hidden', state.tmdbResults.length === 0);
    ui.tmdbResultsGrid.innerHTML = results
      .map((result, index) => {
        const stateIndex = state.tmdbResults.indexOf(result);
        const selected =
          state.selectedTmdbIndex === stateIndex ||
          (state.tmdbDetails?.tmdbId === result.id && state.tmdbDetails?.mediaType === result.mediaType);
        const badgeClass = result.mediaType === 'tv' ? 'uba-badge-tv' : 'uba-badge-movie';
        return `
          <div class="uba-tmdb-card" role="button" tabindex="0" data-tmdb-index="${stateIndex}" data-selected="${selected}">
            ${buildTmdbPosterMarkup(result)}
            <div class="uba-tmdb-card-body">
              <div class="uba-tmdb-meta">
                <span class="uba-badge ${badgeClass}">${escapeHtml(result.mediaType)}</span>
                ${result.year ? `<span class="uba-badge uba-badge-muted">${escapeHtml(result.year)}</span>` : ''}
                <span class="uba-badge uba-badge-muted">${result.id}</span>
                ${stateIndex === 0 && result.score >= BEST_MATCH_SCORE ? '<span class="uba-badge uba-badge-best">Best match</span>' : ''}
              </div>
              <div class="uba-tmdb-card-title">${escapeHtml(result.title)}</div>
              ${
                result.originalTitle && result.originalTitle !== result.title
                  ? `<div class="uba-help">${escapeHtml(result.originalTitle)}</div>`
                  : ''
              }
              <div class="uba-tmdb-card-overview">${escapeHtml(result.overview ? result.overview.slice(0, 180) : '—')}</div>
            </div>
          </div>
        `;
      })
      .join('');
  }

  function chooseTmdbResult(index) {
    const result = state.tmdbResults[index];
    if (!result) return;
    state.selectedTmdbIndex = index;
    ui.mediaType.value = result.mediaType;
    ui.tmdbId.value = String(result.id);
    state.tmdbDetails = {
      mediaType: result.mediaType,
      tmdbId: result.id,
      details: result.raw,
      source: 'search',
    };
    updateMediaTypeControls();
    const summary = `${result.title} (${result.mediaType}, TMDB ${result.id}${result.year ? `, ${result.year}` : ''})`;
    updateLinkStatus(`Selected: ${summary}.`, 'ok');
    const groupKey = getSelectedGroupKey();
    if (groupKey) cacheTmdbForTitle(groupKey, result.mediaType, result.id, summary);
    renderTmdbSelected(result);
    renderTmdbResults();
    renderTrackTable();
    refreshSeasonCounts();
    if (groupKey) refreshGroupWorkStates([groupKey]);
    log(`Selected TMDB ${result.mediaType} ${result.id}: ${result.title}.`);
  }

  function findLikelyTitle(value, depth = 0, seen = new WeakSet()) {
    if (depth > 5 || value == null || typeof value !== 'object' || seen.has(value)) return '';
    seen.add(value);
    for (const key of ['title', 'name', 'original_title', 'original_name']) {
      if (typeof value[key] === 'string' && value[key].trim()) return value[key].trim();
    }
    for (const child of Object.values(value)) {
      const found = findLikelyTitle(child, depth + 1, seen);
      if (found) return found;
    }
    return '';
  }

  function validateSelection(selected, mediaType, tmdbId, settings) {
    if (!selected.length) throw new Error('Select at least one track.');
    if (!Number.isInteger(tmdbId) || tmdbId <= 0) throw new Error('Pick a TMDB result or enter a valid TMDB ID.');

    const groupKeys = [...new Set(selected.map(getTrackGroupKey))];
    if (groupKeys.length > 1 && !ui.allowMixed.checked) {
      const sample = groupKeys.slice(0, 3).map(getGroupLabel).join(', ');
      throw new Error(
        `Selected tracks span ${groupKeys.length} title groups (${sample}${groupKeys.length > 3 ? ', …' : ''}). Select one group or enable mixed-title linking.`,
      );
    }

    if (mediaType === 'tv') {
      for (const track of selected) {
        const episode = getApiEpisode(track, settings);
        if (!Number.isInteger(episode) || episode < 0) {
          throw new Error(`Track ${track.id} has no episode number. Enter it in the E column or adjust the filename pattern.`);
        }
        const season = getApiSeason(track, settings);
        if (season != null && (!Number.isInteger(season) || season < 0)) {
          throw new Error(`Track ${track.id} has invalid season number: ${season}.`);
        }
      }
    }

    return groupKeys;
  }

  function validateJob(job) {
    const selected = getTracksForJob(job);
    if (!selected.length) throw new Error('No tracks remain for this link job.');
    const settings = { ...job.settings, mediaType: job.mediaType };
    validateSelection(selected, job.mediaType, job.tmdbId, settings);
    return { selected: sortTracksForDisplay(selected), mediaType: job.mediaType, tmdbId: job.tmdbId, settings, groupKey: job.groupKey };
  }

  function validateRun() {
    const selected = state.tracks.filter((track) => state.selectedIds.has(track.id));
    const mediaType = ui.mediaType.value;
    const tmdbId = toInt(ui.tmdbId.value);
    const groupKeys = validateSelection(selected, mediaType, tmdbId, null);
    return { selected, mediaType, tmdbId, groupKeys };
  }

  async function startBulkLink(options = {}) {
    let run;
    try {
      run = validateRun();
    } catch (error) {
      const message = formatError(error);
      updateLinkStatus(message, 'error');
      showToast(message, { kind: 'error' });
      return;
    }

    const job = buildLinkJob(run.selected, run.mediaType, run.tmdbId);

    if (state.running) {
      state.linkQueue.push(job);
      clearJobSelection(job);
      updateQueueStatus();
      log(`Queued link for ${job.trackIds.length} track(s) in “${getGroupLabel(job.groupKey)}”.`);
      updateLinkStatus(`Queued ${job.trackIds.length} track(s). Selection cleared — switch to the next group.`, 'ok');
      return;
    }

    if (run.mediaType === 'tv') await refreshSeasonCounts();
    const outOfRange = run.selected
      .map((track) => ({ track, issue: getEpisodeRangeIssue(track) }))
      .filter((entry) => entry.issue);
    if (options.skipConfirm && outOfRange.length) {
      log(`Auto-run paused: ${outOfRange.length} track(s) fall outside the TMDB season/episode range.`, 'error');
    }

    if (!options.skipConfirm || outOfRange.length) {
      const sample = run.selected[0];
      const samplePayload = buildPayload(sample, run.mediaType, run.tmdbId, job.settings);
      const labels = run.groupKeys.map(getGroupLabel);
      const titleSummary = labels.slice(0, 5).join(', ') + (labels.length > 5 ? ', …' : '');
      const requestCount = groupTracksByPayload(run.selected, run.mediaType, run.tmdbId, job.settings).length;
      const firstIssue = outOfRange[0];
      const rangeWarning = firstIssue
        ? `<dt>Outside TMDB range</dt><dd class="uba-error">${outOfRange.length.toLocaleString()} track(s) — e.g. track ${escapeHtml(firstIssue.track.id)}
           S${getApiSeason(firstIssue.track) ?? '—'}E${getApiEpisode(firstIssue.track) ?? '—'}: ${escapeHtml(firstIssue.issue)}.
           ${outOfRange.some((entry) => suggestTmdbNumbering(entry.track))
             ? 'Cancel and use “Remap to TMDB numbering” to convert per-season numbering.'
             : 'Check the episode offset or season before linking.'}</dd>`
        : '';
      const confirmed = await showConfirm({
        title: `Link ${run.selected.length.toLocaleString()} track(s)?`,
        bodyHtml: `
          <dl class="uba-confirm-dl">
            <dt>Title group(s)</dt>
            <dd>${escapeHtml(titleSummary || 'none')}</dd>
            <dt>Target</dt>
            <dd>${escapeHtml(run.mediaType)}, TMDB ${run.tmdbId}</dd>
            <dt>Requests</dt>
            <dd>${requestCount.toLocaleString()} (tracks sharing a season/episode are linked together)</dd>
            ${rangeWarning}
            <dt>First track</dt>
            <dd>${escapeHtml(String(sample.id))} — ${escapeHtml(sample.filename)}</dd>
            <dt>First payload</dt>
            <dd><code>${escapeHtml(JSON.stringify(samplePayload))}</code></dd>
          </dl>
          <p class="uba-help">Requests run sequentially. You can queue the next group while this one links.</p>
        `,
        confirmLabel: outOfRange.length ? 'Link anyway' : 'Link tracks',
      });
      if (!confirmed) return;
    }

    clearJobSelection(job);
    await runLinkJob(job);
  }

  async function runLinkJob(job) {
    let run;
    try {
      run = validateJob(job);
    } catch (error) {
      log(`Skipped link job: ${formatError(error)}`, 'error');
      updateLinkStatus(formatError(error), 'error');
      await continueAfterLinkJob(job, 0, 0, false, true);
      return;
    }

    state.running = true;
    state.abortController = new AbortController();
    state.lastRun = {
      startedAt: new Date().toISOString(),
      finishedAt: null,
      mediaType: run.mediaType,
      tmdbId: run.tmdbId,
      requestedTrackIds: run.selected.map((track) => track.id),
      successCount: 0,
      failureCount: 0,
      aborted: false,
      groupKey: run.groupKey,
    };
    setRunningUi(true);
    refreshGroupWorkStates([
      run.groupKey,
      ...state.linkQueue.map((job) => job.groupKey),
    ].filter(Boolean));
    if (run.groupKey && run.groupKey !== UNPARSED_GROUP && !getCachedTmdb(run.groupKey)) {
      const label =
        state.tmdbDetails?.tmdbId === run.tmdbId
          ? findLikelyTitle(state.tmdbDetails.details) || `TMDB ${run.tmdbId}`
          : `TMDB ${run.tmdbId}`;
      cacheTmdbForTitle(run.groupKey, run.mediaType, run.tmdbId, label);
    }
    const buckets = groupTracksByPayload(run.selected, run.mediaType, run.tmdbId, run.settings);
    const signal = state.abortController.signal;
    ui.progress.max = run.selected.length;
    ui.progress.value = 0;
    ui.progressText.textContent = `Starting 0/${run.selected.length.toLocaleString()}…`;
    log(`Linking ${run.selected.length.toLocaleString()} track(s) for “${getGroupLabel(run.groupKey)}” in ${buckets.length.toLocaleString()} request(s).`);

    let successCount = 0;
    let failureCount = 0;
    let aborted = false;
    let processed = 0;

    const refreshRows = (tracks) => {
      if (tracks.some((track) => !updateTrackRowStatus(track.id))) renderTrackTable();
    };

    try {
      for (const { payload, tracks } of buckets) {
        if (signal.aborted) {
          aborted = true;
          break;
        }

        for (const track of tracks) state.statuses.set(track.id, { state: 'running', message: 'Sending request' });
        refreshRows(tracks);
        ui.progressText.textContent = `Processing ${(processed + tracks.length).toLocaleString()}/${run.selected.length.toLocaleString()}: ${describePayload(payload)}`;

        let results;
        try {
          results = await sendLinkRequest(tracks, payload, signal);
        } catch (error) {
          if (error.name === 'AbortError') {
            for (const track of tracks) state.statuses.delete(track.id);
            refreshRows(tracks);
            aborted = true;
            break;
          }
          results = new Map(tracks.map((track) => [track.id, {
            ok: false,
            message: formatError(error),
            errorStatus: error.status ?? null,
            errorBody: error.body ?? null,
          }]));
        }

        const completedAt = new Date().toISOString();
        const linkedIds = [];
        for (const track of tracks) {
          const result = results.get(track.id);
          if (result.ok) {
            successCount += 1;
            linkedIds.push(track.id);
            state.statuses.set(track.id, { state: 'success', message: 'Linked successfully', payload, response: result.response, completedAt });
            state.selectedIds.delete(track.id);
          } else {
            failureCount += 1;
            state.statuses.set(track.id, {
              state: 'error',
              message: result.message,
              payload,
              errorStatus: result.errorStatus ?? null,
              errorBody: result.errorBody ?? null,
              completedAt,
            });
            log(`✗ Track ${track.id} (${describePayload(payload)}): ${result.message}`, 'error');
          }
        }
        if (linkedIds.length) log(`✓ ${describePayload(payload)}: linked track(s) ${linkedIds.join(', ')}.`);

        processed += tracks.length;
        ui.progress.value = processed;
        refreshRows(tracks);
        notifyGroupProgress(run.groupKey);

        if (processed < run.selected.length) {
          try {
            await abortableDelay(Math.max(0, toInt(ui.delay.value) || 0), signal);
          } catch {
            aborted = true;
            break;
          }
        }
      }
    } finally {
      await continueAfterLinkJob(job, successCount, failureCount, aborted, false);
    }
  }

  async function continueAfterLinkJob(job, successCount, failureCount, aborted, skipped) {
    state.running = false;
    state.abortController = null;
    setRunningUi(false);

    if (!skipped) {
      const remaining = job.trackIds.length - successCount - failureCount;
      const summary = aborted
        ? `Aborted. Success: ${successCount}; failed: ${failureCount}; not processed: ${remaining}.`
        : `Finished. Success: ${successCount}; failed: ${failureCount}; not processed: ${remaining}.`;
      ui.progressText.textContent = summary;
      log(summary, failureCount ? 'error' : 'info');
      Object.assign(state.lastRun, {
        finishedAt: new Date().toISOString(),
        successCount,
        failureCount,
        aborted,
        remainingCount: remaining,
      });
      refreshGroupUi({ rebuild: true });
      renderTrackTable();
    }

    if (aborted) {
      updateQueueStatus();
      return;
    }

    if (state.linkQueue.length) {
      const nextJob = state.linkQueue.shift();
      updateQueueStatus();
      log(`Starting queued link for “${getGroupLabel(nextJob.groupKey)}”.`);
      await runLinkJob(nextJob);
      return;
    }

    if (successCount > 0 && ui.autoAdvance?.checked) {
      advanceToNextReadyGroup(job.groupKey, true);
    }
  }

  function buildPayload(track, mediaType, tmdbId, settings = null) {
    const linkSettings = { ...(settings || snapshotLinkSettings()), mediaType };
    return {
      media_type: mediaType,
      tmdb_id: tmdbId,
      season_number: mediaType === 'tv' ? getApiSeason(track, linkSettings) : null,
      episode_number: mediaType === 'tv' ? getApiEpisode(track, linkSettings) : null,
    };
  }

  function groupTracksByPayload(tracks, mediaType, tmdbId, settings) {
    const buckets = new Map();
    for (const track of tracks) {
      const payload = buildPayload(track, mediaType, tmdbId, settings);
      const key = `${payload.season_number}|${payload.episode_number}`;
      if (!buckets.has(key)) buckets.set(key, { payload, tracks: [] });
      buckets.get(key).tracks.push(track);
    }
    return [...buckets.values()];
  }

  function describePayload(payload) {
    if (payload.media_type !== 'tv') return `movie ${payload.tmdb_id}`;
    return `S${payload.season_number ?? '—'}E${payload.episode_number}`;
  }

  async function sendLinkRequest(tracks, payload, signal) {
    const response = await apiRequest('/api/my-tracks/bulk/media-title', {
      method: 'PATCH',
      headers: getAuthHeaders(true),
      body: JSON.stringify({ track_ids: tracks.map((track) => Number(track.id)), ...payload }),
      signal,
    });
    const updated = new Set((response?.updated_track_ids || []).map(String));
    const failures = Array.isArray(response?.failures) ? response.failures : [];
    return new Map(tracks.map((track) => {
      if (updated.has(track.id)) return [track.id, { ok: true, response }];
      const failure = failures.find((item) => String(item?.track_id ?? item?.id) === track.id) || failures[0];
      return [track.id, { ok: false, message: failure?.detail || 'Not updated by the server.', errorBody: failure ?? response }];
    }));
  }

  function abortBulkLink() {
    const affectedGroups = [
      state.lastRun?.groupKey,
      ...state.linkQueue.map((job) => job.groupKey),
    ].filter(Boolean);
    state.abortController?.abort();
    state.linkQueue = [];
    updateQueueStatus();
    refreshGroupWorkStates(affectedGroups);
    log('Abort requested. Cleared link queue.');
  }

  function abortableDelay(ms, signal) {
    if (!ms) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          reject(new DOMException('Aborted', 'AbortError'));
        },
        { once: true },
      );
    });
  }

  function formatError(error) {
    if (!error) return 'Unknown error';
    let message = error.message || String(error);
    if (error.body != null) {
      const body = typeof error.body === 'string' ? error.body : JSON.stringify(error.body);
      if (body && !message.includes(body)) message += ` — ${body}`;
    }
    return message;
  }

  function dismissToast(toast) {
    if (!toast?.isConnected) return;
    if (toast.dataset.timer) clearTimeout(Number(toast.dataset.timer));
    toast.remove();
  }

  function showToast(message, { kind = 'info', duration = TOAST_DEFAULT_MS, actionLabel = '', onAction = null } = {}) {
    if (!ui.toastStack || !message) return;
    const toast = document.createElement('div');
    toast.className = `uba-toast uba-toast-${kind}`;
    toast.setAttribute('role', kind === 'error' ? 'alert' : 'status');

    const text = document.createElement('div');
    text.textContent = message;
    toast.appendChild(text);

    const actions = document.createElement('div');
    actions.className = 'uba-toast-actions';

    if (actionLabel && onAction) {
      const actionBtn = document.createElement('button');
      actionBtn.type = 'button';
      actionBtn.className = 'uba-btn';
      actionBtn.textContent = actionLabel;
      actionBtn.addEventListener('click', () => {
        onAction();
        dismissToast(toast);
      });
      actions.appendChild(actionBtn);
    }

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'uba-toast-close';
    closeBtn.title = 'Dismiss';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', () => dismissToast(toast));
    actions.appendChild(closeBtn);

    toast.appendChild(actions);
    ui.toastStack.prepend(toast);

    if (duration > 0) {
      toast.dataset.timer = String(setTimeout(() => dismissToast(toast), duration));
    }
  }

  function closeConfirm(result) {
    if (!ui.confirmBackdrop) return;
    ui.confirmBackdrop.classList.add('uba-hidden');
    if (state.confirmResolver) {
      const resolver = state.confirmResolver;
      state.confirmResolver = null;
      resolver(result);
    }
  }

  function showConfirm({ title, bodyHtml, confirmLabel = 'Confirm', cancelLabel = 'Cancel' }) {
    return new Promise((resolve) => {
      if (!ui.confirmBackdrop) {
        resolve(false);
        return;
      }
      if (state.confirmResolver) state.confirmResolver(false);
      state.confirmResolver = resolve;
      ui.confirmTitle.textContent = title;
      ui.confirmBody.innerHTML = bodyHtml;
      ui.confirmOk.textContent = confirmLabel;
      ui.confirmCancel.textContent = cancelLabel;
      ui.confirmBackdrop.classList.remove('uba-hidden');
      ui.confirmOk.focus();
    });
  }

  function log(message, level = 'info') {
    if (!ui.log) return;
    const timestamp = new Date().toLocaleTimeString();
    ui.log.textContent += `\n[${timestamp}] ${level === 'error' ? 'ERROR' : 'INFO'} ${message}`;
    ui.log.scrollTop = ui.log.scrollHeight;
  }

  async function copyReport() {
    const relevantTracks = state.tracks.filter((track) => state.statuses.has(track.id) || state.selectedIds.has(track.id));
    const report = {
      generated_at: new Date().toISOString(),
      route: location.href,
      loaded_track_count: state.tracks.length,
      current_selection_count: state.selectedIds.size,
      last_run: state.lastRun,
      totals: {
        success: [...state.statuses.values()].filter((status) => status.state === 'success').length,
        failed: [...state.statuses.values()].filter((status) => status.state === 'error').length,
        running: [...state.statuses.values()].filter((status) => status.state === 'running').length,
      },
      tracks: relevantTracks.map((track) => ({
        id: track.id,
        filename: track.filename,
        parsed_title: track.title,
        display_title: track.displayTitle,
        parsed_year: track.year,
        group_key: getTrackGroupKey(track),
        group_label: getGroupLabel(getTrackGroupKey(track)),
        uploader: track.uploader,
        parsed_season: track.season,
        parsed_episode: track.episode,
        api_season: getApiSeason(track),
        api_episode: getApiEpisode(track),
        selected: state.selectedIds.has(track.id),
        status: state.statuses.get(track.id) || null,
      })),
    };

    try {
      await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
      const message = `Run report copied (${relevantTracks.length.toLocaleString()} relevant track record(s)).`;
      log(message);
      showToast(message, { kind: 'ok' });
    } catch (error) {
      pageWindow.__ukrabBulkAssistantReport = report;
      const message = `Could not copy report: ${formatError(error)}. Saved to window.__ukrabBulkAssistantReport.`;
      log(message, 'error');
      showToast(message, { kind: 'error', duration: 10000 });
    }
  }

  function observeRoute() {
    const onRouteChange = () => {
      const endpoint = getUnlinkedEndpoint();
      if (endpoint !== state.lastRouteEndpoint) {
        state.lastRouteEndpoint = endpoint;
        if (!document.getElementById(PANEL_ID) && endpoint) createPanel();
        updateRouteStatus();
        if (endpoint && endpoint !== state.loadedEndpoint && !state.loading) setTimeout(loadUnlinkedTracks, 500);
      }
    };

    pageWindow.addEventListener('popstate', onRouteChange);
    setInterval(onRouteChange, 1000);
    onRouteChange();
  }

  const initialise = () => {
    readCsrfToken();
    observeRoute();
    if (isTargetRoute()) createPanel();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialise, { once: true });
  } else {
    initialise();
  }
})();
