// ==UserScript==
// @name         Toloka — Fill form from folder (meta.json)
// @version      1.1.1
// @description  Populate Toloka release form from folder containing meta.json (Upload Assistant output). Use with release_toloka1.sh for final BBCode.
// @match        https://toloka.to/release.php*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/maksii/utp-script/main/toloka/toloka-fill-form.user.js
// @downloadURL  https://raw.githubusercontent.com/maksii/utp-script/main/toloka/toloka-fill-form.user.js
// ==/UserScript==

(function () {
    'use strict';

    const TMDB_STORAGE_KEY = 'toloka_fill_tmdb_apikey';

    function getStoredTmdbKey() {
        try {
            return localStorage.getItem(TMDB_STORAGE_KEY) || '';
        } catch (e) {
            return '';
        }
    }

    function setStoredTmdbKey(key) {
        try {
            if (key) localStorage.setItem(TMDB_STORAGE_KEY, key);
            else localStorage.removeItem(TMDB_STORAGE_KEY);
        } catch (e) {}
    }

    // ——— Country names: English → Ukrainian (aligned with release_toloka1.sh)
    const COUNTRY_UA = {
        'Germany': 'Німеччина', 'Peru': 'Перу', 'United States': 'США', 'Canada': 'Канада',
        'United Kingdom': 'Великобританія', 'France': 'Франція', 'Japan': 'Японія', 'South Korea': 'Південна Корея',
        'China': 'Китай', 'Russia': 'Росія', 'Ukraine': 'Україна', 'Italy': 'Італія', 'Spain': 'Іспанія',
        'Australia': 'Австралія', 'Brazil': 'Бразилія', 'Mexico': 'Мексика', 'India': 'Індія', 'Poland': 'Польща',
        'Netherlands': 'Нідерланди', 'Belgium': 'Бельгія', 'Switzerland': 'Швейцарія', 'Sweden': 'Швеція',
        'Norway': 'Норвегія', 'Denmark': 'Данія', 'Austria': 'Австрія', 'Czech Republic': 'Чеська Республіка',
        'Greece': 'Греція', 'Portugal': 'Португалія', 'Turkey': 'Туреччина', 'Israel': 'Ізраїль', 'Thailand': 'Таїланд',
        'Vietnam': "В'єтнам", 'Hong Kong': 'Гонконг', 'Taiwan': 'Тайвань', 'Philippines': 'Філіппіни',
        'Indonesia': 'Індонезія', 'Malaysia': 'Малайзія', 'Singapore': 'Сінгапур', 'New Zealand': 'Нова Зеландія',
        'South Africa': 'Південна Африка', 'Egypt': 'Єгипет', 'Nigeria': 'Нігерія', 'Kenya': 'Кенія',
        'Chile': 'Чилі', 'Argentina': 'Аргентина', 'Colombia': 'Колумбія', 'Venezuela': 'Венесуела'
    };

    function safeStr(val) {
        if (val == null) return '';
        if (typeof val === 'string') return val;
        return '';
    }

    function langCode(lang) {
        const m = {
            uk: 'Ukr', ukrainian: 'Ukr', en: 'Eng', english: 'Eng', de: 'Ger', german: 'Ger',
            fr: 'Fr', french: 'Fr', ru: 'Rus', russian: 'Rus', es: 'Spa', spanish: 'Spa',
            it: 'Ita', italian: 'Ita', ja: 'Jap', japanese: 'Jap', zh: 'Chi', chinese: 'Chi',
            pt: 'Por', portuguese: 'Por', pl: 'Pol', polish: 'Pol', ko: 'Kor', korean: 'Kor'
        };
        const n = safeStr(lang).trim().toLowerCase();
        return m[n] || n || '—';
    }

    // Name (subject): BDRip | BDRemux | WEBDL | etc.   Dropdown (f11): any web → 18 WEBDLRip, any bluray → 16 BDRip
    function qualityFromBasename(basename) {
        const b = safeStr(basename).toLowerCase();
        const isWeb = /webdl|web-dl|webrip|web\s*rip|hdtv|hdrip/i.test(b);
        const isRemux = /remux|bluray\s*remux|bdremux/i.test(b);
        const isBluray = /bdrip|blu-ray|bluray|blu\s*ray/i.test(b);
        let nameLabel, dropdownValue;
        if (isWeb) {
            nameLabel = 'WEBDL';
            dropdownValue = '18'; // WEBDLRip
        } else if (isRemux) {
            nameLabel = 'BDRemux';
            dropdownValue = '16'; // BDRip (any bluray → BDRip in dropdown)
        } else if (isBluray) {
            nameLabel = 'BDRip';
            dropdownValue = '16';
        } else {
            nameLabel = 'BDRip';
            dropdownValue = '16';
        }
        return { value: dropdownValue, label: nameLabel };
    }

    function dubTypeFromBasename(basename) {
        const b = safeStr(basename).toLowerCase();
        if (/-svo/.test(b)) return 'SVO';
        if (/-dvo/.test(b)) return 'DVO';
        if (/-dub/.test(b)) return 'DUB';
        return 'MVO';
    }

    function durationFromSeconds(sec) {
        const s = Math.floor(Number(sec) || 0);
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const ss = s % 60;
        return [h, m, ss].map(n => String(n).padStart(2, '0')).join(':');
    }

    function getBasename(meta) {
        const path = meta.path || '';
        const filelist = meta.filelist;
        if (Array.isArray(filelist) && filelist.length) {
            const first = filelist[0];
            return first.split(/[/\\]/).pop() || path.split(/[/\\]/).pop() || '';
        }
        return path.split(/[/\\]/).pop() || meta.uuid || '';
    }

    function getImdbUrl(meta) {
        const info = meta.imdb_info;
        if (info && info.imdb_url) return info.imdb_url;
        const id = meta.imdb_id;
        if (id != null) return 'https://www.imdb.com/title/tt' + String(id).replace(/^tt/i, '') + '/';
        return '';
    }

    function getCountries(meta) {
        if (meta._tmdb && meta._tmdb.production_countries !== undefined) return meta._tmdb.production_countries;
        const arr = meta.production_countries;
        if (!Array.isArray(arr)) return '';
        return arr.map(c => COUNTRY_UA[c.name] || c.name).filter(Boolean).join(', ');
    }

    function getCompanies(meta) {
        if (meta._tmdb && meta._tmdb.production_companies !== undefined) return meta._tmdb.production_companies;
        const arr = meta.production_companies;
        if (!Array.isArray(arr)) return '';
        return arr.map(c => c.name).slice(0, 5).join(', ');
    }

    function getGenres(meta) {
        if (meta._tmdb && meta._tmdb.genres !== undefined) return meta._tmdb.genres;
        return (meta.genres || '').trim() || '';
    }

    function getDirectors(meta) {
        if (meta._tmdb && meta._tmdb.director !== undefined) return meta._tmdb.director;
        const d = meta.tmdb_directors;
        if (Array.isArray(d)) return d.join(', ');
        const imdb = meta.imdb_info && meta.imdb_info.directors;
        if (Array.isArray(imdb)) return imdb.join(', ');
        return '';
    }

    function getCast(meta, limit = 10) {
        if (meta._tmdb && meta._tmdb.cast !== undefined) return meta._tmdb.cast;
        const c = meta.tmdb_cast;
        if (Array.isArray(c)) return c.slice(0, limit).join(', ');
        const imdb = meta.imdb_info && meta.imdb_info.stars;
        if (Array.isArray(imdb)) return imdb.slice(0, limit).join(', ');
        return '';
    }

    function getOverview(meta) {
        if (meta._tmdb && meta._tmdb.overview !== undefined) return meta._tmdb.overview;
        return (meta.overview || (meta.imdb_info && meta.imdb_info.plot) || '').trim();
    }

    function getScreenshotsBBCode(meta) {
        const list = meta.image_list;
        if (!Array.isArray(list) || !list.length) return '';
        return list.map(item => {
            const url = item.raw_url || item.img_url || '';
            return url ? '[img]' + url + '[/img]' : '';
        }).filter(Boolean).join(' ');
    }

    // ——— TMDB: fetch Ukrainian (uk-UA) data, fallback to en-US for empty fields (movies + series)
    async function fetchTmdbData(apiKey, meta) {
        const key = (apiKey || '').trim();
        if (!key) return null;
        const imdbId = meta.imdb_id != null ? meta.imdb_id : (meta.imdb_info && meta.imdb_info.imdbID);
        const imdbStr = imdbId != null ? ('tt' + String(imdbId).replace(/^tt/i, '')) : '';
        let tmdbId = meta.tmdb_id;
        let type = (meta.tmdb_type || meta.category || '').toLowerCase();

        if (!tmdbId && imdbStr) {
            const findUrl = `https://api.themoviedb.org/3/find/${imdbStr}?api_key=${encodeURIComponent(key)}&external_source=imdb_id`;
            let findRes;
            try {
                findRes = await fetch(findUrl);
            } catch (e) {
                throw new Error('TMDB find: ' + (e.message || 'network error'));
            }
            if (!findRes.ok) throw new Error('TMDB find: ' + findRes.status);
            const findData = await findRes.json();
            const movieResults = findData.movie_results || [];
            const tvResults = findData.tv_results || [];
            if (movieResults.length && (type !== 'tv' && type !== 'series')) {
                tmdbId = movieResults[0].id;
                type = 'movie';
            } else if (tvResults.length) {
                tmdbId = tvResults[0].id;
                type = 'tv';
            } else if (movieResults.length) {
                tmdbId = movieResults[0].id;
                type = 'movie';
            }
            if (!tmdbId) return null;
        } else if (tmdbId) {
            if (!type || (type !== 'movie' && type !== 'tv')) type = 'movie';
        } else {
            return null;
        }

        const langUk = `https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${encodeURIComponent(key)}&append_to_response=credits&language=uk-UA`;
        const langEn = `https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${encodeURIComponent(key)}&append_to_response=credits&language=en-US`;
        let uk, en;
        try {
            uk = await fetch(langUk).then(r => r.ok ? r.json() : null);
            en = await fetch(langEn).then(r => r.ok ? r.json() : null);
        } catch (e) {
            throw new Error('TMDB fetch: ' + (e.message || 'network error'));
        }
        if (uk && uk.success === false) throw new Error('TMDB: ' + (uk.status_message || 'API error'));
        const j = uk || en;
        if (!j) return null;

        const titleField = type === 'tv' ? 'name' : 'title';
        const originalField = type === 'tv' ? 'original_name' : 'original_title';
        const dateField = type === 'tv' ? 'first_air_date' : 'release_date';
        const titleUk = (j[titleField] || '').trim();
        const originalTitle = (j[originalField] || '').trim();
        const year = (j[dateField] || '').slice(0, 4);
        let overview = (j.overview || '').trim();
        if (!overview && en) overview = (en.overview || '').trim();

        const genres = Array.isArray(j.genres) ? j.genres.map(g => g.name).join(', ') : '';
        const productionCountries = Array.isArray(j.production_countries)
            ? j.production_countries.map(c => COUNTRY_UA[c.name] || c.name).filter(Boolean).join(', ')
            : '';
        const productionCompanies = Array.isArray(j.production_companies)
            ? j.production_companies.map(c => c.name).slice(0, 5).join(', ')
            : '';
        const credits = j.credits || {};
        const cast = (credits.cast || []).slice(0, 10).map(p => p.name || p.original_name || '').filter(Boolean).join(', ');
        let director = '';
        if (type === 'movie') {
            director = (credits.crew || []).filter(p => p.job === 'Director').map(p => p.name).join(', ');
        } else {
            const createdBy = j.created_by || [];
            director = Array.isArray(createdBy) ? createdBy.map(p => p.name).filter(Boolean).join(', ') : '';
        }

        return {
            genres,
            production_countries: productionCountries,
            production_companies: productionCompanies,
            overview,
            cast,
            director,
            title_uk: titleUk,
            original_title: originalTitle,
            year
        };
    }

    // ——— Mediainfo: first General + first Video + all Audio/Text
    function getTracks(meta) {
        const media = meta.mediainfo && meta.mediainfo.media;
        const track = media && media.track;
        if (!Array.isArray(track)) return { general: null, video: null, audio: [], text: [] };
        const general = track.find(t => t['@type'] === 'General') || null;
        const video = track.find(t => t['@type'] === 'Video') || null;
        const audio = track.filter(t => t['@type'] === 'Audio');
        const text = track.filter(t => t['@type'] === 'Text');
        return { general, video, audio, text };
    }

    // Toloka video codec f13: 7=H.264, 12=VPx (HEVC not listed → 7 or 12)
    function videoCodecToSelect(format) {
        const f = safeStr(format).toUpperCase();
        if (/AVC|H\.?264/.test(f)) return '7';
        if (/HEVC|H\.?265|VP9/.test(f)) return '12';
        return '7';
    }

    // Toloka audio language f18: 1=українська, 2=англійська, 9=французька, 8=російська, 3=італійська, 4=китайська, 5=корейська, 6=німецька, 7=польська, 10=фінська, 11=чеська, 12=японська
    const AUDIO_LANG_MAP = { uk: '1', Ukrainian: '1', en: '2', English: '2', fr: '9', French: '9', ru: '8', Russian: '8', de: '6', German: '6', it: '3', Italian: '3', zh: '4', Chinese: '4', ko: '5', Korean: '5', pl: '7', Polish: '7', fi: '10', Finnish: '10', cs: '11', Czech: '11', ja: '12', Japanese: '12' };
    function audioLangToSelect(lang) {
        const n = safeStr(lang).trim();
        return AUDIO_LANG_MAP[n] || AUDIO_LANG_MAP[n.toLowerCase()] || '0';
    }

    // f19: 1=оригінал, 2=професійний дубльований, 3=багатоголосий закадровий, 4=двоголосий закадровий, 5=одноголосий закадровий, 6="гоблінський"
    function audioTypeToSelect(lang, dubType) {
        const isUa = /uk|Ukrainian/i.test(safeStr(lang));
        if (!isUa) return '1'; // оригінал
        if (dubType === 'SVO') return '5';
        if (dubType === 'DVO') return '4';
        if (dubType === 'DUB') return '2';
        return '3'; // MVO
    }

    // f20: 3=AC3 2.0, 4=AC3 5.1, 7=DTS 2.0, 8=DTS 5.1, 9=DTS-HD 2.0, 10=DTS-HD 5.1, 11=DTS-HD 7.1, 12=FLAC
    function audioCodecToSelect(format, channels) {
        const f = safeStr(format).toLowerCase();
        const ch = String(channels != null ? channels : '');
        const is51 = /6|5\.1|5.1/.test(ch);
        const is20 = /2|2\.0|2.0|stereo/i.test(ch);
        if (/dts[- ]?hd|dtshd|master/i.test(f)) return is51 ? '10' : '9';
        if (/dts/i.test(f)) return is51 ? '8' : '7';
        if (/ac-?3|dolby\s*digital|e-?ac-?3/i.test(f)) return is51 ? '4' : '3';
        if (/flac/i.test(f)) return '12';
        if (/aac/i.test(f)) return is51 ? '2' : '1';
        return is51 ? '4' : '3';
    }

    // Subtitle language f25: same codes as audio
    function subLangToSelect(lang) {
        return audioLangToSelect(lang);
    }
    // f26: 1=вбудовані (жорсткі), 2=пререндерні, 3=програмні (м'які)
    function subTypeToSelect(format) {
        const f = safeStr(format).toLowerCase();
        if (/pgs|sup|vobsub/i.test(f)) return '2';
        if (/utf-?8|srt|ass|text/i.test(f)) return '3';
        return '3';
    }
    // f27: 8=*.srt, 2=*.ass, 10=*.sub, 11=*.sub + *.idx
    function subFormatToSelect(format) {
        const f = safeStr(format).toLowerCase();
        if (/utf-?8|srt/i.test(f)) return '8';
        if (/ass|ssa/i.test(f)) return '2';
        if (/pgs|sup/i.test(f)) return '10';
        if (/vobsub|idx/i.test(f)) return '11';
        return '8';
    }

    function setField(form, name, value) {
        const el = form.querySelector(`[name="${name}"]`);
        if (!el) return;
        if (el.tagName === 'SELECT') {
            const opt = Array.from(el.options).find(o => o.value === String(value));
            if (opt) opt.selected = true;
        } else if (el.type === 'checkbox' || el.type === 'radio') {
            el.checked = !!value;
        } else {
            el.value = value != null ? String(value) : '';
        }
    }

    function setFieldByIndex(form, name, index, value) {
        const els = form.querySelectorAll(`[name="${name}"]`);
        const el = els[index];
        if (!el) return;
        if (el.tagName === 'SELECT') {
            const opt = Array.from(el.options).find(o => o.value === String(value));
            if (opt) opt.selected = true;
        } else {
            el.value = value != null ? String(value) : '';
        }
    }

    // Clone table row so we have enough rows without clicking Toloka's + (avoids mlAddVal break)
    function ensureRows(form, rowSelector, count) {
        const first = form.querySelector(rowSelector);
        if (!first || count <= 1) return;
        const row = first.closest('tr');
        if (!row || !row.parentNode) return;
        const currentCount = form.querySelectorAll(rowSelector).length;
        for (let i = currentCount; i < count; i++) {
            const clone = row.cloneNode(true);
            row.parentNode.appendChild(clone);
        }
    }

    function populateForm(form, meta) {
        const basename = getBasename(meta);
        const quality = qualityFromBasename(basename);
        const dubType = dubTypeFromBasename(basename);
        const tracks = getTracks(meta);

        const t = meta._tmdb;
        const title = (t && t.title_uk) || (meta.regex_title || meta.title || '').trim();
        const originalTitle = (t && t.original_title) || (meta.secondary_title || meta.original_title || (meta.imdb_info && meta.imdb_info.aka) || '').trim();
        const year = (t && t.year) || meta.year || (meta.release_date || '').slice(0, 4) || '';
        const resolution = (meta.resolution || '').trim() || '1080p';

        const audioLangs = (meta.audio_languages || []).map(l => langCode(l));
        const subLangs = (meta.subtitle_languages || []).map(l => langCode(l));
        let titleSuffix = audioLangs.join('/');
        if (subLangs.length) titleSuffix += ' | Sub ' + subLangs.join('/');

        const subject = [title, originalTitle].filter(Boolean).join(' / ') + (year ? ` (${year}) ` : ' ') + quality.label + ' ' + resolution + ' ' + titleSuffix;
        setField(form, 'subject', subject.trim());
        setField(form, 'f31[]', '18');   // Джерело: Інше
        setField(form, 'f32[]', '14');   // спільно з: Інше
        setField(form, 'f34', '11');     // Особиста оцінка: 0 - не дивився
        setField(form, 'f29', getScreenshotsBBCode(meta));  // Скріншоти

        setField(form, 'f1', getGenres(meta));
        setField(form, 'f2', getCountries(meta));
        const imdbUrl = getImdbUrl(meta);
        setField(form, 'f4[]', imdbUrl);
        setField(form, 'f6', getCompanies(meta));
        setField(form, 'f7', getDirectors(meta));
        setField(form, 'f8', getCast(meta));
        setField(form, 'f9', getOverview(meta));

        if (tracks.general && tracks.general.Duration) {
            const sec = parseFloat(tracks.general.Duration);
            setField(form, 'f10', durationFromSeconds(sec));
        }

        setField(form, 'f11', quality.value);

        // Video: first track
        if (tracks.video) {
            const v = tracks.video;
            const codec = videoCodecToSelect(v.Format);
            const res = v.Width && v.Height ? `${v.Width}x${v.Height}` : '';
            const bitrate = (v.BitRate && Number(v.BitRate) > 0) ? (Number(v.BitRate) / 1e6).toFixed(1) : '';
            setFieldByIndex(form, 'f13[]', 0, codec);
            setFieldByIndex(form, 'f14[]', 0, res);
            setFieldByIndex(form, 'f15[]', 0, bitrate ? bitrate + ' мб/с' : '');
        }

        // Audio: ensure enough rows by cloning, then fill all tracks (e.g. 1 Ukr + 2 Eng + 3 Fr = 6)
        ensureRows(form, 'select[name="f18[]"]', tracks.audio.length);
        tracks.audio.forEach((a, i) => {
            const lang = safeStr(a.Language);
            const ch = a.Channels;
            const fmt = safeStr(a.Format_Commercial_IfAny || a.Format);
            const bitK = (a.BitRate && Number(a.BitRate) > 0) ? Math.round(Number(a.BitRate) / 1000) : 'VBR';
            setFieldByIndex(form, 'f18[]', i, audioLangToSelect(lang));
            setFieldByIndex(form, 'f19[]', i, audioTypeToSelect(lang, dubType));
            setFieldByIndex(form, 'f20[]', i, audioCodecToSelect(fmt, ch));
            setFieldByIndex(form, 'f21[]', i, bitK + (bitK === 'VBR' ? '' : ' кб/с'));
        });

        // Dubbing source f23: 45 = Оригінальний_Blu-Ray, 44 = Оригінальний_DVD, 46 = Любительський переклад
        setField(form, 'f23', '45'); // default Blu-Ray

        // Subtitles: ensure enough rows by cloning, then fill all tracks (e.g. 3 Eng + 4 Fr = 7)
        const fullTextTracks = tracks.text.filter(t => t.Forced !== 'Yes');
        const textToFill = fullTextTracks.length ? fullTextTracks : tracks.text;
        ensureRows(form, 'select[name="f25[]"]', textToFill.length);
        textToFill.forEach((t, i) => {
            setFieldByIndex(form, 'f25[]', i, subLangToSelect(t.Language));
            setFieldByIndex(form, 'f26[]', i, subTypeToSelect(t.Format));
            setFieldByIndex(form, 'f27[]', i, subFormatToSelect(t.Format));
        });
    }

    function readMetaFromFile(file) {
        return new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => { try { resolve(JSON.parse(r.result)); } catch (e) { reject(e); } };
            r.onerror = () => reject(new Error('Failed to read file'));
            r.readAsText(file, 'UTF-8');
        });
    }

    function findForm() {
        return document.querySelector('form[name="post"]') || document.querySelector('form[enctype="multipart/form-data"]');
    }

    function injectUI() {
        const form = findForm();
        if (!form) return;

        const table = form.querySelector('table.forumline');
        if (!table || !table.tBodies[0]) return;

        const thead = table.querySelector('th.thHead');
        let panel = document.getElementById('toloka-fill-panel');
        let btn = document.getElementById('toloka-fill-btn');

        if (panel && btn) return;

        const firstRow = table.rows[1];
        btn = document.createElement('button');
        btn.type = 'button';
        btn.id = 'toloka-fill-btn';
        btn.className = 'mainoption';
        btn.textContent = 'Заповнити з папки (meta.json)';
        btn.style.marginRight = '8px';
        btn.style.marginBottom = '8px';

        panel = document.createElement('div');
        panel.id = 'toloka-fill-panel';
        panel.style.display = 'none';
        panel.style.background = '#f5f5f5';
        panel.style.border = '1px solid #ccc';
        panel.style.borderRadius = '6px';
        panel.style.padding = '12px';
        panel.style.marginBottom = '12px';
        panel.style.maxWidth = '600px';

        const selectFolderBtn = document.createElement('button');
        selectFolderBtn.type = 'button';
        selectFolderBtn.textContent = 'Обрати папку';
        selectFolderBtn.className = 'mainoption';
        selectFolderBtn.style.marginRight = '8px';

        const dropZone = document.createElement('div');
        dropZone.style.border = '2px dashed #888';
        dropZone.style.borderRadius = '6px';
        dropZone.style.padding = '24px';
        dropZone.style.textAlign = 'center';
        dropZone.style.marginTop = '10px';
        dropZone.style.background = '#fff';
        dropZone.textContent = 'або перетягніть сюди папку або файл meta.json';

        const status = document.createElement('div');
        status.style.marginTop = '10px';
        status.style.minHeight = '20px';
        status.style.fontSize = '12px';
        status.style.color = '#666';

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.textContent = 'Закрити';
        closeBtn.style.marginLeft = '8px';

        const tmdbRow = document.createElement('div');
        tmdbRow.style.marginBottom = '10px';
        const tmdbLabel = document.createElement('label');
        tmdbLabel.textContent = 'TMDB API key (для української локалізації): ';
        const tmdbInput = document.createElement('input');
        tmdbInput.type = 'password';
        tmdbInput.placeholder = 'Збережено повторно використовується';
        tmdbInput.style.width = '220px';
        tmdbInput.style.marginRight = '6px';
        tmdbInput.value = getStoredTmdbKey();
        tmdbInput.autocomplete = 'off';
        const tmdbSave = document.createElement('button');
        tmdbSave.type = 'button';
        tmdbSave.textContent = 'Зберегти';
        tmdbSave.className = 'mainoption';
        tmdbSave.style.marginRight = '6px';
        const tmdbHint = document.createElement('span');
        tmdbHint.style.fontSize = '11px';
        tmdbHint.style.color = '#666';
        tmdbHint.textContent = getStoredTmdbKey() ? ' (ключ збережено)' : '';
        tmdbSave.addEventListener('click', () => {
            const v = tmdbInput.value.trim();
            setStoredTmdbKey(v);
            tmdbHint.textContent = v ? ' (ключ збережено)' : ' (ключ видалено)';
        });
        tmdbRow.appendChild(tmdbLabel);
        tmdbRow.appendChild(tmdbInput);
        tmdbRow.appendChild(tmdbSave);
        tmdbRow.appendChild(tmdbHint);

        panel.appendChild(tmdbRow);
        panel.appendChild(selectFolderBtn);
        panel.appendChild(closeBtn);
        panel.appendChild(document.createElement('br'));
        panel.appendChild(dropZone);
        panel.appendChild(status);

        function setStatus(msg, isError) {
            status.textContent = msg;
            status.style.color = isError ? '#c00' : '#666';
        }

        function tryFillWithMeta(meta) {
            try {
                populateForm(form, meta);
                setStatus('Форму заповнено.');
            } catch (e) {
                setStatus('Помилка: ' + e.message, true);
            }
        }

        async function handleFile(file) {
            if (!file || file.name !== 'meta.json') {
                setStatus('Оберіть файл meta.json або папку, де він лежить.', true);
                return;
            }
            setStatus('Читаю meta.json…');
            try {
                const meta = await readMetaFromFile(file);
                const apiKey = (tmdbInput.value || getStoredTmdbKey() || '').trim();
                if (apiKey && (meta.tmdb_id || meta.imdb_id || (meta.imdb_info && meta.imdb_info.imdbID))) {
                    setStatus('Отримую дані TMDB (українською)…');
                    try {
                        const tmdbData = await fetchTmdbData(apiKey, meta);
                        if (tmdbData) meta._tmdb = tmdbData;
                    } catch (e) {
                        setStatus('Форму заповнено (TMDB: ' + e.message + ').', true);
                        tryFillWithMeta(meta);
                        return;
                    }
                }
                tryFillWithMeta(meta);
            } catch (e) {
                setStatus('Помилка читання JSON: ' + e.message, true);
            }
        }

        async function openFolder() {
            if (typeof showDirectoryPicker !== 'function') {
                setStatus('Оберіть файл meta.json (API папок не підтримується в цьому браузері).', true);
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = '.json';
                input.onchange = () => { const f = input.files && input.files[0]; if (f) handleFile(f); };
                input.click();
                return;
            }
            setStatus('Відкрийте папку з релізом…');
            try {
                const dir = await showDirectoryPicker();
                const file = await dir.getFileHandle('meta.json');
                const f = await file.getFile();
                await handleFile(f);
            } catch (e) {
                if (e.name === 'AbortError') setStatus('Вибір скасовано.');
                else setStatus('Помилка: ' + e.message, true);
            }
        }

        selectFolderBtn.addEventListener('click', openFolder);
        closeBtn.addEventListener('click', () => { panel.style.display = 'none'; });

        dropZone.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); dropZone.style.background = '#e8f4fc'; });
        dropZone.addEventListener('dragleave', () => { dropZone.style.background = '#fff'; });
        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.style.background = '#fff';
            const items = e.dataTransfer && e.dataTransfer.items;
            if (!items || !items.length) {
                const files = e.dataTransfer.files;
                if (files && files.length) {
                    const metaFile = Array.from(files).find(f => f.name === 'meta.json');
                    if (metaFile) { handleFile(metaFile); return; }
                }
                setStatus('Перетягніть папку або файл meta.json.', true);
                return;
            }
            (async () => {
                for (let i = 0; i < items.length; i++) {
                    const entry = items[i].webkitGetAsEntry ? items[i].webkitGetAsEntry() : null;
                    if (entry && entry.isDirectory) {
                        const dir = entry.createReader && entry.createReader();
                        if (dir) {
                            dir.readEntries(async (entries) => {
                                const metaEntry = entries.find(e => e.name === 'meta.json');
                                if (metaEntry && metaEntry.file) {
                                    metaEntry.file(handleFile);
                                } else {
                                    setStatus('У папці не знайдено meta.json.', true);
                                }
                            });
                        }
                        return;
                    }
                    const file = items[i].getAsFile();
                    if (file && file.name === 'meta.json') {
                        await handleFile(file);
                        return;
                    }
                }
                setStatus('Перетягніть папку або файл meta.json.', true);
            })();
        });

        btn.addEventListener('click', () => {
            panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
            if (panel.style.display === 'block') setStatus('');
        });

        const wrap = document.createElement('tr');
        wrap.innerHTML = '<td class="row2" colspan="2" style="padding:10px"></td>';
        wrap.querySelector('td').appendChild(btn);
        wrap.querySelector('td').appendChild(panel);
        table.tBodies[0].insertBefore(wrap, firstRow);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', injectUI);
    } else {
        injectUI();
    }
})();
