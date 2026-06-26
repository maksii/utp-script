// ==UserScript==
// @name         UNIT3D Playlist Assistant
// @namespace    https://github.com/maksii/utp-script
// @version      3.3.0
// @description  Scrape movie/TV lists from IMDb, TMDB & Letterboxd, match them against UNIT3D (utp.to) torrents by quality priority, build playlists & BBCode reports, and open requests for missing media — with optional read-only cross-checks against other UNIT3D trackers (Aither/Blutopia/custom).
// @author       maksii
// @match        https://www.imdb.com/*
// @match        https://*.themoviedb.org/*
// @match        https://*.letterboxd.com/*
// @match        https://letterboxd.com/*
// @match        https://utp.to/*
// @grant        GM_registerMenuCommand
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @connect      utp.to
// @connect      aither.cc
// @connect      blutopia.cc
// @connect      *
// @run-at       document-idle
// @noframes
// @updateURL    https://raw.githubusercontent.com/maksii/utp-script/main/unit3d-collection-generator.user.js
// @downloadURL  https://raw.githubusercontent.com/maksii/utp-script/main/unit3d-collection-generator.user.js
// ==/UserScript==

/* global GM_registerMenuCommand, GM_setValue, GM_getValue, GM_xmlhttpRequest */

(function () {
  'use strict';

  // ===========================================================================
  // Constants & configuration
  // ===========================================================================

  const SITE = {
    UTP_ORIGIN: 'https://utp.to',
    API_BASE: 'https://utp.to/api',
  };

  // Canonical quality slots. Order here is the *default* priority order.
  // `key` is derived once and used consistently everywhere (no ad-hoc string
  // building), which removes the old "remux1080" vs "remux1080p" key mismatch.
  const DEFAULT_SLOTS = [
    { type: 'Remux', resolution: '1080p' },
    { type: 'Remux', resolution: '2160p' },
    { type: 'Encode', resolution: '2160p' },
    { type: 'WEB-DL', resolution: '2160p' },
    { type: 'Encode', resolution: '1080p' },
    { type: 'WEB-DL', resolution: '1080p' },
  ];

  const slotKey = (slot) =>
    `${slot.type}_${slot.resolution}`.toLowerCase().replace(/[^a-z0-9]/g, '');
  const slotLabel = (slot) => `${slot.type} ${slot.resolution}`;

  // Normalise a UNIT3D type/resolution label for tolerant comparison across
  // instances (a re-skinned tracker may label "WEB-DL" as "WEBDL"/"Web-Dl").
  const normAttr = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '');

  // Reference UNIT3D trackers (optional). Used only to *check* whether the target
  // quality already exists elsewhere — never written to. Aither & Blutopia ship
  // as fixed presets; the third row is a user-defined custom instance. Each needs
  // that tracker's own API key. They share utp.to's read-only
  // /api/torrents/filter shape (see external-links.user.js for the same calls).
  const DEFAULT_REF_TRACKERS = [
    { name: 'Aither', base: 'https://aither.cc', apiKey: '', enabled: false, fixed: true },
    { name: 'Blutopia', base: 'https://blutopia.cc', apiKey: '', enabled: false, fixed: true },
    { name: 'Custom', base: '', apiKey: '', enabled: false, fixed: false },
  ];

  // Networking defaults. UNIT3D throttles the API at exactly 30 req/min per
  // user (RouteServiceProvider: Limit::perMinute(30)). A global ~2.2s gap
  // between request starts keeps us at ~27/min — safely under the cap — while
  // low concurrency overlaps network latency. Still vastly faster and safer
  // than the old fixed 5s-serial loop, and 429s are retried with Retry-After.
  const NET = {
    concurrency: 2,
    minGapMs: 2200, // global spacing between request starts (~27 req/min)
    maxRetries: 4,
    perPage: 100, // API caps perPage at 100
    timeoutMs: 30000,
  };

  // Storage keys
  const STORE = {
    apiKey: 'utpto_api_key',
    selectedType: 'selected_type',
    selectedQuality: 'selected_quality',
    slots: 'quality_slots_v3',
    results: 'last_results_v3',
    sourceName: 'last_source_name_v3',
    panelPos: 'panel_pos_v3',
    panelMin: 'panel_min_v3',
    refTrackers: 'ref_trackers_v1',
  };

  // ===========================================================================
  // Small utilities
  // ===========================================================================

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const isUtp = () => location.hostname.includes('utp.to');

  // Per-host rate gate — UNIT3D's 30/min cap is enforced *per instance*, so each
  // tracker origin gets its own spacing. Requests to different hosts never block
  // each other; same-host requests stay ~minGapMs apart (~27/min). For the common
  // single-host case this behaves exactly like the old global gate.
  const _hostSlots = new Map();
  const hostOf = (url) => {
    try { return new URL(url).host; } catch { return '_'; }
  };
  async function rateGate(host = '_') {
    const now = Date.now();
    const next = _hostSlots.get(host) || 0;
    const wait = Math.max(0, next - now);
    _hostSlots.set(host, Math.max(now, next) + NET.minGapMs);
    if (wait) await sleep(wait);
  }

  const gv = (k, def) => {
    try {
      const v = GM_getValue(k, def);
      return v === undefined ? def : v;
    } catch {
      return def;
    }
  };
  const sv = (k, v) => {
    try {
      GM_setValue(k, v);
    } catch {
      /* storage unavailable */
    }
  };

  // Load persisted slots, validating shape; fall back to defaults.
  const loadSlots = () => {
    const saved = gv(STORE.slots, null);
    if (Array.isArray(saved) && saved.length === DEFAULT_SLOTS.length &&
        saved.every((s) => s && s.type && s.resolution)) {
      return saved.map((s) => ({ type: s.type, resolution: s.resolution }));
    }
    return DEFAULT_SLOTS.map((s) => ({ ...s }));
  };

  // Load reference trackers, overlaying saved enabled/apiKey/base onto the
  // presets (matched by name, then position). Fixed base URLs survive a stale
  // save, and newly-added presets always appear.
  const loadRefTrackers = () => {
    const saved = gv(STORE.refTrackers, null);
    return DEFAULT_REF_TRACKERS.map((def, i) => {
      const t = { ...def };
      const s = Array.isArray(saved)
        ? saved.find((x) => x && x.name === def.name) || saved[i]
        : null;
      if (s) {
        t.enabled = !!s.enabled;
        t.apiKey = typeof s.apiKey === 'string' ? s.apiKey : '';
        if (!t.fixed && typeof s.base === 'string') t.base = s.base;
      }
      return t;
    });
  };
  const saveRefTrackers = (list) =>
    sv(
      STORE.refTrackers,
      list.map((t) => ({
        name: t.name, base: t.base, apiKey: t.apiKey, enabled: t.enabled, fixed: t.fixed,
      }))
    );

  // ===========================================================================
  // HTTP layer — uses GM_xmlhttpRequest (handles cross-origin + headers
  // reliably) with a fetch fallback, plus retry/backoff honouring Retry-After.
  // ===========================================================================

  function rawRequest({ method = 'GET', url, headers = {}, data = null }) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest === 'function') {
        GM_xmlhttpRequest({
          method,
          url,
          headers,
          data,
          timeout: NET.timeoutMs,
          onload: (res) =>
            resolve({
              status: res.status,
              text: res.responseText,
              finalUrl: res.finalUrl || url,
              getHeader: (name) => {
                const m = (res.responseHeaders || '').match(
                  new RegExp('^' + name + ':\\s*(.+)$', 'im')
                );
                return m ? m[1].trim() : null;
              },
            }),
          onerror: () => reject(new Error('Network error')),
          ontimeout: () => reject(new Error('Request timed out')),
        });
      } else {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), NET.timeoutMs);
        fetch(url, { method, headers, body: data, signal: ctrl.signal })
          .then(async (r) => {
            clearTimeout(t);
            resolve({
              status: r.status,
              text: await r.text(),
              finalUrl: r.url || url,
              getHeader: (n) => r.headers.get(n),
            });
          })
          .catch((e) => {
            clearTimeout(t);
            reject(e);
          });
      }
    });
  }

  // JSON request with retry/backoff. `shouldAbort` lets callers cancel.
  async function apiRequest(opts, shouldAbort = () => false) {
    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (shouldAbort()) throw new Error('Aborted');
      await rateGate(hostOf(opts.url)); // per-host throttle, applied to every attempt
      let res;
      try {
        res = await rawRequest(opts);
      } catch (e) {
        if (attempt++ >= NET.maxRetries) throw e;
        await sleep(clamp(500 * 2 ** attempt, 500, 8000));
        continue;
      }

      if (res.status === 429 || res.status >= 500) {
        if (attempt++ >= NET.maxRetries) {
          throw new Error(`HTTP ${res.status} after ${attempt} attempts`);
        }
        const retryAfter = parseInt(res.getHeader('Retry-After') || '', 10);
        const wait = Number.isFinite(retryAfter)
          ? retryAfter * 1000
          : clamp(800 * 2 ** attempt, 800, 10000);
        await sleep(wait);
        continue;
      }

      if (res.status === 401 || res.status === 403) {
        throw new Error(`Unauthorized (HTTP ${res.status}) — check your API key`);
      }
      if (res.status < 200 || res.status >= 300) {
        throw new Error(`HTTP ${res.status}`);
      }

      try {
        return JSON.parse(res.text);
      } catch {
        throw new Error('Invalid JSON response');
      }
    }
  }

  // ===========================================================================
  // Concurrency mapper with progress + cancellation
  // ===========================================================================

  async function mapPool(items, limit, worker, { onProgress, shouldAbort } = {}) {
    const results = new Array(items.length);
    let cursor = 0;
    let done = 0;
    const runner = async () => {
      while (true) {
        if (shouldAbort && shouldAbort()) return;
        const i = cursor++;
        if (i >= items.length) return;
        try {
          results[i] = await worker(items[i], i);
        } catch (e) {
          results[i] = { __error: e.message || String(e) };
        }
        done++;
        if (onProgress) onProgress(done, items.length);
        // Throttling is handled per-host by rateGate() inside apiRequest().
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(limit, items.length || 1) }, runner)
    );
    return results;
  }

  // ===========================================================================
  // UNIT3D API client
  // ===========================================================================

  const Api = {
    getKey: () => gv(STORE.apiKey, '').trim(),

    authHeaders() {
      return {
        Authorization: `Bearer ${this.getKey()}`,
        Accept: 'application/json',
      };
    },

    // Build the shared /torrents/filter query for a media item. Prefers the most
    // specific external id (imdb/tmdb/tvdb); when none is available (e.g.
    // Letterboxd, which exposes no id in list DOM) it falls back to a name + year
    // search. `withCategory` carries utp.to's numeric category id, which is
    // instance-specific — so reference trackers must omit it.
    filterParams(item, { withCategory = true } = {}) {
      const params = new URLSearchParams();
      params.set('perPage', String(NET.perPage));
      let hasId = false;
      if (item.imdbId) { params.set('imdbId', String(item.imdbId).replace(/^tt/, '')); hasId = true; }
      if (item.tmdbId) { params.set('tmdbId', String(item.tmdbId)); hasId = true; }
      if (item.tvdbId) { params.set('tvdbId', String(item.tvdbId)); hasId = true; }
      if (!hasId && item.name) {
        params.set('name', item.name);
        if (item.year) {
          params.set('startYear', String(item.year));
          params.set('endYear', String(item.year));
        }
      }
      if (withCategory && item.category) params.append('categories[]', item.category);
      return params;
    },

    // Filter torrents for a media item on utp.to.
    async filterTorrents(item, shouldAbort) {
      const url = `${SITE.API_BASE}/torrents/filter?${this.filterParams(item).toString()}`;
      const json = await apiRequest(
        { method: 'GET', url, headers: this.authHeaders() },
        shouldAbort
      );
      return Array.isArray(json?.data) ? json.data : [];
    },

    // Same read-only filter against a *reference* UNIT3D tracker (different
    // origin + that tracker's own key). Category is omitted (instance-specific).
    // Used only to learn whether a quality exists elsewhere — never writes.
    async filterTorrentsAt(item, tracker, shouldAbort) {
      // Normalise to the origin so a base that includes a path still hits
      // <origin>/api/torrents/filter; fall back to a slash-trimmed string.
      let origin;
      try { origin = new URL(tracker.base).origin; }
      catch { origin = String(tracker.base || '').replace(/\/+$/, ''); }
      const url = `${origin}/api/torrents/filter?${this.filterParams(item, { withCategory: false }).toString()}`;
      const json = await apiRequest(
        {
          method: 'GET',
          url,
          headers: { Authorization: `Bearer ${tracker.apiKey}`, Accept: 'application/json' },
        },
        shouldAbort
      );
      return Array.isArray(json?.data) ? json.data : [];
    },

    // Read-only requests listing (GET /api/requests/filter) used to detect
    // whether a title already has an open/filled request before we create one.
    async listRequests(item, shouldAbort) {
      const params = new URLSearchParams();
      params.set('perPage', '100');
      if (item.imdbId) params.set('imdb', item.imdbId.replace(/^tt/, ''));
      else if (item.tmdbId) params.set('tmdb', item.tmdbId);
      else if (item.tvdbId) params.set('tvdb', item.tvdbId);
      else return [];
      const url = `${SITE.API_BASE}/requests/filter?${params.toString()}`;
      const json = await apiRequest(
        { method: 'GET', url, headers: this.authHeaders() },
        shouldAbort
      );
      return Array.isArray(json?.data) ? json.data : [];
    },
  };

  // Normalise a torrent record's attributes regardless of envelope shape.
  const torrentAttrs = (t) => (t && t.attributes ? t.attributes : t) || {};
  const torrentId = (t) => t?.id ?? torrentAttrs(t).id;
  // A usable external id: present and not the "unknown" sentinel 0.
  const validExtId = (v) => v != null && String(v) !== '0' && String(v) !== '';

  // ===========================================================================
  // Matching logic
  // ===========================================================================

  // For one media item, given its torrents and the ordered slots, fill
  // item.qualities[key] = torrentId (or null) and item.bestId / item.missing.
  function matchItem(item, torrents, slots) {
    item.qualities = {};
    item.bestId = null;

    // Enrich external ids from any returned torrent so created requests can
    // carry tmdb/imdb/tvdb even when the source list only provided one of them
    // (e.g. an IMDb list gains tmdb_id; a TMDB list gains imdb_id). Free —
    // these torrents are already fetched for matching.
    for (const t of torrents) {
      const a = torrentAttrs(t);
      if (!item.tmdbId && validExtId(a.tmdb_id)) item.tmdbId = String(a.tmdb_id);
      if (!item.imdbId && validExtId(a.imdb_id)) item.imdbId = String(a.imdb_id);
      if (!item.tvdbId && validExtId(a.tvdb_id)) item.tvdbId = String(a.tvdb_id);
    }

    for (const slot of slots) {
      const key = slotKey(slot);
      const hit = torrents.find((t) => {
        const a = torrentAttrs(t);
        return a.type === slot.type && a.resolution === slot.resolution;
      });
      const id = hit ? torrentId(hit) : null;
      item.qualities[key] = id;
      if (id && !item.bestId) item.bestId = id;
    }
    // Total releases on utp.to for this title regardless of quality slot — lets
    // the Requests UI flag "exists in another quality" vs "absent entirely".
    item.anyCount = Array.isArray(torrents) ? torrents.length : 0;
    item.missing = !item.bestId;
  }

  const attrsOf = (rec) => (rec && rec.attributes ? rec.attributes : rec) || {};

  // ===========================================================================
  // Requests module — creation is web-only on UNIT3D (no API endpoint).
  // We reuse the logged-in session: scrape /requests/create for the CSRF token
  // and the per-instance category/type/resolution option IDs, then submit a
  // standard form POST to /requests. This spends bonus points (min 100 each),
  // so the UI gates it behind an explicit, costed confirmation.
  // ===========================================================================

  const Requests = {
    form: null, // { token, categories[], types[], resolutions[] }

    // Resolve the per-instance numeric type_id / resolution_id for the target
    // quality from the scraped create form. Needed to compare against existing
    // requests (whose API resource only exposes numeric ids).
    qualityIds(form, typeLabel, resLabel) {
      return {
        typeId: typeLabel ? this.pickId(form.types, typeLabel) : null,
        resId: resLabel ? this.pickId(form.resolutions, resLabel) : null,
      };
    },

    // Does an existing request cover the target quality? A request with a
    // null type_id / resolution_id is treated as generic (covers everything),
    // so it still blocks a same-title request to avoid near-duplicates.
    matchesQuality(a, typeId, resId) {
      const rt = a.type_id == null ? null : String(a.type_id);
      const rr = a.resolution_id == null ? null : String(a.resolution_id);
      const typeOk = rt === null || (typeId != null && rt === String(typeId));
      const resOk = rr === null || (resId != null && rr === String(resId));
      return typeOk && resOk;
    },

    // Inspect existing requests for a title and decide whether creating a
    // request at (typeId,resId) would duplicate one. Returns null if none,
    // else { id, status, blocking, sameQuality, total }.
    async existing(item, typeId, resId, shouldAbort) {
      const list = await Api.listRequests(item, shouldAbort);
      if (!list.length) return null;
      const mapped = list.map((r) => ({ id: r.id ?? attrsOf(r).id, ...attrsOf(r) }));
      const same = mapped.find((a) => this.matchesQuality(a, typeId, resId));
      const chosen = same || mapped[0];
      return {
        id: chosen.id,
        status: chosen.status || 'pending',
        name: chosen.name,
        blocking: !!same,
        sameQuality: !!same,
        total: mapped.length,
      };
    },

    // Fetch & parse the create form (CSRF token + select options). Cached.
    async loadForm() {
      if (this.form) return this.form;
      const res = await rawRequest({
        method: 'GET',
        url: `${SITE.UTP_ORIGIN}/requests/create`,
        headers: { Accept: 'text/html' },
      });
      if (res.status === 401 || res.status === 403) {
        throw new Error('Not logged in to utp.to (open the site in this tab first).');
      }
      if (res.status < 200 || res.status >= 300) {
        throw new Error(`Could not open request form (HTTP ${res.status}).`);
      }
      const doc = new DOMParser().parseFromString(res.text, 'text/html');
      const token =
        doc.querySelector('meta[name="csrf-token"]')?.getAttribute('content') ||
        doc.querySelector('input[name="_token"]')?.value;
      if (!token) throw new Error('Could not read CSRF token from request form.');

      const optionsOf = (name) =>
        Array.from(doc.querySelectorAll(`select[name="${name}"] option`))
          .map((o) => ({ id: o.value, label: (o.textContent || '').trim() }))
          .filter((o) => o.id);

      this.form = {
        token,
        categories: optionsOf('category_id'),
        types: optionsOf('type_id'),
        resolutions: optionsOf('resolution_id'),
      };
      return this.form;
    },

    // Match a target label to an option id (exact, then contains).
    pickId(options, ...candidates) {
      const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      for (const c of candidates) {
        const cn = norm(c);
        const exact = options.find((o) => norm(o.label) === cn);
        if (exact) return exact.id;
      }
      for (const c of candidates) {
        const cn = norm(c);
        const part = options.find((o) => norm(o.label).includes(cn) && cn);
        if (part) return part.id;
      }
      return null;
    },

    // Build the form body for one item given user options + resolved form meta.
    buildBody(item, opts, form) {
      const body = new URLSearchParams();
      body.set('_token', form.token);
      // Request name = "{title} ({year}) {quality}" e.g. "Come and See (1985) Remux 1080p"
      const base = item.year ? `${item.name} (${item.year})` : item.name;
      const quality = [opts.typeLabel, opts.resLabel].filter(Boolean).join(' ');
      const title = quality ? `${base} ${quality}` : base;
      body.set('name', title.slice(0, 180));
      body.set('description', opts.description || `Requesting ${title}.`);
      body.set('bounty', String(opts.bounty));
      body.set('anon', opts.anon ? '1' : '0');

      const isTv = opts.category === 'tv';
      const catId = this.pickId(form.categories, isTv ? 'TV' : 'Movie', isTv ? 'Series' : 'Movies');
      if (catId) body.set('category_id', catId);
      const typeId = opts.typeLabel && this.pickId(form.types, opts.typeLabel);
      if (typeId) body.set('type_id', typeId);
      const resId = opts.resLabel && this.pickId(form.resolutions, opts.resLabel);
      if (resId) body.set('resolution_id', resId);

      // Meta gating mirrors StoreTorrentRequestRequest: each id is read only
      // when its "exists_on" flag is set.
      if (item.imdbId) {
        body.set('title_exists_on_imdb', '1');
        body.set('imdb', item.imdbId.replace(/^tt/, ''));
      }
      if (item.tmdbId) {
        if (isTv) {
          body.set('tv_exists_on_tmdb', '1');
          body.set('tmdb_tv_id', item.tmdbId);
        } else {
          body.set('movie_exists_on_tmdb', '1');
          body.set('tmdb_movie_id', item.tmdbId);
        }
      }
      if (isTv && item.tvdbId) {
        body.set('tv_exists_on_tvdb', '1');
        body.set('tvdb', item.tvdbId);
      }
      if (isTv) {
        body.set('season_number', String(opts.season ?? 0));
        body.set('episode_number', String(opts.episode ?? 0));
      }
      return body;
    },

    async create(item, opts, form, shouldAbort) {
      const body = this.buildBody(item, opts, form);
      let attempt = 0;
      let res;
      // Retry loop: the POST is gated AND retries on 429/5xx honouring
      // Retry-After. A successful create also triggers a followed redirect
      // (GET /requests/{id}), so each create costs ~2 web requests — we burn
      // two rate slots up front to keep the effective rate under the limit.
      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (shouldAbort && shouldAbort()) throw new Error('Aborted');
        await rateGate(hostOf(SITE.UTP_ORIGIN));
        await rateGate(hostOf(SITE.UTP_ORIGIN)); // account for the redirect GET that follows a success
        res = await rawRequest({
          method: 'POST',
          url: `${SITE.UTP_ORIGIN}/requests`,
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            Accept: 'text/html,application/json',
          },
          data: body.toString(),
        });
        if (res.status === 429 || res.status >= 500) {
          if (attempt++ >= NET.maxRetries) {
            return { ok: false, error: `HTTP ${res.status} after ${attempt} attempts` };
          }
          const retryAfter = parseInt(res.getHeader('Retry-After') || '', 10);
          await sleep(
            Number.isFinite(retryAfter)
              ? retryAfter * 1000
              : clamp(1500 * 2 ** attempt, 1500, 15000)
          );
          continue;
        }
        break;
      }

      const url = res.finalUrl || '';
      const idMatch = url.match(/\/requests\/(\d+)(?:[/?#]|$)/);
      if (res.status === 419) return { ok: false, error: 'CSRF expired — reopen tab' };
      if (idMatch && !url.includes('/requests/create')) {
        return { ok: true, requestId: idMatch[1] };
      }
      if (res.status === 422) {
        let msg = 'Validation failed';
        try {
          const j = JSON.parse(res.text);
          msg = j.message || Object.values(j.errors || {})[0]?.[0] || msg;
        } catch {
          /* non-JSON */
        }
        return { ok: false, error: msg };
      }
      if (url.includes('/requests/create')) {
        return { ok: false, error: 'Returned to form (validation/balance issue)' };
      }
      // Some instances redirect to /requests (index) on success.
      if (res.status >= 200 && res.status < 400 && /\/requests(\?|$)/.test(url)) {
        return { ok: true, requestId: null };
      }
      return { ok: false, error: `Unexpected response (HTTP ${res.status})` };
    },
  };

  // ===========================================================================
  // IMDb scraping
  // ===========================================================================

  // Verified live (2026-06) against /chart/top, /search/title, /list, /name.
  // IMDb is a React app whose title text moved into <h4 class="ipc-title__text">
  // while the old <span ...__t> remains present but EMPTY — so we must pick the
  // first NON-EMPTY candidate, not the first existing element (the old bug that
  // produced []). JSON-LD ItemList is used as a structural fallback.
  const IMDb = {
    ROW_SELECTOR: 'li.ipc-metadata-list-summary-item, .lister-item, .titleColumn',
    TITLE_SELECTORS: [
      'h3.ipc-title__text',
      'h4.ipc-title__text',
      '.ipc-title__text',
      'a.ipc-title-link-wrapper',
      'a.ipc-metadata-list-summary-item__t',
      '.ipc-metadata-list-summary-item__t',
    ],

    text(node) {
      return node && node.textContent ? node.textContent.trim() : '';
    },

    // Strip a leading rank prefix ("12. " or "#3 ") WITHOUT eating numeric
    // titles like "1917" (no trailing separator → left intact).
    cleanTitle(s) {
      return s
        .replace(/^\d{1,4}\.\s+/, '')
        .replace(/^#\d+\s*/, '')
        .trim();
    },

    firstNonEmpty(row, selectors) {
      for (const sel of selectors) {
        const t = this.text(row.querySelector(sel));
        if (t) return t;
      }
      return '';
    },

    yearOf(row) {
      const cells = row.querySelectorAll(
        '.ipc-inline-list__item, .dli-title-metadata-item, .cli-title-metadata-item, .lister-item-year'
      );
      for (const c of cells) {
        const m = this.text(c).match(/(19|20)\d{2}/);
        if (m) return m[0];
      }
      return null;
    },

    scrapeDom() {
      const items = [];
      const seen = new Set();
      document.querySelectorAll(this.ROW_SELECTOR).forEach((row) => {
        const link = row.querySelector('a[href*="/title/tt"]');
        if (!link) return;
        const idMatch = (link.getAttribute('href') || '').match(/\/title\/(tt\d+)/);
        if (!idMatch) return;
        const id = idMatch[1];
        if (seen.has(id)) return;

        let name = this.firstNonEmpty(row, this.TITLE_SELECTORS);
        if (!name) name = (link.getAttribute('aria-label') || '').trim() || this.text(link);
        name = this.cleanTitle(name);
        if (!name) return;

        seen.add(id);
        items.push({ name, imdbId: id, year: this.yearOf(row) });
      });
      return items;
    },

    // Fallback: parse any JSON-LD ItemList embedded in the page.
    scrapeJsonLd() {
      const items = [];
      const seen = new Set();
      document.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
        let json;
        try {
          json = JSON.parse(s.textContent);
        } catch {
          return;
        }
        const list = json && (json.itemListElement || (json['@type'] === 'ItemList' && json.itemListElement));
        if (!Array.isArray(list)) return;
        list.forEach((entry) => {
          const it = entry.item || entry;
          const url = it && it.url ? it.url : '';
          const m = url.match(/\/title\/(tt\d+)/);
          if (!m || seen.has(m[1])) return;
          const name = (it.name || '').trim();
          if (!name) return;
          seen.add(m[1]);
          items.push({ name, imdbId: m[1], year: null });
        });
      });
      return items;
    },

    scrape() {
      const dom = this.scrapeDom();
      if (dom.length) return dom;
      return this.scrapeJsonLd();
    },

    supported() {
      return (
        !!document.querySelector(this.ROW_SELECTOR + ', a[href*="/title/tt"]') ||
        !!document.querySelector('script[type="application/ld+json"]')
      );
    },
  };

  // ---------------------------------------------------------------------------
  // TMDB scraper. Verified live (2026-06) on /movie (grid) and /list/* (list).
  // Both layouts link to /movie/<id> or /tv/<id>; we extract id+name from the
  // title anchor (poster links have no text) and the year by climbing only
  // within the single-card subtree so siblings don't bleed in.
  // ---------------------------------------------------------------------------
  const TMDB = {
    scrape() {
      const items = [];
      const seen = new Set();
      document.querySelectorAll('a[href*="/movie/"], a[href*="/tv/"]').forEach((a) => {
        const href = a.getAttribute('href') || '';
        const m = href.match(/\/(movie|tv)\/(\d+)/);
        if (!m) return;
        const name = (a.getAttribute('title') || a.textContent || '').trim();
        if (!name) return; // skip image-only poster links
        const key = `${m[1]}-${m[2]}`;
        if (seen.has(key)) return;
        seen.add(key);
        let year = null;
        let p = a.parentElement;
        for (let depth = 0; p && depth < 6; depth++, p = p.parentElement) {
          const ids = new Set(
            Array.from(p.querySelectorAll('a[href*="/movie/"], a[href*="/tv/"]'))
              .map((x) => (x.getAttribute('href') || '').match(/\/(movie|tv)\/(\d+)/))
              .filter(Boolean)
              .map((z) => `${z[1]}-${z[2]}`)
          );
          if (ids.size > 1) break; // climbed past this single card
          const ym = (p.textContent || '').match(/\b(19|20)\d{2}\b/);
          if (ym) { year = ym[0]; break; }
        }
        items.push({ name, tmdbId: m[2], media: m[1], year });
      });
      return items;
    },
    supported() {
      return !!document.querySelector('a[href*="/movie/"], a[href*="/tv/"]');
    },
  };

  // ---------------------------------------------------------------------------
  // Letterboxd scraper. Verified live (2026-06) on /films/popular and /list/*.
  // List DOM exposes NO tmdb/imdb id, so these items match by name + year only.
  // Letterboxd paginates lists at ~100/page (one page per generate run).
  // ---------------------------------------------------------------------------
  const Letterboxd = {
    scrape() {
      const items = [];
      const seen = new Set();
      document.querySelectorAll('.film-poster, [data-film-slug], li.poster-container').forEach((p) => {
        const a = p.querySelector('a[href^="/film/"]') || (p.matches('a[href^="/film/"]') ? p : null);
        const slug =
          p.getAttribute('data-film-slug') ||
          (a ? (a.getAttribute('href') || '').replace(/^\/film\//, '').replace(/\/.*$/, '') : '');
        if (!slug || seen.has(slug)) return;
        let raw = '';
        const img = p.querySelector('img[alt]');
        if (img) raw = (img.getAttribute('alt') || '').replace(/^Poster for\s*/i, '').trim();
        if (!raw) {
          const ft = p.querySelector('.frame-title');
          raw = ft ? ft.textContent.trim() : '';
        }
        const ym = raw.match(/\((\d{4})\)\s*$/);
        const year = ym ? ym[1] : null;
        const name = raw.replace(/\s*\(\d{4}\)\s*$/, '').trim();
        if (!name) return;
        seen.add(slug);
        items.push({ name, year, lbSlug: slug });
      });
      return items;
    },
    supported() {
      return !!document.querySelector('.film-poster, [data-film-slug], a[href^="/film/"]');
    },
  };

  // Source registry keyed by hostname. Each entry yields a label + scraper.
  const SOURCES = [
    { host: 'imdb.com', label: 'IMDb', scraper: IMDb },
    { host: 'themoviedb.org', label: 'TMDB', scraper: TMDB },
    { host: 'letterboxd.com', label: 'Letterboxd', scraper: Letterboxd },
  ];
  const activeSource = () => SOURCES.find((s) => location.hostname.includes(s.host)) || null;

  // ===========================================================================
  // Report generation
  // ===========================================================================

  const Report = {
    bestIds(items) {
      return items.map((i) => i.bestId).filter(Boolean).join('\n');
    },

    selectedIds(items, selectedSlot) {
      const key = slotKey(selectedSlot);
      return items.map((i) => i.qualities?.[key]).filter(Boolean).join('\n');
    },

    // Best external link for an item, regardless of source site. imdbId may be
    // numeric (enriched from torrents) or "tt…" — normalise to a valid URL.
    externalUrl(i) {
      if (i.imdbId) {
        const n = String(i.imdbId).replace(/^tt/, '');
        return `https://www.imdb.com/title/tt${n.padStart(7, '0')}/`;
      }
      if (i.tmdbId) return `https://www.themoviedb.org/${i.media || 'movie'}/${i.tmdbId}`;
      if (i.lbSlug) return `https://letterboxd.com/film/${i.lbSlug}/`;
      return null;
    },

    bbcodeTable(items, slots, selectedSlot, onlyMissingSelected) {
      const selKey = slotKey(selectedSlot);
      const cols = slots; // show all slots as columns
      const rows = items
        .filter((i) => (onlyMissingSelected ? !i.qualities?.[selKey] : true))
        .map((i) => {
          const label = `${i.name}${i.year ? ` (${i.year})` : ''}`;
          const ext = this.externalUrl(i);
          const title = ext ? `[url=${ext}]${label}[/url]` : label;
          const cells = cols.map((slot) => {
            const id = i.qualities?.[slotKey(slot)];
            const mark = slotKey(slot) === selKey ? '★ ' : '';
            return id
              ? `[td]${mark}[url=${SITE.UTP_ORIGIN}/torrents/${id}]${slotLabel(slot)}[/url][/td]`
              : `[td]${mark}—[/td]`;
          });
          return `[tr][td]${title}[/td]${cells.join('')}[/tr]`;
        });

      const header =
        `[tr][td]Title[/td]` +
        cols.map((s) => `[td]${slotLabel(s)}[/td]`).join('') +
        `[/tr]`;
      return `[table]\n${header}\n${rows.join('\n')}\n[/table]`;
    },
  };

  // ===========================================================================
  // Styles
  // ===========================================================================

  const CSS = `
  .upa-panel{position:fixed;width:520px;max-width:95vw;background:#1e1f26;color:#e6e6e6;
    border:1px solid #3a3c47;border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,.45);
    z-index:2147483000;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:13px;
    display:flex;flex-direction:column;max-height:90vh;overflow:hidden}
  .upa-header{display:flex;align-items:center;gap:8px;padding:10px 12px;cursor:move;
    background:#2a2c36;border-bottom:1px solid #3a3c47;user-select:none}
  .upa-header h3{margin:0;font-size:14px;font-weight:600;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .upa-icon-btn{background:none;border:none;color:#aab;cursor:pointer;font-size:15px;line-height:1;
    padding:2px 6px;border-radius:4px}
  .upa-icon-btn:hover{background:#3a3c47;color:#fff}
  .upa-body{padding:12px;overflow-y:auto;flex:1;min-height:0}
  .upa-tabs{display:flex;gap:4px;padding:8px 8px 0}
  .upa-tab{flex:1;padding:8px;text-align:center;background:#2a2c36;color:#aab;border:none;
    border-radius:6px 6px 0 0;cursor:pointer;font-size:12px;font-weight:600}
  .upa-tab.active{background:#1e1f26;color:#fff;box-shadow:inset 0 -2px 0 #4f8cff}
  .upa-row{display:flex;gap:8px;margin-bottom:8px}
  .upa-row>*{flex:1}
  .upa-label{display:block;font-size:11px;color:#99a;margin:8px 0 4px}
  .upa-input,.upa-select,.upa-textarea{width:100%;box-sizing:border-box;background:#14151a;
    color:#e6e6e6;border:1px solid #3a3c47;border-radius:6px;padding:8px;font-size:13px;font-family:inherit}
  .upa-textarea{height:140px;resize:vertical;font-family:ui-monospace,Consolas,monospace;font-size:12px}
  .upa-btn{width:100%;box-sizing:border-box;padding:10px;border:none;border-radius:6px;cursor:pointer;
    font-weight:600;font-size:13px;color:#fff;background:#4f8cff;margin-bottom:8px;transition:filter .15s}
  .upa-btn:hover:not(:disabled){filter:brightness(1.1)}
  .upa-btn:disabled{opacity:.45;cursor:not-allowed}
  .upa-btn.green{background:#3aa76d}.upa-btn.gold{background:#d6a417;color:#1a1a1a}
  .upa-btn.grey{background:#4a4d5a}.upa-btn.red{background:#e0533d}
  .upa-btn.sm{width:auto;padding:6px 10px;font-size:12px;margin:0}
  .upa-status{font-size:12px;color:#9bb;margin:6px 0;min-height:16px}
  .upa-progress{height:8px;background:#14151a;border-radius:4px;overflow:hidden;margin:6px 0;display:none}
  .upa-progress.show{display:block}
  .upa-progress>div{height:100%;width:0;background:#4f8cff;transition:width .2s}
  .upa-list{list-style:none;margin:0;padding:0;border:1px solid #3a3c47;border-radius:6px;
    max-height:220px;overflow-y:auto;background:#14151a}
  .upa-list li{display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid #2a2c36;cursor:grab}
  .upa-list li:last-child{border-bottom:none}
  .upa-list li.drag{opacity:.4}.upa-list li.over{box-shadow:inset 0 2px 0 #4f8cff}
  .upa-list .grip{color:#667;font-size:14px}
  .upa-list .rank{color:#778;font-size:11px;min-width:16px}
  .upa-report-block{margin-bottom:10px}
  .upa-report-head{display:flex;align-items:center;gap:8px;margin-bottom:4px}
  .upa-report-head span{flex:1;font-size:12px;font-weight:600;color:#cdd}
  .upa-toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#2a2c36;
    color:#fff;padding:10px 16px;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.4);
    z-index:2147483600;font-size:13px;opacity:0;transition:opacity .2s;pointer-events:none}
  .upa-toast.show{opacity:1}
  .upa-min .upa-body,.upa-min .upa-tabs{display:none}
  .upa-req-list{max-height:340px}
  .upa-list li.upa-req-li{display:block;cursor:default}
  .upa-req-row{display:flex;align-items:center;gap:10px}
  .upa-req-cb{flex:0 0 auto;width:16px;height:16px;accent-color:#4f8cff}
  .upa-req-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
  .upa-req-l1{display:flex;align-items:center;gap:8px}
  .upa-req-title{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:600}
  .upa-req-badge{flex:0 0 auto;font-size:11px;white-space:nowrap}
  .upa-req-line{display:flex;flex-wrap:wrap;gap:4px 6px;min-height:14px}
  .upa-selbar{display:flex;align-items:center;gap:8px;margin:2px 0 8px}
  .upa-sel-count{flex:1;font-size:12px;color:#cdd}
  .upa-link-btn{background:none;border:1px solid #3a3c47;color:#aab;cursor:pointer;
    font-size:11px;padding:3px 8px;border-radius:6px}
  .upa-link-btn:hover:not(:disabled){background:#3a3c47;color:#fff}
  .upa-link-btn:disabled{opacity:.4;cursor:not-allowed}
  .upa-req-actions{flex:0 0 auto;display:flex;align-items:center}
  .upa-req-create{background:#3aa76d;border:none;color:#fff;cursor:pointer;font-size:11px;
    padding:4px 9px;border-radius:6px;white-space:nowrap}
  .upa-req-create:hover:not(:disabled){filter:brightness(1.1)}
  .upa-req-create:disabled{opacity:.4;cursor:not-allowed}
  .upa-collapse-head{display:flex;align-items:center;gap:8px;cursor:pointer;user-select:none;
    padding:7px 10px;margin-bottom:8px;background:#2a2c36;border:1px solid #3a3c47;border-radius:6px;
    font-size:12px;font-weight:600;color:#cdd}
  .upa-collapse-head:hover{background:#33353f}
  .upa-collapse-head .chev{font-size:10px;color:#99a}
  .upa-chip{font-size:10px;padding:1px 6px;border-radius:8px;background:#23252e;
    border:1px solid #33353f;color:#9aa;white-space:nowrap}
  .upa-chip.info{color:#8ab4f8;border-color:#2c3a52}
  .upa-chip.has{color:#7fd6a3;border-color:#2f5e44}
  .upa-chip.no{color:#c98a8a;border-color:#5a3434}
  .upa-chip.warn{color:#e0b341;border-color:#5a4a1f}
  .upa-ref-row{display:flex;gap:6px;align-items:center;margin-bottom:6px}
  .upa-ref-row>.upa-input{flex:1}
  .upa-ref-name{display:flex;align-items:center;gap:6px;min-width:84px;font-size:12px;color:#cdd}
  `;

  // ===========================================================================
  // UI primitives
  // ===========================================================================

  let panelEl = null;

  const el = (tag, props = {}, children = []) => {
    const node = document.createElement(tag);
    Object.entries(props).forEach(([k, v]) => {
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function')
        node.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v !== null && v !== undefined) node.setAttribute(k, v);
    });
    (Array.isArray(children) ? children : [children]).forEach((c) => {
      if (c) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  };

  let toastTimer = null;
  function toast(msg) {
    let t = document.querySelector('.upa-toast');
    if (!t) {
      t = el('div', { class: 'upa-toast' });
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast('Copied to clipboard');
    } catch {
      const ta = el('textarea', { value: text });
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        toast('Copied to clipboard');
      } catch {
        toast('Copy failed — select manually');
      }
      ta.remove();
    }
  }

  function downloadText(filename, text, mime = 'application/json') {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function makeDraggable(panel, handle) {
    let sx, sy, ox, oy, dragging = false;
    handle.addEventListener('mousedown', (e) => {
      if (e.target.closest('.upa-icon-btn')) return;
      dragging = true;
      sx = e.clientX;
      sy = e.clientY;
      const r = panel.getBoundingClientRect();
      ox = r.left;
      oy = r.top;
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const x = clamp(ox + e.clientX - sx, 0, window.innerWidth - 60);
      const y = clamp(oy + e.clientY - sy, 0, window.innerHeight - 30);
      panel.style.left = x + 'px';
      panel.style.top = y + 'px';
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    });
    window.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      sv(STORE.panelPos, { left: panel.style.left, top: panel.style.top });
    });
  }

  // ===========================================================================
  // Panel shell (shared between IMDb & UTP)
  // ===========================================================================

  function buildPanel(titleText, bodyBuilder, tabs) {
    if (panelEl) {
      panelEl.remove();
      panelEl = null;
    }
    if (!document.getElementById('upa-style')) {
      const style = el('style', { id: 'upa-style', html: CSS });
      document.head.appendChild(style);
    }

    const body = el('div', { class: 'upa-body' });
    const minBtn = el('button', { class: 'upa-icon-btn', title: 'Minimise', text: '–' });
    const header = el('div', { class: 'upa-header' }, [
      el('h3', { text: titleText }),
      minBtn,
      el('button', {
        class: 'upa-icon-btn',
        title: 'Close',
        text: '✕',
        onclick: () => {
          panelEl.remove();
          panelEl = null;
        },
      }),
    ]);

    panelEl = el('div', { class: 'upa-panel' }, [header]);

    let tabBar = null;
    if (tabs && tabs.length) {
      tabBar = el('div', { class: 'upa-tabs' });
      const panes = {};
      tabs.forEach((t, idx) => {
        const pane = el('div');
        pane.style.display = idx === 0 ? 'block' : 'none';
        panes[t.id] = pane;
        const btn = el('button', {
          class: 'upa-tab' + (idx === 0 ? ' active' : ''),
          text: t.label,
          onclick: () => {
            tabBar.querySelectorAll('.upa-tab').forEach((b) => b.classList.remove('active'));
            btn.classList.add('active');
            Object.values(panes).forEach((p) => (p.style.display = 'none'));
            pane.style.display = 'block';
          },
        });
        tabBar.appendChild(btn);
        body.appendChild(pane);
        t.build(pane);
      });
      panelEl.appendChild(tabBar);
    } else {
      bodyBuilder(body);
    }

    panelEl.appendChild(body);
    document.body.appendChild(panelEl);

    // Restore position / minimised state
    const pos = gv(STORE.panelPos, null);
    if (pos && pos.left && pos.top) {
      panelEl.style.left = pos.left;
      panelEl.style.top = pos.top;
      panelEl.style.right = 'auto';
      panelEl.style.bottom = 'auto';
    } else {
      panelEl.style.right = '16px';
      panelEl.style.bottom = '16px';
    }
    const applyMin = (min) => {
      panelEl.classList.toggle('upa-min', min);
      minBtn.textContent = min ? '+' : '–';
      minBtn.title = min ? 'Expand' : 'Minimise';
    };
    applyMin(gv(STORE.panelMin, false));
    minBtn.addEventListener('click', () => {
      const min = !panelEl.classList.contains('upa-min');
      applyMin(min);
      sv(STORE.panelMin, min);
    });

    makeDraggable(panelEl, header);
    return { body };
  }

  // ===========================================================================
  // Source generator UI (IMDb / TMDB / Letterboxd)
  // ===========================================================================

  function buildGeneratorUI(source) {
    buildPanel(`${source.label} → JSON Generator`, (body) => {
      const status = el('div', { class: 'upa-status', text: 'Ready' });
      const output = el('textarea', { class: 'upa-textarea', readonly: 'readonly' });
      let current = [];

      const refreshButtons = () => {
        const has = !!output.value.trim();
        dlBtn.disabled = !has;
        copyBtn.disabled = !has;
      };

      const genBtn = el('button', {
        class: 'upa-btn gold',
        text: 'Generate JSON from this page',
        onclick: () => {
          status.textContent = 'Scraping…';
          current = source.scraper.scrape();
          output.value = JSON.stringify(current, null, 2);
          const nameOnly = current.length && current.every((i) => !i.imdbId && !i.tmdbId);
          status.textContent = current.length
            ? `Found ${current.length} titles.` +
              (nameOnly ? ' (no IDs — will match by name + year)' : '')
            : 'No titles found — open a chart, list, search, or popular page.';
          refreshButtons();
        },
      });

      const copyBtn = el('button', {
        class: 'upa-btn grey sm',
        text: 'Copy',
        disabled: true,
        onclick: () => copyText(output.value),
      });
      const dlBtn = el('button', {
        class: 'upa-btn green sm',
        text: 'Download .json',
        disabled: true,
        onclick: () =>
          downloadText(
            `${source.label.toLowerCase()}-${(document.title || 'list').replace(/[^\w.-]+/g, '_')}.json`,
            output.value
          ),
      });

      body.appendChild(genBtn);
      body.appendChild(status);
      body.appendChild(output);
      const actions = el('div', { class: 'upa-row' }, [copyBtn, dlBtn]);
      body.appendChild(actions);
      body.appendChild(
        el('div', {
          class: 'upa-status',
          html: 'Tip: open this JSON on a <b>utp.to</b> page to match it against torrents.',
        })
      );
    });
  }

  // ===========================================================================
  // UTP UI — Match & Report tab
  // ===========================================================================

  let state = {
    items: [], // loaded media items
    slots: loadSlots(),
    fetching: false,
    aborted: false,
  };

  function selectedSlot(typeSel, qualSel) {
    return { type: typeSel.value, resolution: qualSel.value };
  }

  // Parse + normalise a loaded JSON list (array, or { items: [...] }) into the
  // internal item shape. Returns an array, or null if empty/invalid. Preserves
  // any pre-computed match data (qualities/bestId) from an exported results file.
  function normalizeItems(parsed) {
    const arr = Array.isArray(parsed) ? parsed : parsed && parsed.items;
    if (!Array.isArray(arr) || !arr.length) return null;
    return arr.map((it) => ({
      name: it.name || it.title || 'Untitled',
      imdbId:
        it.imdbId ||
        (typeof it.id === 'string' && /^tt?\d+$/.test(it.id) ? it.id : null) ||
        (typeof it.imdb === 'string' ? it.imdb : null),
      tmdbId: it.tmdbId || it.tmdb || null,
      tvdbId: it.tvdbId || it.tvdb || null,
      media: it.media || null,
      lbSlug: it.lbSlug || null,
      year: it.year || null,
      category: it.category || null,
      // carry forward prior match results if this is an exported results file
      qualities: it.qualities || undefined,
      bestId: it.bestId !== undefined ? it.bestId : undefined,
    }));
  }

  // Parse pasted/loaded input that may be JSON *or* plain text. Plain text is
  // one entry per line (or comma-separated): a bare IMDb id ("tt6019206" or a
  // 6+ digit number), "tmdb:123" / "tvdb:123", or a "Name (Year)" title.
  function parseListInput(raw) {
    const text = (raw || '').trim();
    if (!text) return null;
    try {
      const items = normalizeItems(JSON.parse(text));
      if (items) return items;
    } catch {
      /* not JSON — fall through to plain-text parsing */
    }
    const tokens = text
      .split(/[\r\n,]+/)
      .map((t) => t.replace(/^['"]+|['"]+$/g, '').trim())
      .filter(Boolean);
    if (!tokens.length) return null;
    const rows = tokens.map((tok) => {
      let m;
      if ((m = tok.match(/^tt(\d+)$/i)) || (m = tok.match(/^(\d{6,})$/))) {
        return { name: `tt${m[1]}`, imdbId: `tt${m[1]}` };
      }
      if ((m = tok.match(/^tmdb[:=]\s*(\d+)$/i))) return { name: `TMDB ${m[1]}`, tmdbId: m[1] };
      if ((m = tok.match(/^tvdb[:=]\s*(\d+)$/i))) return { name: `TVDB ${m[1]}`, tvdbId: m[1] };
      const ym = tok.match(/\((\d{4})\)\s*$/);
      return { name: tok.replace(/\s*\(\d{4}\)\s*$/, '').trim() || tok, year: ym ? ym[1] : null };
    });
    return normalizeItems(rows);
  }

  function buildMatchTab(pane) {
    const status = el('div', { class: 'upa-status', text: 'Load a JSON list to begin.' });
    const progress = el('div', { class: 'upa-progress' }, [el('div')]);
    const progressBar = progress.firstChild;

    // --- API key ---
    const keyInput = el('input', {
      class: 'upa-input',
      type: 'password',
      placeholder: 'utp.to API key',
      value: Api.getKey(),
      oninput: (e) => sv(STORE.apiKey, e.target.value.trim()),
    });

    // --- JSON load (file or paste) ---
    const fileInput = el('input', { class: 'upa-input', type: 'file', accept: '.json' });
    const pasteArea = el('textarea', {
      class: 'upa-textarea',
      placeholder: '…or paste JSON, or one per line: tt6019206 · tmdb:603 · Name (Year)',
    });
    pasteArea.style.height = '80px';

    const loadItems = (raw, srcName) => {
      const items = parseListInput(raw);
      if (!items) {
        status.textContent = 'Could not parse list (need JSON, IMDb ids, or "Name (Year)").';
        fetchBtn.disabled = true;
        return;
      }
      state.items = items;
      sv(STORE.sourceName, srcName || 'list');
      status.textContent = `Loaded ${state.items.length} titles.`;
      fetchBtn.disabled = false;
    };

    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => loadItems(ev.target.result, file.name.replace(/\.json$/i, ''));
      reader.readAsText(file);
    });
    pasteArea.addEventListener('change', () => {
      if (pasteArea.value.trim()) loadItems(pasteArea.value, 'pasted');
    });

    // --- Target type/quality ---
    const typeSel = el('select', { class: 'upa-select' });
    ['Remux', 'WEB-DL', 'Encode'].forEach((t) =>
      typeSel.appendChild(el('option', { value: t, text: t }))
    );
    typeSel.value = gv(STORE.selectedType, 'Remux');
    typeSel.addEventListener('change', () => sv(STORE.selectedType, typeSel.value));

    const qualSel = el('select', { class: 'upa-select' });
    ['1080p', '2160p'].forEach((q) =>
      qualSel.appendChild(el('option', { value: q, text: q }))
    );
    qualSel.value = gv(STORE.selectedQuality, '1080p');
    qualSel.addEventListener('change', () => sv(STORE.selectedQuality, qualSel.value));

    // --- Priority list (drag to reorder) ---
    const list = el('ul', { class: 'upa-list' });
    const renderPriorities = () => {
      list.innerHTML = '';
      state.slots.forEach((slot, index) => {
        const li = el('li', { draggable: 'true' }, [
          el('span', { class: 'rank', text: String(index + 1) }),
          el('span', { class: 'grip', text: '⠿' }),
          el('span', { text: slotLabel(slot) }),
        ]);
        li.dataset.index = String(index);
        li.addEventListener('dragstart', (e) => {
          li.classList.add('drag');
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', String(index));
        });
        li.addEventListener('dragend', () => li.classList.remove('drag'));
        li.addEventListener('dragover', (e) => {
          e.preventDefault();
          li.classList.add('over');
        });
        li.addEventListener('dragleave', () => li.classList.remove('over'));
        li.addEventListener('drop', (e) => {
          e.preventDefault();
          li.classList.remove('over');
          const from = parseInt(e.dataTransfer.getData('text/plain'), 10);
          const to = index;
          if (Number.isNaN(from) || from === to) return;
          const [moved] = state.slots.splice(from, 1);
          state.slots.splice(to, 0, moved);
          sv(STORE.slots, state.slots);
          renderPriorities();
        });
        list.appendChild(li);
      });
    };
    renderPriorities();

    // --- Fetch / cancel ---
    const fetchBtn = el('button', { class: 'upa-btn', text: 'Match against utp.to', disabled: true });
    const cancelBtn = el('button', { class: 'upa-btn red', text: 'Cancel' });
    cancelBtn.style.display = 'none';

    const reportBtn = el('button', {
      class: 'upa-btn green',
      text: 'Generate report',
      disabled: true,
      onclick: () => renderReport(),
    });

    const reportWrap = el('div');

    const renderReport = () => {
      reportWrap.innerHTML = '';
      if (!state.items.length || !state.items.some((i) => i.qualities)) {
        status.textContent = 'Run a match first.';
        return;
      }
      const sel = selectedSlot(typeSel, qualSel);
      const matched = state.items.filter((i) => i.bestId).length;
      const missing = state.items.length - matched;

      const block = (title, content, mime) => {
        const head = el('div', { class: 'upa-report-head' }, [
          el('span', { text: title }),
          el('button', {
            class: 'upa-btn grey sm',
            text: 'Copy',
            onclick: () => copyText(content),
          }),
        ]);
        const ta = el('textarea', { class: 'upa-textarea', readonly: 'readonly' });
        ta.value = content;
        return el('div', { class: 'upa-report-block' }, [head, ta]);
      };

      reportWrap.appendChild(
        el('div', {
          class: 'upa-status',
          html: `<b>${matched}</b> matched · <b>${missing}</b> missing · target <b>${slotLabel(sel)}</b>`,
        })
      );
      reportWrap.appendChild(
        block(`Torrent IDs — target (${slotLabel(sel)})`, Report.selectedIds(state.items, sel))
      );
      reportWrap.appendChild(
        block('Torrent IDs — best available (playlist)', Report.bestIds(state.items))
      );
      reportWrap.appendChild(
        block(
          'BBCode — titles missing target quality',
          Report.bbcodeTable(state.items, state.slots, sel, true)
        )
      );
      reportWrap.appendChild(
        block('BBCode — full table', Report.bbcodeTable(state.items, state.slots, sel, false))
      );
      status.textContent = 'Report generated.';
    };

    fetchBtn.addEventListener('click', async () => {
      if (state.fetching) return;
      if (!Api.getKey()) {
        status.textContent = 'Enter your API key first.';
        return;
      }
      if (!state.items.length) {
        status.textContent = 'Load a list first.';
        return;
      }
      state.fetching = true;
      state.aborted = false;
      fetchBtn.disabled = true;
      reportBtn.disabled = true;
      cancelBtn.style.display = 'block';
      progress.classList.add('show');
      progressBar.style.width = '0%';

      const slots = state.slots;
      await mapPool(
        state.items,
        NET.concurrency,
        async (item) => {
          const torrents = await Api.filterTorrents(item, () => state.aborted);
          matchItem(item, torrents, slots);
          return true;
        },
        {
          shouldAbort: () => state.aborted,
          onProgress: (done, total) => {
            progressBar.style.width = `${(done / total) * 100}%`;
            status.textContent = `Matching… ${done}/${total} (${Math.round(
              (done / total) * 100
            )}%)`;
          },
        }
      );

      state.fetching = false;
      cancelBtn.style.display = 'none';
      fetchBtn.disabled = false;
      progress.classList.remove('show');
      if (state.aborted) {
        status.textContent = 'Cancelled.';
      } else {
        const matched = state.items.filter((i) => i.bestId).length;
        status.textContent = `Done — ${matched}/${state.items.length} matched.`;
        reportBtn.disabled = false;
        // Persist results so a reload doesn't lose work.
        sv(STORE.results, state.items);
        renderReport();
      }
    });

    cancelBtn.addEventListener('click', () => {
      state.aborted = true;
      status.textContent = 'Cancelling…';
    });

    // Restore previous results if present.
    const prev = gv(STORE.results, null);
    if (Array.isArray(prev) && prev.length) {
      state.items = prev;
      status.textContent = `Restored ${prev.length} titles from last session.`;
      fetchBtn.disabled = false;
      reportBtn.disabled = !prev.some((i) => i.qualities);
    }

    // --- Layout ---
    pane.appendChild(el('label', { class: 'upa-label', text: 'API key' }));
    pane.appendChild(keyInput);
    pane.appendChild(el('label', { class: 'upa-label', text: 'Load list (file or paste)' }));
    pane.appendChild(fileInput);
    pane.appendChild(pasteArea);
    pane.appendChild(el('label', { class: 'upa-label', text: 'Target quality' }));
    pane.appendChild(el('div', { class: 'upa-row' }, [typeSel, qualSel]));
    pane.appendChild(el('label', { class: 'upa-label', text: 'Priority order (drag to reorder)' }));
    pane.appendChild(list);
    pane.appendChild(el('div', { class: 'upa-label' }));
    pane.appendChild(fetchBtn);
    pane.appendChild(cancelBtn);
    pane.appendChild(progress);
    pane.appendChild(status);
    pane.appendChild(reportBtn);
    pane.appendChild(reportWrap);
  }

  // --- Requests tab: detect & open requests for missing media ----------------
  function buildRequestsTab(pane) {
    let scanned = []; // [{ item, existing, include }]

    const banner = el('div', {
      class: 'upa-status',
      html:
        '⚠️ Creates requests for titles with <b>no release at the target quality</b> ' +
        '<b>and no existing request for that same quality</b>. ' +
        'Each request <b>spends ≥100 bonus points</b> on your logged-in utp.to account.',
    });
    const status = el('div', { class: 'upa-status', text: 'Load a list (or run a match), then scan.' });
    const progress = el('div', { class: 'upa-progress' }, [el('div')]);
    const progressBar = progress.firstChild;

    // --- API key (standalone) ---
    const keyInput = el('input', {
      class: 'upa-input',
      type: 'password',
      placeholder: 'utp.to API key',
      value: Api.getKey(),
      oninput: (e) => sv(STORE.apiKey, e.target.value.trim()),
    });

    // --- List loader (standalone): use a previously generated/exported JSON ---
    const fileInput = el('input', { class: 'upa-input', type: 'file', accept: '.json' });
    const pasteArea = el('textarea', {
      class: 'upa-textarea',
      placeholder: 'Paste JSON, or one per line: tt6019206 · tmdb:603 · Name (Year)',
    });
    pasteArea.style.height = '70px';
    const loadList = (raw, srcName) => {
      const items = parseListInput(raw);
      if (!items) {
        status.textContent = 'Could not parse list (need JSON, IMDb ids, or "Name (Year)").';
        return false;
      }
      state.items = items;
      sv(STORE.sourceName, srcName || 'list');
      scanned = [];
      renderTable();
      const matched = items.filter((i) => i.qualities).length;
      status.textContent =
        `Loaded ${items.length} titles` +
        (matched ? ` (${matched} already matched).` : ' — scan will match them.');
      return true;
    };
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => loadList(ev.target.result, file.name.replace(/\.json$/i, ''));
      reader.readAsText(file);
    });
    pasteArea.addEventListener('change', () => {
      if (pasteArea.value.trim()) loadList(pasteArea.value, 'pasted');
    });

    // --- Target quality (synced with the Match tab via shared storage) ---
    const typeSel = el('select', { class: 'upa-select' });
    ['Remux', 'WEB-DL', 'Encode'].forEach((t) => typeSel.appendChild(el('option', { value: t, text: t })));
    typeSel.value = gv(STORE.selectedType, 'Remux');
    typeSel.addEventListener('change', () => sv(STORE.selectedType, typeSel.value));
    const qualSel = el('select', { class: 'upa-select' });
    ['1080p', '2160p'].forEach((q) => qualSel.appendChild(el('option', { value: q, text: q })));
    qualSel.value = gv(STORE.selectedQuality, '1080p');
    qualSel.addEventListener('change', () => sv(STORE.selectedQuality, qualSel.value));

    const catSel = el('select', { class: 'upa-select' }, [
      el('option', { value: 'auto', text: 'Auto (TV if TVDB id)' }),
      el('option', { value: 'movie', text: 'Movie' }),
      el('option', { value: 'tv', text: 'TV' }),
    ]);
    const bountyInput = el('input', { class: 'upa-input', type: 'number', min: '100', step: '1', value: '100' });
    const anonCb = el('input', { type: 'checkbox' });
    const descInput = el('textarea', { class: 'upa-textarea', placeholder: 'Description (optional). {title} is substituted.' });
    descInput.style.height = '60px';
    descInput.value = 'Requesting {title}. Posted via Playlist Assistant.';

    // --- Reference trackers (optional) -------------------------------------
    // Read-only cross-check of whether the *target quality* already exists on
    // other UNIT3D trackers. Helps tell "this quality doesn't exist anywhere"
    // (don't bother requesting) from "just missing here". Never creates anything.
    const refTrackers = loadRefTrackers();
    const persistRefs = () => saveRefTrackers(refTrackers);
    // Enabled trackers with a key and a valid http(s) base — the ones we query.
    const activeRefTrackers = () =>
      refTrackers.filter((t) => t.enabled && t.apiKey && /^https?:\/\//i.test(t.base || ''));

    const refWrap = el('div', { class: 'upa-ref' });
    refTrackers.forEach((tr) => {
      const enableCb = el('input', { type: 'checkbox' });
      enableCb.checked = !!tr.enabled;
      enableCb.addEventListener('change', () => { tr.enabled = enableCb.checked; persistRefs(); });

      const nameLabel = el('label', {
        class: 'upa-ref-name',
        title: tr.fixed ? tr.base : 'Custom UNIT3D tracker',
      }, [enableCb, el('span', { text: tr.name })]);

      const row = el('div', { class: 'upa-ref-row' }, [nameLabel]);

      if (!tr.fixed) {
        const baseIn = el('input', {
          class: 'upa-input', type: 'text', placeholder: 'https://tracker.example',
          value: tr.base || '',
        });
        baseIn.addEventListener('input', () => { tr.base = baseIn.value.trim(); persistRefs(); });
        row.appendChild(baseIn);
      }

      const keyIn = el('input', {
        class: 'upa-input', type: 'password', placeholder: `${tr.name} API key`,
        value: tr.apiKey || '',
      });
      keyIn.addEventListener('input', () => { tr.apiKey = keyIn.value.trim(); persistRefs(); });
      row.appendChild(keyIn);

      refWrap.appendChild(row);
    });

    // --- Results table: a persistent <ul> so rows can stream in one-by-one as
    // each title is processed, plus a separate area for the post-create failures.
    const tableWrap = el('div');
    const listEl = el('ul', { class: 'upa-list upa-req-list' });
    listEl.style.display = 'none';
    const failWrap = el('div');
    tableWrap.appendChild(listEl);
    tableWrap.appendChild(failWrap);

    // Single in-flight guard for the whole tab: true during a scan OR a create.
    // Blocks a second long-running action (and double-submits) while one runs,
    // and disables the Create buttons (global + per-row) for the duration.
    let busy = false;
    // Eligible = not a same-quality dupe. Creatable = eligible and not already
    // created in this session (so the global "Create all" can never re-submit a
    // title already created via its per-row button).
    const isEligible = (r) => !(r.existing && r.existing.blocking);
    const creatable = (r) => isEligible(r) && !r.done;

    // --- Selection toolbar (select/unselect all + live count) --------------
    const selCount = el('span', { class: 'upa-sel-count' });
    const setAllIncluded = (val) => {
      scanned.forEach((r) => { if (creatable(r)) r.include = val; });
      renderTable();
    };
    const selectAllBtn = el('button', {
      class: 'upa-link-btn', text: 'Select all', onclick: () => setAllIncluded(true),
    });
    const unselectAllBtn = el('button', {
      class: 'upa-link-btn', text: 'Unselect all', onclick: () => setAllIncluded(false),
    });
    const selBar = el('div', { class: 'upa-selbar' }, [selCount, selectAllBtn, unselectAllBtn]);
    selBar.style.display = 'none';

    // Refresh the live count + Create button cost without a full re-render.
    const refreshSelection = () => {
      const creatableRows = scanned.filter(creatable);
      const selected = creatableRows.filter((r) => r.include).length;
      const blocked = scanned.filter((r) => r.existing && r.existing.blocking).length;
      const doneN = scanned.filter((r) => r.done).length;
      selCount.textContent =
        `${selected} of ${creatableRows.length} selected` +
        (blocked ? ` · ${blocked} blocked` : '') +
        (doneN ? ` · ${doneN} created` : '');
      const bounty = parseInt(bountyInput.value, 10) || 100;
      createBtn.disabled = selected === 0 || busy;
      createBtn.textContent = selected
        ? `Create ${selected} request${selected > 1 ? 's' : ''} (≈${selected * bounty} BON)`
        : 'Create requests';
      selectAllBtn.disabled = !creatableRows.length || selected === creatableRows.length;
      unselectAllBtn.disabled = selected === 0;
    };

    // Chip builders shared by the row renderer.
    const utpChip = (row) => {
      const any = row.item.anyCount;
      if (any > 0) {
        // torrents.length is capped at perPage, so show "100+" at the cap.
        const more = any >= NET.perPage ? '+' : '';
        return el('span', {
          class: 'upa-chip info',
          title: `${any}${more} release(s) on utp.to in other qualities (just not ${target.typeLabel} ${target.resLabel})`,
          text: `utp: ${any}${more} other`,
        });
      }
      if (any === 0) {
        return el('span', {
          class: 'upa-chip no',
          title: 'No releases at all on utp.to — absent in every quality',
          text: 'utp: none',
        });
      }
      return el('span', { class: 'upa-chip', text: 'utp: ?' });
    };
    const refChipsFor = (row) => {
      const out = [];
      if (!row.refs) return out;
      Object.keys(row.refs).forEach((name) => {
        const r = row.refs[name];
        if (!r || r.state === 'skip') return;
        let cls = 'upa-chip warn';
        let txt = `${name}: ?`;
        let ttl = `Check failed for ${name}`;
        if (r.state === 'has') {
          cls = 'upa-chip has';
          txt = `${name}: ✓${r.count}`;
          ttl = `${r.count} ${target.typeLabel} ${target.resLabel} release(s) on ${name}`;
        } else if (r.state === 'none') {
          cls = 'upa-chip no';
          txt = `${name}: ✕`;
          ttl = r.any
            ? `${r.any} release(s) on ${name}, but none at ${target.typeLabel} ${target.resLabel}`
            : `Nothing found on ${name}`;
        }
        out.push(el('span', { class: cls, title: ttl, text: txt }));
      });
      return out;
    };

    // Reference-check ONE item against the enabled trackers (parallel, per-host
    // gated). Returns { trackerName: { state, count, any } }. Never throws — a
    // per-tracker failure becomes a chip, a cancel becomes a skipped entry.
    const checkRefs = async (item, refs) => {
      const out = {};
      const wantType = normAttr(target.typeLabel);
      const wantRes = normAttr(target.resLabel);
      await Promise.all(
        refs.map(async (tr) => {
          try {
            const torr = await Api.filterTorrentsAt(item, tr, () => state.aborted);
            const count = torr.filter((t) => {
              const a = torrentAttrs(t);
              return normAttr(a.type) === wantType && normAttr(a.resolution) === wantRes;
            }).length;
            out[tr.name] = { state: count > 0 ? 'has' : 'none', count, any: torr.length };
          } catch (e) {
            out[tr.name] = e && e.message === 'Aborted' ? { state: 'skip' } : { state: 'error' };
          }
        })
      );
      return out;
    };

    // Uncheck a row only when every decisive (non-skip) reference result is
    // 'none'. A single 'has' or an errored/uncertain tracker leaves it checked —
    // we never silently drop a request on incomplete evidence.
    const applyAutoSelect = (row) => {
      if (!isEligible(row) || !row.refs) return;
      const states = Object.values(row.refs).map((x) => x.state).filter((s) => s !== 'skip');
      if (states.length && states.every((s) => s === 'none')) row.include = false;
    };

    // Build one <li> (3-line layout + per-row Create button when creatable).
    const buildRow = (row) => {
      const blocking = !!(row.existing && row.existing.blocking);
      const done = !!row.done;

      const cb = el('input', { type: 'checkbox', class: 'upa-req-cb' });
      cb.checked = !!row.include && !blocking && !done;
      cb.disabled = blocking || done;
      cb.addEventListener('change', () => { row.include = cb.checked; refreshSelection(); });

      // Line 1 — title + request status badge.
      let reqStatus;
      if (done) {
        reqStatus = row.existing && row.existing.id
          ? el('a', { class: 'upa-req-badge', href: `${SITE.UTP_ORIGIN}/requests/${row.existing.id}`, target: '_blank', text: '✓ created', style: 'color:#7fd6a3' })
          : el('span', { class: 'upa-req-badge', text: '✓ created', style: 'color:#7fd6a3' });
      } else if (blocking) {
        reqStatus = el('a', {
          class: 'upa-req-badge',
          href: `${SITE.UTP_ORIGIN}/requests/${row.existing.id}`,
          target: '_blank',
          text: `dupe: ${row.existing.status} (same quality)`,
          style: 'color:#e88',
        });
      } else if (row.existing) {
        // A request exists for the title but at a different quality — allowed.
        reqStatus = el('a', {
          class: 'upa-req-badge',
          href: `${SITE.UTP_ORIGIN}/requests/${row.existing.id}`,
          target: '_blank',
          text: 'req exists (other quality)',
          style: 'color:#e0b341',
        });
      } else {
        reqStatus = el('span', { class: 'upa-req-badge', text: 'no request', style: 'color:#9c9' });
      }
      const label = row.item.name + (row.item.year ? ` (${row.item.year})` : '');
      const line1 = el('div', { class: 'upa-req-l1' }, [
        el('span', { class: 'upa-req-title', title: label, text: label }),
        reqStatus,
      ]);

      // Line 2 — utp.to on-site status (any-other-quality flag).
      const line2 = el('div', { class: 'upa-req-line' }, [utpChip(row)]);

      // Line 3 — reference trackers (only rendered when a check ran).
      const refChips = refChipsFor(row);
      const lines = refChips.length
        ? [line1, line2, el('div', { class: 'upa-req-line' }, refChips)]
        : [line1, line2];

      const children = [cb, el('div', { class: 'upa-req-main' }, lines)];
      if (creatable(row)) {
        const createOne = el('button', {
          class: 'upa-req-create', text: 'Create', onclick: () => createRows([row]),
        });
        createOne.disabled = busy;
        children.push(el('div', { class: 'upa-req-actions' }, [createOne]));
      }
      return el('li', { class: 'upa-req-li' }, [el('div', { class: 'upa-req-row' }, children)]);
    };

    const renderTable = () => {
      listEl.innerHTML = '';
      scanned.forEach((row) => listEl.appendChild(buildRow(row)));
      listEl.style.display = scanned.length ? 'block' : 'none';
      selBar.style.display = scanned.length ? 'flex' : 'none';
      // NB: failWrap is NOT cleared here — a re-render (e.g. select-all) must not
      // wipe the post-create failures list. It's cleared at scan/create start.
      refreshSelection();
    };
    // Stream a single freshly-found row into the list (no full rebuild).
    const appendRow = (row) => {
      listEl.appendChild(buildRow(row));
      listEl.style.display = 'block';
      selBar.style.display = 'flex';
      refreshSelection();
    };

    // --- Unified create path (used by the global button AND each per-row one) --
    const createRows = async (rows) => {
      if (busy) return;
      const todo = rows.filter(creatable);
      if (!todo.length) return;
      const bounty = parseInt(bountyInput.value, 10) || 100;
      if (bounty < 100) { status.textContent = 'Bounty must be at least 100 BON.'; return; }
      const cost = todo.length * bounty;
      if (!confirm(
        `Create ${todo.length} request(s), each with a ${bounty} BON bounty?\n` +
        `Total cost: ~${cost} bonus points.\n\nThis cannot be undone.`
      )) return;

      busy = true;
      state.aborted = false;
      failWrap.innerHTML = ''; // drop failures from any previous create
      scanBtn.disabled = true;
      // Disable every in-list control (other rows' Create + checkboxes) for the duration.
      listEl.querySelectorAll('button, input').forEach((b) => { b.disabled = true; });
      cancelBtn.style.display = 'block';
      progress.classList.add('show');
      progressBar.style.width = '0%';
      refreshSelection(); // reflects busy on the global button
      status.textContent = 'Loading request form…';

      let form;
      try {
        form = await Requests.loadForm();
      } catch (e) {
        status.textContent = `Cannot create: ${e.message}`;
        progress.classList.remove('show');
        cancelBtn.style.display = 'none';
        busy = false;
        scanBtn.disabled = false;
        renderTable();
        return;
      }

      const typeLabel = target.typeLabel || gv(STORE.selectedType, 'Remux');
      const resLabel = target.resLabel || gv(STORE.selectedQuality, '1080p');
      let ok = 0;
      const fails = [];
      for (let i = 0; i < todo.length; i++) {
        if (state.aborted) break;
        const row = todo[i];
        const isTv =
          catSel.value === 'tv' ||
          (catSel.value === 'auto' && (!!row.item.tvdbId || row.item.media === 'tv'));
        const title = row.item.year ? `${row.item.name} (${row.item.year})` : row.item.name;
        try {
          const res = await Requests.create(
            row.item,
            {
              bounty,
              anon: anonCb.checked,
              description: (descInput.value || '').replace(/\{title\}/g, title),
              category: isTv ? 'tv' : 'movie',
              typeLabel,
              resLabel,
            },
            form,
            () => state.aborted
          );
          if (res.ok) {
            ok++;
            row.done = true;
            row.include = false;
            row.existing = { id: res.requestId, status: 'created' };
          } else {
            fails.push(`${row.item.name}: ${res.error}`);
          }
        } catch (e) {
          fails.push(`${row.item.name}: ${e.message}`);
        }
        progressBar.style.width = `${((i + 1) / todo.length) * 100}%`;
        status.textContent = `Creating… ${i + 1}/${todo.length}`;
      }

      progress.classList.remove('show');
      cancelBtn.style.display = 'none';
      scanBtn.disabled = false;
      busy = false;
      status.textContent =
        `Created ${ok}/${todo.length}.` +
        (fails.length ? ` ${fails.length} failed.` : '') +
        (state.aborted ? ' (cancelled)' : '');
      // renderTable clears failWrap, so append the failures block afterwards.
      renderTable();
      if (fails.length) {
        failWrap.appendChild(
          el('div', { class: 'upa-report-block' }, [
            el('div', { class: 'upa-report-head' }, [el('span', { text: 'Failures' })]),
            (() => {
              const ta = el('textarea', { class: 'upa-textarea', readonly: 'readonly' });
              ta.value = fails.join('\n');
              return ta;
            })(),
          ])
        );
      }
    };

    // --- Collapsible "Scan settings" (auto-collapsed after a scan to give the
    // results list the rest of the panel).
    let configCollapsed = false;
    const configBody = el('div');
    const configChev = el('span', { class: 'chev', text: '▾' });
    const setConfigCollapsed = (v) => {
      configCollapsed = v;
      configBody.style.display = v ? 'none' : 'block';
      configChev.textContent = v ? '▸' : '▾';
    };
    const configHead = el('div', {
      class: 'upa-collapse-head',
      onclick: () => setConfigCollapsed(!configCollapsed),
      title: 'Show/hide scan settings',
    }, [configChev, el('span', { text: 'Scan settings' })]);

    // Resolved target quality, set during scan and reused for create.
    let target = { typeLabel: null, resLabel: null, typeId: null, resId: null };

    const cancelBtn = el('button', {
      class: 'upa-btn red',
      text: 'Cancel',
      onclick: () => {
        state.aborted = true;
        status.textContent = 'Cancelling…';
      },
    });
    cancelBtn.style.display = 'none';

    const scanBtn = el('button', {
      class: 'upa-btn',
      text: 'Scan missing & validate against requests',
      onclick: async () => {
        const finish = () => {
          progress.classList.remove('show');
          scanBtn.disabled = false;
          cancelBtn.style.display = 'none';
          busy = false;
        };
        if (busy) return;
        if (!Api.getKey()) {
          status.textContent = 'Enter your API key above.';
          return;
        }
        // A non-empty paste box is authoritative: (re)load it now so a stale
        // restored list can never be scanned by accident.
        if (pasteArea.value.trim() && !loadList(pasteArea.value, 'pasted')) {
          return; // parse failed — loadList already showed the error
        }
        if (!state.items.length) {
          status.textContent = 'Load a list above (or run a match).';
          return;
        }

        // Target quality from this tab's selectors (shared with the Match tab).
        target.typeLabel = typeSel.value;
        target.resLabel = qualSel.value;
        const selKey = slotKey({ type: target.typeLabel, resolution: target.resLabel });

        // Refocus on the results: collapse the settings and clear the table.
        setConfigCollapsed(true);
        scanned = [];
        failWrap.innerHTML = '';
        renderTable();

        busy = true;
        state.aborted = false;
        scanBtn.disabled = true;
        cancelBtn.style.display = 'block';
        progress.classList.add('show');
        progressBar.style.width = '0%';

        // Load the create form FIRST: its numeric type_id / resolution_id are
        // needed to dedupe against existing requests, and it gates creation.
        // Fail fast if not logged in or the quality isn't requestable here.
        status.textContent = 'Loading request form…';
        let form;
        try {
          form = await Requests.loadForm();
        } catch (e) {
          status.textContent = `Cannot scan: ${e.message}`;
          finish();
          return;
        }
        const ids = Requests.qualityIds(form, target.typeLabel, target.resLabel);
        target.typeId = ids.typeId;
        target.resId = ids.resId;
        if (target.typeId == null || target.resId == null) {
          status.textContent =
            `This tracker's request form has no "${target.typeLabel}" / "${target.resLabel}" option — ` +
            `cannot create or dedupe this quality.`;
          finish();
          return;
        }

        // Pre-flight the API key against the exact endpoint the scan uses: the
        // form loads via the login cookie, NOT the key, so an invalid key would
        // otherwise 401 on every single title and falsely report "all present".
        status.textContent = 'Checking API key…';
        try {
          await apiRequest(
            { method: 'GET', url: `${SITE.API_BASE}/torrents/filter?perPage=1`, headers: Api.authHeaders() },
            () => state.aborted
          );
        } catch (e) {
          if (!state.aborted && /unauthorized|http 40[13]/i.test(e.message || '')) {
            status.textContent = 'API key rejected — check it in your utp.to profile.';
            setConfigCollapsed(false); // re-expand so the key field is reachable
            finish();
            return;
          }
          // A transient/network error here is non-fatal: per-title retries cope.
        }

        // Streaming pipeline — one pass over every title. Each is matched on
        // utp.to (unless already matched); any title MISSING the target quality
        // has its existing-request check (utp.to) and reference checks (other
        // hosts, independent rate gates) fired IN PARALLEL, then its row streams
        // straight into the list — no waiting for the whole batch to finish.
        const refs = activeRefTrackers();
        const total = state.items.length;
        let foundN = 0;
        const results = await mapPool(
          state.items,
          NET.concurrency,
          async (item) => {
            // 1. Match on utp.to unless we already have quality data (also
            //    re-match items from an older version that lacked anyCount).
            if (!item.qualities || item.anyCount === undefined) {
              const torrents = await Api.filterTorrents(item, () => state.aborted);
              matchItem(item, torrents, state.slots);
            }
            // 2. Skip titles that already have the target quality.
            if (item.qualities && item.qualities[selKey]) return false;
            // 3. Missing — validate against existing requests AND reference-check
            //    concurrently (different hosts, so they don't contend).
            const canQuery = item.imdbId || item.tmdbId || item.tvdbId || item.name;
            const [existing, refResult] = await Promise.all([
              Requests.existing(item, target.typeId, target.resId, () => state.aborted),
              refs.length && canQuery ? checkRefs(item, refs) : Promise.resolve(null),
            ]);
            const row = { item, existing, refs: refResult, include: true };
            row.include = isEligible(row); // blocked dupes start unchecked
            applyAutoSelect(row); // reference 'none' everywhere → unchecked
            // 4. Stream the row in as soon as it's ready.
            scanned.push(row);
            foundN++;
            appendRow(row);
            return true;
          },
          {
            shouldAbort: () => state.aborted,
            onProgress: (d) => {
              progressBar.style.width = `${(d / total) * 100}%`;
              status.textContent = `Scanning… ${d}/${total} · ${foundN} missing`;
            },
          }
        );

        // Titles whose worker threw (e.g. a persistent 5xx after retries) are
        // counted so an error case never silently looks like "nothing missing".
        const errN = results.filter((r) => r && r.__error).length;

        sv(STORE.results, state.items);
        finish();
        renderTable(); // finalize the streamed rows (re-enables their buttons now busy=false)
        if (state.aborted) {
          status.textContent =
            `Cancelled — ${scanned.length} found so far.` + (errN ? ` (${errN} errored)` : '');
          return;
        }
        if (!scanned.length) {
          status.textContent = errN
            ? `⚠️ ${errN}/${total} title(s) errored — check your API key or retry (rate limit).`
            : `Every title already has a ${target.typeLabel} ${target.resLabel} release. 🎉`;
          return;
        }
        const blocked = scanned.filter((r) => r.existing && r.existing.blocking).length;
        const selectedNow = scanned.filter((r) => r.include && creatable(r)).length;
        let refNote = '';
        if (refs.length) {
          const elsewhere = scanned.filter(
            (r) => r.refs && Object.values(r.refs).some((x) => x.state === 'has')
          ).length;
          refNote =
            ` · ${elsewhere}/${scanned.length} have ${target.typeLabel} ${target.resLabel} on ${refs.map((t) => t.name).join('/')}`;
        }
        const errNote = errN ? ` · ⚠️ ${errN} errored` : '';
        status.textContent =
          `${scanned.length} missing ${target.typeLabel} ${target.resLabel} · ` +
          `${selectedNow} selected · ${blocked} already requested at this quality.` + refNote + errNote;
      },
    });

    const createBtn = el('button', {
      class: 'upa-btn red',
      text: 'Create requests',
      disabled: true,
      onclick: () => createRows(scanned.filter((r) => r.include && creatable(r))),
    });

    bountyInput.addEventListener('input', refreshSelection);

    // --- Layout. Config inputs live in the collapsible body; the scan button,
    // status, results list and create button stay visible at all times. ---
    const cfg = (node) => configBody.appendChild(node);
    cfg(banner);
    cfg(el('label', { class: 'upa-label', text: 'API key' }));
    cfg(keyInput);
    cfg(el('label', { class: 'upa-label', text: 'List (file or paste) — optional if you ran a match' }));
    cfg(fileInput);
    cfg(pasteArea);
    cfg(el('label', { class: 'upa-label', text: 'Target quality' }));
    cfg(el('div', { class: 'upa-row' }, [typeSel, qualSel]));
    cfg(el('label', { class: 'upa-label', text: 'Category' }));
    cfg(catSel);
    cfg(el('div', { class: 'upa-row' }, [
      (() => { const w = el('div'); w.appendChild(el('label', { class: 'upa-label', text: 'Bounty (BON)' })); w.appendChild(bountyInput); return w; })(),
      (() => { const w = el('label', { class: 'upa-label' }); w.textContent = ' '; const r = el('div', { style: 'display:flex;align-items:center;gap:6px;margin-top:18px' }, [anonCb, el('span', { text: 'Anonymous' })]); w.appendChild(r); return w; })(),
    ]));
    cfg(el('label', { class: 'upa-label', text: 'Description' }));
    cfg(descInput);
    cfg(el('label', {
      class: 'upa-label',
      text: 'Reference trackers (optional) — flag if the target quality exists elsewhere',
    }));
    cfg(refWrap);

    pane.appendChild(configHead);
    pane.appendChild(configBody);
    pane.appendChild(scanBtn);
    pane.appendChild(cancelBtn);
    pane.appendChild(progress);
    pane.appendChild(status);
    pane.appendChild(selBar);
    pane.appendChild(tableWrap);
    pane.appendChild(createBtn);
    pane.appendChild(
      el('div', {
        class: 'upa-status',
        html: 'Requests are created at the <b>target quality</b> selected above. ' +
          'Fallback: <a href="' + SITE.UTP_ORIGIN + '/requests/create" target="_blank">open the request form</a> manually.',
      })
    );
  }

  function buildUtpUI() {
    buildPanel('UNIT3D Playlist Assistant', null, [
      { id: 'match', label: 'Match & Report', build: buildMatchTab },
      { id: 'requests', label: 'Requests', build: buildRequestsTab },
    ]);
  }

  // ===========================================================================
  // Bootstrap
  // ===========================================================================

  // Guard against unloading mid-fetch.
  window.addEventListener('beforeunload', (e) => {
    if (state.fetching) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  const open = () => {
    if (isUtp()) buildUtpUI();
    else {
      const source = activeSource();
      if (source) buildGeneratorUI(source);
    }
  };

  try {
    GM_registerMenuCommand('Open Playlist Assistant', open);
  } catch {
    /* menu command unavailable */
  }
})();
