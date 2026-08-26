import { describe, expect, it, vi } from 'vitest';
import { getStorageManager, hasPersistentStorage, requestPersistentStorage } from './storage';

describe('storage helpers', () => {
  it('безопасно работает без StorageManager API', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(navigator, 'storage');
    Object.defineProperty(navigator, 'storage', { configurable: true, value: undefined });
    try {
      expect(getStorageManager()).toBeUndefined();
      await expect(requestPersistentStorage()).resolves.toBe(false);
      await expect(hasPersistentStorage()).resolves.toBe(false);
    } finally {
      if (descriptor) Object.defineProperty(navigator, 'storage', descriptor);
      else Reflect.deleteProperty(navigator, 'storage');
    }
  });

  it('спрашивает браузер о постоянном хранилище, когда API есть', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(navigator, 'storage');
    const persist = vi.fn(() => Promise.resolve(true));
    const persisted = vi.fn(() => Promise.resolve(false));
    Object.defineProperty(navigator, 'storage', { configurable: true, value: { persist, persisted } });
    try {
      await expect(requestPersistentStorage()).resolves.toBe(true);
      await expect(hasPersistentStorage()).resolves.toBe(false);
      expect(persist).toHaveBeenCalledTimes(1);
      expect(persisted).toHaveBeenCalledTimes(1);
    } finally {
      if (descriptor) Object.defineProperty(navigator, 'storage', descriptor);
      else Reflect.deleteProperty(navigator, 'storage');
    }
  });
});
