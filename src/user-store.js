const DB_NAME = "conferenceCompanionUserData";
const DB_VERSION = 2;
const USER_SCHEMA_VERSION = 1;
const STORED_BLOB = '__conferenceCompanionStoredBlobV1';

export async function encodeStoredValue(value) {
  if (value instanceof Blob) return {[STORED_BLOB]:true,type:value.type,bytes:new Uint8Array(await value.arrayBuffer())};
  if (Array.isArray(value)) return Promise.all(value.map(encodeStoredValue));
  if (value && typeof value === 'object') {
    const entries=await Promise.all(Object.entries(value).map(async([key,item])=>[key,await encodeStoredValue(item)]));
    return Object.fromEntries(entries);
  }
  return value;
}

export function decodeStoredValue(value) {
  if (value && typeof value === 'object' && value[STORED_BLOB] === true && value.bytes instanceof Uint8Array) return new Blob([value.bytes],{type:value.type||''});
  if (typeof Blob !== 'undefined' && value instanceof Blob) return value;
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return value;
  if (Array.isArray(value)) return value.map(decodeStoredValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,decodeStoredValue(item)]));
  return value;
}

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
      return decodeStoredValue(row?.data || {favorites:[], posterFavorites:[], notes:{}});
    },
    async saveState(data) {
      const storedData=await encodeStoredValue(data);
      const db = await openDb();
      await txRequest(db, "states", "readwrite", s => s.put({conferenceId:id, data:storedData, updatedAt:Date.now()}));
    },
    async getProfile() {
      const db = await openDb();
      const row = await txRequest(db, "profiles", "readonly", s => s.get(id));
      return decodeStoredValue(row?.data || {});
    },
    async saveProfile(data) {
      const storedData=await encodeStoredValue(data);
      const db = await openDb();
      await txRequest(db, "profiles", "readwrite", s => s.put({conferenceId:id, data:storedData, updatedAt:Date.now()}));
    },
    async listFriends() {
      const db = await openDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction("friends", "readonly");
        const req = tx.objectStore("friends").index("conferenceId").getAll(id);
        req.onsuccess = () => resolve((req.result || []).map(x => decodeStoredValue(x.data)).sort((a,b)=>(a.savedAt||0)-(b.savedAt||0)));
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => db.close();
      });
    },
    async saveFriend(friend) {
      const record = {...friend};
      if (!record.id) record.id = crypto.randomUUID();
      if (!record.savedAt) record.savedAt = Date.now();
      const storedRecord=await encodeStoredValue(record);
      const db = await openDb();
      await txRequest(db, "friends", "readwrite", s => s.put({key:`${id}:${record.id}`, conferenceId:id, data:storedRecord, updatedAt:Date.now()}));
      return record;
    },
    async deleteFriend(friendId) {
      const db = await openDb();
      await txRequest(db, "friends", "readwrite", s => s.delete(`${id}:${friendId}`));
    },
    async replaceFriends(friends) {
      const db = await openDb();
      const normalized=(friends||[]).map(friend=>({...friend,id:friend.id||crypto.randomUUID(),savedAt:friend.savedAt||Date.now()}));
      const stored=await Promise.all(normalized.map(encodeStoredValue));
      await new Promise((resolve, reject) => {
        const tx = db.transaction("friends", "readwrite");
        const store = tx.objectStore("friends");
        const idx = store.index("conferenceId");
        const get = idx.getAllKeys(id);
        get.onsuccess = () => {
          for (const key of get.result || []) store.delete(key);
          for (let index=0;index<normalized.length;index++) {const record=normalized[index];store.put({key:`${id}:${record.id}`, conferenceId:id, data:stored[index], updatedAt:Date.now()});}
        };
        get.onerror = () => reject(get.error);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
      });
    },
    async replacePersonalData({state, profile, friends} = {}) {
      const normalizedFriends = (friends || []).map(friend => ({
        ...friend,
        id:friend.id || crypto.randomUUID(),
        savedAt:friend.savedAt || Date.now()
      }));
      const [storedState,storedProfile,storedFriends]=await Promise.all([
        encodeStoredValue(state || {favorites:[],posterFavorites:[],notes:{}}),
        encodeStoredValue(profile || {}),
        Promise.all(normalizedFriends.map(encodeStoredValue))
      ]);
      const db = await openDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(["states", "profiles", "friends"], "readwrite");
        let txError = null;
        const states = tx.objectStore("states"), profiles = tx.objectStore("profiles"), friendStore = tx.objectStore("friends");
        const keys = friendStore.index("conferenceId").getAllKeys(id);
        keys.onsuccess = () => {
          states.put({conferenceId:id, data:storedState, updatedAt:Date.now()});
          profiles.put({conferenceId:id, data:storedProfile, updatedAt:Date.now()});
          for (const key of keys.result || []) friendStore.delete(key);
          for (let index=0;index<normalizedFriends.length;index++) {const friend=normalizedFriends[index];friendStore.put({key:`${id}:${friend.id}`, conferenceId:id, data:storedFriends[index], updatedAt:Date.now()});}
        };
        keys.onerror = () => { txError = keys.error; };
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { txError ||= tx.error; };
        tx.onabort = () => { db.close(); reject(txError || tx.error || new Error("Personal-data restore aborted")); };
      });
      return normalizedFriends;
    },
    async clearAll() {
      const db = await openDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(["states", "profiles", "friends", "meta"], "readwrite");
        tx.objectStore("states").delete(id);
        tx.objectStore("profiles").delete(id);
        tx.objectStore("meta").delete(`user-schema:${id}`);
        const friends = tx.objectStore("friends");
        const keys = friends.index("conferenceId").getAllKeys(id);
        keys.onsuccess = () => { for (const key of keys.result || []) friends.delete(key); };
        keys.onerror = () => reject(keys.error);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
        tx.onabort = () => { db.close(); reject(tx.error || new Error("Personal-data deletion aborted")); };
      });
    }
  };
}
