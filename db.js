// Tiny IndexedDB wrapper. Everything lives on this device only.
const DB = (() => {
  const NAME = "gutlog", VERSION = 1;
  let dbp;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("entries")) {
          const s = db.createObjectStore("entries", { keyPath: "id" });
          s.createIndex("ts", "ts");
        }
        if (!db.objectStoreNames.contains("settings")) db.createObjectStore("settings");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbp;
  }

  async function tx(store, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const s = t.objectStore(store);
      let out;
      Promise.resolve(fn(s)).then(v => { out = v; });
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }

  const req2p = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

  return {
    put: e => tx("entries", "readwrite", s => { s.put(e); }),
    putMany: list => tx("entries", "readwrite", s => { list.forEach(e => s.put(e)); }),
    del: id => tx("entries", "readwrite", s => { s.delete(id); }),
    all: async () => {
      const db = await open();
      const list = await req2p(db.transaction("entries").objectStore("entries").getAll());
      return list.sort((a, b) => a.ts - b.ts);
    },
    getSetting: async key => {
      const db = await open();
      return req2p(db.transaction("settings").objectStore("settings").get(key));
    },
    setSetting: (key, val) => tx("settings", "readwrite", s => { s.put(val, key); }),
  };
})();
