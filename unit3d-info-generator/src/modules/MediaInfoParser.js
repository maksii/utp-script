export class MediaInfoParser {
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
