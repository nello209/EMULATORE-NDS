// Archivio locale (IndexedDB). I metadati e i dati pesanti stanno in archivi
// separati: gli elenchi non caricano mai in memoria ROM o stati completi.

const DB_NAME = "vesuvio";
const DB_VERSION = 1;

export const STORES = {
  games: { keyPath: "id" },
  romData: { keyPath: "id" },
  states: { keyPath: "id", indexes: [["romId", "romId"]] },
  stateData: { keyPath: "id" },
  saves: { keyPath: "id", indexes: [["romId", "romId"]] },
  saveData: { keyPath: "id" },
  settings: { keyPath: "key" },
  events: { keyPath: "id", autoIncrement: true, indexes: [["romId", "romId"]] },
};

let dbPromise = null;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [name, def] of Object.entries(STORES)) {
        if (db.objectStoreNames.contains(name)) continue;
        const os = db.createObjectStore(name, { keyPath: def.keyPath, autoIncrement: !!def.autoIncrement });
        for (const [idx, path] of def.indexes || []) os.createIndex(idx, path);
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("Database bloccato da un'altra scheda aperta"));
  });
  return dbPromise;
}

function wrap(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Esegue fn dentro una transazione e risolve solo quando la transazione e' scritta. */
export async function tx(stores, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode, { durability: "strict" });
    let result;
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error("Transazione annullata"));
    const os = Object.fromEntries([].concat(stores).map((s) => [s, t.objectStore(s)]));
    Promise.resolve(fn(os, t)).then((r) => { result = r; }, (e) => { try { t.abort(); } catch (_) { /* gia' chiusa */ } reject(e); });
  });
}

export async function get(store, key) {
  const db = await openDB();
  return wrap(db.transaction(store).objectStore(store).get(key));
}

export async function getAll(store) {
  const db = await openDB();
  return wrap(db.transaction(store).objectStore(store).getAll());
}

export async function getAllByIndex(store, index, value) {
  const db = await openDB();
  return wrap(db.transaction(store).objectStore(store).index(index).getAll(value));
}

export async function put(store, value) {
  return tx(store, "readwrite", (os) => { os[store].put(value); });
}

export async function del(store, key) {
  return tx(store, "readwrite", (os) => { os[store].delete(key); });
}

export { wrap as request };
