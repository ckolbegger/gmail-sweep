import { useEffect } from 'react';

type KeyMap = Record<string, () => void>;

const INPUT_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

export function useKeyBindings(bindings: KeyMap): void {
  useEffect(() => {
    function handler(e: KeyboardEvent): void {
      const target = e.target as HTMLElement | null;
      if (target && INPUT_TAGS.has(target.tagName)) return;

      const action = bindings[e.key];
      if (action) {
        e.preventDefault();
        action();
      }
    }

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [bindings]);
}
