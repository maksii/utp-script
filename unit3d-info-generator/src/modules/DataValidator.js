export class DataValidator {
    // A MediaInfo blob is parseable if it's a non-empty string. Section/field
    // problems are handled per-section by the parser (which simply skips what it
    // can't use) rather than rejecting the whole dump.
    validateMediaInfo(text) {
        return typeof text === 'string' && text.trim().length > 0;
    }

    // Does the uploader's track Title already match the convention-canonical
    // Format the parser built? Compared segment-by-segment, trimmed, so spacing
    // quirks ("a |  b") don't cause false mismatches. This drives the Status
    // column; it is NOT used to drop rows.
    validateRow(title, format) {
        if (!title || !format) return false;
        const norm = (s) => s.split('|').map(p => p.trim()).filter(Boolean).join(' | ');
        return norm(title) === norm(format);
    }

    validateFormat(info) {
        return this.validateRow(info.title, info.format);
    }

    // Character-level diff of two short strings (track Title vs canonical Format),
    // used to spotlight near-misses. Returns segment lists for each side plus a
    // `distance` = inserted + deleted characters (a 1-char substitution counts as 2).
    // Segments are runs of `{ text, changed }` so the renderer can wrap only the
    // differing characters. O(n*m) via LCS — track titles are tens of chars, so cheap.
    charDiff(a, b) {
        a = String(a == null ? '' : a);
        b = String(b == null ? '' : b);
        const m = a.length, n = b.length;
        // dp[i][j] = length of the longest common subsequence of a[i:] and b[j:].
        const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
        for (let i = m - 1; i >= 0; i--) {
            for (let j = n - 1; j >= 0; j--) {
                dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
            }
        }
        const aSeg = [], bSeg = [];
        let distance = 0;
        const push = (segs, ch, changed) => {
            const last = segs[segs.length - 1];
            if (last && last.changed === changed) last.text += ch;
            else segs.push({ text: ch, changed });
        };
        let i = 0, j = 0;
        while (i < m && j < n) {
            if (a[i] === b[j]) { push(aSeg, a[i], false); push(bSeg, b[j], false); i++; j++; }
            else if (dp[i + 1][j] >= dp[i][j + 1]) { push(aSeg, a[i], true); distance++; i++; } // only in a (removed)
            else { push(bSeg, b[j], true); distance++; j++; }                                    // only in b (added)
        }
        while (i < m) { push(aSeg, a[i], true); distance++; i++; }
        while (j < n) { push(bSeg, b[j], true); distance++; j++; }
        return { distance, aSeg, bSeg };
    }
}
