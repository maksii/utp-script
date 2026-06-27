// ==UserScript==
// @name         External Links on UNIT3D
// @namespace    N/A
// @version      0.10.1
// @description  Add links to other sites on the metadata section of a torrent item
// @match        *://*/torrents/*
// @match        *://*/requests/*
// @run-at       document-idle
// @grant        GM.setValue
// @grant        GM.getValue
// @grant        GM.deleteValue
// @grant        GM.listValues
// @grant        GM.registerMenuCommand
// @grant        GM.xmlHttpRequest
// @connect      kinobaza.com.ua
// @connect      broadcasthe.net
// @connect      anthelion.me
// @connect      passthepopcorn.me
// @connect      hdbits.org
// @connect      beyond-hd.me
// @connect      morethantv.me
// @connect      utp.to
// @connect      aither.cc
// @connect      blutopia.cc
// @connect      upload.cx
// @connect      lst.gg
// @connect      fearnopeer.com
// @connect      oldtoons.world
// @connect      onlyencodes.cc
// @connect      reelflix.cc
// @connect      hawke.uno
// @connect      eiga.moi
// @connect      cinematik.net
// @connect      self
// @connect      *
// @updateURL    https://raw.githubusercontent.com/maksii/utp-script/main/external-links.user.js
// @downloadURL  https://raw.githubusercontent.com/maksii/utp-script/main/external-links.user.js
// ==/UserScript==

(function () {
  "use strict";

  // ---------------------------------------------------------------------------
  // Shared helpers & constants
  // ---------------------------------------------------------------------------

  // Flip to true to enable verbose cache/flow logging in the devtools console.
  const DEBUG = false;
  const dlog = (...args) => { if (DEBUG) console.log(...args); };

  // Escape a value for safe interpolation into HTML text or a double/single
  // quoted attribute. Prevents stored secrets / titles / hostnames from
  // breaking out of the markup (and the silent key-corruption that caused).
  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // Validate a string is a safe http(s) URL before using it as a link target.
  function isSafeHttpUrl(value) {
    try {
      const u = new URL(value);
      return u.protocol === "http:" || u.protocol === "https:";
    } catch (e) {
      return false;
    }
  }

  // Canonical "release check" result shapes used across the API layer.
  const okLink = () => ({ hasReleases: true, count: 0, error: false });
  const apiError = () => ({ hasReleases: true, count: 0, error: true });
  const apiResult = (count) => ({ hasReleases: count > 0, count, error: false });

  // Default configuration
  const DEFAULT_CONFIG = {
    ENABLED_SITES: [
      "Trakt",
      "Letterboxd",
      "slow.pics",
      "Blutopia",
      "Aither",
      "Open Subtitles",
    ],
    ICON_FONT_SIZE: "24px",
    ICON_IMAGE_SIZE: "35px",
    CUSTOM_ICON_SIZES: {
      // Define custom sizes for specific sites
      AniDB: { width: "30px", height: "30px" },
      Prowlarr: { width: "30px", height: "30px" },
      Jackett: { width: "30px", height: "30px" },
    },
    API_KEYS: {
      // Store API keys for sites by type
      // "Blutopia": "your-api-key",
      // "Aither": "your-api-key",
    },
    INDEXER_BASE_URLS: {
      // Store base URLs for indexer sites
      "jackett_base_url": "http://localhost:9117",
      "prowlarr_base_url": "http://localhost:9696",
    },
    SHOW_RELEASE_COUNT: true, // Toggle to show/hide release count badges
    ENABLE_API_SUPPORT: false, // Toggle to enable/disable API calls
    SHOW_ICONS_WITHOUT_RELEASES: true, // Toggle to show icons even when no releases are found
    API_CACHE_EXPIRY: 30 * 60 * 1000, // Cache expiry time in milliseconds (30 minutes)
    ONLY_SEARCH_BY_BUTTON_PRESS: true, // When true, do not auto-search; require user click to load links
    SKIP_CACHE_WHEN_BUTTON_PRESS: false, // When true, ignore API cache when button press is required
    USE_TRACKER_FAVICON: false, // When true, use https://<tracker-origin>/favicon.ico for tracker icons
  };

  // Site Types (internal keys; display names for UI below)
  const SITE_TYPES = {
    UNIT3D: "UNIT3D",
    STANDARD: "standard",
    TRACKER: "tracker",
    INDEXER: "indexer",
    // Can add more types here in the future
  };

  // Display names for config UI (user-facing section headers)
  const SITE_TYPE_LABELS = {
    [SITE_TYPES.STANDARD]: "Metadata & Info Sites",
    [SITE_TYPES.INDEXER]: "Indexer",
    [SITE_TYPES.TRACKER]: "Tracker",
    [SITE_TYPES.UNIT3D]: "UNIT3D",
    CUSTOM_UNIT3D: "Custom UNIT3D Sites",
  };

  // Sites configuration
  const MOVIE_ONLY_SITES = ["Letterboxd", "PassThePopcorn", "Anthelion", "ReelFlix"];
  const TV_ONLY_SITES = ["BroadcasTheNet", "Serializd"];

  const SITES = [
    {
      name: "KinoBaza",
      icon: "https://kinobaza.com.ua/assets/img/kinobazav4.svg",
      imdbSearchUrl:
        "https://kinobaza.com.ua/api/external?q=https://www.imdb.com/title/$Id",
      tmdbSearchUrl:
        "https://kinobaza.com.ua/api/external?q=https://www.themoviedb.org/movie/$Id",
      tmdbSearchUrlTv:
        "https://kinobaza.com.ua/api/external?q=https://www.themoviedb.org/tv/$Id",
      nameSearchUrl: "",
      type: SITE_TYPES.STANDARD,
    },
    {
      name: "Trakt",
      icon: "https://trakt.tv/assets/logos/logomark.square.gradient-b644b16c38ff775861b4b1f58c1230f6a097a2466ab33ae00445a505c33fcb91.svg",
      imdbSearchUrl: "https://trakt.tv/search/imdb/$Id",
      tmdbSearchUrl: "https://trakt.tv/search/tmdb/$Id",
      nameSearchUrl: "https://trakt.tv/search?query=$Id",
      type: SITE_TYPES.STANDARD,
    },
    {
      name: "Letterboxd",
      icon: "https://a.ltrbxd.com/logos/letterboxd-decal-dots-pos-rgb.svg",
      imdbSearchUrl: "https://letterboxd.com/imdb/$Id",
      tmdbSearchUrl: "https://letterboxd.com/tmdb/$Id",
      nameSearchUrl: "https://letterboxd.com/search/?q=$Id",
      type: SITE_TYPES.STANDARD,
    },
    {
      name: "slow.pics",
      icon: "fa-solid fa-images",
      imdbSearchUrl: "",
      tmdbSearchUrl: "https://slow.pics/tmdb/movie/$Id",
      tmdbSearchUrlTv: "https://slow.pics/tmdb/tv/$Id",
      nameSearchUrl: "",
      type: SITE_TYPES.STANDARD,
    },
    {
      name: "Serializd",
      icon: "https://i.ibb.co/k2zF7C60/image.png",
      imdbSearchUrl: "",
      tmdbSearchUrl: "https://www.serializd.com/show/$Id",
      nameSearchUrl: "https://www.serializd.com/search?searchQuery=$Id",
      type: SITE_TYPES.STANDARD,
    },
    {
      name: "AniList",
      icon: "https://anilist.co/img/icons/icon.svg",
      imdbSearchUrl: "",
      tmdbSearchUrl: "",
      nameSearchUrl: "https://anilist.co/search/anime?search=$Id",
      type: SITE_TYPES.STANDARD,
    },
    {
      name: "AniDB",
      icon: "https://upload.wikimedia.org/wikipedia/commons/e/ec/AniDB_apple-touch-icon.png",
      imdbSearchUrl: "",
      tmdbSearchUrl: "",
      nameSearchUrl:
        "https://anidb.net/search/anime/?adb.search=$Id&do.search=1",
      type: SITE_TYPES.STANDARD,
    },
    {
      name: "Open Subtitles",
      icon: "fa-solid fa-closed-captioning",
      imdbSearchUrl:
        "https://www.opensubtitles.org/en/search/sublanguageid-all/imdbid-$Id",
      tmdbSearchUrl: "",
      nameSearchUrl:
        "https://www.opensubtitles.org/en/search2/sublanguageid-all/moviename-$Id",
      type: SITE_TYPES.STANDARD,
    },
    {
      name: "UTP",
      icon: "fa-brands fa-galactic-republic",
      imdbSearchUrl: "https://utp.to/torrents?&imdbId=$Id&sortField=size",
      tmdbSearchUrl: "https://utp.to/torrents?&tmdbId=$Id&sortField=size",
      nameSearchUrl: "https://utp.to/torrents?&name=$Id&sortField=size",
      type: SITE_TYPES.UNIT3D,
    },
    {
      name: "Aither",
      icon: "fa-light fa-tv-retro",
      imdbSearchUrl: "https://aither.cc/torrents?&imdbId=$Id&sortField=size",
      tmdbSearchUrl: "https://aither.cc/torrents?&tmdbId=$Id&sortField=size",
      nameSearchUrl: "https://aither.cc/torrents?&name=$Id&sortField=size",
      type: SITE_TYPES.UNIT3D,
    },
    {
      name: "Blutopia",
      icon: "fa fa-rocket",
      imdbSearchUrl: "https://blutopia.cc/torrents?&imdbId=$Id&sortField=size",
      tmdbSearchUrl: "https://blutopia.cc/torrents?&tmdbId=$Id&sortField=size",
      nameSearchUrl: "https://blutopia.cc/torrents?&name=$Id&sortField=size",
      type: SITE_TYPES.UNIT3D,
    },
    {
      name: "PassThePopcorn",
      icon: "fa fa-film",
      imdbSearchUrl:
        "https://passthepopcorn.me/torrents.php?action=advanced&searchstr=$Id",
      tmdbSearchUrl: "",
      nameSearchUrl:
        "https://passthepopcorn.me/torrents.php?action=advanced&searchstr=$Id",
      type: SITE_TYPES.TRACKER,
      apiHandler: "PTP",
    },
    {
      name: "MoreThanTV",
      icon: "fa-solid fa-tv",
      imdbSearchUrl:
        "https://www.morethantv.me/torrents.php?searchtext=$Id",
      tmdbSearchUrl: "",
      nameSearchUrl:
        "https://www.morethantv.me/torrents.php?searchtext=$Id",
      type: SITE_TYPES.TRACKER,
      apiHandler: "MTV",
    },
    {
      name: "Anthelion",
      icon: "fa-solid fa-sun",
      imdbSearchUrl:
        "https://anthelion.me/torrents.php?action=advanced&searchstr=$Id",
      tmdbSearchUrl: "",
      nameSearchUrl:
        "https://anthelion.me/torrents.php?action=advanced&searchstr=$Id",
      type: SITE_TYPES.TRACKER,
      apiHandler: "ANT",
    },
    {
      name: "BroadcasTheNet",
      icon: "fa-solid fa-power-off",
      imdbSearchUrl:
        "https://broadcasthe.net/torrents.php?action=advanced&imdb=$Id",
      tmdbSearchUrl: "",
      nameSearchUrl:
        "https://broadcasthe.net/torrents.php?action=advanced&artistname=$Id",
      type: SITE_TYPES.TRACKER,
      apiHandler: "BTN",
    },
    {
      name: "BeyondHD",
      icon: "fa fa-circle-star",
      imdbSearchUrl:
        "https://beyond-hd.me/torrents?search=&doSearch=Search&imdb=$Id",
      tmdbSearchUrl:
        "https://beyond-hd.me/torrents?search=&doSearch=Search&tmdb=$Id",
      nameSearchUrl: "https://beyond-hd.me/torrents?search=$Id&doSearch=Search",
      type: SITE_TYPES.TRACKER,
      apiHandler: "BHD",
    },
    {
      name: "Upload.cx",
      icon: "fa fa-upload",
      imdbSearchUrl: "https://upload.cx/torrents?imdbId=$Id",
      tmdbSearchUrl: "https://upload.cx/torrents?tmdbId=$Id",
      nameSearchUrl: "https://upload.cx/torrents?name=$Id",
      type: SITE_TYPES.UNIT3D,
    },
    {
      name: "LST.gg",
      icon: "fa fa-duck",
      imdbSearchUrl: "https://lst.gg/torrents?imdbId=$Id",
      tmdbSearchUrl: "https://lst.gg/torrents?tmdbId=$Id",
      nameSearchUrl: "https://lst.gg/torrents?name=$Id",
      type: SITE_TYPES.UNIT3D,
    },
    {
      name: "OldToons",
      icon: "fa fa-cat",
      imdbSearchUrl: "https://oldtoons.world/torrents?imdbId=$Id",
      tmdbSearchUrl: "https://oldtoons.world/torrents?tmdbId=$Id",
      nameSearchUrl: "https://oldtoons.world/torrents?name=$Id",
      type: SITE_TYPES.UNIT3D,
    },
    {
      name: "OnlyEncodes",
      icon: "fa fa-bolt",
      imdbSearchUrl: "https://onlyencodes.cc/torrents?imdbId=$Id",
      tmdbSearchUrl: "https://onlyencodes.cc/torrents?tmdbId=$Id",
      nameSearchUrl: "https://onlyencodes.cc/torrents?name=$Id",
      type: SITE_TYPES.UNIT3D,
    },
    {
      name: "ReelFlix",
      icon: "fa fa-video",
      imdbSearchUrl: "https://reelflix.cc/torrents?imdbId=$Id",
      tmdbSearchUrl: "https://reelflix.cc/torrents?tmdbId=$Id",
      nameSearchUrl: "https://reelflix.cc/torrents?name=$Id",
      type: SITE_TYPES.UNIT3D,
    },
    {
      name: "UNO",
      icon: "fa fa-infinity",
      imdbSearchUrl: "https://hawke.uno/torrents?imdbId=$Id",
      tmdbSearchUrl: "https://hawke.uno/torrents?tmdbId=$Id",
      nameSearchUrl: "https://hawke.uno/torrents?name=$Id",
      type: SITE_TYPES.UNIT3D,
    },
    {
      name: "AsianCinema",
      icon: "fa-solid fa-dragon",
      imdbSearchUrl: "https://eiga.moi/torrents?imdbId=$Id",
      tmdbSearchUrl: "https://eiga.moi/torrents?tmdbId=$Id",
      nameSearchUrl: "https://eiga.moi/torrents?name=$Id",
      type: SITE_TYPES.UNIT3D,
    },
    {
      name: "Cinemaggedon",
      icon: "fa-solid fa-circle-radiation",
      imdbSearchUrl: "https://cinemageddon.net/browse.php?search=$Id",
      tmdbSearchUrl: "",
      nameSearchUrl: "https://cinemageddon.net/browse.php?search=$Id",
      type: SITE_TYPES.TRACKER,
    },
    {
      name: "PTerClub",
      icon: "fa-solid fa-shield-cat",
      imdbSearchUrl: "https://pterclub.net/torrents.php?incldead=0&search_area=4&search=$Id&sort=5&type=desc",
      tmdbSearchUrl: "",
      nameSearchUrl: "https://pterclub.net/torrents.php?incldead=0&search_area=4&search=$Id&sort=5&type=desc",
      type: SITE_TYPES.TRACKER,
    },
    {
      name: "Cinematik",
      icon: "fa-solid fa-clapperboard",
      imdbSearchUrl: "https://cinematik.net/torrents?&imdbId=$Id&sortField=size",
      tmdbSearchUrl: "https://cinematik.net/torrents?&tmdbId=$Id&sortField=size",
      nameSearchUrl: "https://cinematik.net/torrents?&name=$Id&sortField=size",
      type: SITE_TYPES.UNIT3D,
    },
    {
      name: "HDBits",
      icon: "fa-solid fa-high-definition",
      imdbSearchUrl: "https://hdbits.org/browse.php?sort=size&d=DESC&search=$Id",
      tmdbSearchUrl: "",
      nameSearchUrl: "https://hdbits.org/browse.php?search=$Id",
      type: SITE_TYPES.TRACKER,
      apiHandler: "HDB",
    },
    {
      name: "Jackett",
      icon: "https://i.ibb.co/jPdy4sCY/image.png",
      imdbSearchUrl: "",
      tmdbSearchUrl: "",
      nameSearchUrl: "$BASE_URL/UI/Dashboard#search=$Id",
      type: SITE_TYPES.INDEXER,
      baseUrlConfigKey: "jackett_base_url",
    },
    {
      name: "Prowlarr",
      icon: "https://i.ibb.co/4wtjZPN2/image.png",
      imdbSearchUrl: "",
      tmdbSearchUrl: "",
      nameSearchUrl: "$BASE_URL/search?query=$Id",
      type: SITE_TYPES.INDEXER,
      baseUrlConfigKey: "prowlarr_base_url",
    },
  ];

  // ---------------------------------------------------------------------------
  // Tracker API descriptors — the single source of truth for trackers that
  // expose a private release-count API. A SITES entry opts in via
  // `apiHandler: "<KEY>"`. Each descriptor drives three things at once: the
  // credential inputs in the config UI, the outgoing request, and the response
  // parsing — so a tracker is defined in exactly one place.
  //
  //   fields      : ordered credential inputs. Stored joined by "|" in
  //                 API_KEYS[siteName]; the runtime splits them back into tokens.
  //   minTokens   : tokens required before a request is attempted.
  //   guard(ctx)  : optional extra precondition (e.g. needs an imdb id).
  //   build(ctx)  : -> { method, url, headers?, data?, cacheSuffix }.
  //   parse(resp) : -> release count (number).
  //   responseType: "json" (default) or "text".
  //
  // ctx = { site, tokens[], imdbId (tt-prefixed), imdbNum (digits only),
  //         tmdbId, tvdbId, titleNoYear, rpcId }.
  // When minTokens/guard are unmet the link is shown without a count (fail-open).
  // ---------------------------------------------------------------------------
  const TRACKER_API = {
    BTN: {
      fields: [{ key: "token", label: "BTN token" }],
      minTokens: 1,
      responseType: "json",
      build(ctx) {
        const hasTvdb = Boolean(ctx.tvdbId);
        const searchParams = hasTvdb
          ? { tvdb: ctx.tvdbId }
          : (ctx.titleNoYear ? { search: ctx.titleNoYear } : { search: ctx.site.name });
        const resultsPerPage = hasTvdb ? 50 : 6;
        const cacheSuffix = ctx.tvdbId
          || (ctx.titleNoYear ? encodeURIComponent(ctx.titleNoYear) : "")
          || ctx.imdbId || ctx.tmdbId || "unknown";
        return {
          method: "POST",
          url: "https://api.broadcasthe.net/",
          headers: { "Content-Type": "application/json" },
          data: JSON.stringify({
            jsonrpc: "2.0",
            id: ctx.rpcId,
            method: "getTorrentsSearch",
            params: [ctx.tokens[0], searchParams, resultsPerPage],
          }),
          cacheSuffix,
        };
      },
      parse(resp) {
        const resultData = (resp.response && resp.response.result) || {};
        const reported = Number(resultData.results);
        const torrentCount = resultData.torrents && typeof resultData.torrents === "object"
          ? Object.keys(resultData.torrents).length
          : 0;
        return Number.isFinite(reported) && reported >= 0 ? reported : torrentCount;
      },
    },
    ANT: {
      fields: [{ key: "apikey", label: "Anthelion API key" }],
      minTokens: 1,
      responseType: "json",
      build(ctx) {
        return {
          method: "GET",
          url: `https://anthelion.me/api.php?apikey=${ctx.tokens[0]}&t=movie&imdbid=${ctx.imdbNum}&o=json`,
          cacheSuffix: ctx.imdbNum,
        };
      },
      parse(resp) {
        const payload = resp.response || {};
        const items = payload.item || [];
        const totalRaw = payload.response && payload.response.total;
        const total = typeof totalRaw === "number"
          ? totalRaw
          : (typeof totalRaw === "string" ? Number(totalRaw) : NaN);
        return Number.isFinite(total) && total >= 0
          ? total
          : (Array.isArray(items) ? items.length : 0);
      },
    },
    PTP: {
      fields: [
        { key: "apiuser", label: "PTP ApiUser" },
        { key: "apikey", label: "PTP ApiKey" },
      ],
      minTokens: 2,
      responseType: "json",
      guard: (ctx) => Boolean(ctx.imdbId),
      build(ctx) {
        return {
          method: "GET",
          url: `https://passthepopcorn.me/torrents.php?action=advanced&order_by=relevance&searchbar=${encodeURIComponent(ctx.imdbId)}&pretty=1&json=noredirect`,
          headers: { ApiUser: ctx.tokens[0], ApiKey: ctx.tokens[1], "User-Agent": navigator.userAgent },
          cacheSuffix: ctx.imdbId,
        };
      },
      parse(resp) {
        const res = resp.response || {};
        const movies = Array.isArray(res.Movies) ? res.Movies : [];
        return movies.reduce((total, movie) => {
          const torrents = Array.isArray(movie.Torrents) ? movie.Torrents : [];
          return total + torrents.length;
        }, 0);
      },
    },
    HDB: {
      fields: [
        { key: "username", label: "HDB username" },
        { key: "passkey", label: "HDB passkey" },
      ],
      minTokens: 2,
      responseType: "json",
      build(ctx) {
        return {
          method: "POST",
          url: "https://hdbits.org/api/torrents",
          headers: { "Content-Type": "application/json" },
          data: JSON.stringify({ username: ctx.tokens[0], passkey: ctx.tokens[1], imdb: { id: ctx.imdbNum } }),
          cacheSuffix: ctx.imdbNum,
        };
      },
      parse(resp) {
        const res = resp.response || {};
        return Array.isArray(res.data) ? res.data.length : 0;
      },
    },
    BHD: {
      fields: [{ key: "token", label: "BHD token" }],
      minTokens: 1,
      responseType: "json",
      build(ctx) {
        return {
          method: "POST",
          url: `https://beyond-hd.me/api/torrents/${ctx.tokens[0]}`,
          headers: { "Content-Type": "application/json" },
          data: JSON.stringify({ action: "search", imdb_id: ctx.imdbNum }),
          cacheSuffix: ctx.imdbNum,
        };
      },
      parse(resp) {
        const res = resp.response;
        if (res && typeof res.total_results === "number") return res.total_results;
        if (res && Array.isArray(res.data)) return res.data.length;
        if (Array.isArray(res)) return res.length;
        return res ? 1 : 0;
      },
    },
    MTV: {
      fields: [{ key: "apikey", label: "MoreThanTV API key" }],
      minTokens: 1,
      responseType: "text",
      build(ctx) {
        return {
          method: "GET",
          url: `https://www.morethantv.me/api/torznab?t=search&apikey=${ctx.tokens[0]}&imdbid=${ctx.imdbNum}`,
          cacheSuffix: ctx.imdbNum,
        };
      },
      parse(resp) {
        const text = resp.responseText || resp.response || "";
        return (text.match(/<item\b/g) || []).length;
      },
    },
  };

  // Credential inputs to render for a tracker in the config UI: the descriptor's
  // fields when it has an API handler, otherwise none (no key needed).
  const trackerFieldsFor = (site) =>
    (site && site.apiHandler && TRACKER_API[site.apiHandler] && TRACKER_API[site.apiHandler].fields) || [];

  // Custom UNIT3D sites are stored separately (non-expiring)
  async function loadCustomSites() {
    try {
      const sites = await GM.getValue('custom_unit3d_sites');
      return sites || [];
    } catch (e) {
      return [];
    }
  }

  async function saveCustomSites(sites) {
    try {
      await GM.setValue('custom_unit3d_sites', sites);
    } catch (e) {
      console.error('Failed to save custom sites', e);
    }
  }

  // Utility to save and load configuration
  async function saveConfig(config) {
    await GM.setValue("config", config);
  }

  async function loadConfig() {
    const saved = await GM.getValue("config", DEFAULT_CONFIG);
    // Guard against a malformed/partial stored config (e.g. an explicit null for
    // a nested object) so downstream `config.X[...]` / `.includes` never throw.
    const savedConfig = saved && typeof saved === "object" ? saved : {};
    return {
      ...DEFAULT_CONFIG,
      ...savedConfig,
      ENABLED_SITES: Array.isArray(savedConfig.ENABLED_SITES)
        ? savedConfig.ENABLED_SITES
        : DEFAULT_CONFIG.ENABLED_SITES,
      CUSTOM_ICON_SIZES: {
        ...DEFAULT_CONFIG.CUSTOM_ICON_SIZES,
        ...(savedConfig.CUSTOM_ICON_SIZES || {}),
      },
      API_KEYS: {
        ...DEFAULT_CONFIG.API_KEYS,
        ...(savedConfig.API_KEYS || {}),
      },
      // Replace-or-default (NOT a deep merge) to match the original behaviour:
      // a saved object fully replaces the defaults, so we never re-introduce the
      // localhost placeholders for an indexer the user intentionally left blank.
      INDEXER_BASE_URLS: (savedConfig.INDEXER_BASE_URLS && typeof savedConfig.INDEXER_BASE_URLS === "object")
        ? savedConfig.INDEXER_BASE_URLS
        : DEFAULT_CONFIG.INDEXER_BASE_URLS,
    };
  }

  // Create configuration UI
  async function showConfigUI() {
    const config = await loadConfig();
    const { ENABLED_SITES, API_KEYS } = config;

    // Load custom sites and group base sites by type for better organization
    const customSites = await loadCustomSites();
    const sitesByType = SITES.reduce((acc, site) => {
      const type = site.type || SITE_TYPES.STANDARD;
      if (!acc[type]) acc[type] = [];
      acc[type].push(site);
      return acc;
    }, {});

    // Add toggle for showing release count badges
    const showReleaseCount = config.SHOW_RELEASE_COUNT !== false ? "checked" : "";
    const enableApiSupport = config.ENABLE_API_SUPPORT === true ? "checked" : "";
    const showIconsWithoutReleases = config.SHOW_ICONS_WITHOUT_RELEASES !== false ? "checked" : "";
    const onlySearchChecked = config.ONLY_SEARCH_BY_BUTTON_PRESS !== false ? "checked" : "";
    const skipCacheWhenButtonPressChecked = config.SKIP_CACHE_WHEN_BUTTON_PRESS === true ? "checked" : "";
    const useTrackerFaviconChecked = config.USE_TRACKER_FAVICON === true ? "checked" : "";

    // Secret masking: render a fixed placeholder for existing values (never any
    // real characters) and keep the real value on the element. A field counts as
    // edited only once the user types into it (set up in applySecretMasking), so
    // an untouched or partially-edited field can never overwrite a stored key with
    // the placeholder text.
    const SECRET_PLACEHOLDER = "••••••••";
    function resolveSecretInput(input) {
      if (input.dataset.masked === "1") return input.dataset.fullValue || "";
      return input.value.trim();
    }

    // Build credential inputs for a tracker from its descriptor fields (config UI).
    // Stored value is "|"-joined; split it back so each field shows its own part.
    // Sites without an apiHandler render no inputs (no key needed).
    function trackerInputsFor(site) {
      const fields = trackerFieldsFor(site);
      if (!fields.length) return "";
      const stored = (API_KEYS[site.name] || "").split("|");
      return fields.map((field, i) => {
        const val = escapeHtml((stored[i] || "").trim());
        return `<input type="text" placeholder="${escapeHtml(field.label)}" value="${val}" class="apiKey" data-site="${escapeHtml(site.name)}" data-key="${escapeHtml(field.key)}">`;
      }).join("");
    }

    // Tracker sites shown alphabetically in the UI.
    const trackerInputsHtml = sitesByType[SITE_TYPES.TRACKER]
      ? [...sitesByType[SITE_TYPES.TRACKER]].sort((a, b) => a.name.localeCompare(b.name)).map(site => {
          const name = escapeHtml(site.name);
          return `
              <div class="ext-links-tracker-entry">
                <label><input type="checkbox" value="${name}" ${ENABLED_SITES.includes(site.name) ? "checked" : ""}> ${name}</label>
                ${trackerInputsFor(site)}
              </div>`;
        }).join("")
      : "No tracker sites";

    // Custom sites are stored separately and editable here; they are only shown in this panel (alphabetically by display name).
    // Derive a display name safely — never let a malformed stored base throw.
    const customDisplayName = (site) => {
      if (site && site.name) return site.name;
      try { return new URL(site.base).hostname; } catch (e) { return (site && site.base) || ""; }
    };
    const customSitesSorted = (customSites && customSites.length)
      ? [...customSites].sort((a, b) => customDisplayName(a).localeCompare(customDisplayName(b)))
      : [];
    const customSitesHtml = customSitesSorted.length ? customSitesSorted.map(site => {
      const displayName = customDisplayName(site);
      const dn = escapeHtml(displayName);
      const base = escapeHtml(site.base);
      return `
        <div class="customSiteEntry" data-base="${base}" data-name="${dn}">
          <label>
            <input type="checkbox" value="${dn}" ${ENABLED_SITES.includes(displayName) ? "checked" : ""}>
            ${dn}
          </label>
          <div class="ext-links-muted">${base}</div>
          <div style="margin-top:4px;">
            <input type="text" placeholder="API Key" value="${escapeHtml(API_KEYS[displayName] || '')}" class="apiKey" data-site="${dn}">
            <button class="removeCustomSiteBtn" data-name="${dn}" style="margin-left:8px;">Remove</button>
          </div>
        </div>
      `;
    }).join('') : '<div class="ext-links-muted">No custom sites added yet.</div>';

    const sortSitesByName = (sites) => (sites || []).length ? [...(sites || [])].sort((a, b) => a.name.localeCompare(b.name)) : [];

    const countEnabled = (sites) => (sites || []).filter(s => ENABLED_SITES.includes(s.name)).length;
    const countMetadata = countEnabled(sitesByType[SITE_TYPES.STANDARD]);
    const countIndexer = countEnabled(sitesByType[SITE_TYPES.INDEXER]);
    const countTracker = countEnabled(sitesByType[SITE_TYPES.TRACKER]);
    const countUnit3d = countEnabled(sitesByType[SITE_TYPES.UNIT3D]);
    const countCustom = (customSites || []).filter(s => ENABLED_SITES.includes(customDisplayName(s))).length;

    const sectionStyles = "margin-bottom: 0; padding: 14px 16px 14px 14px; border-radius: 8px; background: var(--ext-surface);";
    const summaryStyles = "cursor: pointer; font-weight: 600; font-size: 14px; padding: 12px 14px; border-radius: 8px; list-style: none; display: flex; align-items: center; gap: 8px; user-select: none; color: var(--ext-text);";
    const summaryMarker = "<span class=\"ext-links-chevron\" aria-hidden=\"true\">▶</span>";

    const html = `
      <style>
        .ext-links-config {
          --ext-bg: #181818;
          --ext-surface: #303030;
          --ext-border: #404040;
          --ext-text: #dddddd;
          --ext-text-muted: #bababa;
          --ext-primary: #59b329;
          --ext-primary-hover: #6bc235;
          --ext-accent: #865be9;
          --ext-radius: 8px;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          font-size: 13px;
          color: var(--ext-text);
          background: var(--ext-bg);
          border: 1px solid var(--ext-border);
          border-radius: var(--ext-radius);
          box-shadow: 0 4px 20px rgba(0,0,0,0.4);
          max-height: 85vh;
          overflow-y: auto;
          min-width: 90vw;
          max-width: 960px;
          padding: 24px;
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          z-index: 9999;
        }
        .ext-links-config * { box-sizing: border-box; }
        .ext-links-config h2 {
          margin: 0;
          font-size: 20px;
          font-weight: 600;
          letter-spacing: 0.02em;
        }
        .ext-links-config__header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-wrap: wrap;
          gap: 16px;
          margin-bottom: 24px;
          padding-bottom: 20px;
          border-bottom: 1px solid var(--ext-border);
        }
        .ext-links-config #saveConfigBtn {
          padding: 10px 22px;
          background: #5cb579;
          color: #181818;
          border: none;
          border-radius: 8px;
          font-weight: 600;
          cursor: pointer;
          font-size: 14px;
        }
        .ext-links-config #saveConfigBtn:hover {
          background: #6bc289;
          filter: brightness(1.05);
        }
        .ext-links-section { margin-bottom: 12px; }
        .ext-links-section summary::-webkit-details-marker { display: none; }
        .ext-links-section summary .ext-links-chevron {
          transition: transform 0.2s;
          font-size: 10px;
          color: var(--ext-text-muted);
        }
        .ext-links-section[open] summary .ext-links-chevron { transform: rotate(90deg); }
        .ext-links-section summary:hover { background: rgba(255,255,255,0.06); }
        .ext-links-section__body { padding: 14px 0 4px 0; }
        .ext-links-section__body > div { margin-bottom: 10px; }
        .ext-links-config label { cursor: pointer; color: var(--ext-text); }
        .ext-links-config input[type="text"] {
          background: var(--ext-bg);
          border: 1px solid var(--ext-border);
          border-radius: 8px;
          color: var(--ext-text);
          padding: 8px 12px;
          width: 100%;
          max-width: 320px;
        }
        .ext-links-config input[type="text"]:focus {
          outline: none;
          border-color: var(--ext-text-muted);
        }
        .ext-links-config input[type="checkbox"] { margin-right: 8px; accent-color: #3498db; }
        .ext-links-config .ext-links-tracker-entry { margin-bottom: 8px; }
        .ext-links-config .ext-links-tracker-entry .apiKey { width: 100%; max-width: none; margin-top: 4px; }
        .ext-links-config button:not(#saveConfigBtn) {
          background: var(--ext-surface);
          border: 1px solid var(--ext-border);
          color: var(--ext-text);
          padding: 8px 14px;
          border-radius: 8px;
          cursor: pointer;
          font-size: 13px;
        }
        .ext-links-config button:not(#saveConfigBtn):hover {
          background: #404040;
          border-color: var(--ext-text-muted);
        }
        .ext-links-config .removeCustomSiteBtn { margin-left: 8px; }
        .ext-links-config .customSiteEntry {
          margin-bottom: 14px;
          padding-bottom: 14px;
          border-bottom: 1px solid var(--ext-border);
        }
        .ext-links-config .customSiteEntry:last-child { border-bottom: none; }
        .ext-links-config .ext-links-muted { color: var(--ext-text-muted); font-size: 12px; }
        .ext-links-config::-webkit-scrollbar { width: 12px; }
        .ext-links-config::-webkit-scrollbar-track { background: #2a2a2a; border-radius: 6px; }
        .ext-links-config::-webkit-scrollbar-thumb { background: #606060; border-radius: 6px; border: 2px solid #2a2a2a; }
        .ext-links-config::-webkit-scrollbar-thumb:hover { background: #707070; }
        .ext-links-section-badge {
          margin-left: auto;
          min-width: 20px;
          padding: 2px 8px;
          font-size: 12px;
          font-weight: 600;
          line-height: 1.2;
          text-align: center;
          background: var(--ext-border);
          color: var(--ext-text);
          border-radius: 10px;
        }
      </style>
      <div class="ext-links-config">
        <div class="ext-links-config__header">
          <h2>Configure External Links</h2>
          <button type="button" id="saveConfigBtn">Save</button>
        </div>

        <details class="ext-links-section" open>
          <summary style="${summaryStyles}">${summaryMarker}Settings</summary>
          <div class="ext-links-section__body" style="${sectionStyles}">
            <div><label><input type="checkbox" id="showReleaseCount" ${showReleaseCount}> Show release count badges</label></div>
            <div><label><input type="checkbox" id="enableApiSupport" ${enableApiSupport}> Enable API support</label></div>
            <div><label><input type="checkbox" id="showIconsWithoutReleases" ${showIconsWithoutReleases}> Show icons even when no releases are found</label></div>
            <div><label><input type="checkbox" id="onlySearchByButton" ${onlySearchChecked}> Only search by button press (show generic icon until clicked)</label></div>
            <div style="margin-left: 18px;"><label><input type="checkbox" id="skipCacheWhenButtonPress" ${skipCacheWhenButtonPressChecked}> Skip API cache when button press is required</label></div>
            <div><label><input type="checkbox" id="useTrackerFavicon" ${useTrackerFaviconChecked}> Use tracker favicon (https://domain/favicon.ico) for tracker icons</label></div>
          </div>
        </details>

        <details class="ext-links-section">
          <summary style="${summaryStyles}">${summaryMarker}${SITE_TYPE_LABELS[SITE_TYPES.STANDARD]}<span class="ext-links-section-badge">${countMetadata}</span></summary>
          <div class="ext-links-section__body" style="${sectionStyles}">
            ${(sortSitesByName(sitesByType[SITE_TYPES.STANDARD])).map(site => `
              <div><label><input type="checkbox" value="${escapeHtml(site.name)}" ${ENABLED_SITES.includes(site.name) ? "checked" : ""}> ${escapeHtml(site.name)}</label></div>
            `).join("") || "<span style=\"color: var(--ext-text-muted);\">No sites</span>"}
          </div>
        </details>

        <details class="ext-links-section">
          <summary style="${summaryStyles}">${summaryMarker}${SITE_TYPE_LABELS[SITE_TYPES.INDEXER]}<span class="ext-links-section-badge">${countIndexer}</span></summary>
          <div class="ext-links-section__body" style="${sectionStyles}">
            ${(sortSitesByName(sitesByType[SITE_TYPES.INDEXER])).map(site => `
              <div style="margin-bottom: 10px;">
                <label><input type="checkbox" value="${escapeHtml(site.name)}" ${ENABLED_SITES.includes(site.name) ? "checked" : ""}> ${escapeHtml(site.name)}</label>
                <br>
                <input type="text" placeholder="Base URL" value="${escapeHtml(config.INDEXER_BASE_URLS[site.baseUrlConfigKey] || '')}" class="indexerBaseUrl" data-site="${escapeHtml(site.name)}" data-config-key="${escapeHtml(site.baseUrlConfigKey)}">
              </div>
            `).join("") || "<span style=\"color: var(--ext-text-muted);\">No indexer sites</span>"}
          </div>
        </details>

        <details class="ext-links-section">
          <summary style="${summaryStyles}">${summaryMarker}${SITE_TYPE_LABELS[SITE_TYPES.TRACKER]}<span class="ext-links-section-badge">${countTracker}</span></summary>
          <div class="ext-links-section__body" style="${sectionStyles}">
            ${trackerInputsHtml}
          </div>
        </details>

        <details class="ext-links-section">
          <summary style="${summaryStyles}">${summaryMarker}${SITE_TYPE_LABELS[SITE_TYPES.UNIT3D]}<span class="ext-links-section-badge">${countUnit3d}</span></summary>
          <div class="ext-links-section__body" style="${sectionStyles}">
            ${(sortSitesByName(sitesByType[SITE_TYPES.UNIT3D])).map(site => `
              <div style="margin-bottom: 10px;">
                <label style="min-width: 120px; display: inline-block;"><input type="checkbox" value="${escapeHtml(site.name)}" ${ENABLED_SITES.includes(site.name) ? "checked" : ""}> ${escapeHtml(site.name)}</label>
                <input type="text" placeholder="API Key" value="${escapeHtml(API_KEYS[site.name] || '')}" class="apiKey" data-site="${escapeHtml(site.name)}">
              </div>
            `).join("") || "<span style=\"color: var(--ext-text-muted);\">No UNIT3D sites</span>"}
          </div>
        </details>

        <details class="ext-links-section">
          <summary style="${summaryStyles}">${summaryMarker}${SITE_TYPE_LABELS.CUSTOM_UNIT3D}<span class="ext-links-section-badge">${countCustom}</span></summary>
          <div class="ext-links-section__body" style="${sectionStyles}">
            <div style="margin-bottom: 12px;">
              <input type="text" id="newCustomSiteBase" placeholder="https://example.xyz/" style="width: 70%; margin-right: 8px;">
              <button type="button" id="addCustomSiteBtn">Add Site</button>
            </div>
            <div id="customSitesList">${customSitesHtml}</div>
          </div>
        </details>
      </div>
    `;

    const configDiv = document.createElement("div");
    configDiv.innerHTML = html;
    configDiv.style.cssText = "position: fixed; inset: 0; z-index: 9998; display: flex; align-items: center; justify-content: center; background: #181818f5; backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); padding: 20px;";
    document.body.appendChild(configDiv);

    // Mask API key / token / passkey fields: keep the real value on the element,
    // display a fixed placeholder (no real characters), and only treat the field
    // as edited once the user actually types into it. resolveSecretInput() then
    // returns the stored value for untouched fields and the typed value otherwise.
    function applySecretMasking(container) {
      container.querySelectorAll('input.apiKey').forEach((input) => {
        const v = input.value;
        if (!v) return;
        input.dataset.fullValue = v;
        input.dataset.masked = "1";
        input.value = SECRET_PLACEHOLDER;
        // Clear the placeholder display on focus, but keep the "masked" flag until
        // the user actually types — so focus+blur without editing keeps the key.
        input.addEventListener('focus', () => {
          if (input.dataset.masked === "1") input.value = "";
        });
        input.addEventListener('input', () => { delete input.dataset.masked; });
        input.addEventListener('blur', () => {
          if (input.dataset.masked === "1") input.value = SECRET_PLACEHOLDER;
        });
      });
    }
    applySecretMasking(configDiv);

    function closeModal() {
      if (document.body.contains(configDiv)) {
        document.body.removeChild(configDiv);
        document.removeEventListener("keydown", closeOnEscape);
      }
    }
    function closeOnEscape(e) {
      if (e.key === "Escape") closeModal();
    }
    configDiv.addEventListener("click", (e) => {
      if (e.target === configDiv) closeModal();
    });
    document.addEventListener("keydown", closeOnEscape);

    configDiv
      .querySelector("#saveConfigBtn")
      .addEventListener("click", async () => {
        const checkboxes = configDiv.querySelectorAll('input[type="checkbox"]:not(#showReleaseCount):not(#enableApiSupport):not(#showIconsWithoutReleases):not(#onlySearchByButton):not(#skipCacheWhenButtonPress):not(#useTrackerFavicon)');
        const newEnabledSites = Array.from(checkboxes)
          .filter((checkbox) => checkbox.checked)
          .map((checkbox) => checkbox.value);

        // Collect API keys, preserving DOM order per site (== the descriptor's
        // field order, since inputs are rendered in that order). Multi-credential
        // trackers store their parts "|"-joined. Masked fields resolve to the
        // stored value.
        const apiKeyInputs = configDiv.querySelectorAll('input.apiKey');
        const grouped = {};

        apiKeyInputs.forEach(input => {
          const site = input.getAttribute('data-site');
          if (!site) return;
          const value = resolveSecretInput(input);
          if (!grouped[site]) grouped[site] = [];
          grouped[site].push(value);
        });

        const newApiKeys = {};
        for (const site in grouped) {
          const combined = grouped[site].map(v => (v || '').trim()).filter(Boolean).join('|');
          if (combined) newApiKeys[site] = combined;
        }

        // Collect indexer base URLs
        const indexerBaseUrlInputs = configDiv.querySelectorAll('input.indexerBaseUrl');
        const newIndexerBaseUrls = {};

        indexerBaseUrlInputs.forEach(input => {
          const configKey = input.getAttribute('data-config-key');
          const value = input.value.trim();

          if (value) {
            newIndexerBaseUrls[configKey] = value;
          }
        });

        // Collect custom UNIT3D sites from the DOM and persist them (non-expiring)
        const customSiteEntries = configDiv.querySelectorAll('.customSiteEntry');
        const newCustomSites = [];
        customSiteEntries.forEach(entry => {
          const base = entry.getAttribute('data-base') || '';
          const name = entry.getAttribute('data-name') || '';
          if (!base || !name) return;
          // normalize base to ensure trailing slash
          let normalized = base.trim();
          if (!normalized.endsWith('/')) normalized += '/';
          try {
            const origin = new URL(normalized).origin;
            const siteObj = {
              name: name,
              icon: `${origin}/favicon.ico`,
              imdbSearchUrl: `${normalized}torrents?imdbId=$Id`,
              tmdbSearchUrl: `${normalized}torrents?tmdbId=$Id`,
              nameSearchUrl: `${normalized}torrents?name=$Id`,
              type: SITE_TYPES.UNIT3D,
              base: normalized
            };
            newCustomSites.push(siteObj);
          } catch (e) { /* ignore invalid */ }
        });

        // Persist custom sites
        await saveCustomSites(newCustomSites);

        // Get show release count setting
        const showReleaseCount = document.getElementById('showReleaseCount').checked;
        const enableApiSupport = document.getElementById('enableApiSupport').checked;
        const showIconsWithoutReleases = document.getElementById('showIconsWithoutReleases').checked;
        const onlySearchByButton = document.getElementById('onlySearchByButton').checked;
        const skipCacheWhenButtonPress = document.getElementById('skipCacheWhenButtonPress').checked;
        const useTrackerFavicon = document.getElementById('useTrackerFavicon').checked;

        config.ENABLED_SITES = newEnabledSites;
        config.API_KEYS = newApiKeys;
        config.INDEXER_BASE_URLS = newIndexerBaseUrls;
        config.SHOW_RELEASE_COUNT = showReleaseCount;
        config.ENABLE_API_SUPPORT = enableApiSupport;
        config.SHOW_ICONS_WITHOUT_RELEASES = showIconsWithoutReleases;
        config.ONLY_SEARCH_BY_BUTTON_PRESS = onlySearchByButton;
        config.SKIP_CACHE_WHEN_BUTTON_PRESS = skipCacheWhenButtonPress;
        config.USE_TRACKER_FAVICON = useTrackerFavicon;

        await saveConfig(config);
        // ensure custom sites saved too (already saved above, but reload to pick up)
        alert("Configuration saved! The page will now reload.");
        closeModal();
        window.location.reload();
      });

    // Add handlers for adding/removing custom sites inside the configDiv
    const addBtn = configDiv.querySelector('#addCustomSiteBtn');
    const customList = configDiv.querySelector('#customSitesList');
    if (addBtn) {
      addBtn.addEventListener('click', (e) => {
        const input = configDiv.querySelector('#newCustomSiteBase');
        if (!input) return;
        let base = input.value.trim();
        if (!base) return;
        try {
          if (!base.startsWith('http')) base = 'https://' + base;
          const url = new URL(base);
          let normalized = url.origin + (url.pathname.endsWith('/') ? url.pathname : url.pathname + '/');
          const displayName = url.hostname;
          const dn = escapeHtml(displayName);
          const nb = escapeHtml(normalized);
          // create DOM entry
          const entry = document.createElement('div');
          entry.className = 'customSiteEntry';
          entry.setAttribute('data-base', normalized);
          entry.setAttribute('data-name', displayName);
          entry.innerHTML = `\n            <label>\n              <input type="checkbox" value="${dn}" checked>\n              ${dn}\n            </label>\n            <div class="ext-links-muted">${nb}</div>\n            <div style="margin-top:4px;">\n              <input type="text" placeholder="API Key" value="" class="apiKey" data-site="${dn}">\n              <button class="removeCustomSiteBtn" data-name="${dn}" style="margin-left:8px;">Remove</button>\n            </div>`;
          customList.appendChild(entry);
          // wire remove button
          const rem = entry.querySelector('.removeCustomSiteBtn');
          if (rem) rem.addEventListener('click', () => entry.remove());
          input.value = '';
        } catch (err) { alert('Invalid URL'); }
      });
    }

    // wire existing remove buttons
    const existingRemoves = configDiv.querySelectorAll('.removeCustomSiteBtn');
    existingRemoves.forEach(btn => btn.addEventListener('click', (e) => {
      const parent = btn.closest('.customSiteEntry');
      if (parent) parent.remove();
    }));
  }

  // Add menu command to open configuration UI
  GM.registerMenuCommand("Configure Script", showConfigUI);

  // Main logic
  (async () => {
    // Load config and persisted custom sites concurrently (two independent reads).
    const [config, persistedCustomSites] = await Promise.all([loadConfig(), loadCustomSites()]);
    const { ENABLED_SITES, ICON_FONT_SIZE, API_KEYS, SHOW_RELEASE_COUNT, ENABLE_API_SUPPORT, API_CACHE_EXPIRY } = config;

    // Merge persisted custom UNIT3D sites into runtime sites list so they're used by the script
    const RUNTIME_SITES = Array.isArray(persistedCustomSites) && persistedCustomSites.length ? SITES.concat(persistedCustomSites) : SITES;

    // Cache management functions
    function shouldBypassApiCache(cacheKey) {
      if (!config.ONLY_SEARCH_BY_BUTTON_PRESS || !config.SKIP_CACHE_WHEN_BUTTON_PRESS) {
        return false;
      }
      return typeof cacheKey === 'string' && cacheKey.startsWith('api_cache_');
    }

    async function getCachedApiResponse(cacheKey) {
      try {
        if (shouldBypassApiCache(cacheKey)) return null;
        const cachedData = await GM.getValue(cacheKey);
        if (!cachedData) return null;

        // For favicon caches, do not expire
        if (typeof cacheKey === 'string' && cacheKey.startsWith('favicon_')) {
          dlog(`Using cached favicon for ${cacheKey}`);
          return cachedData.data;
        }

        // Check if cache is expired for other caches
        if (!cachedData.timestamp || (Date.now() - cachedData.timestamp > API_CACHE_EXPIRY)) {
          dlog(`Cache expired for ${cacheKey}`);
          return null;
        }

        dlog(`Using cached data for ${cacheKey}`);
        return cachedData.data;
      } catch (error) {
        console.error(`Error retrieving cache for ${cacheKey}:`, error);
        return null;
      }
    }

    async function setCachedApiResponse(cacheKey, data) {
      try {
        if (shouldBypassApiCache(cacheKey)) return;
        await GM.setValue(cacheKey, {
          timestamp: Date.now(),
          data: data
        });
        dlog(`Cached data for ${cacheKey}`);
      } catch (error) {
        console.error(`Error caching data for ${cacheKey}:`, error);
      }
    }

    // Best-effort, fire-and-forget purge of expired api_cache_* entries so GM
    // storage doesn't grow without bound. No-op where GM.listValues /
    // GM.deleteValue are unavailable (e.g. some Greasemonkey builds). Favicon
    // caches are intentionally permanent and left untouched.
    async function purgeExpiredCaches() {
      try {
        if (typeof GM.listValues !== 'function' || typeof GM.deleteValue !== 'function') return;
        const keys = await GM.listValues();
        if (!Array.isArray(keys)) return;
        const now = Date.now();
        for (const key of keys) {
          if (typeof key !== 'string' || !key.startsWith('api_cache_')) continue;
          const entry = await GM.getValue(key);
          if (!entry || !entry.timestamp || (now - entry.timestamp > API_CACHE_EXPIRY)) {
            await GM.deleteValue(key);
            dlog(`Purged expired cache ${key}`);
          }
        }
      } catch (e) {
        /* best-effort maintenance; ignore */
      }
    }

    // Dispatch to a tracker's private API via its TRACKER_API descriptor (keyed
    // by site.apiHandler — the single source of truth for request + parsing).
    // Returns true if a check was started or short-circuited (resolve was/will be
    // called); false if the site has no descriptor (caller resolves the default).
    function checkSpecificTrackerApi(site, imdbId, tmdbId, tvdbId, titleNoYear, resolve) {
      try {
        const key = site.apiHandler;
        const desc = key && TRACKER_API[key];
        if (!desc) return false;

        const tokens = (API_KEYS[site.name] || "").split("|").map(s => s.trim()).filter(Boolean);
        if (tokens.length < (desc.minTokens || 0)) { resolve(okLink()); return true; }

        const ctx = {
          site, tokens, imdbId, tmdbId, tvdbId, titleNoYear,
          imdbNum: imdbId ? imdbId.replace(/^tt/, "") : "",
          rpcId: Math.random().toString(36).substring(2, 10),
        };
        if (desc.guard && !desc.guard(ctx)) { resolve(okLink()); return true; }

        let req;
        try {
          req = desc.build(ctx);
        } catch (e) {
          console.error(`${key} API request build failed`, e);
          resolve(apiError());
          return true;
        }

        const cacheKey = `api_cache_${key}_${req.cacheSuffix}`;
        getCachedApiResponse(cacheKey).then(cached => {
          if (cached) { resolve(cached); return; }
          GM.xmlHttpRequest({
            method: req.method,
            url: req.url,
            data: req.data,
            headers: req.headers,
            responseType: desc.responseType || "json",
            onload(resp) {
              const ok = resp.status === 200 &&
                (desc.responseType === "text" ? true : Boolean(resp.response));
              if (!ok) {
                if (DEBUG) console.error(`${key} API unexpected response`, { status: resp.status, statusText: resp.statusText });
                resolve(apiError());
                return;
              }
              let count;
              try {
                count = desc.parse(resp);
              } catch (e) {
                console.error(`${key} API parse failed`, e);
                resolve(apiError());
                return;
              }
              const out = apiResult(count);
              setCachedApiResponse(cacheKey, out);
              dlog(`${key} API count for ${cacheKey}: ${count}`);
              resolve(out);
            },
            onerror(err) { console.error(`${key} API error`, err); resolve(apiError()); },
          });
        });
        return true;
      } catch (e) {
        console.error("checkSpecificTrackerApi failed", e);
        return false;
      }
    }

    // Check for releases via API based on site type
    function checkReleasesViaApi(site, imdbId, tmdbId, tvdbId, titleNoYear) {
      return new Promise((resolve) => {
        // Skip API calls if API support is disabled
        if (!ENABLE_API_SUPPORT) {
          resolve(okLink());
          return;
        }

        // Handle different site types
        if (site.type === SITE_TYPES.UNIT3D) {
          checkUnit3dReleases(site, imdbId, tmdbId, resolve);
          return;
        }

        // For TRACKER sites that have an API key configured, try specific handlers first
        if (site.type === SITE_TYPES.TRACKER && API_KEYS[site.name]) {
          const handled = checkSpecificTrackerApi(site, imdbId, tmdbId, tvdbId, titleNoYear, resolve);
          if (handled) return; // specific handler will call resolve
        }

        // For STANDARD sites or trackers without API support, default to showing the link
        resolve(okLink());
      });
    }

    // Check specifically for UNIT3D releases (resolves via the passed callback).
    function checkUnit3dReleases(site, imdbId, tmdbId, resolve) {
      // Skip the check if no API key is available
      if (!API_KEYS[site.name]) {
        resolve(okLink()); // Default to showing the link if no API key
        return;
      }

      let baseUrl;
      try {
        baseUrl = new URL(site.imdbSearchUrl.replace('$Id', '')).origin;
      } catch (e) {
        resolve(okLink()); // Malformed site URL — show the link rather than crash
        return;
      }
      let apiUrl = `${baseUrl}/api/torrents/filter?`;

      // Add appropriate parameter based on available IDs
      if (tmdbId) {
        apiUrl += `tmdbId=${tmdbId}`;
      } else if (imdbId) {
        apiUrl += `imdbId=${imdbId}`;
      } else {
        resolve(okLink()); // Default to showing if no IDs available
        return;
      }

      // Create a cache key based on the site and ID
      const cacheKey = `api_cache_${site.name}_${tmdbId || imdbId}`;

      // Try to get cached response first
      getCachedApiResponse(cacheKey).then(cachedResponse => {
        if (cachedResponse) {
          // Use cached data
          resolve(cachedResponse);
          return;
        }

        // If no cached data or expired, make the API request
        GM.xmlHttpRequest({
          method: "GET",
          url: apiUrl,
          headers: {
            'Authorization': `Bearer ${API_KEYS[site.name]}`,
            'Accept': 'application/json',
          },
          responseType: "json",
          onload: function (response) {
            if (response.status === 200 && response.response) {
              const data = response.response;
              // Prefer the API's reported total (data.data is only the current
              // page); fall back to the page length. Guard the array shape.
              const list = Array.isArray(data.data) ? data.data : [];
              const total = data.meta && typeof data.meta.total === "number"
                ? data.meta.total
                : list.length;
              const result = apiResult(total);
              setCachedApiResponse(cacheKey, result);
              resolve(result);
            } else {
              console.error(`API request failed for ${site.name}:`, response);
              resolve(apiError()); // Indicate error
            }
          },
          onerror: function (err) {
            console.error(`API request error for ${site.name}:`, err);
            resolve(apiError()); // Indicate error
          }
        });
      });
    }

    const TRANSPARENT_PIXEL = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
    // Sentinel cached when a favicon fetch fails, so we don't re-fetch a missing
    // /favicon.ico on every page load (negative caching).
    const FAVICON_FAILED = "__ext_links_favicon_failed__";

    // Function to create an external link element
    async function createExternalLink(url, site, releaseCount, hasError = false, showBadges = true) {
      let linkElement = document.createElement("a");
      linkElement.className = "external-link-item";
      linkElement.dataset.site = site.name;
      let image = site.icon.endsWith(".svg") || site.icon.endsWith(".png");

      const customSize = config.CUSTOM_ICON_SIZES?.[site.name];
      const iconWidth = customSize?.width || config.ICON_FONT_SIZE;
      const iconHeight =
        customSize?.height ||
        (image ? config.ICON_IMAGE_SIZE : config.ICON_FONT_SIZE);

      let badgeHtml = "";
      // Show badges for UNIT3D sites and TRACKER sites when API key is configured
      if (showBadges && (site.type === SITE_TYPES.UNIT3D || (site.type === SITE_TYPES.TRACKER && API_KEYS[site.name])) && SHOW_RELEASE_COUNT) {
        if (hasError) {
          // Show error indicator
          badgeHtml = `<span class="release-count-badge error-badge">!</span>`;
        } else if (releaseCount > 0 || config.SHOW_ICONS_WITHOUT_RELEASES) {
          // Show count (0 in red if no releases)
          const badgeClass = releaseCount > 0 ? "release-count-badge" : "release-count-badge zero-badge";
          badgeHtml = `<span class="${badgeClass}">${releaseCount}</span>`;
        }
      }

      // Determine favicon usage: always use favicon for custom sites (site.base),
      // otherwise optionally use favicon when global setting enabled for tracker/unit3d types
      let iconUrl = site.icon;
      let useFavicon = false;
      let faviconOrigin = "";
      try {
        if (site.base) {
          faviconOrigin = new URL(site.base).origin;
          useFavicon = true;
          image = true;
        } else if ((site.type === SITE_TYPES.TRACKER || site.type === SITE_TYPES.UNIT3D) && config.USE_TRACKER_FAVICON) {
          const base = (site.nameSearchUrl || site.imdbSearchUrl || site.tmdbSearchUrl || "").replace('$Id', '');
          faviconOrigin = new URL(base).origin;
          useFavicon = true;
          image = true;
        }
      } catch (e) {
        // fallback to existing icon
      }

      const fallbackUrl = (typeof site.icon === "string" && site.icon.startsWith('http')) ? site.icon : '';
      let cachedFavicon = null;
      let faviconFailed = false;
      if (useFavicon && faviconOrigin) {
        const cached = await getCachedApiResponse(`favicon_${faviconOrigin}`);
        if (cached === FAVICON_FAILED) {
          // The background base64 fetch failed before, so don't re-fetch — but
          // still try the live icon URL as an <img> (it may load fine directly).
          // For font-class icons fallbackUrl is "" so we fall through to the <i>.
          faviconFailed = true;
          iconUrl = fallbackUrl;
        } else if (cached) {
          cachedFavicon = cached;
          iconUrl = cached;
        } else {
          iconUrl = fallbackUrl || TRANSPARENT_PIXEL;
        }
      }

      // Build the icon container with the DOM API (no innerHTML for dynamic
      // values, no inline event handlers running in the page's main world).
      const container = document.createElement("div");
      container.className = "icon-container";

      const renderImage = image && typeof iconUrl === "string" &&
        (iconUrl.startsWith("http") || iconUrl.startsWith("data:"));
      if (renderImage) {
        const img = document.createElement("img");
        img.src = iconUrl;
        img.alt = site.name;
        img.style.width = iconWidth;
        img.style.height = iconHeight;
        // Sandboxed error fallback (replaces the old inline onerror string that
        // ran in page context): try the configured icon URL, else a font icon.
        img.addEventListener("error", function onImgError() {
          img.removeEventListener("error", onImgError);
          if (fallbackUrl && img.src !== fallbackUrl) {
            img.src = fallbackUrl;
          } else {
            img.style.display = "none";
            if (typeof site.icon === "string" && !site.icon.startsWith("http") && !site.icon.startsWith("data:")) {
              const i = document.createElement("i");
              i.className = site.icon;
              i.style.fontSize = iconWidth;
              container.appendChild(i);
            }
          }
        });
        container.appendChild(img);
      } else {
        const i = document.createElement("i");
        i.className = site.icon;
        i.style.fontSize = iconWidth;
        container.appendChild(i);
      }

      if (badgeHtml) container.insertAdjacentHTML("beforeend", badgeHtml);

      // Inner anchor (matches the previous <a class="meta-id-tag"> structure).
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.title = site.name;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      anchor.className = "meta-id-tag";
      anchor.appendChild(container);
      anchor.appendChild(document.createElement("div"));
      linkElement.appendChild(anchor);

      // If using a favicon and we don't have one cached yet, fetch it as a base64
      // data URL and cache it. On failure, cache a sentinel so we don't retry the
      // missing favicon on every future page load.
      if (useFavicon && faviconOrigin && !cachedFavicon && !faviconFailed) {
        const cacheKey = `favicon_${faviconOrigin}`;
        const imgEl = renderImage ? container.querySelector('img') : null;
        GM.xmlHttpRequest({
          method: 'GET',
          url: `${faviconOrigin}/favicon.ico`,
          responseType: 'arraybuffer',
          onload: function (res) {
            try {
              if (res.status === 200 && res.response && res.response.byteLength) {
                const bytes = new Uint8Array(res.response);
                let binary = '';
                const chunk = 0x8000;
                for (let i = 0; i < bytes.length; i += chunk) {
                  binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
                }
                const dataUrl = `data:image/x-icon;base64,${btoa(binary)}`;
                setCachedApiResponse(cacheKey, dataUrl);
                if (imgEl) imgEl.src = dataUrl;
              } else {
                setCachedApiResponse(cacheKey, FAVICON_FAILED);
              }
            } catch (e) {
              setCachedApiResponse(cacheKey, FAVICON_FAILED);
            }
          },
          onerror: function () { setCachedApiResponse(cacheKey, FAVICON_FAILED); }
        });
      }

      return linkElement;
    }

    function updateExternalLinkBadge(linkElement, site, releaseCount, hasError = false) {
      if (!linkElement) return;
      const container = linkElement.querySelector('.icon-container');
      if (!container) return;

      const existingBadge = container.querySelector('.release-count-badge');
      if (existingBadge) existingBadge.remove();

      if (!(site.type === SITE_TYPES.UNIT3D || (site.type === SITE_TYPES.TRACKER && API_KEYS[site.name])) || !SHOW_RELEASE_COUNT) {
        return;
      }

      if (hasError) {
        container.insertAdjacentHTML('beforeend', '<span class="release-count-badge error-badge">!</span>');
        return;
      }

      if (releaseCount > 0 || config.SHOW_ICONS_WITHOUT_RELEASES) {
        const badgeClass = releaseCount > 0 ? "release-count-badge" : "release-count-badge zero-badge";
        container.insertAdjacentHTML('beforeend', `<span class="${badgeClass}">${releaseCount}</span>`);
      }
    }

    // New function to handle link preparation and collection
    async function prepareLink(site, imdbId, tmdbId, tvdbId, mediaTitle, mediaTitleNoYear, runApiChecks = true, isMovie = true) {
      let searchUrl = "";
      if (imdbId != "" && site.imdbSearchUrl != "") {
        searchUrl = site.imdbSearchUrl.replace("$Id", imdbId);
      } else if (tmdbId != "" && site.tmdbSearchUrl != "") {
        // Use the TV-specific TMDB template when present and this is a TV title
        // (e.g. slow.pics /tmdb/tv/ vs /tmdb/movie/, KinoBaza /tv/ vs /movie/).
        const tmdbTemplate = (!isMovie && site.tmdbSearchUrlTv) ? site.tmdbSearchUrlTv : site.tmdbSearchUrl;
        searchUrl = tmdbTemplate.replace("$Id", tmdbId);
      } else if (mediaTitle != "" && site.nameSearchUrl != "") {
        // Encode the title so spaces / & / # / ? don't corrupt the query.
        searchUrl = site.nameSearchUrl.replace("$Id", encodeURIComponent(mediaTitle));
      }

      if (searchUrl === "") {
        return null; // No valid URL, skip this site
      }

      // Handle INDEXER type sites
      if (site.type === SITE_TYPES.INDEXER) {
        const baseUrl = config.INDEXER_BASE_URLS[site.baseUrlConfigKey];
        if (!baseUrl) {
          dlog(`No base URL configured for ${site.name}, skipping`);
          return null;
        }
        searchUrl = searchUrl.replace("$BASE_URL", baseUrl);
      }

      // Special handling for KinoBaza: it resolves the real destination via its
      // API. Only hit the network when API checks run (so button-press mode shows
      // a placeholder until clicked), cache the result, and validate the URL.
      if (site.name === "KinoBaza") {
        if (!runApiChecks) {
          return { site: site, url: searchUrl, count: 0, error: false };
        }
        const cacheKey = `api_cache_KinoBaza_${tmdbId || imdbId || encodeURIComponent(searchUrl)}`;
        const cached = await getCachedApiResponse(cacheKey);
        if (cached && cached.url) {
          return { site: site, url: cached.url, count: 0, error: false };
        }
        try {
          const response = await new Promise((resolve, reject) => {
            GM.xmlHttpRequest({
              method: "GET",
              url: searchUrl,
              responseType: "json",
              onload: resolve,
              onerror: reject
            });
          });
          const resolvedUrl = response.response && response.response.url;
          if (resolvedUrl && isSafeHttpUrl(resolvedUrl)) {
            setCachedApiResponse(cacheKey, { url: resolvedUrl });
            return { site: site, url: resolvedUrl, count: 0, error: false };
          }
          return null;
        } catch (err) {
          console.error("KinoBaza fetch failed:", err);
          return { site: site, url: searchUrl, count: 0, error: true };
        }
      }

      // Check for releases on sites with API support if API key is available
      // Allow UNIT3D and TRACKER sites to use API checks when an API key is present
      if (runApiChecks && site.type !== SITE_TYPES.STANDARD && site.type !== SITE_TYPES.INDEXER && API_KEYS[site.name]) {
        const result = await checkReleasesViaApi(site, imdbId, tmdbId, tvdbId, mediaTitleNoYear);
        if (result.hasReleases || config.SHOW_ICONS_WITHOUT_RELEASES) {
          return {
            site: site,
            url: searchUrl,
            count: result.count,
            error: result.error
          };
        } else {
          dlog(`No releases found on ${site.name}, hiding link`);
          return null;
        }
      } else {
        // For sites without API support or without API keys, include link as usual
        return {
          site: site,
          url: searchUrl,
          count: 0,
          error: false
        };
      }
    }

    (function () {
      // Bail out early when this isn't a UNIT3D torrent/request detail page. The
      // @match is intentionally broad (*://*/torrents/*, *://*/requests/*) so the
      // script works on any UNIT3D tracker, but that also loads it on unrelated
      // sites. ".meta__ids" is the container we render into and our reliable
      // sentinel — guarding here prevents the DOM-scraping below from throwing on
      // foreign pages and avoids injecting stylesheets / running logic there.
      const externalLinksUl = document.querySelector(".meta__ids");
      if (!externalLinksUl) return;

      // Best-effort maintenance: drop expired caches (fire-and-forget).
      purgeExpiredCaches();

      // FontAwesome (solid/light/regular AND brands) is already provided by the
      // UNIT3D host page, served from 'self' and allowed by the tracker CSP. We
      // render fa-* glyphs against that bundled build, so no external stylesheet
      // is injected here. Previously this block appended brands.min.css from
      // cdnjs.cloudflare.com, which violated the page's style-src CSP
      // ('self' 'unsafe-inline' github.* only) and was blocked on every load.

      //Style changes
      const overriddenStyles = `
        .meta__ids {
            column-gap: 0;
            flex-direction: row;
            flex-wrap: wrap;
        }

        .meta-id-tag {
            font-size: ${ICON_FONT_SIZE};
            padding: 0 10px;
        }

        .meta__description {
            margin-top: 2px;
        }

        .icon-container {
            position: relative;
            display: inline-block;
        }

        .release-count-badge {
            position: absolute;
            top: -10px;
            right: -10px;
            background-color: #28a745;
            color: white;
            border-radius: 50%;
            font-size: 12px;
            min-width: 20px;
            height: 20px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: bold;
            padding: 0 4px;
            box-shadow: 0 0 3px rgba(0,0,0,0.3);
        }

        .release-count-badge.zero-badge {
            background-color: #dc3545;
        }

        .release-count-badge.error-badge {
            background-color: #ffc107;
            color: #212529;
        }
    `;
      const stylesheet = new CSSStyleSheet();
      stylesheet.replaceSync(overriddenStyles);
      // Append rather than replace, so we don't clobber sheets the host page or
      // another userscript already adopted.
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, stylesheet];

      let imdbId = "";
      let tmdbId = "";
      let tvdbId = "";
      let isMovie = "";

      // TMDB id — tolerate slugged/queried hrefs (e.g. /movie/27205-inception)
      // and a missing anchor instead of throwing on .match(...)[1].
      const tmdbLi = document.querySelector(".meta__tmdb");
      if (tmdbLi) {
        const tmdbAnchor = tmdbLi.querySelector("a");
        const href = tmdbAnchor && tmdbAnchor.href;
        const match = href && href.match(/\/(\d+)(?:[/?#-]|$)/);
        if (match) {
          tmdbId = match[1];
          isMovie = href.includes("/movie");
        }
      }

      // IMDb id — extract the ttNNNN token directly (robust to trailing slashes
      // and a non-anchor first child).
      const imdbLi = document.querySelector(".meta__imdb");
      if (imdbLi) {
        const imdbAnchor = imdbLi.querySelector("a");
        const imdbHref = imdbAnchor && imdbAnchor.href;
        const ttMatch = imdbHref && imdbHref.match(/tt\d+/);
        imdbId = ttMatch ? ttMatch[0] : "";
      }

      const tvdbLi = document.querySelector(".meta__tvdb");
      if (tvdbLi) {
        const tvdbLink = tvdbLi.querySelector("a");
        if (tvdbLink && tvdbLink.href) {
          const match = tvdbLink.href.match(/[?&]id=(\d+)/);
          if (match) {
            tvdbId = match[1];
          }
        }
      }

      const malLi = document.querySelector(".meta__mal");
      if (malLi) {
        const malLink = malLi.children[0];
        const malImg = malLink && malLink.querySelector("img");

        // Replace the image URL
        if (malImg) {
          malImg.src = "https://simpleicons.org/icons/myanimelist.svg";

          // Apply size and filter styles
          malImg.style.width = "40px";
          malImg.style.height = "35px";
          malImg.style.filter =
            "invert(91%) sepia(6%) saturate(0%) hue-rotate(180deg) brightness(94%) contrast(88%)";
        }
      }

      // Title — use textContent (`.outerText` is non-standard and returns
      // undefined on Firefox/Greasemonkey) and tolerate a missing element.
      const titleEl = document.querySelector(".meta__title") || document.querySelector(".movie-heading a");
      const mediaTitle = titleEl ? (titleEl.textContent || "").trim() : "";

      const mediaTitleNoYear = mediaTitle
        ? mediaTitle.replace(/\(\d{4}\)/, " ").replace(/\s+/g, " ").trim()
        : "";

      // Fallback movie/TV detection — guarded against missing markup (the old
      // "3rd <ul>, first child" walk threw on any layout variation). When the
      // markup can't be read, a TVDB id strongly implies a TV title.
      if (isMovie === "") {
        try {
          const article = document.querySelector("main article");
          const typeUl = article ? article.querySelectorAll("ul")[2] : null;
          const firstItem = typeUl && typeUl.children[0];
          isMovie = firstItem ? firstItem.textContent.includes("Movie") : !tvdbId;
        } catch (e) {
          isMovie = !tvdbId;
        }
      }

      // Function to parse torrent__name and extract the title
      function parseTorrentName(torrentName, isMovie) {
        if (isMovie) {
          // Extract title until the year (assumes year is a 4-digit number)
          let match = torrentName.match(/^(.*?)(\s\d{4})/);
          return match ? match[1].trim() : torrentName;
        } else {
          // Extract title before the season/series info (e.g., "S01E01", "Season 1", etc.)
          let match = torrentName.match(
            /^(.*?)(\s[Ss]\d{1,2}[Ee]\d{1,2}|\s[Ss]eason\s\d+)/
          );
          return match ? match[1].trim() : torrentName;
        }
      }

      // Extract torrent__name from the page
      const torrentNameElement = document.querySelector(".torrent__name");
      const torrentName = torrentNameElement
        ? torrentNameElement.textContent.trim()
        : "";

      let extractedTitle = mediaTitle;
      if (torrentName) {
        extractedTitle = parseTorrentName(torrentName, isMovie);
      }

      // Update AniList and AniDB links to use the parsed title
      const aniListLink = SITES.find((site) => site.name === "AniList");
      const aniDbLink = SITES.find((site) => site.name === "AniDB");

      if (aniListLink && extractedTitle) {
        aniListLink.nameSearchUrl = aniListLink.nameSearchUrl.replace(
          "$Id",
          encodeURIComponent(extractedTitle)
        );
      }
      if (aniDbLink && extractedTitle) {
        aniDbLink.nameSearchUrl = aniDbLink.nameSearchUrl.replace(
          "$Id",
          encodeURIComponent(extractedTitle)
        );
      }

      // Filter sites based on media type (movie or TV)
      let filteredSites = [];
      if (!isMovie) {
        filteredSites = RUNTIME_SITES.filter(
          (site) => !MOVIE_ONLY_SITES.includes(site.name)
        );
      } else {
        filteredSites = RUNTIME_SITES.filter(
          (site) => !TV_ONLY_SITES.includes(site.name)
        );
      }

      // Get the current site URL to avoid adding links to the same site
      // (externalLinksUl was resolved by the sentinel guard at the top).
      const currentSiteURL = window.location.origin;

      // Collect all enabled sites that should be displayed
      const enabledSitesOrder = (() => {
        const enabledOrder = ENABLED_SITES.slice();
        const enabledSet = new Set(enabledOrder);
        const runtimeUnit3dSites = RUNTIME_SITES
          .filter(site => site.type === SITE_TYPES.UNIT3D && enabledSet.has(site.name))
          .map(site => site.name);
        const sortedUnit3dSites = Array.from(new Set(runtimeUnit3dSites))
          .sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));

        if (!sortedUnit3dSites.length) {
          return enabledOrder;
        }

        const nonUnit3dSites = enabledOrder.filter(name => !sortedUnit3dSites.includes(name));
        const unit3dInsertIndex = enabledOrder.findIndex(name => sortedUnit3dSites.includes(name));
        if (unit3dInsertIndex === -1) {
          return enabledOrder;
        }

        return nonUnit3dSites.slice(0, unit3dInsertIndex)
          .concat(sortedUnit3dSites, nonUnit3dSites.slice(unit3dInsertIndex));
      })();

      const enabledSitesMap = {};
      enabledSitesOrder.forEach((siteName, index) => {
        enabledSitesMap[siteName] = index;
      });

      // Filter the sites that should be added
      const sitesToProcess = filteredSites.filter(site => {
        // First check if the site is enabled
        if (!ENABLED_SITES.includes(site.name)) {
          return false;
        }

        if (site.name === "Letterboxd" && document.querySelector(".meta__letterboxd") !== null) {
          return false;
        }

        // For INDEXER type sites, we need to check if the base URL is configured
        if (site.type === SITE_TYPES.INDEXER) {
          const baseUrl = config.INDEXER_BASE_URLS[site.baseUrlConfigKey];
          if (!baseUrl) {
            return false;
          }
          // For INDEXER sites, we don't need to check against currentSiteURL
          return true;
        }

        // For other site types, check the site is not the current site (guard a
        // malformed custom-site URL so it can't break the whole filter).
        if (!site.nameSearchUrl) return true;
        try {
          return new URL(site.nameSearchUrl.replace('$Id', '')).origin !== currentSiteURL;
        } catch (e) {
          return true;
        }
      });

      // Sort sites to match order in ENABLED_SITES
      sitesToProcess.sort((a, b) => {
        const indexA = enabledSitesMap[a.name] !== undefined ? enabledSitesMap[a.name] : Infinity;
        const indexB = enabledSitesMap[b.name] !== undefined ? enabledSitesMap[b.name] : Infinity;
        return indexA - indexB;
      });

      // Process all sites in order and add links
      (async () => {
        // If only-search-by-button option is enabled, show all icons without counts
        // and use the button to trigger API checks.
        if (config.ONLY_SEARCH_BY_BUTTON_PRESS) {
          const initialLinkPromises = sitesToProcess.map(site =>
            prepareLink(site, imdbId, tmdbId, tvdbId, mediaTitle, mediaTitleNoYear, false, isMovie)
          );
          const initialPreparedLinks = await Promise.all(initialLinkPromises);
          // sitesToProcess is already sorted; Promise.all and filter preserve
          // input order, so no re-sort is needed here.
          const initialValidLinks = initialPreparedLinks.filter(link => link !== null);
          const initialLinkElements = await Promise.all(
            initialValidLinks.map(link => createExternalLink(link.url, link.site, 0, false, false))
          );
          const initialFragment = document.createDocumentFragment();
          initialLinkElements.forEach(linkElement => initialFragment.appendChild(linkElement));
          externalLinksUl.appendChild(initialFragment);

          const generic = document.createElement('a');
          generic.href = '#';
          generic.className = 'meta-id-tag generic-search-btn';
          const iconSize = ICON_FONT_SIZE || '24px';
          generic.innerHTML = ` <div class="icon-container"><i class="fa-solid fa-magnifying-glass" style="font-size:${iconSize};"></i></div>`;
          externalLinksUl.appendChild(generic);

          generic.addEventListener('click', async (e) => {
            e.preventDefault();
            generic.remove();

            const existingLinks = externalLinksUl.querySelectorAll('.external-link-item');
            const linkBySite = {};
            existingLinks.forEach(link => {
              if (link.dataset.site) linkBySite[link.dataset.site] = link;
            });

            sitesToProcess.forEach(site => {
              prepareLink(site, imdbId, tmdbId, tvdbId, mediaTitle, mediaTitleNoYear, true, isMovie)
                .then(result => {
                  const linkElement = linkBySite[site.name];
                  if (!linkElement) return;
                  // A null result means the link should be hidden (no releases &
                  // SHOW_ICONS_WITHOUT_RELEASES off, or KinoBaza couldn't resolve)
                  // — remove the placeholder icon, matching auto-search mode.
                  if (!result) { linkElement.remove(); return; }
                  const inner = linkElement.querySelector('a.meta-id-tag');
                  if (inner && result.url) {
                    inner.href = result.url;
                    inner.title = site.name;
                  }
                  updateExternalLinkBadge(linkElement, site, result.count, result.error);
                })
                .catch(err => {
                  console.error(`API check failed for ${site.name}`, err);
                  const linkElement = linkBySite[site.name];
                  updateExternalLinkBadge(linkElement, site, 0, true);
                });
            });
          });
          return;
        }

        // Prepare all links (this creates an array of promises)
        const linkPromises = sitesToProcess.map(site =>
          prepareLink(site, imdbId, tmdbId, tvdbId, mediaTitle, mediaTitleNoYear, true, isMovie)
        );

        // Wait for all link preparations to complete
        const preparedLinks = await Promise.all(linkPromises);

        // Filter out null results (sites that don't have valid links or no releases).
        // sitesToProcess is already sorted and Promise.all/filter preserve order,
        // so the result is already in the desired order.
        const validLinks = preparedLinks.filter(link => link !== null);

        // Create and append links in the correct order (one reflow via fragment)
        const linkElements = await Promise.all(validLinks.map(link => createExternalLink(link.url, link.site, link.count, link.error, true)));
        const fragment = document.createDocumentFragment();
        linkElements.forEach(linkElement => fragment.appendChild(linkElement));
        externalLinksUl.appendChild(fragment);
      })();
    })();
  })();
})();
