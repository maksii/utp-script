export class Utils {
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
