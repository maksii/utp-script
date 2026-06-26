export class UIHandler {
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
