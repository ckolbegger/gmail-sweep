# Bug: Summary view doesn't display action items or key points

**Status:** Fixed in `3f57cff`, border rendering fixed 2026-04-03

**Severity:** Medium
**Date:** 2026-04-01

## Summary

When toggling the detail panel to "[summary]" mode, only the `summary` text is shown. The `action_items` and `key_points` fields (which exist in the database for 371/566 emails) are not rendered.

## Reproduction

1. Start TUI, navigate to any email that has AI-generated action items (e.g., "🔓 Unlocked" from AI Fire)
2. Press `Tab` to toggle to summary view
3. Observe: detail panel shows only the one-sentence summary
4. Expected: summary, action items, and key points should all be displayed

## Root Cause

Two gaps in the data pipeline:

1. **`EmailDetail` type missing fields** — `src/tui/api.ts:16-30` defines `EmailDetail` without `action_items` or `key_points`. The API response includes these fields but the type ignores them.

2. **`getEmailContent()` only returns `summary`** — `src/tui/components/detail-panel.ts:101-107` returns just `email.summary` when in summary mode. It doesn't format or include action items or key points.

## Fix

1. Add `action_items: string[] | null` and `key_points: string[] | null` to `EmailDetail` in `src/tui/api.ts`
2. Verify the backend `/emails/:id` route returns these fields (check `src/backend/routes/emails.ts`)
3. Update `getEmailContent()` in `src/tui/components/detail-panel.ts` to format summary + action items + key points when in summary mode

## Files

- `src/tui/api.ts` — `EmailDetail` interface (add fields)
- `src/tui/components/detail-panel.ts` — `getEmailContent()` (render all fields)
- `src/backend/routes/emails.ts` — verify API returns action_items and key_points
