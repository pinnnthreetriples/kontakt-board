import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';

Object.defineProperty(globalThis, 'crypto', {
  value: { randomUUID: () => `test-${Math.random().toString(16).slice(2)}` },
  configurable: true,
});
