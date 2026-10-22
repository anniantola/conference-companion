const DB_NAME = "conferenceCompanionUserData";
const DB_VERSION = 2;
const USER_SCHEMA_VERSION = 1;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("states")) db.createObjectStore("states", {keyPath:"conferenceId"});
      if (!db.objectStoreNames.contains("profiles")) db.createObjectStore("profiles", {keyPath:"conferenceId"});
      if (!db.objectStoreNames.contains("friends")) {
        const store = db.createObjectStore("friends", {keyPath:"key"});
        store.createIndex("conferenceId", "conferenceId", {unique:false});
      }
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", {keyPath:"key"});
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txRequest(db, storeName, mode, operation) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let resultValue;
    let request;
    try { request = operation(store); }
    catch (err) { db.close(); reject(err); return; }
    if (request && typeof request === "object" && "onsuccess" in request) {
      request.onsuccess = () => { resultValue = request.result; };
      request.onerror = () => reject(request.error);
    } else resultValue = request;
    tx.oncomplete = () => { db.close(); resolve(resultValue); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error || new Error("IndexedDB transaction aborted")); };
  });
}

export function createUserStore(conferenceId) {
  const id = String(conferenceId || "default");
  return {
    async ensureReady() {
      const db = await openDb();
      await txRequest(db, "meta", "readwrite", s => s.put({key:`user-schema:${id}`, conferenceId:id, version:USER_SCHEMA_VERSION, updatedAt:Date.now()}));
    },
    async getState() {
      const db = await openDb();
      const row = await txRequest(db, "states", "readonly", s => s.get(id));
      return row?.data || {favorites:[], posterFavorites:[], notes:{}};
    },
    async saveState(data) {
      const db = await openDb();
      await txRequest(db, "states", "readwrite", s => s.put({conferenceId:id, data, updatedAt:Date.now()}));
    },
    async getProfile() {
      const db = await openDb();
      const row = await txRequest(db, "profiles", "readonly", s => s.get(id));
      return row?.data || {};
    },
    async saveProfile(data) {
      const db = await openDb();
      await txRequest(db, "profiles", "readwrite", s => s.put({conferenceId:id, data, updatedAt:Date.now()}));
    },
    async listFriends() {
      const db = await openDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction("friends", "readonly");
        const req = tx.objectStore("friends").index("conferenceId").getAll(id);
        req.onsuccess = () => resolve((req.result || []).map(x => x.data).sort((a,b)=>(a.savedAt||0)-(b.savedAt||0)));
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => db.close();
      });
    },
    async saveFriend(friend) {
      const record = {...friend};
      if (!record.id) record.id = crypto.randomUUID();
      if (!record.savedAt) record.savedAt = Date.now();
      const db = await openDb();
      await txRequest(db, "friends", "readwrite", s => s.put({key:`${id}:${record.id}`, conferenceId:id, data:record, updatedAt:Date.now()}));
      return record;
    },
    async deleteFriend(friendId) {
      const db = await openDb();
      await txRequest(db, "friends", "readwrite", s => s.delete(`${id}:${friendId}`));
    },
    async replaceFriends(friends) {
      const db = await openDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction("friends", "readwrite");
        const store = tx.objectStore("friends");
        const idx = store.index("conferenceId");
        const get = idx.getAllKeys(id);
        get.onsuccess = () => {
          for (const key of get.result || []) store.delete(key);
          for (const friend of friends || []) {
            const record = {...friend, id:friend.id || crypto.randomUUID(), savedAt:friend.savedAt || Date.now()};
            store.put({key:`${id}:${record.id}`, conferenceId:id, data:record, updatedAt:Date.now()});
          }
        };
        get.onerror = () => reject(get.error);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
      });
    }
  };
}
