# Bug: Detail panel right border rendering is broken — missing frame chars, content overflows

> **Fixed** (2026-04-03): Stripped emoji from both panes, dynamic column widths, pre-wrapped content to panel width via `src/tui/visual-width.ts` utilities.

**Severity:** Medium
**Date:** 2026-04-02

## Summary

The detail panel (right pane) has corrupted border rendering. Three distinct problems appear:

1. **Missing right `x` border** — multiple lines show the left `x` but no matching right `x`, leaving the right edge of the frame open
2. **Content overflows past the border** — long unbroken strings (email addresses, URLs) extend into or past where the right border should be
3. **Lines missing both borders** — some content lines (notably "Action Items:", bullet points) render with no `x` border on either side

## Reproduction

1. Start TUI: `tmux new-session -d -s tui 'TERM=xterm-256color bun run src/tui/index.ts'`
2. Observe the right pane border while viewing any email

## Evidence

Captured with `tmux capture-pane -p`:

```
xFrom: TradingView <noreply@tradingviewx       ← content eats into border
x.com>                                 x        ← email address overflows to next line
x                                      x
Action Items:                                   ← MISSING both borders
x• Review the new trading idea from    x
xtraderspro_charts on TradingView.     x
x                                               ← MISSING right border
xKey Points:                           x
x• Sender: TradingView                  x
x• Author: traderspro_charts           x
• Content: New trading idea                     ← MISSING both borders
```

## Root Cause (suspected)

Three contributing factors in `src/tui/components/detail-panel.ts`:

1. **Unicode width miscalculation** — The email content contains wide Unicode characters (emoji like 📢📄📉👀, bullet points •). These occupy 2 terminal cells but blessed may count them as 1, causing the text width to be underestimated. This makes the right border appear to be pushed off-screen or overlap content.

2. **Long unbroken strings** — Email addresses (`noreply@tradingview.com`) and URLs are long strings with no spaces. blessed's word-wrapping can't break them, so they overflow past the panel width and consume the border character position.

3. **Border rendering on content-wrapped lines** — When blessed wraps content to multiple visual lines, the border module may not draw the `x` characters on continuation lines or on lines where the content fills the full width.

## Fix

### Approach: Content pre-processing before rendering

1. **Wrap content to panel width** — Before calling `panel.setContent()`, word-wrap the text to `panel.width - 2` (subtract 2 for left/right border). Break long unbroken strings at the panel boundary.

2. **Strip/replace problematic Unicode** — Replace wide emoji with ASCII equivalents or account for their double-width in wrap calculations.

3. **Alternatively: disable native border, draw manually** — If blessed's border module can't handle these edge cases, draw the frame characters manually as part of the content string, ensuring every line has proper left/right frame chars.

### Files

- `src/tui/components/detail-panel.ts` — `render()` function and content formatting
- Possibly `src/tui/components/email-list.ts` — for reference on how the list handles width
