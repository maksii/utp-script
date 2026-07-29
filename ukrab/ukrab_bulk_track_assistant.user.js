// ==UserScript==
// @name         Ukrab.work Bulk Track Assistant
// @namespace    https://ukrab.work/
// @version      0.4.5
// @description  Load unlinked tracks, parse filenames, match TMDB, and link tracks in bulk with queued workflow.
// @match        https://ukrab.work/*
// @run-at       document-start
// @grant        unsafeWindow
// @updateURL    https://raw.githubusercontent.com/maksii/utp-script/main/ukrab/ukrab_bulk_track_assistant.user.js
// @downloadURL  https://raw.githubusercontent.com/maksii/utp-script/main/ukrab/ukrab_bulk_track_assistant.user.js
// ==/UserScript==

(() => {
  'use strict';

  const TARGET_HASH_PREFIX = '#/my-tracks/unlinked';
  const AUTH_STORAGE_KEY = 'audio_bucket_auth_token';
  const UNLINKED_ENDPOINT = '/api/my-library/unlinked?sort_by=created_at&sort_direction=desc';
  const PANEL_ID = 'ukrab-bulk-assistant';
  const STYLE_ID = 'ukrab-bulk-assistant-style';
  const UNPARSED_GROUP = '__UBA_UNPARSED__';
  const DEFAULT_RENDER_LIMIT = 250;
  const TMDB_CACHE_KEY = 'ukrab_bulk_assistant_tmdb_cache_v1';
  const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w154';
  const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

  const PATTERN_FRAGMENTS = {
    seasonLabel: String.raw`^(?<title>.+?)\s*\(\s*(?:Сезон|Season)\s*(?<season>\d{1,3})\s*\)\s*[-–—]\s*(?<episode>\d{1,5})(?=\D|$)`,
    sxxExx: String.raw`^(?<title>.+?)[\s._-]+S(?<season>\d{1,3})(?:EP|E)(?<episode>\d{1,5})(?=\D|$)`,
    sxxexxLower: String.raw`^(?<title>.+?)[\s._-]+s(?<season>\d{1,3})e(?<episode>\d{1,5})(?=\D|$)`,
    sSeasonDashEp: String.raw`^(?<title>.+?)\s+s(?<season>\d{1,3})\s*[-–—]\s*(?<episode>\d{1,5})(?=\D|$)`,
    titleSeasonEpDash: String.raw`^(?<title>.+?)\s*[-–—]\s*(?<season>\d{1,3})\s*[-–—]\s*(?<episode>\d{1,5})(?=\D|$)`,
    titleSpaceSeasonEp: String.raw`^(?<title>.+?)\s+(?<season>\d{1,3})\s+(?<episode>\d{1,5})(?=_track)`,
    titleSpaceEpTrack: String.raw`^(?<title>.+?)\s+(?<episode>\d{1,5})(?=_track)`,
    dashEp: String.raw`^(?<title>.+?)\s*[-–—]\s*(?<episode>\d{1,5})(?=\s|_track|\.|$)`,
    aniuaBracketEp: String.raw`^(?:\[[^\]]+\]_)?(?<title>.+?)_\[(?<episode>\d{1,5})\]_`,
    specVypusk: String.raw`^(?<title>.+?)\s*[-–—]\s*(?:спецвипуск|спец\.?\s*вип\.?|special)\s*(?<episode>\d{1,5})`,
    bracketEpBeforeParen: String.raw`^(?<title>.+?)\s*\[(?<episode>\d{1,5})\]\s*\(`,
    titleSpaceEpParen: String.raw`^(?<title>.+?)\s+(?<episode>\d{1,5})\s*\(`,
    titleSpaceEpBracket: String.raw`^(?<title>.+?)\s+(?<episode>\d{1,5})\s*\[`,
    multiBracketEp: String.raw`^\[(?<title>.+?)\](?:\[[^\]]+\])+\[(?<episode>\d{1,5})\]`,
    eEpisode: String.raw`^(?<title>.+?)\s+E(?<episode>\d{1,5})(?=\s|\[|_|-|$)`,
    dashOvaEp: String.raw`^(?<title>.+?)\s*[-–—]\s*OVA\s*(?<episode>\d{1,5})?(?=\s|\[|_|\(|\.|$)`,
    dashEpBeforeParen: String.raw`^(?<title>.+?)\s*[-–—]\s*.+?\s+(?<episode>\d{1,5})\s*\(`,
    bracketNumPrefix: String.raw`^\[\d{1,3}\]\s*(?<title>.+?)(?:_track\d+)?(?:\.[^.]+)?$`,
    movieYear: String.raw`^(?<title>.+?)\s*\(\d{4}\).*?(?:_track\d+)?(?:\.[^.]+)?$`,
    movieNoYear: String.raw`^(?<title>.+?)(?:\s+(?:WEBRip|BDRip|BluRay|HDTV|DVDRip|WEB-DL)).*?(?:_track\d+)?(?:\.[^.]+)?$`,
    numberedListPrefix: String.raw`^\d{1,2}\.?\s*(?<title>[A-Za-zА-Яа-яІіЇїЄєҐґ].+?)(?:_track\d+)?(?:\.[^.]+)?$`,
    movie: String.raw`^(?<title>.+?)(?:_track\d+)?(?:\.[^.]+)?$`,
  };

  const TV_PATTERNS = [
    PATTERN_FRAGMENTS.seasonLabel,
    PATTERN_FRAGMENTS.sxxExx,
    PATTERN_FRAGMENTS.sxxexxLower,
    PATTERN_FRAGMENTS.sSeasonDashEp,
    PATTERN_FRAGMENTS.titleSeasonEpDash,
    PATTERN_FRAGMENTS.titleSpaceSeasonEp,
    PATTERN_FRAGMENTS.titleSpaceEpTrack,
    PATTERN_FRAGMENTS.dashEp,
    PATTERN_FRAGMENTS.aniuaBracketEp,
    PATTERN_FRAGMENTS.specVypusk,
    PATTERN_FRAGMENTS.bracketEpBeforeParen,
    PATTERN_FRAGMENTS.titleSpaceEpParen,
    PATTERN_FRAGMENTS.titleSpaceEpBracket,
    PATTERN_FRAGMENTS.multiBracketEp,
    PATTERN_FRAGMENTS.eEpisode,
    PATTERN_FRAGMENTS.dashOvaEp,
    PATTERN_FRAGMENTS.dashEpBeforeParen,
  ];

  const AUTO_PATTERNS = [
    ...TV_PATTERNS,
    PATTERN_FRAGMENTS.bracketNumPrefix,
    PATTERN_FRAGMENTS.movieYear,
    PATTERN_FRAGMENTS.movieNoYear,
    PATTERN_FRAGMENTS.numberedListPrefix,
    PATTERN_FRAGMENTS.movie,
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
      label: 'Title Season Episode _track (РГ style)',
      patterns: [PATTERN_FRAGMENTS.titleSpaceSeasonEp, PATTERN_FRAGMENTS.titleSpaceEpTrack],
    },
    'aniua-bracket': {
      label: 'AniUA: Title_[Episode]_...',
      patterns: [PATTERN_FRAGMENTS.aniuaBracketEp],
    },
    'spec-vypusk': {
      label: 'Title - спецвипуск NN ...',
      patterns: [PATTERN_FRAGMENTS.specVypusk],
    },
    'title-space-ep': {
      label: 'Title NN (release) / Title NN [release]',
      patterns: [PATTERN_FRAGMENTS.titleSpaceEpParen, PATTERN_FRAGMENTS.titleSpaceEpBracket],
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
    authToken: '',
    loading: false,
    loaded: false,
    running: false,
    abortController: null,
    tmdbDetails: null,
    tmdbResults: [],
    lastRouteMatched: false,
    lastRun: null,
    tmdbCache: {},
    selectedTmdbIndex: -1,
    groupOrder: [],
    linkQueue: [],
    groupTrackIds: new Map(),
    groupStatsCache: new Map(),
    manualOverrides: new Map(),
  };

  const ui = {};

  function isTargetRoute() {
    return location.hash.startsWith(TARGET_HASH_PREFIX);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function normaliseToken(value) {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    const bearerMatch = trimmed.match(/^Bearer\s+(.+)$/i);
    return (bearerMatch ? bearerMatch[1] : trimmed).trim();
  }

  function extractTokenFromStorageValue(raw) {
    if (!raw) return '';
    let value = String(raw).trim();
    if (!value) return '';

    if (value.startsWith('{') || value.startsWith('[') || value.startsWith('"')) {
      try {
        const parsed = JSON.parse(value);
        if (typeof parsed === 'string') value = parsed;
        else if (typeof parsed?.access_token === 'string') value = parsed.access_token;
        else if (typeof parsed?.token === 'string') value = parsed.token;
      } catch {
        /* keep raw string */
      }
    }

    return normaliseToken(value);
  }

  function readAuthToken() {
    try {
      const raw = pageWindow.localStorage?.getItem(AUTH_STORAGE_KEY);
      state.authToken = extractTokenFromStorageValue(raw);
    } catch {
      state.authToken = '';
    }
    updateAuthIndicator();
    return !!state.authToken;
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
      #${PANEL_ID} .uba-cell-input:disabled {
        opacity: .65;
        cursor: not-allowed;
      }
      #${PANEL_ID} .uba-fixed-value { color: #6c757d; }
      #${PANEL_ID} .uba-inline { display: flex; align-items: center; gap: 6px; }
      #${PANEL_ID} .uba-inline input[type="checkbox"] { width: auto; }
      #${PANEL_ID} .uba-hidden { display: none !important; }
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
        <div class="uba-title">Ukrab Bulk Track Assistant v0.4.4</div>
        <div class="uba-header-actions">
          <button type="button" data-action="collapse" title="Collapse">−</button>
          <button type="button" data-action="close" title="Hide">×</button>
        </div>
      </div>
      <div class="uba-body">
        <div class="uba-grid">
          <div class="uba-status-row">
            <div class="uba-notice" data-role="route-status"></div>
            <div class="uba-notice" data-role="auth-status">Reading auth token…</div>
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
              <option value="rg-space">Title Season Episode _track (РГ style)</option>
              <option value="aniua-bracket">AniUA: Title_[Episode]_...</option>
              <option value="spec-vypusk">Title - спецвипуск NN ...</option>
              <option value="title-space-ep">Title NN (release) / Title NN [release]</option>
              <option value="movie">Movie: use filename as title</option>
              <option value="custom">Custom regex</option>
            </select>
          </div>
          <div class="uba-col-3">
            <label for="uba-delay">Delay after success, ms</label>
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
              <label for="uba-filter">Filename / title filter</label>
              <input id="uba-filter" type="text" placeholder="Example: Arabasta">
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
            <div class="uba-col-12">
              <div class="uba-buttons">
                <button class="uba-btn" type="button" data-action="select-matching">Select all matching</button>
                <button class="uba-btn" type="button" data-action="deselect-matching">Deselect matching</button>
                <button class="uba-btn" type="button" data-action="select-none">Select none</button>
                <button class="uba-btn" type="button" data-action="select-failed">Select failed</button>
                <button class="uba-btn" type="button" data-action="reset-manual-se" disabled>Reset manual S/E</button>
                <button class="uba-btn" type="button" data-action="reparse">Reparse all</button>
              </div>
            </div>
          </div>
          <div class="uba-notice" data-role="selection-summary">No tracks loaded.</div>
          <div class="uba-split">
            <div class="uba-split-side">
              <label>Quick group list (click to jump)</label>
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
              <label for="uba-tmdb-query">TMDB title search</label>
              <input id="uba-tmdb-query" type="text" placeholder="Uma Musume">
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
            Episode offset is added to each parsed episode before linking. Manual per-track E values in the table override the offset. Fixed season applies to all tracks and overrides per-track S edits.
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
    `;

    document.body.appendChild(panel);

    Object.assign(ui, {
      panel,
      routeStatus: panel.querySelector('[data-role="route-status"]'),
      authStatus: panel.querySelector('[data-role="auth-status"]'),
      dataStatus: panel.querySelector('[data-role="data-status"]'),
      preset: panel.querySelector('#uba-preset'),
      pattern: panel.querySelector('#uba-pattern'),
      episodeOffset: panel.querySelector('#uba-episode-offset'),
      delay: panel.querySelector('#uba-delay'),
      titleGroup: panel.querySelector('#uba-title-group'),
      filter: panel.querySelector('#uba-filter'),
      statusFilter: panel.querySelector('#uba-status-filter'),
      stripBracket: panel.querySelector('#uba-strip-bracket'),
      autoAdvance: panel.querySelector('#uba-auto-advance'),
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
      start: panel.querySelector('[data-action="start"]'),
      abort: panel.querySelector('[data-action="abort"]'),
      resetManualSe: panel.querySelector('[data-action="reset-manual-se"]'),
    });

    loadTmdbCache();

    ui.pattern.value = PRESETS['auto-anime'].patterns.join('\n\nOR\n\n');
    ui.pattern.readOnly = true;

    panel.addEventListener('click', handlePanelClick);
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
      renderGroupList();
    });
    ui.filter.addEventListener('input', renderTrackTable);
    ui.statusFilter.addEventListener('change', renderTrackTable);
    ui.stripBracket.addEventListener('change', () => {
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
    });
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
      renderGroupList();
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
    readAuthToken();
    pageWindow.addEventListener('storage', (event) => {
      if (event.key === AUTH_STORAGE_KEY) readAuthToken();
    });
    updateMediaTypeControls();
    renderTrackTable();
    updateQueueStatus();

    if (isTargetRoute() && !state.loaded && !state.loading) {
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
    if (state.running && ['load-api', 'reparse'].includes(action)) return;

    const actions = {
      'load-api': loadUnlinkedTracks,
      reparse: reparseTracks,
      'prev-group': () => navigateGroup(-1),
      'next-group': () => navigateGroup(1),
      'select-group-pending': selectGroupPending,
      'select-matching': () => selectMatching(true),
      'deselect-matching': () => selectMatching(false),
      'select-none': selectNone,
      'select-failed': selectFailed,
      'reset-manual-se': resetManualOverrides,
      'search-tmdb': searchTmdb,
      start: startBulkLink,
      abort: abortBulkLink,
      'copy-report': copyReport,
    };

    Promise.resolve(actions[action]?.()).catch((error) => {
      log(`Unexpected error: ${formatError(error)}`, 'error');
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

  function compilePatterns() {
    const preset = PRESETS[ui.preset.value];
    const sourcePatterns = preset?.patterns ?? [ui.pattern.value];

    try {
      return sourcePatterns.map((pattern) => new RegExp(pattern, 'i'));
    } catch (error) {
      throw new Error(`Invalid filename regex: ${error.message}`);
    }
  }

  function normaliseParsedTitle(value) {
    return String(value ?? '')
      .trim()
      .replace(/[._]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function stripBracketPrefix(value) {
    return String(value ?? '')
      .replace(/^\[[^\]]+\]\s*/, '')
      .trim();
  }

  function shouldStripBracket() {
    return ui.stripBracket?.checked ?? true;
  }

  function getDisplayTitle(rawTitle) {
    const title = normaliseParsedTitle(rawTitle);
    if (!title) return '';
    return shouldStripBracket() ? stripBracketPrefix(title) : title;
  }

  function getTrackGroupKey(track) {
    const raw = track.title || UNPARSED_GROUP;
    if (raw === UNPARSED_GROUP) return UNPARSED_GROUP;
    return getDisplayTitle(raw) || UNPARSED_GROUP;
  }

  function getTmdbSearchTitle(rawTitle) {
    return getDisplayTitle(rawTitle);
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

  function getCachedTmdb(titleKey) {
    return titleKey && titleKey !== UNPARSED_GROUP ? state.tmdbCache[titleKey] : null;
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
    for (const id of trackIds) {
      const trackState = state.statuses.get(id)?.state;
      if (trackState === 'success') linked += 1;
      else if (trackState === 'error') failed += 1;
    }
    const stats = {
      total: trackIds.length,
      linked,
      failed,
      pending: trackIds.length - linked,
    };
    state.groupStatsCache.set(groupKey, stats);
    return stats;
  }

  function invalidateGroupStats(groupKey = '') {
    if (groupKey) state.groupStatsCache.delete(groupKey);
    else state.groupStatsCache.clear();
  }

  function formatGroupBadge(stats) {
    const parts = [`${stats.pending} pending`, `${stats.linked} linked`];
    if (stats.failed > 0) parts.push(`${stats.failed} failed`);
    return parts.join(' · ');
  }

  function refreshGroupUi(options = {}) {
    if (options.rebuild) rebuildTitleGroups();
    refreshTitleGroupSelect();
    renderGroupList();
  }

  function formatJobGroupLabel(groupKey) {
    return groupKey === UNPARSED_GROUP ? 'Unparsed' : groupKey || 'mixed titles';
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

  function notifyGroupProgress(groupKey) {
    if (!groupKey) return;
    invalidateGroupStats(groupKey);
    refreshGroupUi();
  }

  function applyGroupContext() {
    const titleKey = ui.titleGroup?.value || '';
    const searchTitle = titleKey && titleKey !== UNPARSED_GROUP ? titleKey : '';
    if (searchTitle) {
      ui.tmdbQuery.value = searchTitle;
      state.tmdbResults = [];
      state.selectedTmdbIndex = -1;
      renderTmdbResults();
    }

    const cached = getCachedTmdb(searchTitle);
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
      return;
    }

    state.tmdbDetails = null;
    state.selectedTmdbIndex = -1;
    ui.tmdbId.value = '';
    renderTmdbSelected(null);
    updateLinkStatus(searchTitle ? 'Search TMDB and pick a result for this group.' : 'Select a title group to begin.');
  }

  function selectCurrentGroupTracks(options = {}) {
    const { silent = false } = options;
    const group = ui.titleGroup?.value || '';
    if (!group) {
      if (!silent) alert('Select a title group first.');
      return false;
    }
    state.selectedIds.clear();
    for (const track of state.tracks) {
      if (getTrackGroupKey(track) !== group) continue;
      if (!isTrackPending(track.id)) continue;
      state.selectedIds.add(track.id);
    }
    renderTrackTable();
    if (!silent) log(`Selected pending tracks in group “${group === UNPARSED_GROUP ? 'Unparsed' : group}”.`);
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
    renderGroupList();
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
    renderGroupList();
    renderTrackTable();
    log(`Advanced to ready group: “${nextKey}”.`);
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

  function buildLinkJob(selected, mediaType, tmdbId, groupKey = '') {
    return {
      groupKey: groupKey || ui.titleGroup?.value || '',
      trackIds: selected.map((track) => track.id),
      mediaType,
      tmdbId,
      parsedTitles: [...new Set(selected.map((track) => getDisplayTitle(track.title)).filter(Boolean))],
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
      return;
    }

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

  function ingestTrackPayload(payload, sourceLabel = 'API') {
    const normalised = normaliseApiTracks(payload);
    const existingIds = new Set(normalised.tracks.map((track) => track.id));

    state.tracks = normalised.tracks;
    state.selectedIds = new Set([...state.selectedIds].filter((id) => existingIds.has(id)));
    state.statuses = new Map([...state.statuses].filter(([id]) => existingIds.has(id)));
    state.manualOverrides = new Map([...state.manualOverrides].filter(([id]) => existingIds.has(id)));
    state.loaded = true;

    rebuildTitleGroups();
    refreshTitleGroupSelect();
    renderGroupList();
    renderTrackTable();
    updateDataStatus(
      `Loaded ${state.tracks.length.toLocaleString()} unique track(s) from ${normalised.groupCount.toLocaleString()} group(s) via ${sourceLabel}` +
        (normalised.declaredTrackCount && normalised.declaredTrackCount !== state.tracks.length
          ? `; API-declared count ${normalised.declaredTrackCount.toLocaleString()}.`
          : '.'),
      'ok',
    );
    log(`Loaded ${state.tracks.length.toLocaleString()} track(s) from ${sourceLabel}.`);
  }

  function parseFilename(filename) {
    const value = String(filename ?? '');
    const bracketTag = extractBracketTag(value);
    const stripped = stripBracketPrefix(value);
    const regexes = compilePatterns();
    let match = null;
    let patternIndex = -1;

    for (let index = 0; index < regexes.length; index += 1) {
      const regex = regexes[index];
      match = value.match(regex) || (stripped !== value ? stripped.match(regex) : null);
      if (match) {
        patternIndex = index;
        break;
      }
    }

    if (!match) return { title: '', season: null, episode: null, parseError: 'No match', patternIndex: -1, bracketTag };

    const groups = match.groups || {};
    const title = normaliseParsedTitle(groups.title);
    const season = groups.season == null || groups.season === '' ? null : Number.parseInt(groups.season, 10);
    const episode = groups.episode == null || groups.episode === '' ? null : Number.parseInt(groups.episode, 10);

    return {
      title,
      season: Number.isInteger(season) ? season : null,
      episode: Number.isInteger(episode) ? episode : null,
      parseError: title ? '' : 'Missing title group',
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
          filename,
          displayName: String(rawTrack.display_name || filename),
          type: rawTrack.type ?? null,
          language: rawTrack.language ?? null,
          createdAt: rawTrack.created_at ?? null,
          apiGroupKey: group.groupKey,
          ...parseFilename(filename),
        });
      }
    }

    return {
      tracks: [...found.values()],
      groupCount: groups.length,
      declaredTrackCount: groups.reduce((total, group) => total + (Number(group.declaredTrackCount) || 0), 0),
    };
  }

  async function loadUnlinkedTracks() {
    if (state.loading || state.running) return;
    if (!isTargetRoute()) {
      updateRouteStatus();
      log(`Open ${TARGET_HASH_PREFIX} before loading.`, 'error');
      return;
    }

    try {
      compilePatterns();
    } catch (error) {
      alert(formatError(error));
      return;
    }

    readAuthToken();
    state.loading = true;
    setLoadingUi(true);
    updateDataStatus('Loading the unlinked-track JSON response…');
    log(`Loading ${UNLINKED_ENDPOINT}.`);

    try {
      const payload = await apiRequest(UNLINKED_ENDPOINT, {
        method: 'GET',
        headers: getAuthHeaders(false),
      });
      ingestTrackPayload(payload, UNLINKED_ENDPOINT);
    } catch (error) {
      if (error.status === 401 || error.status === 403) readAuthToken();
      updateDataStatus(`API load failed: ${formatError(error)}`, 'error');
      log(`API load failed: ${formatError(error)}`, 'error');
    } finally {
      state.loading = false;
      setLoadingUi(false);
    }
  }

  function reparseTracks() {
    try {
      compilePatterns();
      state.tracks = state.tracks.map((track) => ({ ...track, ...parseFilename(track.filename) }));
      rebuildTitleGroups();
      refreshTitleGroupSelect();
      renderGroupList();
      renderTrackTable();
      log(`Reparsed ${state.tracks.length.toLocaleString()} track(s).`);
    } catch (error) {
      log(formatError(error), 'error');
      alert(formatError(error));
    }
  }

  function rebuildTitleGroups() {
    const groups = new Map();
    state.groupTrackIds = new Map();
    for (const track of state.tracks) {
      const key = getTrackGroupKey(track);
      groups.set(key, (groups.get(key) || 0) + 1);
      if (!state.groupTrackIds.has(key)) state.groupTrackIds.set(key, []);
      state.groupTrackIds.get(key).push(track.id);
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
        return titleA.localeCompare(titleB, undefined, { sensitivity: 'base', numeric: true });
      }),
    );
    state.groupOrder = [...state.titleGroups.keys()];
  }

  function renderGroupList() {
    if (!ui.groupList) return;
    const active = ui.titleGroup?.value || '';
    const items = [...state.titleGroups.entries()].slice(0, 80);
    ui.groupList.innerHTML = items
      .map(([key, count]) => {
        const stats = getGroupStats(key);
        const label = key === UNPARSED_GROUP ? 'Unparsed' : key;
        const badge = formatGroupBadge(stats);
        const done = stats.pending === 0 && stats.total > 0;
        return `
          <div class="uba-group-item" data-group-key="${escapeHtml(key)}" data-active="${key === active}" data-done="${done}">
            <span>${escapeHtml(label)}</span>
            <span class="uba-badge">${badge} / ${count.toLocaleString()}</span>
          </div>
        `;
      })
      .join('');
  }

  function refreshTitleGroupSelect() {
    if (!ui.titleGroup) return;
    const previous = ui.titleGroup.value;
    const options = ['<option value="">All parsed titles</option>'];
    for (const [title, count] of state.titleGroups) {
      const stats = getGroupStats(title);
      const label =
        title === UNPARSED_GROUP
          ? `Unparsed (${stats.pending} pending / ${count.toLocaleString()})`
          : `${title} (${stats.pending} pending / ${count.toLocaleString()})`;
      options.push(`<option value="${escapeHtml(title)}">${escapeHtml(label)}</option>`);
    }
    ui.titleGroup.innerHTML = options.join('');
    if ([...ui.titleGroup.options].some((option) => option.value === previous)) ui.titleGroup.value = previous;
  }

  function getSelectedGroupTitle() {
    const value = ui.titleGroup?.value || '';
    return value && value !== UNPARSED_GROUP ? value : '';
  }

  function getMatchingTracks() {
    const group = ui.titleGroup?.value || '';
    const filter = ui.filter?.value.trim().toLocaleLowerCase() || '';
    return state.tracks.filter((track) => {
      if (!matchesStatusFilter(track)) return false;
      const groupKey = getTrackGroupKey(track);
      if (group) {
        if (group === UNPARSED_GROUP && groupKey !== UNPARSED_GROUP) return false;
        if (group !== UNPARSED_GROUP && groupKey !== group) return false;
      }
      const displayTitle = getDisplayTitle(track.title);
      if (filter && !`${displayTitle}\n${track.title}\n${track.filename}`.toLocaleLowerCase().includes(filter)) return false;
      return true;
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
    updateResetManualButton();
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
    updateResetManualButton();
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
    let title = manual ? 'Manual override (episode offset ignored)' : `Parsed ${track.episode ?? '—'}`;
    if (!manual && offset !== 0) title += `, offset ${offset}`;

    const className = manual ? 'uba-manual-input' : offset !== 0 && Number.isInteger(track.episode) ? 'uba-has-offset' : '';
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

  function renderTrackTable() {
    if (!ui.trackBody) return;
    const matching = sortTracksForDisplay(getMatchingTracks());
    const limit = Math.max(1, Number.parseInt(ui.renderLimit.value, 10) || DEFAULT_RENDER_LIMIT);
    const rendered = matching.slice(0, limit);

    ui.trackBody.innerHTML = rendered
      .map((track) => {
        const status = state.statuses.get(track.id);
        const checked = state.selectedIds.has(track.id) ? 'checked' : '';
        const displayTitle = getDisplayTitle(track.title) || `⚠ ${track.parseError || 'Unparsed'}`;
        const statusLabel = getTrackStatusLabel(track.id);
        const patternHint = Number.isInteger(track.patternIndex) && track.patternIndex >= 0 ? `#${track.patternIndex + 1}` : '';
        return `
          <tr data-track-id="${track.id}" data-status="${escapeHtml(status?.state || '')}">
            <td><input type="checkbox" data-track-checkbox="${track.id}" ${checked}></td>
            <td class="uba-number">${track.id}</td>
            <td>${escapeHtml(displayTitle)}${patternHint ? `<div class="uba-pattern-tag">${patternHint}</div>` : ''}</td>
            <td class="uba-number">${formatSeasonCell(track)}</td>
            <td class="uba-number">${formatEpisodeCell(track)}</td>
            <td>${escapeHtml(statusLabel)}</td>
            <td class="uba-file" title="${escapeHtml(track.filename)}">${escapeHtml(track.filename)}</td>
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
  }

  function updateSelectionSummary(matching = getMatchingTracks(), renderedCount = null) {
    if (!ui.selectionSummary) return;
    const selected = state.tracks.filter((track) => state.selectedIds.has(track.id));
    const selectedParseFailures = selected.filter(
      (track) => !track.title || (ui.mediaType.value === 'tv' && !Number.isInteger(getApiEpisode(track))),
    );
    const displayCount = renderedCount ?? Math.min(matching.length, Number.parseInt(ui.renderLimit.value, 10) || DEFAULT_RENDER_LIMIT);
    ui.selectionSummary.textContent =
      `${state.tracks.length.toLocaleString()} loaded · ${matching.length.toLocaleString()} matching · ` +
      `${displayCount.toLocaleString()} rendered · ${selected.length.toLocaleString()} selected · ` +
      `${selectedParseFailures.length.toLocaleString()} selected with missing required parsing`;
    ui.selectionSummary.className = 'uba-notice';
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
      ui.routeStatus.textContent = 'Target route detected. Track data is loaded from the unlinked-library API.';
      ui.routeStatus.className = 'uba-notice uba-ok';
    } else {
      ui.routeStatus.textContent = `Inactive on this route. Open ${TARGET_HASH_PREFIX}.`;
      ui.routeStatus.className = 'uba-notice uba-warning';
    }
  }

  function updateAuthIndicator() {
    if (!ui.authStatus) return;
    if (state.authToken) {
      ui.authStatus.textContent = 'Signed in — auth token loaded from localStorage.';
      ui.authStatus.className = 'uba-notice uba-ok';
    } else {
      ui.authStatus.textContent = `Not signed in — log in on ukrab.work so ${AUTH_STORAGE_KEY} is available.`;
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
  }

  function setRunningUi(running) {
    ui.abort.disabled = !running;
    if (ui.start) ui.start.textContent = running ? 'Queue link' : 'Link selected tracks';
  }

  function getAuthHeaders(includeJson = false) {
    readAuthToken();
    const headers = new (pageWindow.Headers || Headers)();
    headers.set('Accept', 'application/json');
    if (includeJson) headers.set('Content-Type', 'application/json');
    if (state.authToken) headers.set('Authorization', `Bearer ${state.authToken}`);
    return headers;
  }

  async function apiRequest(path, options = {}) {
    readAuthToken();
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
            popularity: Number(value.popularity) || 0,
            posterPath: String(value.poster_path || '').trim(),
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
    return `${TMDB_IMAGE_BASE}${posterPath.startsWith('/') ? posterPath : `/${posterPath}`}`;
  }

  function sortTmdbResults(results, preferredType = '') {
    return [...results].sort((a, b) => {
      if (preferredType === 'tv' || preferredType === 'movie') {
        if (a.mediaType === preferredType && b.mediaType !== preferredType) return -1;
        if (b.mediaType === preferredType && a.mediaType !== preferredType) return 1;
      }
      return (b.popularity || 0) - (a.popularity || 0);
    });
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
    const groupTitle = getSelectedGroupTitle();
    if (groupTitle) return groupTitle;

    const selected = state.tracks.filter((track) => state.selectedIds.has(track.id) && track.title);
    if (selected.length) {
      const counts = new Map();
      selected.forEach((track) => {
        const key = getDisplayTitle(track.title);
        counts.set(key, (counts.get(key) || 0) + 1);
      });
      return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    }
    return ui.filter.value.trim();
  }

  async function searchTmdb() {
    selectCurrentGroupTracks({ silent: true });
    const queryText = deriveTmdbQuery();
    const requestedType = ui.searchMediaType.value;
    if (!queryText) {
      alert('Enter a TMDB search query or select a parsed title group.');
      return;
    }

    ui.tmdbQuery.value = queryText;
    updateTmdbSearchStatus(`Searching for “${queryText}”…`);
    state.tmdbResults = [];
    state.selectedTmdbIndex = -1;
    renderTmdbResults();
    renderTmdbSelected(null);

    try {
      const query = new URLSearchParams({ q: queryText, media_type: requestedType });
      const payload = await apiRequest(`/api/titles/search?${query}`, {
        method: 'GET',
        headers: getAuthHeaders(false),
      });
      const preferredType = ui.mediaType?.value === 'movie' ? 'movie' : ui.mediaType?.value === 'tv' ? 'tv' : '';
      state.tmdbResults = sortTmdbResults(collectTmdbCandidates(payload, requestedType), preferredType).slice(0, 50);
      state.selectedTmdbIndex = -1;
      renderTmdbResults();
      updateTmdbSearchStatus(
        state.tmdbResults.length
          ? `Found ${state.tmdbResults.length} result(s). Select the correct title.`
          : 'No usable movie or TV results were returned.',
        state.tmdbResults.length ? 'ok' : 'error',
      );
      log(`TMDB search returned ${state.tmdbResults.length} usable result(s) for “${queryText}”.`);
    } catch (error) {
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
    updateLinkStatus(`Selected: ${result.title} (${result.mediaType}, TMDB ${result.id}${result.year ? `, ${result.year}` : ''}).`, 'ok');
    const titleKey = getSelectedGroupTitle() || getDisplayTitle(result.title);
    if (titleKey) cacheTmdbForTitle(titleKey, result.mediaType, result.id, `${result.title} (${result.mediaType} ${result.id})`);
    renderTmdbSelected(result);
    renderTmdbResults();
    renderTrackTable();
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

  function validateJob(job) {
    const selected = getTracksForJob(job);
    const settings = { ...job.settings, mediaType: job.mediaType };

    if (!selected.length) throw new Error('No tracks remain for this link job.');
    if (!Number.isInteger(job.tmdbId) || job.tmdbId <= 0) throw new Error('Enter a valid positive TMDB ID.');

    const parsedTitles = [...new Set(selected.map((track) => getDisplayTitle(track.title)).filter(Boolean))];
    if (parsedTitles.length > 1 && !ui.allowMixed.checked) {
      throw new Error(
        `Selected tracks contain ${parsedTitles.length} parsed titles. Select one title group or explicitly enable mixed-title linking.`,
      );
    }

    for (const track of selected) {
      if (!track.title) throw new Error(`Track ${track.id} did not produce a title. Adjust the filename regex.`);
      if (job.mediaType === 'tv') {
        const episode = getApiEpisode(track, settings);
        if (!Number.isInteger(episode) || episode < 0) {
          throw new Error(`Track ${track.id} has invalid API episode number: ${episode ?? 'missing'}.`);
        }
        const season = getApiSeason(track, settings);
        if (season != null && (!Number.isInteger(season) || season < 0)) {
          throw new Error(`Track ${track.id} has invalid season number: ${season}.`);
        }
      }
    }

    return { selected, mediaType: job.mediaType, tmdbId: job.tmdbId, parsedTitles, settings, groupKey: job.groupKey };
  }

  function validateRun() {
    const selected = state.tracks.filter((track) => state.selectedIds.has(track.id));
    const mediaType = ui.mediaType.value;
    const tmdbId = Number.parseInt(ui.tmdbId.value, 10);

    if (!selected.length) throw new Error('Select at least one track.');
    if (!Number.isInteger(tmdbId) || tmdbId <= 0) throw new Error('Pick a TMDB result or enter a valid TMDB ID.');

    const parsedTitles = [...new Set(selected.map((track) => getDisplayTitle(track.title)).filter(Boolean))];
    if (parsedTitles.length > 1 && !ui.allowMixed.checked) {
      throw new Error(
        `Selected tracks contain ${parsedTitles.length} parsed titles. Select one title group or explicitly enable mixed-title linking.`,
      );
    }

    for (const track of selected) {
      if (!track.title) throw new Error(`Track ${track.id} did not produce a title. Adjust the filename regex.`);
      if (mediaType === 'tv') {
        const episode = getApiEpisode(track);
        if (!Number.isInteger(episode) || episode < 0) {
          throw new Error(`Track ${track.id} has invalid API episode number: ${episode ?? 'missing'}.`);
        }
        const season = getApiSeason(track);
        if (season != null && (!Number.isInteger(season) || season < 0)) {
          throw new Error(`Track ${track.id} has invalid season number: ${season}.`);
        }
      }
    }

    return { selected, mediaType, tmdbId, parsedTitles };
  }

  async function startBulkLink(options = {}) {
    let run;
    try {
      run = validateRun();
    } catch (error) {
      alert(formatError(error));
      return;
    }

    const job = buildLinkJob(run.selected, run.mediaType, run.tmdbId);

    if (state.running) {
      state.linkQueue.push(job);
      clearJobSelection(job);
      updateQueueStatus();
      log(`Queued link for ${job.trackIds.length} track(s) in “${job.groupKey || 'mixed'}”.`);
      updateLinkStatus(`Queued ${job.trackIds.length} track(s). Selection cleared — switch to the next group.`, 'ok');
      return;
    }

    if (!options.skipConfirm) {
      const sample = run.selected[0];
      const samplePayload = buildPayload(sample, run.mediaType, run.tmdbId, job.settings);
      const titleSummary = run.parsedTitles.slice(0, 5).join(', ') + (run.parsedTitles.length > 5 ? ', …' : '');
      const confirmed = pageWindow.confirm(
        [
          `Link ${run.selected.length.toLocaleString()} track(s)?`,
          '',
          `Parsed title group(s): ${titleSummary || 'none'}`,
          `Target: ${run.mediaType}, TMDB ${run.tmdbId}`,
          `First track: ${sample.id} — ${sample.filename}`,
          `First payload: ${JSON.stringify(samplePayload)}`,
          '',
          'Requests run sequentially. You can queue the next group while this one links.',
        ].join('\n'),
      );
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
    if (run.groupKey && run.groupKey !== UNPARSED_GROUP && !getCachedTmdb(run.groupKey)) {
      const label =
        state.tmdbDetails?.tmdbId === run.tmdbId
          ? findLikelyTitle(state.tmdbDetails.details) || `TMDB ${run.tmdbId}`
          : `TMDB ${run.tmdbId}`;
      cacheTmdbForTitle(run.groupKey, run.mediaType, run.tmdbId, label);
    }
    ui.progress.max = run.selected.length;
    ui.progress.value = 0;
    ui.progressText.textContent = `Starting 0/${run.selected.length.toLocaleString()}…`;
    log(`Linking ${run.selected.length.toLocaleString()} track(s) for “${run.groupKey || 'mixed'}”.`);

    let successCount = 0;
    let failureCount = 0;
    let aborted = false;

    try {
      for (let index = 0; index < run.selected.length; index += 1) {
        const track = run.selected[index];
        if (state.abortController.signal.aborted) {
          aborted = true;
          break;
        }

        state.statuses.set(track.id, { state: 'running', message: 'Sending request' });
        if (!updateTrackRowStatus(track.id)) renderTrackTable();
        ui.progressText.textContent = `Processing ${index + 1}/${run.selected.length}: track ${track.id}`;

        try {
          const payload = buildPayload(track, run.mediaType, run.tmdbId, run.settings);
          const response = await apiRequest(`/api/my-tracks/${encodeURIComponent(track.id)}/media-title`, {
            method: 'PATCH',
            headers: getAuthHeaders(true),
            body: JSON.stringify(payload),
            signal: state.abortController.signal,
          });

          successCount += 1;
          state.statuses.set(track.id, {
            state: 'success',
            message: 'Linked successfully',
            payload,
            response,
            completedAt: new Date().toISOString(),
          });
          state.selectedIds.delete(track.id);
          log(`✓ Track ${track.id}: linked successfully.`);
          ui.progress.value = index + 1;
          if (!updateTrackRowStatus(track.id)) renderTrackTable();
          notifyGroupProgress(run.groupKey);

          if (index < run.selected.length - 1) {
            const delayMs = Math.max(0, Number.parseInt(ui.delay.value, 10) || 0);
            await abortableDelay(delayMs, state.abortController.signal);
          }
        } catch (error) {
          if (error.name === 'AbortError') {
            aborted = true;
            break;
          }
          failureCount += 1;
          state.statuses.set(track.id, {
            state: 'error',
            message: formatError(error),
            payload: buildPayload(track, run.mediaType, run.tmdbId, run.settings),
            errorStatus: error.status ?? null,
            errorBody: error.body ?? null,
            completedAt: new Date().toISOString(),
          });
          log(`✗ Track ${track.id}: ${formatError(error)}`, 'error');
          ui.progress.value = index + 1;
          if (!updateTrackRowStatus(track.id)) renderTrackTable();
          notifyGroupProgress(run.groupKey);
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
      log(`Starting queued link for “${nextJob.groupKey || 'mixed'}”.`);
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

  function abortBulkLink() {
    state.abortController?.abort();
    state.linkQueue = [];
    updateQueueStatus();
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
        display_title: getDisplayTitle(track.title),
        group_key: getTrackGroupKey(track),
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
      log(`Run report copied (${relevantTracks.length.toLocaleString()} relevant track record(s)).`);
    } catch (error) {
      pageWindow.__ukrabBulkAssistantReport = report;
      log(`Could not copy report: ${formatError(error)}`, 'error');
      alert('Clipboard access failed. The report is available as window.__ukrabBulkAssistantReport.');
    }
  }

  function observeRoute() {
    const onRouteChange = () => {
      const matched = isTargetRoute();
      if (matched !== state.lastRouteMatched) {
        state.lastRouteMatched = matched;
        if (!document.getElementById(PANEL_ID) && matched) createPanel();
        updateRouteStatus();
        if (matched && !state.loaded && !state.loading) setTimeout(loadUnlinkedTracks, 500);
      }
    };

    pageWindow.addEventListener('hashchange', onRouteChange);
    setInterval(onRouteChange, 1000);
    onRouteChange();
  }

  const initialise = () => {
    readAuthToken();
    observeRoute();
    if (isTargetRoute()) createPanel();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialise, { once: true });
  } else {
    initialise();
  }
})();
