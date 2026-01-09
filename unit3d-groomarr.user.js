// ==UserScript==
// @name         Groomarr UNIT3D Helperer
// @namespace    https://github.com/maksii/Groomarr
// @version      1.0.0
// @description  Rename torrents in qBittorrent via Groomarr manual endpoint from UNIT3D torrent pages
// @author       maksii
// @match        *://*/torrents/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_addStyle
// @connect      *
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/maksii/utp-script/main/unit3d-groomarr.user.js
// @downloadURL  https://raw.githubusercontent.com/maksii/utp-script/main/unit3d-groomarr.user.js
// ==/UserScript==

(function() {
    'use strict';

    // ============================================================================
    // CONFIGURATION
    // ============================================================================

    const CONFIG_KEY = 'groomarr_config';
    const VERSION = '1.1.0';

    const DEFAULT_CONFIG = {
        // Groomarr API settings
        groomarrUrl: 'http://localhost:8000',
        renameMode: 'torrent_and_folder',

        // Rename rule toggles
        languageTagMode: 'audio+subs', // 'none', 'audio', 'audio+subs'
        addReleaseGroup: true,        // Add uploader as group if missing
        tvYearMode: 'replace',        // 'keep', 'replace', 'remove'
        fixBdLabels: true,            // BDRemux → BluRay REMUX, etc.

        // UI options
        showNotifications: true,
        notificationDuration: 3000,
    };

    const LANGUAGE_TAG_MODES = [
        { value: 'none', label: 'None' },
        { value: 'audio', label: 'Audio Only' },
        { value: 'audio+subs', label: 'Audio + Subtitles' },
    ];

    const TV_YEAR_MODES = [
        { value: 'keep', label: 'Keep Original' },
        { value: 'replace', label: 'Replace with Premiere Year' },
        { value: 'remove', label: 'Remove Year' },
    ];

    const RENAME_MODES = [
        { value: 'torrent_only', label: 'Torrent Only' },
        { value: 'torrent_and_folder', label: 'Torrent + Folder' },
        { value: 'torrent_folder_files', label: 'Torrent + Folder + Files' },
        { value: 'folder_only', label: 'Folder Only' },
        { value: 'files_only', label: 'Files Only' },
    ];

    // ============================================================================
    // STYLES
    // ============================================================================

    GM_addStyle(`
        /* Main floating button */
        .groomarr-btn {
            position: fixed;
            bottom: 20px;
            right: 20px;
            z-index: 9999;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            border-radius: 50px;
            padding: 12px 24px;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
            transition: all 0.3s ease;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .groomarr-btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(102, 126, 234, 0.6);
        }

        .groomarr-btn:active {
            transform: translateY(0);
        }

        .groomarr-btn svg {
            width: 18px;
            height: 18px;
        }

        /* Modal overlay */
        .groomarr-overlay {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.6);
            backdrop-filter: blur(4px);
            z-index: 10000;
            display: flex;
            align-items: center;
            justify-content: center;
            opacity: 0;
            visibility: hidden;
            transition: all 0.3s ease;
        }

        .groomarr-overlay.visible {
            opacity: 1;
            visibility: visible;
        }

        /* Modal panel */
        .groomarr-panel {
            background: #1a1a2e;
            border-radius: 16px;
            width: 550px;
            max-width: 90vw;
            max-height: 90vh;
            overflow-y: auto;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
            transform: scale(0.9) translateY(20px);
            transition: all 0.3s ease;
        }

        .groomarr-overlay.visible .groomarr-panel {
            transform: scale(1) translateY(0);
        }

        .groomarr-header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            padding: 20px 24px;
            border-radius: 16px 16px 0 0;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .groomarr-header h2 {
            margin: 0;
            color: white;
            font-size: 18px;
            font-weight: 600;
        }

        .groomarr-header .version {
            color: rgba(255,255,255,0.7);
            font-size: 12px;
        }

        .groomarr-close {
            background: rgba(255,255,255,0.2);
            border: none;
            color: white;
            width: 32px;
            height: 32px;
            border-radius: 8px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: background 0.2s;
        }

        .groomarr-close:hover {
            background: rgba(255,255,255,0.3);
        }

        .groomarr-body {
            padding: 24px;
        }

        /* Form sections */
        .groomarr-section {
            margin-bottom: 20px;
        }

        .groomarr-section-title {
            color: #a0a0a0;
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 1px;
            margin-bottom: 12px;
            font-weight: 600;
        }

        /* Info display */
        .groomarr-info {
            background: #16213e;
            border-radius: 8px;
            padding: 12px 16px;
            margin-bottom: 12px;
        }

        .groomarr-info-label {
            color: #a0a0a0;
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 4px;
        }

        .groomarr-info-value {
            color: #e0e0e0;
            font-size: 13px;
            word-break: break-all;
            font-family: 'Monaco', 'Menlo', monospace;
        }

        .groomarr-info-value.highlight {
            color: #4ade80;
        }

        .groomarr-info-value.hash {
            color: #fbbf24;
            font-size: 12px;
        }

        .groomarr-info-value.small {
            font-size: 11px;
            color: #9ca3af;
        }

        /* Input fields */
        .groomarr-input {
            width: 100%;
            background: #16213e;
            border: 1px solid #2d3748;
            border-radius: 8px;
            padding: 12px 16px;
            color: #e0e0e0;
            font-size: 14px;
            transition: border-color 0.2s;
            box-sizing: border-box;
        }

        .groomarr-input:focus {
            outline: none;
            border-color: #667eea;
        }

        .groomarr-input::placeholder {
            color: #4a5568;
        }

        /* Select dropdown */
        .groomarr-select {
            width: 100%;
            background: #16213e;
            border: 1px solid #2d3748;
            border-radius: 8px;
            padding: 12px 16px;
            color: #e0e0e0;
            font-size: 14px;
            cursor: pointer;
            appearance: none;
            background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='%23a0a0a0' viewBox='0 0 16 16'%3E%3Cpath d='M8 11L3 6h10l-5 5z'/%3E%3C/svg%3E");
            background-repeat: no-repeat;
            background-position: right 16px center;
        }

        .groomarr-select:focus {
            outline: none;
            border-color: #667eea;
        }

        /* Checkbox toggles */
        .groomarr-toggle {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 12px 0;
            border-bottom: 1px solid #2d3748;
        }

        .groomarr-toggle:last-child {
            border-bottom: none;
        }

        .groomarr-toggle-label {
            color: #e0e0e0;
            font-size: 14px;
        }

        .groomarr-toggle-desc {
            color: #6b7280;
            font-size: 12px;
            margin-top: 2px;
        }

        .groomarr-switch {
            position: relative;
            width: 44px;
            height: 24px;
            flex-shrink: 0;
        }

        .groomarr-switch input {
            opacity: 0;
            width: 0;
            height: 0;
        }

        .groomarr-slider {
            position: absolute;
            cursor: pointer;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background-color: #2d3748;
            transition: 0.3s;
            border-radius: 24px;
        }

        .groomarr-slider:before {
            position: absolute;
            content: "";
            height: 18px;
            width: 18px;
            left: 3px;
            bottom: 3px;
            background-color: white;
            transition: 0.3s;
            border-radius: 50%;
        }

        .groomarr-switch input:checked + .groomarr-slider {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        }

        .groomarr-switch input:checked + .groomarr-slider:before {
            transform: translateX(20px);
        }

        /* Buttons */
        .groomarr-actions {
            display: flex;
            gap: 12px;
            margin-top: 24px;
        }

        .groomarr-btn-primary {
            flex: 1;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            border-radius: 8px;
            padding: 14px 24px;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
        }

        .groomarr-btn-primary:hover {
            opacity: 0.9;
            transform: translateY(-1px);
        }

        .groomarr-btn-primary:disabled {
            opacity: 0.5;
            cursor: not-allowed;
            transform: none;
        }

        .groomarr-btn-secondary {
            background: #2d3748;
            color: #e0e0e0;
            border: none;
            border-radius: 8px;
            padding: 14px 24px;
            font-size: 14px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.2s;
        }

        .groomarr-btn-secondary:hover {
            background: #3d4758;
        }

        /* Toast notifications */
        .groomarr-toast {
            position: fixed;
            bottom: 80px;
            right: 20px;
            z-index: 10001;
            background: #1a1a2e;
            border-radius: 12px;
            padding: 16px 20px;
            box-shadow: 0 10px 40px rgba(0, 0, 0, 0.4);
            display: flex;
            align-items: center;
            gap: 12px;
            transform: translateX(120%);
            transition: transform 0.3s ease;
            max-width: 350px;
        }

        .groomarr-toast.visible {
            transform: translateX(0);
        }

        .groomarr-toast.success {
            border-left: 4px solid #4ade80;
        }

        .groomarr-toast.error {
            border-left: 4px solid #f87171;
        }

        .groomarr-toast.info {
            border-left: 4px solid #60a5fa;
        }

        .groomarr-toast-icon {
            width: 24px;
            height: 24px;
            flex-shrink: 0;
        }

        .groomarr-toast-icon.success {
            color: #4ade80;
        }

        .groomarr-toast-icon.error {
            color: #f87171;
        }

        .groomarr-toast-icon.info {
            color: #60a5fa;
        }

        .groomarr-toast-message {
            color: #e0e0e0;
            font-size: 14px;
            line-height: 1.4;
        }

        /* Tabs for settings */
        .groomarr-tabs {
            display: flex;
            gap: 4px;
            margin-bottom: 20px;
            background: #16213e;
            padding: 4px;
            border-radius: 10px;
        }

        .groomarr-tab {
            flex: 1;
            background: transparent;
            border: none;
            color: #a0a0a0;
            padding: 10px 16px;
            font-size: 13px;
            font-weight: 500;
            cursor: pointer;
            border-radius: 8px;
            transition: all 0.2s;
        }

        .groomarr-tab:hover {
            color: #e0e0e0;
        }

        .groomarr-tab.active {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
        }

        .groomarr-tab-content {
            display: none;
        }

        .groomarr-tab-content.active {
            display: block;
        }

        /* Preview diff */
        .groomarr-diff {
            background: #16213e;
            border-radius: 8px;
            padding: 16px;
            font-family: 'Monaco', 'Menlo', monospace;
            font-size: 12px;
            line-height: 1.6;
        }

        .groomarr-diff-line {
            padding: 2px 0;
            word-break: break-all;
        }

        .groomarr-diff-old {
            color: #f87171;
        }

        .groomarr-diff-old::before {
            content: '- ';
            opacity: 0.5;
        }

        .groomarr-diff-new {
            color: #4ade80;
        }

        .groomarr-diff-new::before {
            content: '+ ';
            opacity: 0.5;
        }

        .groomarr-diff-same {
            color: #6b7280;
        }

        /* Loading spinner */
        .groomarr-spinner {
            width: 20px;
            height: 20px;
            border: 2px solid rgba(255,255,255,0.3);
            border-top-color: white;
            border-radius: 50%;
            animation: groomarr-spin 0.8s linear infinite;
        }

        @keyframes groomarr-spin {
            to { transform: rotate(360deg); }
        }

        /* Test connection button */
        .groomarr-test-btn {
            background: #2d3748;
            color: #e0e0e0;
            border: none;
            border-radius: 6px;
            padding: 8px 16px;
            font-size: 12px;
            cursor: pointer;
            margin-top: 8px;
            transition: all 0.2s;
        }

        .groomarr-test-btn:hover {
            background: #3d4758;
        }

        .groomarr-test-btn.success {
            background: #065f46;
            color: #4ade80;
        }

        .groomarr-test-btn.error {
            background: #7f1d1d;
            color: #f87171;
        }

        /* Tags display */
        .groomarr-tags {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
            margin-top: 8px;
        }

        .groomarr-tag {
            background: #2d3748;
            color: #e0e0e0;
            padding: 4px 10px;
            border-radius: 4px;
            font-size: 11px;
            font-family: 'Monaco', 'Menlo', monospace;
        }

        .groomarr-tag.audio {
            border-left: 3px solid #60a5fa;
        }

        .groomarr-tag.subs {
            border-left: 3px solid #fbbf24;
        }
    `);

    // ============================================================================
    // CONFIGURATION MANAGEMENT
    // ============================================================================

    function getConfig() {
        const saved = GM_getValue(CONFIG_KEY, null);
        if (saved) {
            return { ...DEFAULT_CONFIG, ...saved };
        }
        return { ...DEFAULT_CONFIG };
    }

    function saveConfig(config) {
        GM_setValue(CONFIG_KEY, config);
    }

    // ============================================================================
    // DATA EXTRACTION
    // ============================================================================

    /**
     * Clean language name by removing region specs like " (US)", " (UK)", etc.
     * e.g., "English (US)" -> "English"
     */
    function cleanLanguageName(lang) {
        return lang.replace(/\s*\([^)]+\)\s*$/, '').trim();
    }

    /**
     * Extract audio languages from mediainfo__audio section
     * Returns array of unique language names
     */
    function extractAudioLanguages() {
        const languages = new Set();

        // Find the audio section
        const audioSection = document.querySelector('section.mediainfo__audio');
        if (!audioSection) {
            return [];
        }

        // Get all dd elements (contain language info)
        // Or check img alt attributes which contain language names
        const imgs = audioSection.querySelectorAll('dd img[alt]');
        imgs.forEach(img => {
            const lang = img.getAttribute('alt');
            if (lang) {
                languages.add(cleanLanguageName(lang));
            }
        });

        // Fallback: parse from title attributes
        if (languages.size === 0) {
            const titledElements = audioSection.querySelectorAll('[title]');
            titledElements.forEach(el => {
                const title = el.getAttribute('title');
                if (title) {
                    languages.add(cleanLanguageName(title));
                }
            });
        }

        return Array.from(languages);
    }

    /**
     * Extract subtitle languages from mediainfo__subtitles section
     * Returns array of unique language names
     */
    function extractSubtitleLanguages() {
        const languages = new Set();

        // Find the subtitles section
        const subsSection = document.querySelector('section.mediainfo__subtitles');
        if (!subsSection) {
            return [];
        }

        // Get all img elements with alt attributes
        const imgs = subsSection.querySelectorAll('li img[alt]');
        imgs.forEach(img => {
            const lang = img.getAttribute('alt');
            if (lang) {
                languages.add(cleanLanguageName(lang));
            }
        });

        // Fallback: parse from title attributes
        if (languages.size === 0) {
            const titledElements = subsSection.querySelectorAll('[title]');
            titledElements.forEach(el => {
                const title = el.getAttribute('title');
                if (title) {
                    languages.add(cleanLanguageName(title));
                }
            });
        }

        return Array.from(languages);
    }

    /**
     * Extract original year from the localized title header
     * e.g., "Сімпсони (1989)" -> 1989
     */
    function extractOriginalYear() {
        // Try XPath first
        const yearElement = document.evaluate(
            '/html/body/main/article/section[1]/a[1]/h1',
            document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null
        ).singleNodeValue;

        if (yearElement) {
            const text = yearElement.textContent || '';
            const match = text.match(/\((\d{4})\)/);
            if (match) {
                return parseInt(match[1], 10);
            }
        }

        // Fallback: look for any h1 with year pattern in article section
        const h1Elements = document.querySelectorAll('main article section h1, main article header h1');
        for (const h1 of h1Elements) {
            const text = h1.textContent || '';
            const match = text.match(/\((\d{4})\)/);
            if (match) {
                return parseInt(match[1], 10);
            }
        }

        return null;
    }

    /**
     * Extract year from release name if present
     * e.g., "The Simpsons S35 2025 1080p" -> 2025
     */
    function extractYearFromReleaseName(releaseName) {
        // Look for 4-digit year (1900-2099) that's not part of resolution
        // Exclude patterns like 1080p, 2160p, etc.
        const yearMatch = releaseName.match(/\b(19\d{2}|20\d{2})\b(?!p|i)/);
        if (yearMatch) {
            return parseInt(yearMatch[1], 10);
        }
        return null;
    }

    /**
     * Main extraction function - gets all torrent data from page
     */
    function extractTorrentData() {
        const data = {
            hash: '',
            releaseName: '',
            releaseGroup: '',
            mediaType: '',
            isTV: false,
            originalYear: null,
            releaseYear: null,
            audioLanguages: [],
            subtitleLanguages: [],
            error: null
        };

        try {
            // Info Hash - from dialog header
            const hashElement = document.evaluate(
                '/html/body/main/article/menu/li[4]/dialog/header/div/div',
                document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null
            ).singleNodeValue;

            if (hashElement) {
                const hashText = hashElement.textContent || '';
                const hashMatch = hashText.match(/[a-fA-F0-9]{40}/);
                if (hashMatch) {
                    data.hash = hashMatch[0].toLowerCase();
                }
            }

            // Fallback: try to find hash in any element containing "Info Hash"
            if (!data.hash) {
                const allText = document.body.innerText;
                const hashMatch = allText.match(/Info\s*Hash[:\s]*([a-fA-F0-9]{40})/i);
                if (hashMatch) {
                    data.hash = hashMatch[1].toLowerCase();
                }
            }

            // Release Name - from h1
            const titleElement = document.evaluate(
                '/html/body/main/article/h1',
                document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null
            ).singleNodeValue;

            if (titleElement) {
                data.releaseName = titleElement.textContent.trim();
            }

            // Fallback: try main h1 (but not the localized one with year)
            if (!data.releaseName) {
                const h1 = document.querySelector('main article > h1');
                if (h1) {
                    data.releaseName = h1.textContent.trim();
                }
            }

            // Release Group - from uploader/group link
            const groupElement = document.evaluate(
                '/html/body/main/article/ul/li[8]/span/a',
                document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null
            ).singleNodeValue;

            if (groupElement) {
                data.releaseGroup = groupElement.textContent.trim();
            }

            // Type (TV/Movie)
            const typeElement = document.evaluate(
                '/html/body/main/article/ul/li[1]/a',
                document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null
            ).singleNodeValue;

            if (typeElement) {
                data.mediaType = typeElement.textContent.trim();
                data.isTV = data.mediaType.toLowerCase() === 'tv';
            }

            // Extract original year from localized title
            data.originalYear = extractOriginalYear();

            // Extract year from release name
            if (data.releaseName) {
                data.releaseYear = extractYearFromReleaseName(data.releaseName);
            }

            // Extract audio and subtitle languages from mediainfo
            data.audioLanguages = extractAudioLanguages();
            data.subtitleLanguages = extractSubtitleLanguages();

            // Validation
            if (!data.hash) {
                data.error = 'Could not extract torrent hash from page';
            } else if (!data.releaseName) {
                data.error = 'Could not extract release name from page';
            }

        } catch (e) {
            data.error = `Extraction error: ${e.message}`;
        }

        return data;
    }

    // ============================================================================
    // RENAME RULES
    // ============================================================================

    /**
     * Check if title already has a release group
     * Patterns: ends with -GroupName or [GroupName]
     */
    function hasReleaseGroup(title) {
        // Remove common file extensions first
        const withoutExt = title.replace(/\.(mkv|mp4|avi|mov|wmv|flv|webm)$/i, '');
        // Check for -GroupName at end
        if (/-[a-zA-Z0-9]+$/.test(withoutExt)) {
            return true;
        }
        // Check for [GroupName] at end
        if (/\[[^\]]+\]\s*$/.test(withoutExt)) {
            return true;
        }
        return false;
    }

    /**
     * Format language tags for insertion into title
     * Audio: [Ukrainian+English]
     * Subs: [Subs Ukrainian+English]
     * @param {string[]} audioLangs - Array of audio languages
     * @param {string[]} subLangs - Array of subtitle languages
     * @param {string} mode - 'none', 'audio', or 'audio+subs'
     */
    function formatLanguageTags(audioLangs, subLangs, mode) {
        if (mode === 'none') {
            return '';
        }

        const tags = [];

        if (audioLangs && audioLangs.length > 0) {
            tags.push(`[${audioLangs.join('+')}]`);
        }

        if (mode === 'audio+subs' && subLangs && subLangs.length > 0) {
            tags.push(`[Subs ${subLangs.join('+')}]`);
        }

        return tags.join('');
    }

    /**
     * Apply all rename rules based on configuration
     */
    function applyRenameRules(title, torrentData, config) {
        let result = title.trim();

        // 1. Add release group if missing
        if (config.addReleaseGroup && torrentData.releaseGroup && !hasReleaseGroup(result)) {
            // Clean the release group name (alphanumeric, underscore, hyphen only)
            const cleanGroup = torrentData.releaseGroup.replace(/[^a-zA-Z0-9_-]/g, '');
            if (cleanGroup) {
                result = `${result}-${cleanGroup}`;
            }
        }

        // 2. Add language tags after resolution (from mediainfo)
        // Pattern: insert after 2160p|1080p|1080i|720p|480p
        if (config.languageTagMode && config.languageTagMode !== 'none') {
            const langTags = formatLanguageTags(torrentData.audioLanguages, torrentData.subtitleLanguages, config.languageTagMode);
            if (langTags) {
                // Find resolution marker and insert after it
                const resolutionMatch = result.match(/(.*?\b(?:2160p|1080[pi]|720p|480p)\b)(.*)/i);
                if (resolutionMatch) {
                    result = `${resolutionMatch[1]} ${langTags}${resolutionMatch[2]}`;
                } else {
                    // No resolution found, append before group/end
                    const groupMatch = result.match(/^(.+?)(-[a-zA-Z0-9]+)$/);
                    if (groupMatch) {
                        result = `${groupMatch[1]} ${langTags}${groupMatch[2]}`;
                    } else {
                        result = `${result} ${langTags}`;
                    }
                }
            }
        }

        // 3. TV year handling - replace or remove year based on mode
        // Only for TV shows with detected years
        if (config.tvYearMode && config.tvYearMode !== 'keep' && torrentData.isTV && torrentData.releaseYear) {
            if (config.tvYearMode === 'replace' && torrentData.originalYear && torrentData.releaseYear !== torrentData.originalYear) {
                // Replace the wrong year with the correct premiere year
                // Be careful not to replace years that are part of ranges like 2020-2024
                result = result.replace(
                    new RegExp(`\\b${torrentData.releaseYear}\\b(?!-|p|i)`, 'g'),
                    torrentData.originalYear.toString()
                );
            } else if (config.tvYearMode === 'remove') {
                // Remove the year from the title entirely
                // Be careful not to remove years that are part of ranges like 2020-2024
                result = result.replace(
                    new RegExp(`\\s*\\b${torrentData.releaseYear}\\b(?!-|p|i)`, 'g'),
                    ''
                );
            }
        }

        // 4. BD label normalization
        if (config.fixBdLabels) {
            result = result.replace(/\bBDRemux\b/gi, 'BluRay REMUX');
            result = result.replace(/\bBDRip\b/gi, 'BluRay');
        }

        // Clean up multiple spaces
        result = result.replace(/\s+/g, ' ').trim();

        return result;
    }

    // ============================================================================
    // API COMMUNICATION
    // ============================================================================

    function testConnection(url, callback) {
        GM_xmlhttpRequest({
            method: 'GET',
            url: `${url}/health`,
            timeout: 5000,
            onload: function(response) {
                try {
                    const data = JSON.parse(response.responseText);
                    callback(null, data);
                } catch (e) {
                    callback(new Error('Invalid response'), null);
                }
            },
            onerror: function(error) {
                callback(new Error('Connection failed'), null);
            },
            ontimeout: function() {
                callback(new Error('Connection timeout'), null);
            }
        });
    }

    function sendRenameRequest(hash, newName, mode, url, callback) {
        GM_xmlhttpRequest({
            method: 'POST',
            url: `${url}/rename/manual`,
            headers: {
                'Content-Type': 'application/json'
            },
            data: JSON.stringify({
                torrent_hash: hash,
                new_name: newName,
                mode: mode
            }),
            timeout: 30000,
            onload: function(response) {
                try {
                    const data = JSON.parse(response.responseText);
                    if (response.status >= 200 && response.status < 300) {
                        callback(null, data);
                    } else {
                        callback(new Error(data.reason || `HTTP ${response.status}`), data);
                    }
                } catch (e) {
                    callback(new Error('Invalid response from server'), null);
                }
            },
            onerror: function(error) {
                callback(new Error('Failed to connect to Groomarr'), null);
            },
            ontimeout: function() {
                callback(new Error('Request timeout - is the torrent in qBittorrent?'), null);
            }
        });
    }

    // ============================================================================
    // UI COMPONENTS
    // ============================================================================

    let toastTimeout = null;

    function showToast(message, type = 'info') {
        const config = getConfig();
        if (!config.showNotifications) return;

        // Remove existing toast
        const existing = document.querySelector('.groomarr-toast');
        if (existing) {
            existing.remove();
        }
        if (toastTimeout) {
            clearTimeout(toastTimeout);
        }

        const icons = {
            success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
            error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
            info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
        };

        const toast = document.createElement('div');
        toast.className = `groomarr-toast ${type}`;
        toast.innerHTML = `
            <div class="groomarr-toast-icon ${type}">${icons[type]}</div>
            <div class="groomarr-toast-message">${message}</div>
        `;

        document.body.appendChild(toast);

        // Trigger animation
        requestAnimationFrame(() => {
            toast.classList.add('visible');
        });

        // Auto-hide
        toastTimeout = setTimeout(() => {
            toast.classList.remove('visible');
            setTimeout(() => toast.remove(), 300);
        }, config.notificationDuration);
    }

    function createMainButton() {
        const btn = document.createElement('button');
        btn.className = 'groomarr-btn';
        btn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
            </svg>
            Groomarr
        `;
        btn.addEventListener('click', () => showMainPanel());
        document.body.appendChild(btn);
    }

    function createOverlay() {
        const overlay = document.createElement('div');
        overlay.className = 'groomarr-overlay';
        overlay.id = 'groomarr-overlay';
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                hidePanel();
            }
        });
        document.body.appendChild(overlay);
        return overlay;
    }

    function showMainPanel() {
        const config = getConfig();
        const torrentData = extractTorrentData();

        let overlay = document.getElementById('groomarr-overlay');
        if (!overlay) {
            overlay = createOverlay();
        }

        // Calculate transformed name
        const transformedName = torrentData.releaseName
            ? applyRenameRules(torrentData.releaseName, torrentData, config)
            : '';

        const hasChanges = transformedName !== torrentData.releaseName;

        // Build year info display
        let yearInfo = '';
        if (torrentData.isTV) {
            if (torrentData.originalYear && torrentData.releaseYear && torrentData.originalYear !== torrentData.releaseYear) {
                yearInfo = `<span style="color: #f87171;">Release: ${torrentData.releaseYear}</span> → <span style="color: #4ade80;">Original: ${torrentData.originalYear}</span>`;
            } else if (torrentData.originalYear) {
                yearInfo = `Original: ${torrentData.originalYear}`;
            }
        }

        // Build language tags display
        const audioTagsHtml = torrentData.audioLanguages.map(l => `<span class="groomarr-tag audio">${l}</span>`).join('');
        const subsTagsHtml = torrentData.subtitleLanguages.map(l => `<span class="groomarr-tag subs">${l}</span>`).join('');

        overlay.innerHTML = `
            <div class="groomarr-panel">
                <div class="groomarr-header">
                    <div>
                        <h2>🔧 Groomarr Rename</h2>
                        <div class="version">v${VERSION}</div>
                    </div>
                    <button class="groomarr-close" id="groomarr-close">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                    </button>
                </div>
                <div class="groomarr-body">
                    ${torrentData.error ? `
                        <div class="groomarr-info" style="border-left: 3px solid #f87171;">
                            <div class="groomarr-info-label">Error</div>
                            <div class="groomarr-info-value" style="color: #f87171;">${torrentData.error}</div>
                        </div>
                    ` : ''}

                    <div class="groomarr-tabs">
                        <button class="groomarr-tab active" data-tab="rename">Rename</button>
                        <button class="groomarr-tab" data-tab="settings">Settings</button>
                    </div>

                    <!-- Rename Tab -->
                    <div class="groomarr-tab-content active" id="tab-rename">
                        <div class="groomarr-section">
                            <div class="groomarr-info">
                                <div class="groomarr-info-label">Torrent Hash</div>
                                <div class="groomarr-info-value hash">${torrentData.hash || 'Not found'}</div>
                            </div>

                            <div class="groomarr-info">
                                <div class="groomarr-info-label">Media Type</div>
                                <div class="groomarr-info-value">
                                    ${torrentData.mediaType || 'Unknown'}
                                    ${torrentData.releaseGroup ? `• Group: ${torrentData.releaseGroup}` : ''}
                                    ${yearInfo ? `<br><span class="small">${yearInfo}</span>` : ''}
                                </div>
                            </div>

                            ${(torrentData.audioLanguages.length > 0 || torrentData.subtitleLanguages.length > 0) ? `
                                <div class="groomarr-info">
                                    <div class="groomarr-info-label">Detected Languages</div>
                                    <div class="groomarr-tags">
                                        ${audioTagsHtml ? `<span style="color:#60a5fa;font-size:10px;margin-right:4px;">Audio:</span>${audioTagsHtml}` : ''}
                                        ${subsTagsHtml ? `<span style="color:#fbbf24;font-size:10px;margin-right:4px;margin-left:8px;">Subs:</span>${subsTagsHtml}` : ''}
                                    </div>
                                </div>
                            ` : ''}
                        </div>

                        <div class="groomarr-section">
                            <div class="groomarr-section-title">Preview</div>
                            <div class="groomarr-diff">
                                <div class="groomarr-diff-line groomarr-diff-old">${torrentData.releaseName || 'N/A'}</div>
                                <div class="groomarr-diff-line groomarr-diff-new">${transformedName || 'N/A'}</div>
                            </div>
                            ${!hasChanges ? '<div style="color: #6b7280; font-size: 12px; margin-top: 8px;">ℹ️ No changes - rename rules didn\'t modify the title</div>' : ''}
                        </div>

                        <div class="groomarr-section">
                            <div class="groomarr-section-title">Final Name (editable)</div>
                            <input type="text" class="groomarr-input" id="groomarr-new-name" value="${transformedName}" placeholder="Enter new name...">
                        </div>

                        <div class="groomarr-section">
                            <div class="groomarr-section-title">Rename Mode</div>
                            <select class="groomarr-select" id="groomarr-mode">
                                ${RENAME_MODES.map(m => `
                                    <option value="${m.value}" ${m.value === config.renameMode ? 'selected' : ''}>${m.label}</option>
                                `).join('')}
                            </select>
                        </div>

                        <div class="groomarr-actions">
                            <button class="groomarr-btn-secondary" id="groomarr-cancel">Cancel</button>
                            <button class="groomarr-btn-primary" id="groomarr-rename" ${!torrentData.hash ? 'disabled' : ''}>
                                Rename Torrent
                            </button>
                        </div>
                    </div>

                    <!-- Settings Tab -->
                    <div class="groomarr-tab-content" id="tab-settings">
                        <div class="groomarr-section">
                            <div class="groomarr-section-title">Groomarr API</div>
                            <input type="text" class="groomarr-input" id="groomarr-url" value="${config.groomarrUrl}" placeholder="http://localhost:8000">
                            <button class="groomarr-test-btn" id="groomarr-test">Test Connection</button>
                        </div>

                        <div class="groomarr-section">
                            <div class="groomarr-section-title">Default Rename Mode</div>
                            <select class="groomarr-select" id="groomarr-default-mode">
                                ${RENAME_MODES.map(m => `
                                    <option value="${m.value}" ${m.value === config.renameMode ? 'selected' : ''}>${m.label}</option>
                                `).join('')}
                            </select>
                        </div>

                        <div class="groomarr-section">
                            <div class="groomarr-section-title">Rename Rules</div>

                            <div class="groomarr-toggle">
                                <div>
                                    <div class="groomarr-toggle-label">Language tags</div>
                                    <div class="groomarr-toggle-desc">Insert [Audio+Langs][Subs Langs] from mediainfo after resolution</div>
                                </div>
                                <select class="groomarr-select" id="groomarr-lang-mode" style="width: auto; min-width: 140px;">
                                    ${LANGUAGE_TAG_MODES.map(m => `
                                        <option value="${m.value}" ${m.value === config.languageTagMode ? 'selected' : ''}>${m.label}</option>
                                    `).join('')}
                                </select>
                            </div>

                            <div class="groomarr-toggle">
                                <div>
                                    <div class="groomarr-toggle-label">Add release group</div>
                                    <div class="groomarr-toggle-desc">Append uploader as group if missing (-GroupName)</div>
                                </div>
                                <label class="groomarr-switch">
                                    <input type="checkbox" id="groomarr-group" ${config.addReleaseGroup ? 'checked' : ''}>
                                    <span class="groomarr-slider"></span>
                                </label>
                            </div>

                            <div class="groomarr-toggle">
                                <div>
                                    <div class="groomarr-toggle-label">TV show year</div>
                                    <div class="groomarr-toggle-desc">Handle year in TV show release names</div>
                                </div>
                                <select class="groomarr-select" id="groomarr-tvyear-mode" style="width: auto; min-width: 180px;">
                                    ${TV_YEAR_MODES.map(m => `
                                        <option value="${m.value}" ${m.value === config.tvYearMode ? 'selected' : ''}>${m.label}</option>
                                    `).join('')}
                                </select>
                            </div>

                            <div class="groomarr-toggle">
                                <div>
                                    <div class="groomarr-toggle-label">Normalize BD labels</div>
                                    <div class="groomarr-toggle-desc">BDRemux → BluRay REMUX, BDRip → BluRay</div>
                                </div>
                                <label class="groomarr-switch">
                                    <input type="checkbox" id="groomarr-bd" ${config.fixBdLabels ? 'checked' : ''}>
                                    <span class="groomarr-slider"></span>
                                </label>
                            </div>
                        </div>

                        <div class="groomarr-section">
                            <div class="groomarr-section-title">UI Options</div>

                            <div class="groomarr-toggle">
                                <div>
                                    <div class="groomarr-toggle-label">Show notifications</div>
                                    <div class="groomarr-toggle-desc">Display toast messages for success/error</div>
                                </div>
                                <label class="groomarr-switch">
                                    <input type="checkbox" id="groomarr-notify" ${config.showNotifications ? 'checked' : ''}>
                                    <span class="groomarr-slider"></span>
                                </label>
                            </div>
                        </div>

                        <div class="groomarr-actions">
                            <button class="groomarr-btn-secondary" id="groomarr-reset">Reset Defaults</button>
                            <button class="groomarr-btn-primary" id="groomarr-save">Save Settings</button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Show overlay
        requestAnimationFrame(() => {
            overlay.classList.add('visible');
        });

        // Bind events
        bindPanelEvents(torrentData);
    }

    function bindPanelEvents(torrentData) {
        // Close button
        document.getElementById('groomarr-close').addEventListener('click', hidePanel);
        document.getElementById('groomarr-cancel')?.addEventListener('click', hidePanel);

        // Tabs
        document.querySelectorAll('.groomarr-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.groomarr-tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.groomarr-tab-content').forEach(c => c.classList.remove('active'));
                tab.classList.add('active');
                document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
            });
        });

        // Rename button
        const renameBtn = document.getElementById('groomarr-rename');
        if (renameBtn) {
            renameBtn.addEventListener('click', () => {
                const newName = document.getElementById('groomarr-new-name').value.trim();
                const mode = document.getElementById('groomarr-mode').value;
                const config = getConfig();

                if (!newName) {
                    showToast('Please enter a new name', 'error');
                    return;
                }

                renameBtn.disabled = true;
                renameBtn.innerHTML = '<div class="groomarr-spinner"></div> Renaming...';

                sendRenameRequest(torrentData.hash, newName, mode, config.groomarrUrl, (err, result) => {
                    renameBtn.disabled = false;
                    renameBtn.textContent = 'Rename Torrent';

                    if (err) {
                        showToast(`Failed: ${err.message}`, 'error');
                    } else if (result.status === 'success') {
                        showToast('Torrent renamed successfully!', 'success');
                        hidePanel();
                    } else {
                        showToast(`Error: ${result.reason || 'Unknown error'}`, 'error');
                    }
                });
            });
        }

        // Test connection
        const testBtn = document.getElementById('groomarr-test');
        if (testBtn) {
            testBtn.addEventListener('click', () => {
                const url = document.getElementById('groomarr-url').value.trim();
                testBtn.textContent = 'Testing...';
                testBtn.className = 'groomarr-test-btn';

                testConnection(url, (err, data) => {
                    if (err) {
                        testBtn.textContent = '✗ Failed';
                        testBtn.className = 'groomarr-test-btn error';
                    } else {
                        testBtn.textContent = `✓ Connected (${data.status})`;
                        testBtn.className = 'groomarr-test-btn success';
                    }

                    setTimeout(() => {
                        testBtn.textContent = 'Test Connection';
                        testBtn.className = 'groomarr-test-btn';
                    }, 3000);
                });
            });
        }

        // Save settings
        const saveBtn = document.getElementById('groomarr-save');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => {
                const newConfig = {
                    groomarrUrl: document.getElementById('groomarr-url').value.trim(),
                    renameMode: document.getElementById('groomarr-default-mode').value,
                    languageTagMode: document.getElementById('groomarr-lang-mode').value,
                    addReleaseGroup: document.getElementById('groomarr-group').checked,
                    tvYearMode: document.getElementById('groomarr-tvyear-mode').value,
                    fixBdLabels: document.getElementById('groomarr-bd').checked,
                    showNotifications: document.getElementById('groomarr-notify').checked,
                    notificationDuration: 3000,
                };

                saveConfig(newConfig);
                showToast('Settings saved!', 'success');

                // Refresh preview with new settings
                setTimeout(() => {
                    showMainPanel();
                }, 500);
            });
        }

        // Reset defaults
        const resetBtn = document.getElementById('groomarr-reset');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                saveConfig(DEFAULT_CONFIG);
                showToast('Settings reset to defaults', 'info');
                showMainPanel();
            });
        }

        // Live preview update when settings change in settings tab
        const settingsInputs = ['groomarr-lang-mode', 'groomarr-group', 'groomarr-tvyear-mode', 'groomarr-bd'];
        settingsInputs.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('change', () => {
                    // Create temp config for preview
                    const tempConfig = {
                        languageTagMode: document.getElementById('groomarr-lang-mode').value,
                        addReleaseGroup: document.getElementById('groomarr-group').checked,
                        tvYearMode: document.getElementById('groomarr-tvyear-mode').value,
                        fixBdLabels: document.getElementById('groomarr-bd').checked,
                    };

                    // Update the new name field in rename tab
                    const newNameInput = document.getElementById('groomarr-new-name');
                    if (newNameInput && torrentData.releaseName) {
                        const transformed = applyRenameRules(
                            torrentData.releaseName,
                            torrentData,
                            tempConfig
                        );
                        newNameInput.value = transformed;
                    }
                });
            }
        });

        // Keyboard shortcut to close
        const handleKeydown = (e) => {
            if (e.key === 'Escape') {
                hidePanel();
                document.removeEventListener('keydown', handleKeydown);
            }
        };
        document.addEventListener('keydown', handleKeydown);
    }

    function hidePanel() {
        const overlay = document.getElementById('groomarr-overlay');
        if (overlay) {
            overlay.classList.remove('visible');
            setTimeout(() => {
                overlay.innerHTML = '';
            }, 300);
        }
    }

    function showSettingsDialog() {
        showMainPanel();
        // Switch to settings tab
        setTimeout(() => {
            const settingsTab = document.querySelector('.groomarr-tab[data-tab="settings"]');
            if (settingsTab) {
                settingsTab.click();
            }
        }, 100);
    }

    // ============================================================================
    // INITIALIZATION
    // ============================================================================

    function init() {
        // Check if we're on a torrent page
        if (!window.location.pathname.match(/^\/torrents\/\d+/)) {
            return;
        }

        console.log('[Groomarr] Initializing on torrent page...');

        // Register menu command for settings
        GM_registerMenuCommand('⚙️ Groomarr Settings', showSettingsDialog);

        // Create the main floating button
        createMainButton();

        // Create overlay container
        createOverlay();

        console.log('[Groomarr] Ready!');
    }

    // Wait for DOM to be ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();