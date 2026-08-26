export function getStorageManager(): StorageManager | undefined {
  return navigator.storage;
}

export async function requestPersistentStorage(): Promise<boolean> {
  const storage = getStorageManager();
  return typeof storage?.persist === 'function' ? storage.persist() : false;
}

export async function hasPersistentStorage(): Promise<boolean> {
  const storage = getStorageManager();
  return typeof storage?.persisted === 'function' ? storage.persisted() : false;
}
