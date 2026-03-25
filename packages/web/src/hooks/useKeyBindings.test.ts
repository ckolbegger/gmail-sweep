import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useKeyBindings } from './useKeyBindings.js';

function fireKey(key: string, opts: Partial<KeyboardEventInit> = {}) {
  document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...opts }));
}

describe('useKeyBindings', () => {
  it('calls handler for registered key', () => {
    const onJ = vi.fn();
    renderHook(() => useKeyBindings({ j: onJ }));
    fireKey('j');
    expect(onJ).toHaveBeenCalledTimes(1);
  });

  it('does not call handler for unregistered key', () => {
    const onJ = vi.fn();
    renderHook(() => useKeyBindings({ j: onJ }));
    fireKey('k');
    expect(onJ).not.toHaveBeenCalled();
  });

  it('cleans up listener on unmount', () => {
    const onJ = vi.fn();
    const { unmount } = renderHook(() => useKeyBindings({ j: onJ }));
    unmount();
    fireKey('j');
    expect(onJ).not.toHaveBeenCalled();
  });

  it('ignores keys when typing in input elements', () => {
    const onJ = vi.fn();
    renderHook(() => useKeyBindings({ j: onJ }));
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true }));
    expect(onJ).not.toHaveBeenCalled();
    document.body.removeChild(input);
  });
});
