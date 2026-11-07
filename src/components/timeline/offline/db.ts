// Minimal IndexedDB wrapper for offline data.
// Stores: kv (snapshot + meta), ops (outbox, keyPath id), blobs (local images, keyPath key).
// public/sw.js opens the same database (same name, version and upgrade) to serve local images.

export const DB_NAME = 'timeline-offline';
export const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('ops')) db.createObjectStore('ops', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs', { keyPath: 'key' });
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    request.onerror = () => { dbPromise = null; reject(request.error); };
    request.onblocked = () => { dbPromise = null; reject(new Error('本地数据库被占用，请关闭其他标签页后重试')); };
  });
  return dbPromise;
}

type StoreName = 'kv' | 'ops' | 'blobs';

const done = (tx: IDBTransaction) => new Promise<void>((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error || new Error('本地写入被中止'));
});

const result = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

/** Runs fn inside one transaction; resolves only after the transaction has committed. */
export async function transact<T>(stores: StoreName[], mode: IDBTransactionMode, fn: (tx: IDBTransaction) => T | Promise<T>): Promise<T> {
  const db = await openDb();
  const tx = db.transaction(stores, mode);
  const finished = done(tx);
  const value = await fn(tx);
  await finished;
  return value;
}

export const kvGet = <T>(key: string) =>
  transact(['kv'], 'readonly', (tx) => result(tx.objectStore('kv').get(key)) as Promise<T | undefined>);

export const kvSet = (key: string, value: unknown) =>
  transact(['kv'], 'readwrite', (tx) => { tx.objectStore('kv').put(value, key); });

export const getAll = <T>(store: 'ops' | 'blobs') =>
  transact([store], 'readonly', (tx) => result(tx.objectStore(store).getAll()) as Promise<T[]>);

export const getOne = <T>(store: 'ops' | 'blobs', key: string) =>
  transact([store], 'readonly', (tx) => result(tx.objectStore(store).get(key)) as Promise<T | undefined>);

export const putOne = (store: 'ops' | 'blobs', value: unknown) =>
  transact([store], 'readwrite', (tx) => { tx.objectStore(store).put(value); });

export const deleteOne = (store: 'ops' | 'blobs', key: string) =>
  transact([store], 'readwrite', (tx) => { tx.objectStore(store).delete(key); });

export { result as idbResult };
