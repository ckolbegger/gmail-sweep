/**
 * Unicode-aware terminal width utilities.
 *
 * Terminal cells != JS string length because:
 *   - Emoji (📌📢) and CJK (日本語) occupy 2 cells
 *   - Surrogate pairs (emoji encoded as 2 UTF-16 code units)
 *
 * blessed does internal width tracking but its wrapping has edge cases.
 * Pre-processing content ourselves guarantees correct widths.
 */

const HIGH_SURROGATE_START = 0xd800;
const HIGH_SURROGATE_END = 0xdbff;

/** Wide Unicode ranges (CJK + misc symbols + emoji). */
function isWide(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) || // Hangul Jamo
    (cp >= 0x231a && cp <= 0x231b) || // watch, hourglass
    (cp >= 0x2328 && cp <= 0x2328) || // keyboard
    (cp >= 0x2388 && cp <= 0x2388) || // helm symbol
    (cp >= 0x23cf && cp <= 0x23cf) || // eject
    (cp >= 0x23e9 && cp <= 0x23f3) || // media/emoji
    (cp >= 0x23f8 && cp <= 0x23fa) || // media controls
    (cp >= 0x25aa && cp <= 0x25ab) || // squares
    (cp >= 0x25b6 && cp <= 0x25b6) || // play
    (cp >= 0x25c0 && cp <= 0x25c0) || // reverse
    (cp >= 0x25fb && cp <= 0x25fe) || // squares
    (cp >= 0x2600 && cp <= 0x27bf) || // misc symbols + dingbats
    (cp >= 0x2934 && cp <= 0x2935) || // arrows
    (cp >= 0x2b05 && cp <= 0x2b07) || // arrows
    (cp >= 0x2b1b && cp <= 0x2b1c) || // squares
    (cp >= 0x2b50 && cp <= 0x2b50) || // star
    (cp >= 0x2b55 && cp <= 0x2b55) || // circle
    (cp >= 0x2c60 && cp <= 0x2ddf) || // Latin Extended-C..D
    (cp >= 0x2e80 && cp <= 0xa4cf) || // CJK
    (cp >= 0xa960 && cp <= 0xa97f) || // Hangul
    (cp >= 0xac00 && cp <= 0xd7a3) || // Hangul Syllables
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK Compatibility
    (cp >= 0xfe30 && cp <= 0xfe6f) || // CJK Forms
    (cp >= 0xff01 && cp <= 0xff60) || // Fullwidth
    (cp >= 0xffe0 && cp <= 0xffe6) || // Fullwidth signs
    (cp >= 0x1f000 && cp <= 0x1f02f) || // Mahjong Tiles
    (cp >= 0x1f0a0 && cp <= 0x1f0ff) || // Playing Cards
    (cp >= 0x1f100 && cp <= 0x1f64f) || // Enclosed + Emoticons
    (cp >= 0x1f680 && cp <= 0x1f6ff) || // Transport
    (cp >= 0x1f900 && cp <= 0x1f9ff) || // Supplemental Symbols
    (cp >= 0x1fa00 && cp <= 0x1fa6f) || // Chess Symbols
    (cp >= 0x1fa70 && cp <= 0x1faff) || // Symbols Extended-A
    (cp >= 0x20000 && cp <= 0x2ffef) || // CJK Extension B..I
    (cp >= 0x30000 && cp <= 0x3fffd)   // CJK Extension G..H
  );
}

/** Return 0 for zero-width chars, 2 for wide chars, 1 otherwise. */
function charWidth(cp: number): number {
  // Zero-width: variation selectors, combining marks, zero-width joiner/non-joiner
  if (
    cp === 0xfe0e || // VS-15 (text presentation)
    cp === 0xfe0f || // VS-16 (emoji presentation)
    cp === 0x200d || // ZWJ
    cp === 0x200c || // ZWNJ
    cp === 0x200b || // ZWSP
    (cp >= 0x0300 && cp <= 0x036f) // combining diacritical marks
  ) return 0;
  return isWide(cp) ? 2 : 1;
}

/** Iterate string by codepoint (not UTF-16 code unit). */
function* codepoints(str: string): Generator<string> {
  let i = 0;
  while (i < str.length) {
    const cu = str.charCodeAt(i);
    if (cu >= HIGH_SURROGATE_START && cu <= HIGH_SURROGATE_END) {
      yield str.slice(i, i + 2);
      i += 2;
    } else {
      yield str[i];
      i += 1;
    }
  }
}

/** Return terminal cell width of `str`. */
export function visualWidth(str: string): number {
  let w = 0;
  for (const cp of codepoints(str)) {
    w += charWidth(cp.codePointAt(0)!);
  }
  return w;
}

/** Strip blessed tags ({bold}, {/bold}, {gray-fg}, etc.) for width measurement. */
export function stripTags(str: string): string {
  return str.replace(/\{[^}]*\}/g, "");
}

/**
 * Strip emoji and other wide Unicode symbols from `str`.
 * Keeps ASCII, Latin, CJK, and basic punctuation (including • ★).
 * This guarantees every remaining character is exactly 1 terminal cell,
 * eliminating all width-calculation edge cases for blessed rendering.
 */
export function stripEmoji(str: string): string {
  let result = "";
  let i = 0;
  while (i < str.length) {
    const cu = str.charCodeAt(i);
    let cp: number;
    let len: number;
    if (cu >= HIGH_SURROGATE_START && cu <= HIGH_SURROGATE_END) {
      cp = str.codePointAt(i)!;
      len = 2;
    } else {
      cp = cu;
      len = 1;
    }
    // Drop: variation selectors, ZWJ, combining marks, emoji/symbol ranges
    if (
      cp === 0xfe0e || cp === 0xfe0f || // variation selectors
      cp === 0x200d || cp === 0x200c || cp === 0x200b || // ZWJ/ZWNJ/ZWSP
      (cp >= 0x0300 && cp <= 0x036f) || // combining marks
      (cp >= 0x2702 && cp <= 0x27b0) || // dingbats
      (cp >= 0x1f000 && cp <= 0x1faff) || // all emoji blocks
      (cp >= 0x2600 && cp <= 0x26ff && cp !== 0x2605 && cp !== 0x2606) || // misc symbols (keep ★☆)
      (cp >= 0x2700 && cp <= 0x2701) || // scissors (before dingbats)
      (cp >= 0x2300 && cp <= 0x23ff) || // misc technical
      (cp >= 0x2b50 && cp <= 0x2b55) || // star/circle
      (cp >= 0x25a0 && cp <= 0x25ff) || // geometric shapes
      (cp >= 0x20a0 && cp <= 0x20cf) || // currency (not basic $)
      (cp >= 0x2190 && cp <= 0x21ff) || // arrows
      (cp >= 0x2900 && cp <= 0x297f)    // supplemental arrows
    ) {
      i += len;
      continue;
    }
    result += str.slice(i, i + len);
    i += len;
  }
  return result;
}

/** Truncate `str` so its visual width is <= `maxWidth`. Never splits an emoji. */
export function truncateToWidth(str: string, maxWidth: number): string {
  let result = "";
  let w = 0;
  for (const cp of codepoints(str)) {
    const cw = charWidth(cp.codePointAt(0)!);
    if (w + cw > maxWidth) break;
    result += cp;
    w += cw;
  }
  return result;
}

/** Pad `str` with spaces on the right to reach `targetWidth` visual cells. */
export function padEndWidth(str: string, targetWidth: number): string {
  const currentWidth = visualWidth(str);
  const pad = targetWidth - currentWidth;
  return pad > 0 ? str + " ".repeat(pad) : str;
}

/**
 * Word-wrap `text` so every line fits within `maxWidth` visual cells.
 * Blessed-tag-aware: tags like {bold}...{/bold} are preserved in output
 * but excluded from width calculations.
 * Breaks at spaces when possible; force-breaks long unbroken runs.
 * Preserves existing newlines.
 */
export function wrapText(text: string, maxWidth: number): string {
  const inputLines = text.split("\n");
  const out: string[] = [];

  for (const line of inputLines) {
    if (visualWidth(stripTags(line)) <= maxWidth) {
      out.push(line);
      continue;
    }

    // Split into segments: tags and non-tag content
    const segments = line.split(/(\{[^}]*\})/);
    // Build a flat list of [rawSegment, visualWidth] pairs
    const tokens: Array<{ raw: string; w: number }> = [];
    for (const seg of segments) {
      if (!seg) continue;
      if (seg.startsWith("{")) {
        // Tag — preserve but zero width
        tokens.push({ raw: seg, w: 0 });
      } else {
        // Real content — may contain spaces, split on whitespace
        const words = seg.split(/(\s+)/);
        for (const word of words) {
          if (!word) continue;
          tokens.push({ raw: word, w: visualWidth(word) });
        }
      }
    }

    let current = "";
    let currentW = 0;

    for (const token of tokens) {
      if (token.w === 0) {
        // Tag — always append (zero visual width)
        current += token.raw;
        continue;
      }

      if (currentW + token.w <= maxWidth) {
        current += token.raw;
        currentW += token.w;
      } else if (token.w >= maxWidth) {
        // Force-break long unbroken content
        if (current) {
          out.push(current);
          current = "";
          currentW = 0;
        }
        let partial = "";
        let partialW = 0;
        for (const cp of codepoints(token.raw)) {
          const cw = charWidth(cp.codePointAt(0)!);
          if (partialW + cw > maxWidth) {
            out.push(partial);
            partial = cp;
            partialW = cw;
          } else {
            partial += cp;
            partialW += cw;
          }
        }
        current = partial;
        currentW = partialW;
      } else {
        out.push(current);
        current = token.raw;
        currentW = token.w;
      }
    }
    if (current) out.push(current);
  }

  return out.join("\n");
}
