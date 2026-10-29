
import {normalizeEmail,normalizeOrcid,normalizeExternalLink,normalizeWebUrl} from './src/safe-url.js';
import {encodeStoredValue,decodeStoredValue} from './src/user-store.js';

(() => {
  const CONFIG = window.CONFERENCE_CONFIG || {};
  const CONFERENCE = CONFIG.conference || {};
  const BRANDING = CONFIG.branding || {};
  const MODEL = window.CONFERENCE_MODEL;
  const SERVICES = window.CONFERENCE_SERVICES || {};
  const USER_STORE = SERVICES.userStore;
  const LOAD_INFO = window.CONFERENCE_LOAD_INFO || {};
  const DAYS = MODEL?.days || [];
  const ITEMS = MODEL?.items || [];
  const POSTERS = MODEL?.posters || [];
  const LOCATION_ROWS = CONFIG.locations?.locations || [];
  const LOCATIONS = Object.fromEntries(LOCATION_ROWS.map(x => [x.id, x]));
  const POSTER_SESSIONS = MODEL?.posterSessions || (MODEL?.posterSession ? [MODEL.posterSession] : []);
  const PREFS_KEY = `conferenceCompanion:${CONFERENCE.id || "default"}:preferences:v1`;
  const PHOTO_DB = `conferenceCompanion:${CONFERENCE.id || "default"}:photos`;

  const PHOTO_STORE = "photos";
  const defaultState = {
    favorites: [],
    posterFavorites: [],
    theme: BRANDING.previewAppearance || BRANDING.defaultAppearance || (BRANDING.darkMode === true ? "dark" : "system"),
    compact: false,
    timeMode: "conference",
    locationId: "all",
    track: "all",
    day: null,
    posterCategory: "all",
    view: "program",
    galleryMode: "photos",
    notes: {}
  };

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const byId = new Map(ITEMS.map(x => [x.id, x]));
  const posterById = new Map(POSTERS.map(x => [x.id, x]));
  let currentModal = null;
  let deferredInstallPrompt = window.CONFERENCE_INSTALL_PROMPT || null;
  let pendingPhotoImports = [];
  let galleryObjectUrls = [];
  let modalPhotoObjectUrls = [];
  let photoViewerIds = [];
  let photoViewerIndex = -1;
  let photoViewerReturnToDetail = false;
  let photoViewerReturnFocus = null;
  let shareQrReturnFocus = null;
  let galleryPhotoCount = 0;
  let galleryNoteCount = 0;
  let galleryPhotoQuery = "";
  let galleryNoteQuery = "";
  let profile = {};
  let friends = [];
  let profilePhotoUrl = "";
  let friendProfilePhotoUrl = "";
  let profileDraft = null;
  let qrScanner = null;
  let qrScanStarting = false;
  let qrScanProcessing = false;
  const expandedFriendIds = new Set();
  const pendingPersonalWrites = new Set();
  let personalDataEpoch = 0;
  let personalDataDeleting = false;
  let personalDataRestoring = false;
  let photoMetaSaveTimer = null;

  function trackPersonalWrite(promise) {
    const tracked = Promise.resolve(promise);
    pendingPersonalWrites.add(tracked);
    tracked.then(() => pendingPersonalWrites.delete(tracked), () => pendingPersonalWrites.delete(tracked));
    return tracked;
  }

  function flushPendingPersonalDebounces() {
    const writes=[];
    if(photoMetaSaveTimer!==null){
      clearTimeout(photoMetaSaveTimer);photoMetaSaveTimer=null;
      const title=$('#photoViewerTitle'),note=$('#photoViewerNote'),photoId=title?.dataset.photoId;
      if(photoId){writes.push(updatePhotoTitle(photoId,title.value));writes.push(updatePhotoNote(photoId,note?.value||''));}
    }
    for(const el of $$('[data-friend-note],[data-friend-tags],[data-friend-met-at]')){
      if(el._saveTimer==null)continue;
      clearTimeout(el._saveTimer);el._saveTimer=null;
      const field=el.matches('[data-friend-note]')?'privateNotes':el.matches('[data-friend-tags]')?'tags':'metAt';
      const id=el.dataset.friendNote||el.dataset.friendTags||el.dataset.friendMetAt;
      writes.push(saveFriendPrivate(id,field,el.value));
    }
    return Promise.allSettled(writes);
  }

  function loadState() {
    let prefs = {};
    try { prefs = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}"); } catch {}
    if (prefs.locationId == null && prefs.room != null) prefs.locationId = prefs.room;
    delete prefs.room;
    const owned = window.CONFERENCE_USER_STATE || {};
    return {...defaultState, ...prefs, ...owned, notes:{...(owned.notes || {})}};
  }
  let state = loadState();

  function saveState() {
    if (personalDataDeleting||personalDataRestoring) return Promise.resolve(false);
    const prefs = {
      theme:state.theme, compact:state.compact, timeMode:state.timeMode, locationId:state.locationId, track:state.track,
      day:state.day, posterCategory:state.posterCategory, view:state.view, galleryMode:state.galleryMode
    };
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    // Start the IndexedDB write now: preference/navigation changes must not
    // postpone a previously saved note until after a reload.
    return trackPersonalWrite(USER_STORE?.saveState({favorites:[...(state.favorites||[])],posterFavorites:[...(state.posterFavorites||[])],notes:{...(state.notes||{})}}) || Promise.resolve())
      .then(()=>true).catch(error=>{console.error(error);return false;});
  }

  function esc(v="") {
    return String(v).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
  }

  function keepDialogFocusInside(event) {
    if(event.key!=="Tab")return;
    const dialog=event.target.closest?.('dialog[open]');if(!dialog)return;
    const focusable=[...dialog.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')]
      .filter(el=>!el.hidden&&el.getAttribute('aria-hidden')!=='true'&&el.getClientRects().length);
    if(!focusable.length){event.preventDefault();dialog.focus();return;}
    const first=focusable[0],last=focusable.at(-1),active=document.activeElement;
    if((event.shiftKey&&active===first)||(!event.shiftKey&&active===last)){
      event.preventDefault();(event.shiftKey?last:first).focus();
    }
  }

  function packageAssetUrl(value) {
    if(!value)return "";if(CONFIG.builderPreview&&String(value).startsWith('blob:'))return String(value);const safe=normalizeWebUrl(value,{allowRelative:true});if(!safe)return "";if(/^https:/i.test(safe))return safe;return `${CONFIG.packageBase||"./conference"}/${safe.replace(/^\/+/,"")}`;
  }


  function noteKey(type, id) {
    return `${type}:${id}`;
  }

  function getNote(type, id) {
    return String(state.notes?.[noteKey(type,id)] || "");
  }

  function saveNote(type, id, value) {
    if (!state.notes || typeof state.notes !== "object" || Array.isArray(state.notes)) {
      state.notes = {};
    }
    const key = noteKey(type,id);
    const text = String(value || "");
    if (text.trim()) state.notes[key] = text;
    else delete state.notes[key];
    const saved=saveState();
    if (state.view === "gallery") renderGalleryNotes();
    return saved;
  }

  function noteSectionHtml(type, id) {
    return `<section class="notes-section">
      <div class="notes-section-head">
        <h3>Notes</h3>
        <span id="noteSaveStatus" class="note-save-status">Saved automatically</span>
      </div>
      <textarea
        id="modalNote"
        class="presentation-note"
        rows="5"
        placeholder="Write notes about this presentation…"
        spellcheck="true"
        data-note-type="${esc(type)}"
        data-note-id="${esc(id)}"
      >${esc(getNote(type,id))}</textarea>
    </section>`;
  }


  function openShareQr() {
    if (!CONFERENCE.features?.friendBook) return;
    if (!String(profile?.name || "").trim()) return toast("Add your name to My conference card first");
    try {
      const card = SERVICES.vcard.compactProfileVCard(profile);
      SERVICES.qr.drawQr($("#shareQrCanvas"), card, {scale:7, margin:4});
      $("#shareQrName").textContent = profile.name || "My conference card";
      $("#shareQrHint").textContent = "Scan to save this compact vCard. Your private Friend Book notes are never shared.";
    } catch (err) {
      console.error(err);
      return toast("Could not create QR card");
    }
    const viewer = $("#shareQrViewer");
    shareQrReturnFocus=document.activeElement;
    viewer.hidden = false;
    viewer.showModal();
    viewer.setAttribute("aria-hidden", "false");
    $("#shareQrClose").focus();
    document.documentElement.classList.add("share-qr-open");
    document.body.classList.add("share-qr-open");
  }

  function closeShareQr() {
    const viewer = $("#shareQrViewer");
    if(viewer.open)viewer.close();
    viewer.hidden = true;
    viewer.setAttribute("aria-hidden", "true");
    document.documentElement.classList.remove("share-qr-open");
    document.body.classList.remove("share-qr-open");
    if(shareQrReturnFocus?.isConnected)shareQrReturnFocus.focus();
    shareQrReturnFocus=null;
  }

  function openPhotoDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(PHOTO_DB, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(PHOTO_STORE)) {
          const store = db.createObjectStore(PHOTO_STORE, {keyPath:"id", autoIncrement:true});
          store.createIndex("ownerKey", "ownerKey", {unique:false});
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function photoOwnerKey(type, id) {
    return `${type}:${id}`;
  }

  async function getPhotos(type, id) {
    const db = await openPhotoDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(PHOTO_STORE, "readonly");
      const req = tx.objectStore(PHOTO_STORE).index("ownerKey").getAll(photoOwnerKey(type,id));
      let rows=[];
      req.onsuccess = () => {rows=(req.result || []).sort((a,b)=>(a.addedAt||0)-(b.addedAt||0));};
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => {db.close();resolve(decodeStoredValue(rows));};
      tx.onabort = () => {db.close();reject(tx.error||new Error('Photo read aborted'));};
    });
  }

  async function getAllPhotos() {
    const db = await openPhotoDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(PHOTO_STORE, "readonly");
      const req = tx.objectStore(PHOTO_STORE).getAll();
      let rows=[];
      req.onsuccess = () => {rows=(req.result || []).sort((x,y)=>(x.addedAt||0)-(y.addedAt||0));};
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => {db.close();resolve(decodeStoredValue(rows));};
      tx.onabort = () => {db.close();reject(tx.error||new Error('Photo read aborted'));};
    });
  }

  async function clonePhotoRowsForRestore(photos=[]) {
    const copyBlob=async blob=>blob instanceof Blob?new Blob([await blob.arrayBuffer()],{type:blob.type}):blob;
    return Promise.all(photos.map(async photo=>({...photo,blob:await copyBlob(photo.blob),thumbnailBlob:await copyBlob(photo.thumbnailBlob)})));
  }

  function storePhoto(type, id, file, metadata={}) {
    const epoch=personalDataEpoch;
    return trackPersonalWrite((async()=>{
    const blob = await prepareImageBlob(file);
    const thumbnailBlob = await prepareThumbnailBlob(blob);
    const storedMedia=await encodeStoredValue({blob,thumbnailBlob});
    if(personalDataDeleting||personalDataRestoring||epoch!==personalDataEpoch)throw new Error("Personal data changed while saving photo");
    const db = await openPhotoDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(PHOTO_STORE, "readwrite");
      const req = tx.objectStore(PHOTO_STORE).add({
        ownerKey: photoOwnerKey(type,id),
        ownerType: type,
        ownerId: id,
        name: file.name || "photo.jpg",
        originalType: file.type || blob.type || "image/jpeg",
        originalLastModified: file.lastModified || null,
        captureDate: metadata.captureDate || null,
        captureTime: metadata.captureTime || null,
        timestampSource: metadata.timestampSource || null,
        addedAt: Date.now(),
        thumbnailBlob:storedMedia.thumbnailBlob,
        blob:storedMedia.blob
      });
      let generatedId,txError=null;
      req.onsuccess = () => {generatedId=req.result;};
      req.onerror = () => {txError=req.error;};
      tx.oncomplete = () => {db.close();resolve(generatedId);};
      tx.onerror = () => {txError ||= tx.error;};
      tx.onabort = () => {db.close();reject(txError||tx.error||new Error('Photo save aborted'));};
    });
    })());
  }

  function updatePhotoTitle(photoId, title) {
    return trackPersonalWrite((async()=>{
    const db = await openPhotoDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(PHOTO_STORE, "readwrite");
      const store = tx.objectStore(PHOTO_STORE);
      const req = store.get(Number(photoId));
      req.onsuccess = () => {
        const photo = req.result;
        if (!photo) return;
        const clean = String(title || "").trim();
        if (clean) photo.customTitle = clean;
        else delete photo.customTitle;
        store.put(photo);
      };
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
    })());
  }

  function updatePhotoNote(photoId, note) {
    return trackPersonalWrite((async()=>{
    const db = await openPhotoDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(PHOTO_STORE, "readwrite");
      const store = tx.objectStore(PHOTO_STORE);
      const req = store.get(Number(photoId));
      req.onsuccess = () => {
        const photo = req.result;
        if (!photo) return;
        const clean = String(note || "").trim();
        if (clean) photo.customNote = clean;
        else delete photo.customNote;
        store.put(photo);
      };
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
    })());
  }


  function updatePhotoAssignment(photoId, type, id) {
    return trackPersonalWrite((async()=>{
    const db = await openPhotoDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(PHOTO_STORE, "readwrite");
      const store = tx.objectStore(PHOTO_STORE);
      const req = store.get(Number(photoId));
      req.onsuccess = () => {
        const photo = req.result;
        if (!photo) return;
        photo.ownerType = type;
        photo.ownerId = id;
        photo.ownerKey = photoOwnerKey(type, id);
        store.put(photo);
      };
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
    })());
  }

  async function deletePhoto(photoId) {
    const db = await openPhotoDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(PHOTO_STORE, "readwrite");
      tx.objectStore(PHOTO_STORE).delete(Number(photoId));
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  }

  async function getPhoto(photoId) {
    const db = await openPhotoDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(PHOTO_STORE, "readonly");
      const req = tx.objectStore(PHOTO_STORE).get(Number(photoId));
      let row=null;
      req.onsuccess = () => {row=req.result||null;};
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => {db.close();resolve(row?decodeStoredValue(row):null);};
      tx.onabort = () => {db.close();reject(tx.error||new Error('Photo read aborted'));};
    });
  }

  async function replaceAllPhotos(photoMeta=[], photoFiles=new Map()) {
    const rows=[];
    for(const meta of photoMeta||[]){
      const blob=photoFiles.get(meta.file);if(!blob)continue;
      const row={...meta,blob};delete row.file;delete row.type;
      row.ownerKey=row.ownerKey||photoOwnerKey(row.ownerType||'unclassified',row.ownerId||'unclassified');
      rows.push(await encodeStoredValue(row));
    }
    const db = await openPhotoDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(PHOTO_STORE, "readwrite");
      const store = tx.objectStore(PHOTO_STORE);
      store.clear();
      for(const row of rows)store.put(row);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
      tx.onabort = () => { db.close(); reject(tx.error || new Error("Photo restore aborted")); };
    });
  }

  async function replacePhotoRows(photos=[]) {
    const storedPhotos=await Promise.all(photos.map(encodeStoredValue));
    const db=await openPhotoDb();
    await new Promise((resolve,reject)=>{
      const tx=db.transaction(PHOTO_STORE,'readwrite'),store=tx.objectStore(PHOTO_STORE);
      let txError=null;
      const fail=(where,error)=>{txError ||= new Error(`${where}: ${error?.name||'Error'}: ${error?.message||String(error)}`);};
      const clear=store.clear();clear.onerror=()=>fail('clear',clear.error);
      for(const photo of storedPhotos){const request=store.put(photo);request.onerror=()=>fail(`put photo ${photo.id}`,request.error);}
      tx.oncomplete=()=>{db.close();resolve();};
      tx.onerror=()=>fail('transaction',tx.error);
      tx.onabort=()=>{db.close();reject(txError||tx.error||new Error('Photo restore aborted'));};
    });
  }

  async function clearAllPhotos() {
    const db = await openPhotoDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(PHOTO_STORE, "readwrite");
      tx.objectStore(PHOTO_STORE).clear();
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
      tx.onabort = () => { db.close(); reject(tx.error || new Error("Photo deletion aborted")); };
    });
  }

  async function prepareImageBlob(file) {
    // Keep small images as-is; compress larger photos to save browser storage.
    if (file.size <= 1200000) return file;
    try {
      const bitmap = await createImageBitmap(file);
      const maxSide = 1800;
      const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(bitmap, 0, 0, width, height);
      bitmap.close?.();
      return await new Promise((resolve, reject) => canvas.toBlob(
        blob => blob ? resolve(blob) : reject(new Error("Image conversion failed")),
        "image/jpeg", 0.82
      ));
    } catch {
      return file;
    }
  }

  async function prepareThumbnailBlob(blob) {
    try {
      const bitmap = await createImageBitmap(blob);
      const maxSide = 360;
      const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(bitmap, 0, 0, width, height);
      bitmap.close?.();
      return await new Promise((resolve, reject) => canvas.toBlob(
        out => out ? resolve(out) : reject(new Error("Thumbnail conversion failed")),
        "image/jpeg", 0.72
      ));
    } catch {
      return blob;
    }
  }

  async function persistPhotoThumbnail(photoId, thumbnailBlob) {
    const storedThumbnail=await encodeStoredValue(thumbnailBlob);
    const db = await openPhotoDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(PHOTO_STORE, "readwrite");
      const store = tx.objectStore(PHOTO_STORE);
      const req = store.get(Number(photoId));
      req.onsuccess = () => {
        const photo = req.result;
        if (photo && !photo.thumbnailBlob) {
          photo.thumbnailBlob = storedThumbnail;
          store.put(photo);
        }
      };
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  }

  async function ensurePhotoThumbnail(photo) {
    if (photo.thumbnailBlob) return photo.thumbnailBlob;
    const thumbnailBlob = await prepareThumbnailBlob(photo.blob);
    photo.thumbnailBlob = thumbnailBlob;
    try { await persistPhotoThumbnail(photo.id, thumbnailBlob); } catch {}
    return thumbnailBlob;
  }

  function readAscii(view, offset, length) {
    if (offset < 0 || offset + length > view.byteLength) return "";
    let out = "";
    for (let i=0; i<length; i++) {
      const code = view.getUint8(offset+i);
      if (!code) break;
      out += String.fromCharCode(code);
    }
    return out;
  }

  function parseExifWallClock(raw) {
    const m = String(raw || "").match(/^(\d{4}):(\d{2}):(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?/);
    if (!m) return null;
    return {date:`${m[1]}-${m[2]}-${m[3]}`, time:`${m[4]}:${m[5]}`, seconds:Number(m[6]||0)};
  }

  async function readExifCaptureTime(file) {
    if (!/jpe?g/i.test(file.type || file.name || "")) return null;
    try {
      const buffer = await file.slice(0, 1024 * 1024).arrayBuffer();
      const view = new DataView(buffer);
      if (view.byteLength < 4 || view.getUint16(0, false) !== 0xFFD8) return null;
      let pos = 2;
      while (pos + 4 <= view.byteLength) {
        if (view.getUint8(pos) !== 0xFF) { pos++; continue; }
        const marker = view.getUint8(pos + 1);
        pos += 2;
        if (marker === 0xDA || marker === 0xD9) break;
        if (pos + 2 > view.byteLength) break;
        const length = view.getUint16(pos, false);
        if (length < 2 || pos + length > view.byteLength) break;
        if (marker === 0xE1) {
          const payload = pos + 2;
          if (readAscii(view, payload, 4) === "Exif") {
            const tiff = payload + 6;
            if (tiff + 8 > view.byteLength) return null;
            const order = view.getUint16(tiff, false);
            const little = order === 0x4949;
            if (!little && order !== 0x4D4D) return null;
            const get16 = off => view.getUint16(off, little);
            const get32 = off => view.getUint32(off, little);
            const valueString = entry => {
              const type = get16(entry + 2);
              const count = get32(entry + 4);
              if (type !== 2 || !count) return "";
              const valuePos = count <= 4 ? entry + 8 : tiff + get32(entry + 8);
              return readAscii(view, valuePos, Math.min(count, 64));
            };
            const findTag = (ifdPos, wanted) => {
              if (ifdPos < 0 || ifdPos + 2 > view.byteLength) return null;
              const count = get16(ifdPos);
              for (let i=0; i<count; i++) {
                const entry = ifdPos + 2 + i*12;
                if (entry + 12 > view.byteLength) break;
                if (get16(entry) === wanted) return entry;
              }
              return null;
            };
            const ifd0 = tiff + get32(tiff + 4);
            const exifPtrEntry = findTag(ifd0, 0x8769);
            if (exifPtrEntry) {
              const exifIfd = tiff + get32(exifPtrEntry + 8);
              for (const tag of [0x9003, 0x9004]) {
                const entry = findTag(exifIfd, tag);
                const parsed = entry ? parseExifWallClock(valueString(entry)) : null;
                if (parsed) return parsed;
              }
            }
            const dateEntry = findTag(ifd0, 0x0132);
            const parsed = dateEntry ? parseExifWallClock(valueString(dateEntry)) : null;
            if (parsed) return parsed;
          }
        }
        pos += length;
      }
    } catch (err) {
      console.warn("Could not read EXIF timestamp", err);
    }
    return null;
  }

  function conferencePartsFromDate(date) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: CONFERENCE.timezone || "UTC",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23"
    }).formatToParts(date);
    const get = t => parts.find(p => p.type === t)?.value || "";
    return {date:`${get("year")}-${get("month")}-${get("day")}`, time:`${get("hour")}:${get("minute")}`};
  }

  async function captureInfoForFile(file) {
    const exif = await readExifCaptureTime(file);
    if (exif) return {...exif, source:"camera metadata"};
    if (file.lastModified) {
      const p = conferencePartsFromDate(new Date(file.lastModified));
      return {...p, seconds:0, source:"file date"};
    }
    return {date:null, time:null, seconds:0, source:"unknown"};
  }

  function minuteDistanceToEvent(minute, event) {
    const start = timeValue(event.start);
    const end = timeValue(event.end);
    if (minute < start) return start - minute;
    if (minute > end) return minute - end;
    return 0;
  }

  function assignmentKey(type, id) {
    return `${type}:${id}`;
  }

  function assignmentFromKey(key) {
    const [type, ...rest] = String(key || "").split(":");
    return {type, id:rest.join(":")};
  }

  function assignmentLabel(type, id) {
    if (type === "poster") {
      const p = posterById.get(id);
      return p ? `Poster #${p.number} · ${p.title}` : "Poster";
    }
    const e = byId.get(id);
    if (!e) return "Programme item";
    const session = e.session ? `${e.session} · ` : "";
    const room = e.locationId ? ` · ${locationLabel(e.locationId)}` : "";
    return `${e.start} · ${session}${e.title}${room}`;
  }

  function posterSessionFor(poster) {
    return poster?.posterSession || (poster?.posterSessionId ? MODEL?.session(poster.posterSessionId) : null) || null;
  }

  function activePosterSessions(capture) {
    if (!capture?.date || !capture?.time) return [];
    const minute=timeValue(capture.time);
    return POSTER_SESSIONS.filter(session=>session.date===capture.date&&minute>=timeValue(session.start)-5&&minute<=timeValue(session.end)+5);
  }

  function photoSuggestions(capture) {
    if (!capture?.date || !capture?.time) return [];
    const minute = timeValue(capture.time);
    const dateEvents = ITEMS.filter(e => e.date === capture.date && !["break","meal"].includes(e.kind));
    const posterSessions = dateEvents.filter(e => e.kind === "poster-session" && minute >= timeValue(e.start)-5 && minute <= timeValue(e.end)+5);
    const ranked = [];

    for (const posterSession of posterSessions) {
      for (const id of state.posterFavorites) {
        const p = posterById.get(id);
        if (p && p.posterSessionId===posterSession.sessionId) ranked.push({type:"poster", id:p.id, score:1600, reason:`Starred poster in ${posterSession.title}`});
      }
      ranked.push({type:"event", id:posterSession.id, score:1000, reason:"Poster session at this time"});
    }

    for (const e of dateEvents) {
      if (e.kind === "poster-session") continue;
      const distance = minuteDistanceToEvent(minute, e);
      if (distance > 20) continue;
      const inside = distance === 0;
      let score = inside ? 1000 : 700 - distance * 18;
      if (state.favorites.includes(e.id)) score += 350;
      if (["talk","plenary","special"].includes(e.kind)) score += 40;
      ranked.push({
        type:"event", id:e.id, score,
        reason: state.favorites.includes(e.id)
          ? (inside ? "Starred item happening at this time" : "Starred item near this time")
          : (inside ? "Happening at this time" : `${distance} min from capture time`)
      });
    }

    const seen = new Set();
    return ranked
      .sort((a,b)=>b.score-a.score)
      .filter(x => {
        const key = assignmentKey(x.type,x.id);
        if (seen.has(key)) return false;
        seen.add(key); return true;
      })
      .slice(0,8);
  }

  function importSelectOptions(item) {
    const suggestedKeys = new Set(item.suggestions.map(x=>assignmentKey(x.type,x.id)));
    let html = `<option value="unclassified:unclassified" ${item.selectedKey==="unclassified:unclassified"?"selected":""}>Unclassified — ignore time match</option>`;
    html += `<option value="">Do not import this photo</option>`;
    if (item.suggestions.length) {
      html += `<optgroup label="Suggested">` + item.suggestions.map(x => {
        const key = assignmentKey(x.type,x.id);
        return `<option value="${esc(key)}" ${key===item.selectedKey?"selected":""}>${esc(assignmentLabel(x.type,x.id))}</option>`;
      }).join("") + `</optgroup>`;
    }
    if (item.capture.date) {
      const others = ITEMS
        .filter(e => e.date===item.capture.date && !["break","meal","poster-session"].includes(e.kind))
        .filter(e => !suggestedKeys.has(assignmentKey("event",e.id)))
        .sort((a,b)=>timeValue(a.start)-timeValue(b.start) || a.track-b.track);
      if (others.length) {
        html += `<optgroup label="Other programme items that day">` + others.map(e =>
          `<option value="event:${esc(e.id)}">${esc(assignmentLabel("event",e.id))}</option>`
        ).join("") + `</optgroup>`;
      }
      const activeSessionIds=new Set(activePosterSessions(item.capture).map(x=>x.id));
      if (activeSessionIds.size && state.posterFavorites.length) {
        const posters = state.posterFavorites.map(id=>posterById.get(id)).filter(Boolean)
          .filter(p=>activeSessionIds.has(p.posterSessionId))
          .filter(p => !suggestedKeys.has(assignmentKey("poster",p.id)));
        if (posters.length) {
          html += `<optgroup label="Other starred posters">` + posters.map(p =>
            `<option value="poster:${esc(p.id)}">${esc(assignmentLabel("poster",p.id))}</option>`
          ).join("") + `</optgroup>`;
        }
      }
    }
    return html;
  }

  function clearPendingPhotoImports() {
    for (const item of pendingPhotoImports) {
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    }
    pendingPhotoImports = [];
    const list = $("#photoImportList");
    if (list) list.innerHTML = "";
  }

  function closePhotoImportDialog() {
    const dlg = $("#photoImportDialog");
    if (dlg?.open) dlg.close();
    clearPendingPhotoImports();
  }

  function renderPhotoImportReview() {
    const list = $("#photoImportList");
    if (!list) return;
    if (!pendingPhotoImports.length) {
      list.innerHTML = `<div class="photo-empty">No image files selected.</div>`;
      return;
    }
    list.innerHTML = pendingPhotoImports.map((item,index) => {
      const stamp = item.capture.date && item.capture.time
        ? `${item.capture.date} · ${item.capture.time}`
        : "No usable timestamp";
      const top = item.suggestions[0];
      const reason = top ? top.reason : "No session match — will import as Unclassified";
      return `<article class="photo-import-item" data-import-index="${index}">
        <img src="${item.previewUrl}" alt="Selected conference photo">
        <div class="photo-import-copy">
          <strong>${esc(item.file.name || `Photo ${index+1}`)}</strong>
          <div class="photo-import-time">${esc(stamp)} · ${esc(item.capture.source)}</div>
          <div class="photo-import-reason">${esc(reason)}</div>
          <label>
            <span>Assign to</span>
            <select class="photo-assignment-select" data-import-select="${index}">${importSelectOptions(item)}</select>
          </label>
          <button class="photo-unclassified-btn${item.selectedKey==="unclassified:unclassified" ? " active" : ""}"
            type="button" data-import-unclassified="${index}">
            ${item.selectedKey==="unclassified:unclassified" ? "✓ Unclassified" : "Keep Unclassified"}
          </button>
        </div>
      </article>`;
    }).join("");
  }

  async function beginSmartPhotoImport(files) {
    clearPendingPhotoImports();
    const images = [...(files || [])].filter(f => f.type.startsWith("image/") || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name || ""));
    if (!images.length) return toast("Choose image files");
    toast(images.length === 1 ? "Reading photo time…" : `Reading ${images.length} photo times…`);
    for (const file of images) {
      const capture = await captureInfoForFile(file);
      const suggestions = photoSuggestions(capture);
      pendingPhotoImports.push({
        file,
        capture,
        suggestions,
        selectedKey: suggestions[0]
          ? assignmentKey(suggestions[0].type,suggestions[0].id)
          : assignmentKey("unclassified","unclassified"),
        previewUrl: URL.createObjectURL(file)
      });
    }
    renderPhotoImportReview();
    $("#photoImportDialog").showModal();
  }

  async function saveSmartPhotoAssignments() {
    if (!pendingPhotoImports.length) return;
    const saveItems = pendingPhotoImports.map((item,index) => {
      const select = $(`[data-import-select="${index}"]`);
      return {...item, selectedKey:select?.value || ""};
    }).filter(x=>x.selectedKey);
    if (!saveItems.length) return toast("Choose at least one assignment");
    $("#photoImportSave").disabled = true;
    toast(saveItems.length === 1 ? "Saving photo…" : `Saving ${saveItems.length} photos…`);
    try {
      for (const item of saveItems) {
        const target = assignmentFromKey(item.selectedKey);
        await storePhoto(target.type, target.id, item.file, {
          captureDate:item.capture.date,
          captureTime:item.capture.time,
          timestampSource:item.capture.source
        });
      }
      const skipped = pendingPhotoImports.length - saveItems.length;
      const unclassified = saveItems.filter(item => item.selectedKey === "unclassified:unclassified").length;
      closePhotoImportDialog();
      await renderGallery();
      if (skipped) {
        toast(`${saveItems.length} saved · ${skipped} skipped`);
      } else if (unclassified) {
        toast(`${saveItems.length} saved · ${unclassified} unclassified`);
      } else {
        toast(`${saveItems.length} photo${saveItems.length===1?"":"s"} assigned`);
      }
    } catch (err) {
      console.error(err);
      toast("Could not save all photos");
    } finally {
      const btn = $("#photoImportSave");
      if (btn) btn.disabled = false;
    }
  }

  function galleryOwnerDetails(photo) {
    if (photo.ownerType === "unclassified") {
      return {
        title: "Unclassified",
        meta: "Photos not assigned to a conference item",
        sortKey: "9999|unclassified"
      };
    }
    if (photo.ownerType === "poster") {
      const p = posterById.get(photo.ownerId);
      return {
        title: p ? `Poster #${p.number} · ${p.title}` : "Poster",
        meta: posterSessionMeta(p),
        sortKey: `${posterSessionFor(p)?.date || "9999-12-31"}|${posterSessionFor(p)?.start || "23:59"}|${String(p?.number || 999).padStart(3,"0")}`
      };
    }
    const e = byId.get(photo.ownerId);
    if (!e) return {title:"Programme item", meta:"", sortKey:"9999"};
    const room = e.locationId ? ` · ${locationLabel(e.locationId)}` : "";
    return {
      title: e.title,
      meta: `${e.weekday} ${e.dateLabel} · ${e.start}–${e.end}${room}`,
      sortKey: `${e.date}|${e.start}|${e.track || 0}`
    };
  }

  function clearGalleryObjectUrls() {
    galleryObjectUrls.forEach(url => URL.revokeObjectURL(url));
    galleryObjectUrls = [];
  }

  function clearModalPhotoObjectUrls() {
    modalPhotoObjectUrls.forEach(url => URL.revokeObjectURL(url));
    modalPhotoObjectUrls = [];
  }


  function escapeRegExp(value="") {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function highlightSearch(text, query) {
    const value = String(text || "");
    const q = String(query || "").trim();
    if (!q) return esc(value);
    const re = new RegExp(`(${escapeRegExp(q)})`, "ig");
    return value.split(re).map((part, index) =>
      index % 2 ? `<mark>${esc(part)}</mark>` : esc(part)
    ).join("");
  }

  function noteSnippet(text, query, maxLength=260) {
    const value = String(text || "").replace(/\s+/g, " ").trim();
    if (!value) return "";
    if (value.length <= maxLength) return value;

    const q = String(query || "").trim().toLowerCase();
    if (!q) return value.slice(0, maxLength).trimEnd() + "…";

    const hit = value.toLowerCase().indexOf(q);
    if (hit < 0) return value.slice(0, maxLength).trimEnd() + "…";

    const before = Math.floor((maxLength - q.length) * 0.42);
    let start = Math.max(0, hit - before);
    let end = Math.min(value.length, start + maxLength);
    if (end - start < maxLength) start = Math.max(0, end - maxLength);

    return `${start > 0 ? "…" : ""}${value.slice(start, end).trim()}${end < value.length ? "…" : ""}`;
  }

  function collectNoteEntries() {
    const entries = [];
    const notes = state.notes && typeof state.notes === "object" ? state.notes : {};

    for (const [key, rawNote] of Object.entries(notes)) {
      const note = String(rawNote || "").trim();
      if (!note) continue;

      const divider = key.indexOf(":");
      if (divider < 0) continue;
      const type = key.slice(0, divider);
      const id = key.slice(divider + 1);

      if (type === "event") {
        const e = byId.get(id);
        if (!e) continue;
        entries.push({
          type,
          id,
          title: e.title || "Presentation",
          person: e.speaker || "",
          affiliation: e.affiliation || "",
          note,
          meta: `${e.weekday} ${e.dateLabel} · ${e.start}–${e.end}${e.locationId ? ` · ${locationLabel(e.locationId)}` : ""}`,
          sortKey: `${e.date}|${e.start}|${String(e.track || 0).padStart(2,"0")}|${e.title || ""}`
        });
      } else if (type === "poster") {
        const p = posterById.get(id);
        if (!p) continue;
        entries.push({
          type,
          id,
          title: `Poster #${p.number} · ${p.title}`,
          person: p.author || "",
          affiliation: p.affiliation || "",
          note,
          meta: posterSessionMeta(p),
          sortKey: `${posterSessionFor(p)?.date || "9999-12-31"}|${posterSessionFor(p)?.start || "23:59"}|99|${String(p.number || 999).padStart(3,"0")}`
        });
      }
    }

    return entries.sort((a,b) => a.sortKey.localeCompare(b.sortKey));
  }

  function syncGalleryMode() {
    const mode = state.galleryMode === "notes" ? "notes" : "photos";
    state.galleryMode = mode;

    $$(".gallery-tab").forEach(btn => {
      const active = btn.dataset.galleryPanel === mode;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
    });

    const photosPanel = $("#galleryPhotosPanel");
    const notesPanel = $("#galleryNotesPanel");
    if (photosPanel) photosPanel.hidden = mode !== "photos";
    if (notesPanel) notesPanel.hidden = mode !== "notes";

    const count = $("#galleryCount");
    if (count) count.textContent = mode === "notes" ? galleryNoteCount : galleryPhotoCount;
  }

  function renderGalleryNotes() {
    const target = $("#galleryNotesContent");
    const meta = $("#galleryNotesMeta");
    const tabCount = $("#galleryNotesCount");
    if (!target || !meta || !tabCount) return;

    const allEntries = collectNoteEntries();
    galleryNoteCount = allEntries.length;
    tabCount.textContent = galleryNoteCount;

    const query = String(galleryNoteQuery || "").trim();
    const q = query.toLowerCase();
    const filtered = q ? allEntries.filter(entry =>
      [entry.title, entry.person, entry.affiliation, entry.note, entry.meta]
        .some(value => String(value || "").toLowerCase().includes(q))
    ) : allEntries;

    meta.innerHTML = query
      ? `<span>${filtered.length} result${filtered.length===1?"":"s"}</span><span>${galleryNoteCount} total notes</span>`
      : `<span>${galleryNoteCount} note${galleryNoteCount===1?"":"s"}</span><span>Tap a note to open its presentation</span>`;

    if (!filtered.length) {
      target.innerHTML = query
        ? `<div class="empty-state"><strong>No matching notes</strong>Try another word from your note, presentation title, speaker or author.</div>`
        : `<div class="empty-state"><strong>No notes yet</strong>Notes you write under talks and posters will appear here automatically.</div>`;
      syncGalleryMode();
      return;
    }

    target.innerHTML = filtered.map(entry => {
      const snippet = noteSnippet(entry.note, query);
      const person = entry.person ? `<div class="gallery-note-person">${highlightSearch(entry.person, query)}</div>` : "";
      return `<button class="gallery-note-card" type="button"
        data-note-owner-type="${esc(entry.type)}"
        data-note-owner-id="${esc(entry.id)}">
        <div class="gallery-note-meta">${highlightSearch(entry.meta, query)}</div>
        <div class="gallery-note-title">${highlightSearch(entry.title, query)}</div>
        ${person}
        <div class="gallery-note-text">${highlightSearch(snippet, query)}</div>
      </button>`;
    }).join("");

    syncGalleryMode();
  }

  async function renderGallery() {
    const target = $("#galleryContent");
    const count = $("#galleryCount");
    const meta = $("#galleryMeta");
    if (!target || !count || !meta) return;
    clearGalleryObjectUrls();
    target.innerHTML = `<div class="photo-loading">Loading gallery…</div>`;
    try {
      const allPhotos = await getAllPhotos();
      for (const photo of allPhotos) {
        if (!photo.thumbnailBlob) await ensurePhotoThumbnail(photo);
      }

      galleryPhotoCount = allPhotos.length;
      count.textContent = state.galleryMode === "notes" ? galleryNoteCount : galleryPhotoCount;

      const query = String(galleryPhotoQuery || "").trim();
      const q = query.toLowerCase();
      const photos = q ? allPhotos.filter(photo =>
        [photo.customTitle, photo.customNote]
          .some(value => String(value || "").toLowerCase().includes(q))
      ) : allPhotos;

      meta.innerHTML = query
        ? `<span>${photos.length} result${photos.length===1?"":"s"}</span><span>${galleryPhotoCount} total photos</span>`
        : `<span>${allPhotos.length} photo${allPhotos.length===1?"":"s"}</span><span>Stored locally on this device</span>`;

      renderGalleryNotes();

      if (!allPhotos.length) {
        target.innerHTML = `<div class="empty-state"><strong>No photos yet</strong>Import conference photos by time, or add them from an individual talk or poster.</div>`;
        syncGalleryMode();
        return;
      }

      if (!photos.length) {
        target.innerHTML = `<div class="empty-state"><strong>No matching photos</strong>Try another word from a photo title or photo note.</div>`;
        syncGalleryMode();
        return;
      }

      const groups = new Map();
      for (const photo of photos) {
        if (!groups.has(photo.ownerKey)) groups.set(photo.ownerKey, []);
        groups.get(photo.ownerKey).push(photo);
      }
      const ordered = [...groups.values()].sort((x,y) => galleryOwnerDetails(x[0]).sortKey.localeCompare(galleryOwnerDetails(y[0]).sortKey));
      target.innerHTML = ordered.map(group => {
        const first = group[0];
        const info = galleryOwnerDetails(first);
        const unclassifiedGroup = first.ownerType === "unclassified";
        const thumbs = group.map(photo => {
          const url = URL.createObjectURL(photo.thumbnailBlob || photo.blob);
          galleryObjectUrls.push(url);
          const stamp = photo.captureTime || "";
          const customTitle = String(photo.customTitle || "").trim();
          const customNote = String(photo.customNote || "").trim();
          const hasMeta = !!(customTitle || customNote || photo.ownerType === "unclassified");
          return `<div class="gallery-thumb-item${hasMeta ? " gallery-thumb-item-titled" : ""}">
            <button class="gallery-thumb" type="button" data-gallery-photo="${photo.id}" aria-label="Open photo${customTitle ? `: ${esc(customTitle)}` : ""}">
              <img src="${url}" alt="Conference photo thumbnail" loading="lazy">
              ${stamp ? `<span class="gallery-thumb-time">${esc(stamp)}</span>` : ""}
            </button>
            <button class="gallery-delete" type="button" data-gallery-delete="${photo.id}" aria-label="Delete photo">×</button>
            ${hasMeta ? `<div class="gallery-thumb-title">${highlightSearch(customTitle || (photo.ownerType === "unclassified" ? "Untitled photo" : "Photo"), query)}</div>` : ""}
            ${customNote ? `<div class="gallery-thumb-note">${highlightSearch(noteSnippet(customNote, query, 180), query)}</div>` : ""}
          </div>`;
        }).join("");
        return `<section class="gallery-group${unclassifiedGroup ? " gallery-group-unclassified" : ""}">
          <button class="gallery-group-head" type="button" data-gallery-owner-type="${esc(first.ownerType)}" data-gallery-owner-id="${esc(first.ownerId)}">
            <span class="gallery-group-copy"><strong>${esc(info.title)}</strong><small>${esc(unclassifiedGroup ? "Tap a photo to view it and edit its title or notes" : info.meta)}</small></span>
            <span class="gallery-group-count">${group.length}</span>
          </button>
          <div class="gallery-thumb-grid">${thumbs}</div>
        </section>`;
      }).join("");
      syncGalleryMode();
    } catch (err) {
      console.error(err);
      galleryPhotoCount = 0;
      count.textContent = state.galleryMode === "notes" ? galleryNoteCount : "0";
      target.innerHTML = `<div class="photo-empty">Could not load the gallery on this device.</div>`;
      renderGalleryNotes();
      syncGalleryMode();
    }
  }

  function photoSectionHtml() {
    return `<section class="photo-section">
      <div class="photo-section-head">
        <h3>Photos</h3>
      </div>
      <div class="photo-action-row">
        <button id="modalTakePhoto" class="primary-btn photo-action-btn" type="button">Take photo</button>
        <button id="modalAddPhotos" class="secondary-btn photo-action-btn" type="button">Add existing</button>
      </div>
      <p class="photo-section-note">Camera photos are attached directly to this presentation. The app also tries to save a normal image copy to your phone.</p>
      <div id="modalPhotos" class="photo-grid"><div class="photo-loading">Loading…</div></div>
    </section>`;
  }

  async function renderModalPhotos() {
    const target = $("#modalPhotos");
    if (!target || !currentModal) return;
    clearModalPhotoObjectUrls();
    target.innerHTML = `<div class="photo-loading">Loading…</div>`;
    try {
      const photos = await getPhotos(currentModal.type, currentModal.id);
      if (!photos.length) {
        target.innerHTML = `<div class="photo-empty">No photos attached yet.</div>`;
        return;
      }
      for (const photo of photos) {
        if (!photo.thumbnailBlob) await ensurePhotoThumbnail(photo);
      }
      target.innerHTML = photos.map(p => {
        const url = URL.createObjectURL(p.thumbnailBlob || p.blob);
        modalPhotoObjectUrls.push(url);
        return `<div class="photo-item">
          <button class="photo-thumb" type="button" data-photo-id="${p.id}" aria-label="Open photo">
            <img src="${url}" alt="Presentation photo thumbnail" loading="lazy">
          </button>
          <button class="photo-delete" type="button" data-photo-delete="${p.id}" aria-label="Delete photo">×</button>
        </div>`;
      }).join("");
    } catch {
      target.innerHTML = `<div class="photo-empty">Could not load photos on this device.</div>`;
    }
  }


  function photoOwnerTitle(type, id) {
    if (type === "poster") {
      const p = posterById.get(id);
      return p ? `Poster ${p.number} ${p.title}` : `${CONFERENCE.shortName || "Conference"} poster`;
    }
    const e = byId.get(id);
    return e?.title || `${CONFERENCE.shortName || "Conference"} presentation`;
  }

  function safePhotoFilenamePart(value, maxLength=72) {
    return String(value || "")
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, maxLength) || "presentation";
  }

  function imageExtension(file) {
    const fromName = String(file?.name || "").match(/\.([a-zA-Z0-9]{2,5})$/)?.[1];
    if (fromName) return fromName.toLowerCase();
    const mime = String(file?.type || "").toLowerCase();
    if (mime.includes("png")) return "png";
    if (mime.includes("webp")) return "webp";
    if (mime.includes("heic")) return "heic";
    if (mime.includes("heif")) return "heif";
    return "jpg";
  }

  function downloadCameraCopy(file, capture, type, id) {
    try {
      const title = safePhotoFilenamePart(photoOwnerTitle(type, id));
      const stamp = capture?.date && capture?.time
        ? `${capture.date}_${String(capture.time).replace(/:/g,"-")}`
        : new Date().toISOString().replace(/[:.]/g,"-").slice(0,19);
      const name = `${safePhotoFilenamePart(CONFERENCE.shortName || CONFERENCE.name || "conference")}_${stamp}_${title}.${imageExtension(file)}`;
      const url = URL.createObjectURL(file);
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      return true;
    } catch (err) {
      console.warn("Could not save camera copy to device", err);
      return false;
    }
  }

  async function addSelectedPhotos(files, options={}) {
    if (!currentModal || !files?.length) return;
    const images = [...files].filter(f => f.type.startsWith("image/"));
    if (!images.length) return toast("Choose image files");

    const owner = {type:currentModal.type, id:currentModal.id};
    toast(images.length === 1 ? "Adding photo…" : `Adding ${images.length} photos…`);

    try {
      let deviceCopies = 0;
      for (const file of images) {
        const capture = await captureInfoForFile(file);
        await storePhoto(owner.type, owner.id, file, {
          captureDate:capture.date,
          captureTime:capture.time,
          timestampSource:capture.source
        });

        if (options.saveDeviceCopy && downloadCameraCopy(file, capture, owner.type, owner.id)) {
          deviceCopies += 1;
        }
      }

      await renderModalPhotos();
      renderGallery();

      if (options.saveDeviceCopy && images.length === 1) {
        toast(deviceCopies ? "Photo added · phone copy requested" : "Photo added");
      } else if (options.saveDeviceCopy) {
        toast(deviceCopies
          ? `${images.length} photos added · phone copies requested`
          : `${images.length} photos added`);
      } else {
        toast(images.length === 1 ? "Photo added" : `${images.length} photos added`);
      }
    } catch (err) {
      console.error(err);
      toast("Could not save photo");
    }
  }

  function updatePhotoViewerControls() {
    const prev = $("#photoViewerPrev");
    const next = $("#photoViewerNext");
    const counter = $("#photoViewerCounter");
    const total = photoViewerIds.length;
    const current = photoViewerIndex + 1;

    prev.disabled = total <= 1 || photoViewerIndex <= 0;
    next.disabled = total <= 1 || photoViewerIndex < 0 || photoViewerIndex >= total - 1;
    prev.hidden = total <= 1;
    next.hidden = total <= 1;
    counter.textContent = total > 1 && current > 0 ? `${current} / ${total}` : "";
  }



  function photoViewerAssignmentOptions(photo) {
    const selectedKey = assignmentKey(photo.ownerType || "unclassified", photo.ownerId || "unclassified");
    const capture = {date:photo.captureDate || null, time:photo.captureTime || null};
    const suggestions = photoSuggestions(capture);
    const seen = new Set();
    const options = [];

    const add = (key, label) => {
      if (!key || seen.has(key)) return;
      seen.add(key);
      options.push({key, label});
    };

    add("unclassified:unclassified", "Unclassified — no programme assignment");

    if (photo.ownerType && photo.ownerType !== "unclassified") {
      add(selectedKey, `Current · ${assignmentLabel(photo.ownerType, photo.ownerId)}`);
    }

    for (const suggestion of suggestions) {
      const key = assignmentKey(suggestion.type, suggestion.id);
      add(key, `Suggested · ${assignmentLabel(suggestion.type, suggestion.id)}`);
    }

    if (capture.date) {
      const events = ITEMS
        .filter(e => e.date === capture.date && !["break","meal","poster-session"].includes(e.kind))
        .sort((a,b) => timeValue(a.start)-timeValue(b.start) || a.track-b.track);
      for (const e of events) {
        add(assignmentKey("event", e.id), assignmentLabel("event", e.id));
      }

      const activeSessionIds=new Set(activePosterSessions(capture).map(x=>x.id));
      if (activeSessionIds.size) {
        for (const id of state.posterFavorites) {
          const p = posterById.get(id);
          if (p&&activeSessionIds.has(p.posterSessionId)) add(assignmentKey("poster", p.id), assignmentLabel("poster", p.id));
        }
      }
    }

    return options.map(option =>
      `<option value="${esc(option.key)}" ${option.key===selectedKey ? "selected" : ""}>${esc(option.label)}</option>`
    ).join("");
  }

  function photoOwnerLabel(photo) {
    if (!photo) return "";
    if (photo.ownerType === "unclassified") return "Unclassified";
    if (photo.ownerType === "poster") {
      const p = posterById.get(photo.ownerId);
      return p ? `Poster #${p.number} · ${p.title}` : "Poster";
    }
    const e = byId.get(photo.ownerId);
    return e ? e.title : "Presentation";
  }

  async function showPhotoViewerPhoto(photoId) {
    const photo = await getPhoto(photoId);
    if (!photo) return false;

    const img = $("#photoViewerImage");
    const old = img.dataset.objectUrl;
    if (old) URL.revokeObjectURL(old);

    const url = URL.createObjectURL(photo.blob);
    img.src = url;
    img.dataset.objectUrl = url;

    const titleInput = $("#photoViewerTitle");
    const noteInput = $("#photoViewerNote");
    const assignmentInput = $("#photoViewerAssignment");
    const saveStatus = $("#photoViewerSaveStatus");
    const owner = $("#photoViewerOwner");
    titleInput.value = String(photo.customTitle || "");
    noteInput.value = String(photo.customNote || "");
    titleInput.dataset.photoId = String(photo.id);
    noteInput.dataset.photoId = String(photo.id);
    assignmentInput.dataset.photoId = String(photo.id);
    assignmentInput.innerHTML = photoViewerAssignmentOptions(photo);
    if (owner) owner.textContent = photoOwnerLabel(photo);
    if (saveStatus) saveStatus.textContent = "Saved automatically";

    updatePhotoViewerControls();
    return true;
  }

  async function openStoredPhoto(photoId, contextIds = null) {
    try {
      const normalizedId = String(photoId);
      const ids = Array.isArray(contextIds)
        ? [...new Set(contextIds.map(String))]
        : [normalizedId];

      if (!ids.includes(normalizedId)) ids.unshift(normalizedId);
      photoViewerIds = ids;
      photoViewerIndex = Math.max(0, photoViewerIds.indexOf(normalizedId));

      const shown = await showPhotoViewerPhoto(normalizedId);
      if (!shown) return;

      const viewer = $("#photoViewer");
      const detail = $("#detailModal");
      photoViewerReturnToDetail = !!detail?.open;
      photoViewerReturnFocus=document.activeElement;
      if (photoViewerReturnToDetail) detail.close();
      viewer.hidden = false;
      viewer.showModal();
      $("#photoViewerClose").focus();
      document.documentElement.classList.add("photo-viewer-open");
      document.body.classList.add("photo-viewer-open");
    } catch {
      toast("Could not open photo");
    }
  }

  async function movePhotoViewer(direction) {
    const nextIndex = photoViewerIndex + direction;
    if (nextIndex < 0 || nextIndex >= photoViewerIds.length) return;
    photoViewerIndex = nextIndex;
    try {
      await showPhotoViewerPhoto(photoViewerIds[photoViewerIndex]);
    } catch {
      toast("Could not open photo");
    }
  }

  function closePhotoViewer() {
    const dlg = $("#photoViewer");
    if(dlg.open)dlg.close();
    dlg.hidden = true;
    document.documentElement.classList.remove("photo-viewer-open");
    document.body.classList.remove("photo-viewer-open");

    const img = $("#photoViewerImage");
    const url = img.dataset.objectUrl;
    if (url) URL.revokeObjectURL(url);
    img.removeAttribute("src");
    delete img.dataset.objectUrl;

    const titleInput = $("#photoViewerTitle");
    const noteInput = $("#photoViewerNote");
    const assignmentInput = $("#photoViewerAssignment");
    const owner = $("#photoViewerOwner");
    titleInput.value = "";
    titleInput.dataset.photoId = "";
    noteInput.value = "";
    noteInput.dataset.photoId = "";
    assignmentInput.innerHTML = "";
    assignmentInput.dataset.photoId = "";
    if (owner) owner.textContent = "";

    photoViewerIds = [];
    photoViewerIndex = -1;
    if (photoViewerReturnToDetail && currentModal && !$("#detailModal").open) $("#detailModal").showModal();
    photoViewerReturnToDetail = false;
    updatePhotoViewerControls();
    if(photoViewerReturnFocus?.isConnected)photoViewerReturnFocus.focus();
    photoViewerReturnFocus=null;
  }

  function conferenceNowParts() {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: CONFERENCE.timezone || "UTC",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23"
    }).formatToParts(new Date());
    const get = t => parts.find(p => p.type === t)?.value || "";
    return {date:`${get("year")}-${get("month")}-${get("day")}`, time:`${get("hour")}:${get("minute")}`};
  }

  function detectConferenceDay() {
    const n = conferenceNowParts();
    const d = DAYS.find(x => x.date === n.date);
    return d ? d.day : 1;
  }

  function currentTimeTarget() {
    const now = conferenceNowParts();
    const day = DAYS.find(d => d.date === now.date);
    if (!day) return null;

    const minute = timeValue(now.time);
    const events = ITEMS
      .filter(e => e.day === day.day)
      .sort((a,b) => timeValue(a.start)-timeValue(b.start) || a.track-b.track);

    if (!events.length) return {day:day.day, start:null, mode:"none"};

    const current = events.filter(e =>
      timeValue(e.start) <= minute && minute < timeValue(e.end)
    );

    if (current.length) {
      const start = current.reduce(
        (earliest,e) => timeValue(e.start) < timeValue(earliest) ? e.start : earliest,
        current[0].start
      );
      return {day:day.day, start, mode:"current"};
    }

    const next = events.find(e => timeValue(e.start) > minute);
    if (next) return {day:day.day, start:next.start, mode:"next"};

    return {day:day.day, start:events.at(-1).start, mode:"last"};
  }

  function scrollToProgramSlot(start, mode="current") {
    if (!start) {
      window.scrollTo({top:0, behavior:"smooth"});
      return;
    }

    requestAnimationFrame(() => requestAnimationFrame(() => {
      const group = $(`#programList .time-group[data-start="${CSS.escape(start)}"]`);
      if (!group) return;

      $$("#programList .time-group.now-focus").forEach(el => el.classList.remove("now-focus"));
      group.classList.add("now-focus");
      group.scrollIntoView({behavior:"smooth", block:"center"});

      window.setTimeout(() => group.classList.remove("now-focus"), 1800);

      if (mode === "next") toast(`Next programme slot · ${start}`);
      else if (mode === "last") toast(`Last programme slot · ${start}`);
    }));
  }

  function jumpToNow() {
    const target = currentTimeTarget();

    // Outside conference dates, preserve the old behavior of taking the user
    // to the closest/default conference day rather than failing silently.
    const day = target?.day || detectConferenceDay();

    // Current-time navigation should never be hidden by a search or room filter.
    const search = $("#programSearch");
    if (search) search.value = "";
    state.locationId = "all";
    state.day = day;
    saveState();

    renderDays();
    renderProgram();
    showView("program");

    if (target?.start) scrollToProgramSlot(target.start, target.mode);
    else window.scrollTo({top:0, behavior:"smooth"});
  }

  function applyTheme() {
    const dark = state.theme === "dark" ||
      (state.theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    const root=document.documentElement,theme=dark?"dark":"light";
    root.dataset.theme = theme;
    document.documentElement.classList.toggle("compact", !!state.compact);
    document.querySelector('meta[name="theme-color"]').setAttribute("content", dark ? "#000000" : "#f3f4f6");
    const headerColor=BRANDING[dark?'headerBackgroundDark':'headerBackgroundLight']||(dark?'#191a1d':'#ffffff');
    root.style.setProperty('--header-background',headerColor);
    root.style.setProperty('--header-text',contrastRatioFor(headerColor,'#ffffff')>=contrastRatioFor(headerColor,'#111111')?'#ffffff':'#111111');
    const accent=BRANDING.accent||BRANDING.primary||'#5b4b9a',surface=dark?'#111216':'#ffffff',fallbackForeground=dark?'#ffffff':'#111111';
    root.style.setProperty('--on-accent',contrastRatioFor(accent,'#ffffff')>=contrastRatioFor(accent,'#111111')?'#ffffff':'#111111');
    root.style.setProperty('--accent-text',contrastRatioFor(accent,surface)>=4.5?accent:fallbackForeground);
    const lightLogo=BRANDING.logoLight||BRANDING.logo,darkLogo=BRANDING.logoDark||BRANDING.logo;
    const logo= document.querySelector('.conference-logo'),fallbackLogo=document.querySelector('.conference-logo-fallback');
    const source=dark?darkLogo:lightLogo,mode=root.dataset.headerStyle||'combined';
    if(logo){if(source){const url=packageAssetUrl(source);if(logo.getAttribute('src')!==url)logo.src=url;logo.hidden=mode==='text';}else logo.hidden=true;}
    if(fallbackLogo)fallbackLogo.hidden=mode==='logo'&&!!source;
    const sponsors=[...document.querySelectorAll('.sponsor-grid img[data-light],.sponsor-grid img[data-dark]')];
    for(const image of sponsors){const preferred=dark?image.dataset.dark:image.dataset.light;const selected=preferred||image.dataset.light||image.dataset.dark;if(selected&&image.getAttribute('src')!==selected)image.src=selected;}
  }
  function contrastRatioFor(a,b){const lum=x=>{const m=/^#([\da-f]{6})$/i.exec(x||'');if(!m)return 0;const c=[0,2,4].map(i=>parseInt(m[1].slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return .2126*c[0]+.7152*c[1]+.0722*c[2];};const x=lum(a),y=lum(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05);}

  function timeValue(t) {
    const [h,m] = t.split(":").map(Number);
    return h*60+m;
  }

  function zonedLocalDate(date, time, timeZone) {
    const [y,m,d] = date.split("-").map(Number);
    const [hh,mm] = time.split(":").map(Number);
    let guess = new Date(Date.UTC(y,m-1,d,hh,mm));
    for (let i=0;i<2;i++) {
      const parts = new Intl.DateTimeFormat("en-CA", {timeZone, year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(guess);
      const get=t=>Number(parts.find(p=>p.type===t)?.value||0);
      const shown = Date.UTC(get("year"),get("month")-1,get("day"),get("hour"),get("minute"));
      const wanted = Date.UTC(y,m-1,d,hh,mm);
      guess = new Date(guess.getTime() + (wanted-shown));
    }
    return guess;
  }

  function fmtTime(event, which="start") {
    const raw = event[which];
    if (state.timeMode === "conference" || !raw) return raw;
    const dt = zonedLocalDate(event.date, raw, CONFERENCE.timezone || "UTC");
    return new Intl.DateTimeFormat(undefined, {hour:"2-digit", minute:"2-digit"}).format(dt);
  }

  function eventTimeLabel(event) {
    return `${fmtTime(event,"start")}–${fmtTime(event,"end")}`;
  }

  function renderDays() {
    $("#dayTabs").innerHTML = DAYS.map(d => `
      <button class="day-tab ${state.day===d.day?"active":""}" data-day="${d.day}">
        <strong>${esc(d.weekday.slice(0,3))}</strong>
        <span>${esc(d.dateLabel)}</span>
      </button>`).join("");
    $$(".day-tab").forEach(btn => btn.addEventListener("click", () => {
      state.day = Number(btn.dataset.day);
      saveState();
      renderDays();
      renderProgram();
      window.scrollTo({top:0, behavior:"smooth"});
    }));
  }

  function searchTextEvent(e) {
    return [e.title,e.speaker,e.affiliation,e.session,e.chair,e.locationId,locationLabel(e.locationId),e.trackName,e.abstract,...(e.keywords||[])].filter(Boolean).join(" ").toLowerCase();
  }

  function statusForSelectedDay() {
    if (!DAYS.length) return {title:"No programme available", sub:"The conference programme has not been added yet."};
    const now = conferenceNowParts();
    const day = DAYS.find(d => d.day === state.day);
    const events = ITEMS.filter(e => e.day===state.day).sort((a,b)=>timeValue(a.start)-timeValue(b.start));
    const first = events[0];
    const last = events.reduce((a,b)=>timeValue(a.end)>timeValue(b.end)?a:b, events[0]);

    if (now.date < DAYS[0].date) {
      return {title:`Conference starts ${DAYS[0].weekday}`, sub:`First item ${DAYS[0].dateLabel} at ${first.start} · ${CONFERENCE.timezoneLabel || "Conference time"}`};
    }
    if (now.date > DAYS.at(-1).date) {
      return {title:"Conference finished", sub:"Your starred talks and posters remain saved on this device."};
    }
    if (day.date !== now.date) {
      return {title:`${day.weekday}, ${day.dateLabel}`, sub:`${events.length} program items · ${first.start}–${last.end} · ${CONFERENCE.city || "Conference"}`};
    }
    const minute = timeValue(now.time);
    const current = events.filter(e => timeValue(e.start) <= minute && minute < timeValue(e.end));
    if (current.length) {
      const names = current.map(e => e.title).join(" · ");
      return {title:"Happening now", sub:names};
    }
    const next = events.find(e => timeValue(e.start) > minute);
    if (next) return {title:`Next at ${fmtTime(next,"start")}`, sub:next.title};
    return {title:"Program finished for today", sub:`Last scheduled item ended at ${last.end}.`};
  }

  function renderStatus() {
    const s = statusForSelectedDay();
    const today = DAYS.some(d => d.date === conferenceNowParts().date);
    $("#statusCard").classList.toggle("status-clickable", today);
    $("#statusCard").setAttribute("role", today ? "button" : "status");
    $("#statusCard").setAttribute("tabindex", today ? "0" : "-1");
    $("#statusCard").setAttribute("aria-label", today ? `${s.title}. Jump to current programme slot.` : s.title);
    $("#statusCard").innerHTML = `<div class="status-line"><span class="status-dot"></span><div><div class="status-title">${esc(s.title)}</div><div class="status-sub">${esc(s.sub)}</div></div>${today?`<span class="status-jump">›</span>`:""}</div>`;
  }

  function locationRow(id) { return id ? LOCATIONS[id] || null : null; }
  function locationLabel(id) { return locationRow(id)?.name || id || ""; }
  function locationColor(id) { return BRANDING.locationColors?.[id] || ""; }
  function trackColor(id) { return BRANDING.trackColors?.[id] || ""; }
  function eventAccent(e) { return locationColor(e.locationId) || trackColor(e.trackId) || ""; }
  function locationPill(locationId) {
    if (!locationId) return "";
    const color = locationColor(locationId);
    return `<span class="pill" ${color?`style="color:${esc(color)};border-color:${esc(color)}55"`:""}>${esc(locationLabel(locationId))}</span>`;
  }

  function eventCard(e, conflict=false) {
    const fav = state.favorites.includes(e.id);
    const session = e.session ? `<span class="pill">${esc(e.session)}</span>` : "";
    const person = e.speaker ? `${esc(e.speaker)}${e.affiliation ? ` · ${esc(e.affiliation)}` : ""}` : "";
    const accent = eventAccent(e);
    return `
      <article class="event-card kind-${esc(e.kind)}" ${accent&&["talk","plenary","special"].includes(e.kind)?`style="border-left-color:${esc(accent)}"`:""} data-event="${e.id}" tabindex="0">
        <button class="star-btn ${fav?"on":""}" data-star-event="${e.id}" aria-label="${fav?"Remove from":"Add to"} my schedule">${fav?"★":"☆"}</button>
        <div class="card-kicker">${locationPill(e.locationId)}${session}</div>
        <div class="event-title">${esc(e.title)}</div>
        ${person?`<div class="event-person">${person}</div>`:""}
        ${conflict?`<div class="conflict-note">Overlaps another starred item</div>`:""}
      </article>`;
  }

  function bindEventCards(scope=document) {
    scope.querySelectorAll("[data-event]").forEach(card => {
      const open = () => openEvent(card.dataset.event);
      card.addEventListener("click", (ev) => {
        if (ev.target.closest("[data-star-event]")) return;
        open();
      });
      card.addEventListener("keydown", (ev) => {
        if ((ev.key==="Enter" || ev.key===" ") && !ev.target.closest("button")) { ev.preventDefault(); open(); }
      });
    });
    scope.querySelectorAll("[data-star-event]").forEach(btn => {
      btn.addEventListener("click", ev => {
        ev.stopPropagation();
        toggleEventFavorite(btn.dataset.starEvent);
      });
    });
  }

  function renderAnnouncements() {
    const panel=$("#announcementPanel");if(!panel)return;
    const rows=CONFIG.programme?.announcements || [];
    panel.hidden=!rows.length;
    panel.innerHTML=rows.map((a,i)=>`<div class="announcement-card"><strong>${esc(a.timestamp ? new Date(a.timestamp).toLocaleString(CONFERENCE.locale||"en-GB") : "Conference update")}</strong><p>${esc(a.message||"")}</p>${(a.affectedIds||[]).some(id=>byId.has(id))?`<button class="secondary-btn" type="button" data-announcement-open="${esc((a.affectedIds||[]).find(id=>byId.has(id)))}">Open affected item</button>`:""}</div>`).join("");
    panel.querySelectorAll("[data-announcement-open]").forEach(btn=>btn.addEventListener("click",()=>openEvent(btn.dataset.announcementOpen)));
  }

  function renderProgram() {
    renderStatus();
    const q = $("#programSearch").value.trim().toLowerCase();
    let events = ITEMS.filter(e => q ? searchTextEvent(e).includes(q) : e.day===state.day);
    if (state.locationId !== "all") events = events.filter(e => !e.locationId || e.locationId.toLowerCase()===state.locationId);
    if (state.track !== "all") events = events.filter(e => (e.trackId || "common")===state.track);
    events.sort((a,b) => a.date.localeCompare(b.date) || timeValue(a.start)-timeValue(b.start) || a.track-b.track);

    $("#programMeta").innerHTML = `<span>${q ? `${events.length} search results` : `${events.length} program items`}</span><span>${esc(state.timeMode==="conference"?(CONFERENCE.timezoneLabel || "Conference time"):"Device time")}</span>`;

    if (!events.length) {
      $("#programList").innerHTML = `<div class="empty-state"><strong>No matches</strong>Try another search or room filter.</div>`;
      return;
    }

    const groups = new Map();
    events.forEach(e => {
      const key = q ? `${e.date}|${e.start}` : e.start;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(e);
    });

    $("#programList").innerHTML = [...groups.entries()].map(([key,items]) => {
      const first = items[0];
      const dayPrefix = q ? `<small>${esc(first.weekday.slice(0,3))} ${esc(first.dateLabel)}</small>` : "";
      const endTimes = [...new Set(items.map(x => fmtTime(x,"end")))];
      const span = endTimes.length===1 ? endTimes[0] : "";
      const common = items.some(x => x.track===0);
      return `<div class="time-group" data-start="${esc(first.start)}">
        <div class="time-label">${esc(fmtTime(first,"start"))}${span?`<small>to ${esc(span)}</small>`:""}${dayPrefix}</div>
        <div class="event-grid ${common||items.length===1?"single":""}">
          ${items.map(e=>eventCard(e)).join("")}
        </div>
      </div>`;
    }).join("");
    bindEventCards($("#programList"));
  }

  function intervalsOverlap(a,b) {
    return a.day===b.day && timeValue(a.start) < timeValue(b.end) && timeValue(b.start) < timeValue(a.end);
  }

  function posterSessionMeta(posterOrSession) {
    const session=posterOrSession?.type==="poster-session"?posterOrSession:posterSessionFor(posterOrSession);
    if (!session) return "Poster session not assigned";
    const day = DAYS.find(d=>d.date===session.date);
    const loc = locationRow(session.locationId);
    return `${session.title || "Poster session"} · ${day?.weekday || session.date} ${day?.dateLabel || ""} · ${session.start}–${session.end}${loc?` · ${loc.name}`:""}`;
  }

  function renderMySchedule() {
    const favEvents = state.favorites.map(id=>byId.get(id)).filter(Boolean).sort((a,b)=>a.date.localeCompare(b.date)||timeValue(a.start)-timeValue(b.start));
    const favPosters = state.posterFavorites.map(id=>posterById.get(id)).filter(Boolean).sort((a,b)=>`${posterSessionFor(a)?.date}|${posterSessionFor(a)?.start}|${a.number}`.localeCompare(`${posterSessionFor(b)?.date}|${posterSessionFor(b)?.start}|${b.number}`));
    $("#favoriteCount").textContent = favEvents.length + favPosters.length;

    if (!favEvents.length && !favPosters.length) {
      $("#mySchedule").innerHTML = `<div class="empty-state"><strong>Nothing starred yet</strong>Tap ☆ on talks or posters to build a personal agenda.</div>`;
      return;
    }

    const conflictIds = new Set();
    for (let i=0;i<favEvents.length;i++) for (let j=i+1;j<favEvents.length;j++) {
      if (intervalsOverlap(favEvents[i],favEvents[j])) { conflictIds.add(favEvents[i].id); conflictIds.add(favEvents[j].id); }
    }

    const byDay = new Map();
    favEvents.forEach(e => {
      if (!byDay.has(e.day)) byDay.set(e.day,[]);
      byDay.get(e.day).push(e);
    });

    let html = [...byDay.entries()].map(([day,items]) => {
      const meta = DAYS.find(d=>d.day===day);
      return `<section class="my-day">
        <div class="my-day-head">${esc(meta.weekday)} · ${esc(meta.dateLabel)}</div>
        <div class="timeline">
          ${items.map(e=>`<div class="time-group"><div class="time-label">${esc(fmtTime(e,"start"))}<small>to ${esc(fmtTime(e,"end"))}</small></div><div class="event-grid single">${eventCard(e,conflictIds.has(e.id))}</div></div>`).join("")}
        </div>
      </section>`;
    }).join("");

    if (favPosters.length) {
      const groups=new Map();for(const p of favPosters){const id=p.posterSessionId||"unassigned";if(!groups.has(id))groups.set(id,[]);groups.get(id).push(p);}
      html += [...groups.values()].map(posters=>`<section class="my-day"><div class="my-day-head">Starred posters · ${esc(posterSessionMeta(posters[0]))}</div><div class="poster-list">${posters.map(p=>posterCard(p)).join("")}</div></section>`).join("");
    }
    $("#mySchedule").innerHTML = html;
    bindEventCards($("#mySchedule"));
    bindPosterCards($("#mySchedule"));
  }

  function posterSearchText(p) {
    const session=posterSessionFor(p);
    return [p.number,p.title,p.author,p.affiliation,p.category,p.presentingAuthor,p.correspondingAuthor,p.abstract,session?.title,session?.date,locationLabel(session?.locationId)].filter(Boolean).join(" ").toLowerCase();
  }

  function posterCard(p) {
    const fav = state.posterFavorites.includes(p.id);
    return `<article class="poster-card" data-poster="${p.id}" tabindex="0">
      <button class="star-btn ${fav?"on":""}" data-star-poster="${p.id}" aria-label="${fav?"Remove from":"Add to"} starred posters">${fav?"★":"☆"}</button>
      <div class="poster-top"><span class="poster-number">#${p.number}</span><span class="pill">${esc(p.category)}</span></div>
      <div class="poster-title">${esc(p.title)}</div>
      <div class="poster-author">${esc(p.author)}${p.affiliation?` · ${esc(p.affiliation)}`:""}</div>
      <div class="poster-session-line">${esc(posterSessionMeta(p))}</div>
    </article>`;
  }

  function bindPosterCards(scope=document) {
    scope.querySelectorAll("[data-poster]").forEach(card => {
      const open = () => openPoster(card.dataset.poster);
      card.addEventListener("click", ev => {
        if (ev.target.closest("[data-star-poster]")) return;
        open();
      });
      card.addEventListener("keydown", ev => {
        if ((ev.key==="Enter"||ev.key===" ") && !ev.target.closest("button")) { ev.preventDefault(); open(); }
      });
    });
    scope.querySelectorAll("[data-star-poster]").forEach(btn => {
      btn.addEventListener("click", ev => {
        ev.stopPropagation();
        togglePosterFavorite(btn.dataset.starPoster);
      });
    });
  }

  function renderPosters() {
    if (!CONFERENCE.features?.posters || !POSTERS.length) return;
    const q = $("#posterSearch").value.trim().toLowerCase();
    let posters = POSTERS.filter(p => !q || posterSearchText(p).includes(q));
    if (state.posterCategory !== "all") posters = posters.filter(p => p.category===state.posterCategory);
    $("#posterMeta").innerHTML = `<span>${posters.length} posters</span><span>${state.posterFavorites.length} starred</span>`;
    const groups=new Map();for(const p of posters){const id=p.posterSessionId||"unassigned";if(!groups.has(id))groups.set(id,[]);groups.get(id).push(p);}
    $("#posterList").innerHTML = posters.length ? [...groups.values()].map(rows=>`<section class="poster-session-group"><h3>${esc(posterSessionMeta(rows[0]))}</h3><div class="poster-list">${rows.map(p=>posterCard(p)).join("")}</div></section>`).join("") :
      `<div class="empty-state"><strong>No matches</strong>Try another search or category.</div>`;
    bindPosterCards($("#posterList"));
  }

  function toggleEventFavorite(id) {
    state.favorites = state.favorites.includes(id) ? state.favorites.filter(x=>x!==id) : [...state.favorites,id];
    saveState(); renderProgram(); renderMySchedule();
    if (currentModal?.type==="event" && currentModal.id===id) refreshModalStar();
  }

  function togglePosterFavorite(id) {
    state.posterFavorites = state.posterFavorites.includes(id) ? state.posterFavorites.filter(x=>x!==id) : [...state.posterFavorites,id];
    saveState(); renderPosters(); renderMySchedule();
    if (currentModal?.type==="poster" && currentModal.id===id) refreshModalStar();
  }

  function refreshModalStar() {
    const on = currentModal?.type==="event"
      ? state.favorites.includes(currentModal.id)
      : state.posterFavorites.includes(currentModal.id);
    $("#modalStar").classList.toggle("on",on);
    $("#modalStar").textContent = on ? "★" : "☆";
  }

  function resolvedVenue(locationId) {
    let loc=locationRow(locationId);
    if (!loc) return null;
    const room = loc.type === "room" ? loc : null;
    let venue=loc;
    if (room?.parentLocationId) venue=locationRow(room.parentLocationId) || room;
    return {room, venue, name:venue.name, address:venue.address || "", maps:venue.mapUrl || ""};
  }

  function venueForEvent(e) {
    return resolvedVenue(e.locationId || CONFERENCE.mainVenueId);
  }

  function venueBoxHtml(resolved, room="") {
    if (!resolved) return "";
    const roomName = resolved.room?.name || (room ? locationLabel(room) : "");
    const strongText = roomName ? `${roomName} · ${resolved.venue.name}` : resolved.venue.name;
    const body = `<span>Venue</span><strong>${esc(strongText)}</strong><small>${esc(resolved.venue.address || "")}${resolved.venue.mapUrl?" · Open Maps ↗":""}</small>`;
    const mapUrl=normalizeWebUrl(resolved.venue.mapUrl);
    return mapUrl ? `<a class="detail-box detail-link" href="${esc(mapUrl)}" target="_blank" rel="noopener noreferrer">${body}</a>` : `<div class="detail-box">${body}</div>`;
  }

  function openEvent(id) {
    const e = byId.get(id); if (!e) return;
    currentModal = {type:"event",id};
    const speakerPhoto=e.speakers?.find(person=>person?.photoUrl)?.photoUrl || "";
    $("#modalContent").innerHTML = `
      <div class="modal-kicker">${locationPill(e.locationId)}${e.session?`<span class="pill">${esc(e.session)}</span>`:""}<span class="pill">${esc(e.weekday)} ${esc(e.dateLabel)}</span></div>
      <div class="modal-title">${esc(e.title)}</div>
      ${speakerPhoto?`<img class="modal-speaker-photo" src="${esc(packageAssetUrl(speakerPhoto))}" alt="${esc(e.speaker||'Speaker')}">`:""}
      ${e.speaker?`<div class="modal-person">${esc(e.speaker)}</div>`:""}
      ${e.affiliation?`<div class="modal-aff">${esc(e.affiliation)}</div>`:""}
      <div class="modal-details">
        <div class="detail-box"><span>Time</span><strong>${esc(eventTimeLabel(e))}</strong></div>
        ${venueBoxHtml(venueForEvent(e), e.locationId || "")}
        ${e.chair?`<div class="detail-box"><span>Session chair</span><strong>${esc(e.chair)}</strong></div>`:""}
        ${e.sourcePage?`<div class="detail-box"><span>Programme</span><strong>PDF page ${e.sourcePage}</strong></div>`:""}
      </div>
      ${CONFERENCE.features?.calendarExport && e.calendarUid?`<button id="modalCalendarBtn" class="secondary-btn calendar-inline-btn" type="button">Add to calendar</button>`:""}
      ${noteSectionHtml("event", e.id)}
      ${photoSectionHtml()}
      ${e.sourcePage && normalizeWebUrl(CONFERENCE.programmePdf,{allowRelative:true})?`<a class="pdf-link" href="${esc(normalizeWebUrl(CONFERENCE.programmePdf,{allowRelative:true}))}#page=${e.sourcePage}" target="_blank" rel="noopener noreferrer">Open this page in the PDF ↗</a>`:""}`;
    refreshModalStar();
    $("#detailModal").showModal();
    renderModalPhotos();
  }

  function openPoster(id) {
    const p = posterById.get(id); if (!p) return;
    currentModal = {type:"poster",id};
    const abstractHtml = (p.abstract || "").split(/\n\s*\n/).filter(Boolean).map(x=>`<p>${esc(x)}</p>`).join("");
    $("#modalContent").innerHTML = `
      <div class="modal-kicker"><span class="pill">Poster #${p.number}</span><span class="pill">${esc(p.category)}</span><span class="pill">Abstract p. ${p.abstractBookPage}</span></div>
      <div class="modal-title">${esc(p.title)}</div>
      <div class="modal-person">${esc(p.author)}</div>
      <div class="modal-aff">${esc(p.affiliation)}</div>
      <div class="modal-details">
        <div class="detail-box"><span>Session</span><strong>${esc(posterSessionMeta(p))}</strong></div>
        ${venueBoxHtml(resolvedVenue(posterSessionFor(p)?.locationId))}
        <div class="detail-box"><span>Presenting author</span><strong>${esc(p.presentingAuthor || p.author || "—")}</strong></div>
        <div class="detail-box"><span>Corresponding author</span><strong>${esc(p.correspondingAuthor || "—")}</strong></div>
        ${p.sourcePage?`<div class="detail-box"><span>Programme</span><strong>PDF page ${p.sourcePage}</strong></div>`:""}
        <div class="detail-box"><span>Book of Abstracts</span><strong>Page ${p.abstractBookPage}</strong></div>
      </div>
      ${noteSectionHtml("poster", p.id)}
      ${photoSectionHtml()}
      ${p.abstract ? `<section class="abstract-section"><h3>Abstract</h3><div class="abstract-text">${abstractHtml}</div></section>` : ""}
      ${p.sourcePage && normalizeWebUrl(CONFERENCE.programmePdf,{allowRelative:true})?`<a class="pdf-link" href="${esc(normalizeWebUrl(CONFERENCE.programmePdf,{allowRelative:true}))}#page=${p.sourcePage}" target="_blank" rel="noopener noreferrer">Open this poster in the programme PDF ↗</a>`:""}`;
    refreshModalStar();
    $("#detailModal").showModal();
    renderModalPhotos();
  }

  function showView(name) {
    if(name!=="friends"&&qrScanner)stopFriendQrScan();
    state.view = name; saveState();
    $$(".view").forEach(v => v.classList.toggle("active",v.dataset.view===name));
    $$(".nav-btn").forEach(b => b.classList.toggle("active",b.dataset.target===name));
    if (name==="my") renderMySchedule();
    if (name==="gallery") renderGallery();
    if (name==="posters") renderPosters();
    if (name==="friends") renderFriendBook();
    window.scrollTo({top:0,behavior:"smooth"});
  }

  function toast(msg) {
    const t=$("#toast"); t.textContent=msg; t.classList.add("show");
    clearTimeout(toast._t); toast._t=setTimeout(()=>t.classList.remove("show"),1800);
  }


  function xmlEsc(v="") {
    return String(v).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
  }

  function safeFilenamePart(v="") {
    return String(v).replace(/[^a-z0-9]+/gi,"-").replace(/^-+|-+$/g,"").slice(0,42) || "conference";
  }

  function emu(inches) {
    return Math.round(inches * 914400);
  }

  function textToParagraphs(text, fontSize=1400, bold=false, color="1f2937") {
    const lines = String(text || "").replace(/\r\n/g,"\n").replace(/\r/g,"\n").split("\n");
    const safeLines = lines.length ? lines : [""];
    return safeLines.map(line => `<a:p><a:r><a:rPr lang="en-US" sz="${fontSize}" ${bold?'b="1" ':""}><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:rPr><a:t>${xmlEsc(line || " ")}</a:t></a:r><a:endParaRPr lang="en-US" sz="${fontSize}"/></a:p>`).join("");
  }

  function pptTextShape(shapeId, name, x, y, w, h, text, opts={}) {
    const fontSize = opts.fontSize || 1400;
    const bold = !!opts.bold;
    const color = opts.color || "1f2937";
    const fill = opts.fill ? `<a:solidFill><a:srgbClr val="${opts.fill}"/></a:solidFill>` : `<a:noFill/>`;
    const line = opts.line ? `<a:ln><a:solidFill><a:srgbClr val="${opts.line}"/></a:solidFill></a:ln>` : `<a:ln><a:noFill/></a:ln>`;
    return `<p:sp><p:nvSpPr><p:cNvPr id="${shapeId}" name="${xmlEsc(name)}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${emu(x)}" y="${emu(y)}"/><a:ext cx="${emu(w)}" cy="${emu(h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${fill}${line}</p:spPr><p:txBody><a:bodyPr wrap="square" lIns="91440" tIns="68580" rIns="91440" bIns="68580" anchor="t"/><a:lstStyle/>${textToParagraphs(text,fontSize,bold,color)}</p:txBody></p:sp>`;
  }

  function pptPicture(picId, relId, x, y, w, h, name="Photo") {
    return `<p:pic><p:nvPicPr><p:cNvPr id="${picId}" name="${xmlEsc(name)}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${emu(x)}" y="${emu(y)}"/><a:ext cx="${emu(w)}" cy="${emu(h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:ln><a:solidFill><a:srgbClr val="d1d5db"/></a:solidFill></a:ln></p:spPr></p:pic>`;
  }

  function fitInBox(imgW, imgH, x, y, w, h) {
    const ratio = Math.min(w / imgW, h / imgH);
    const outW = imgW * ratio;
    const outH = imgH * ratio;
    return {x:x+(w-outW)/2, y:y+(h-outH)/2, w:outW, h:outH};
  }

  function photoChronoKey(photo) {
    const date = String(photo?.captureDate || "9999-12-31");
    const time = String(photo?.captureTime || "23:59:59");
    const added = String(photo?.addedAt || 0).padStart(16,"0");
    const id = String(photo?.id || "").padStart(10,"0");
    return `${date}|${time}|${added}|${id}`;
  }

  function ownerInfoForExport(type, id) {
    if (type === "unclassified") {
      return {title:"Unclassified photos", meta:"Photos not assigned to a conference item", sortKey:"9999-12-31|23:59:59|9|unclassified"};
    }
    if (type === "poster") {
      const p = posterById.get(id);
      if (!p) return {title:"Poster", meta:"Poster session", sortKey:"9999-12-31|23:59:59|8|poster"};
      return {
        title:`Poster #${p.number} · ${p.title}`,
        meta:`${posterSessionMeta(p)}${p.author ? ` · ${p.author}` : ""}`,
        sortKey:`${posterSessionFor(p)?.date || "9999-12-31"}|${posterSessionFor(p)?.start || "23:59"}:00|1|${String(p.number || 999).padStart(3,"0")}`
      };
    }
    const e = byId.get(id);
    if (!e) return {title:"Programme item", meta:"", sortKey:"9999-12-31|23:59:59|8|event"};
    const person = e.speaker ? ` · ${e.speaker}` : "";
    const room = e.locationId ? ` · ${locationLabel(e.locationId)}` : "";
    return {
      title:e.title,
      meta:`${e.weekday} ${e.dateLabel} · ${e.start}–${e.end}${room}${person}`,
      sortKey:`${e.date}|${e.start}:00|0|${String(e.track || 0).padStart(2,"0")}|${e.id}`
    };
  }

  function parseOwnerKey(key) {
    const idx = String(key).indexOf(":");
    if (idx < 0) return {type:"event", id:key};
    return {type:key.slice(0,idx), id:key.slice(idx+1)};
  }

  async function collectNotesPhotosForPptx() {
    const map = new Map();
    const ensure = (type, id) => {
      const key = photoOwnerKey(type,id);
      if (!map.has(key)) {
        const info = ownerInfoForExport(type,id);
        map.set(key, {key, type, id, info, note:getNote(type,id), photos:[]});
      }
      return map.get(key);
    };

    for (const [key,value] of Object.entries(state.notes || {})) {
      if (!String(value || "").trim()) continue;
      const {type,id} = parseOwnerKey(key);
      ensure(type,id).note = String(value || "");
    }

    const photos = await getAllPhotos();
    for (const photo of photos) {
      if ((photo.ownerType || "") === "unclassified") {
        const title = String(photo.customTitle || "").trim() || "Unclassified photo";
        const stamp = [photo.captureDate, photo.captureTime].filter(Boolean).join(" · ");
        const key = `unclassified-photo:${photo.id}`;
        map.set(key, {
          key,
          type:"unclassified",
          id:String(photo.id),
          info:{
            title,
            meta: stamp ? `${stamp} · Unclassified` : "Unclassified photo",
            sortKey:`${String(photo.captureDate || "9999-12-31")}|${String(photo.captureTime || "23:59:59")}|2|unclassified|${String(photo.id).padStart(8,"0")}`
          },
          note:"",
          photos:[photo]
        });
      } else {
        ensure(photo.ownerType || "event", photo.ownerId || "").photos.push(photo);
      }
    }

    return [...map.values()]
      .filter(item => String(item.note || "").trim() || item.photos.length)
      .map(item => ({
        ...item,
        // Keep all photos attached to their topic, but order photos inside that
        // topic chronologically by the photo capture time.
        photos:[...item.photos].sort((a,b)=>photoChronoKey(a).localeCompare(photoChronoKey(b)))
      }))
      .sort((a,b)=>a.info.sortKey.localeCompare(b.info.sortKey));
  }

  async function imageBlobForPptx(photo) {
    const source = photo.blob || photo.thumbnailBlob;
    if (!source) throw new Error("Missing image blob");
    const bitmap = await createImageBitmap(source);
    const maxSide = 1600;
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0,0,width,height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    const blob = await new Promise((resolve, reject) => canvas.toBlob(
      out => out ? resolve(out) : reject(new Error("Could not prepare image for PowerPoint")),
      "image/jpeg", 0.86
    ));
    return {blob, width, height};
  }

  async function blobToU8(blob) {
    return new Uint8Array(await blob.arrayBuffer());
  }

  function strToU8(text) {
    return new TextEncoder().encode(text);
  }

  function crc32(data) {
    if (!crc32.table) {
      const table = new Uint32Array(256);
      for (let i=0;i<256;i++) {
        let c=i;
        for (let k=0;k<8;k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        table[i]=c>>>0;
      }
      crc32.table=table;
    }
    let c=0xffffffff;
    for (let i=0;i<data.length;i++) c=crc32.table[(c ^ data[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function writeU16(view, offset, value) { view.setUint16(offset, value, true); }
  function writeU32(view, offset, value) { view.setUint32(offset, value >>> 0, true); }

  function concatU8(parts) {
    const total = parts.reduce((sum,p)=>sum+p.length,0);
    const out = new Uint8Array(total);
    let offset=0;
    for (const part of parts) { out.set(part,offset); offset += part.length; }
    return out;
  }

  function dosDateTime(date=new Date()) {
    const time = ((date.getHours() & 31) << 11) | ((date.getMinutes() & 63) << 5) | Math.floor(date.getSeconds()/2);
    const day = ((date.getFullYear()-1980) << 9) | ((date.getMonth()+1) << 5) | date.getDate();
    return {time, day};
  }

  function makeZip(files) {
    const now = dosDateTime();
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    for (const file of files) {
      const name = strToU8(file.name);
      const data = file.data instanceof Uint8Array ? file.data : strToU8(file.data);
      const crc = crc32(data);
      const local = new Uint8Array(30 + name.length);
      const lv = new DataView(local.buffer);
      writeU32(lv,0,0x04034b50); writeU16(lv,4,20); writeU16(lv,6,0x0800); writeU16(lv,8,0);
      writeU16(lv,10,now.time); writeU16(lv,12,now.day); writeU32(lv,14,crc);
      writeU32(lv,18,data.length); writeU32(lv,22,data.length); writeU16(lv,26,name.length); writeU16(lv,28,0);
      local.set(name,30);
      localParts.push(local,data);

      const central = new Uint8Array(46 + name.length);
      const cv = new DataView(central.buffer);
      writeU32(cv,0,0x02014b50); writeU16(cv,4,20); writeU16(cv,6,20); writeU16(cv,8,0x0800); writeU16(cv,10,0);
      writeU16(cv,12,now.time); writeU16(cv,14,now.day); writeU32(cv,16,crc);
      writeU32(cv,20,data.length); writeU32(cv,24,data.length); writeU16(cv,28,name.length); writeU16(cv,30,0); writeU16(cv,32,0);
      writeU16(cv,34,0); writeU16(cv,36,0); writeU32(cv,38,0); writeU32(cv,42,offset);
      central.set(name,46);
      centralParts.push(central);
      offset += local.length + data.length;
    }

    const centralStart = offset;
    const centralData = concatU8(centralParts);
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    writeU32(ev,0,0x06054b50); writeU16(ev,4,0); writeU16(ev,6,0); writeU16(ev,8,files.length); writeU16(ev,10,files.length);
    writeU32(ev,12,centralData.length); writeU32(ev,16,centralStart); writeU16(ev,20,0);
    return new Blob([concatU8(localParts), centralData, eocd], {type:"application/vnd.openxmlformats-officedocument.presentationml.presentation"});
  }

  function contentTypesXml(slideCount) {
    let overrides = `<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/presProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presProps+xml"/><Override PartName="/ppt/viewProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml"/><Override PartName="/ppt/tableStyles.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>`;
    for (let i=1;i<=slideCount;i++) overrides += `<Override PartName="/ppt/slides/slide${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`;
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpg" ContentType="image/jpeg"/><Default Extension="jpeg" ContentType="image/jpeg"/>${overrides}</Types>`;
  }

  function rootRelsXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>`;
  }

  function presentationXml(slideCount) {
    let ids = "";
    for (let i=1;i<=slideCount;i++) ids += `<p:sldId id="${255+i}" r:id="rId${i+1}"/>`;
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${ids}</p:sldIdLst><p:sldSz cx="12192000" cy="6858000" type="wide"/><p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle/></p:presentation>`;
  }

  function presentationRelsXml(slideCount) {
    let rels = `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>`;
    for (let i=1;i<=slideCount;i++) rels += `<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i}.xml"/>`;
    const base = slideCount + 2;
    rels += `<Relationship Id="rId${base}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/presProps" Target="presProps.xml"/><Relationship Id="rId${base+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/viewProps" Target="viewProps.xml"/><Relationship Id="rId${base+2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/tableStyles" Target="tableStyles.xml"/>`;
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`;
  }

  function slideXml(shapes) {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${shapes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
  }

  function slideRelsXml(imageRels) {
    let rels = `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>`;
    for (const rel of imageRels) rels += `<Relationship Id="${rel.rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${rel.file}"/>`;
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`;
  }

  function slideMasterXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>`;
  }

  function slideLayoutXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
  }

  function themeXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Conference Companion"><a:themeElements><a:clrScheme name="Conference Companion"><a:dk1><a:srgbClr val="111827"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1f2937"/></a:dk2><a:lt2><a:srgbClr val="f3f4f6"/></a:lt2><a:accent1><a:srgbClr val="1769E0"/></a:accent1><a:accent2><a:srgbClr val="9B5B08"/></a:accent2><a:accent3><a:srgbClr val="58A56C"/></a:accent3><a:accent4><a:srgbClr val="E7A400"/></a:accent4><a:accent5><a:srgbClr val="73767C"/></a:accent5><a:accent6><a:srgbClr val="000000"/></a:accent6><a:hlink><a:srgbClr val="1769E0"/></a:hlink><a:folHlink><a:srgbClr val="1769E0"/></a:folHlink></a:clrScheme><a:fontScheme name="Aptos"><a:majorFont><a:latin typeface="Aptos Display"/></a:majorFont><a:minorFont><a:latin typeface="Aptos"/></a:minorFont></a:fontScheme><a:fmtScheme name="Conference Companion"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;
  }

  async function makeConferencePptx(items) {
    const files = [];
    const slideData = [];
    const mediaFiles = [];
    let mediaIndex = 1;

    const addSlide = (shapes, imageRels=[]) => slideData.push({shapes, imageRels});

    const noteCount = items.filter(x=>String(x.note||"").trim()).length;
    const photoCount = items.reduce((sum,x)=>sum+x.photos.length,0);
    addSlide(
      pptTextShape(2,"Title",0.7,0.75,12,0.75,CONFERENCE.name || "Conference",{fontSize:3600,bold:true,color:"111827"}) +
      pptTextShape(3,"Subtitle",0.75,1.65,11.8,0.65,"Notes and presentation photos",{fontSize:2200,color:"1769E0"}) +
      pptTextShape(4,"Summary",0.8,2.75,11.6,2.2,`${items.length} presentations / groups\n${noteCount} with notes\n${photoCount} photos\nExported ${new Date().toLocaleString()}`,{fontSize:1700,color:"374151",fill:"f3f4f6",line:"d1d5db"}) +
      pptTextShape(5,"Footer",0.8,6.65,11.6,0.35,`Generated locally from ${CONFERENCE.name || "conference app"}`,{fontSize:1000,color:"6b7280"})
    );

    for (const item of items) {
      const prepared = [];
      for (const photo of item.photos) {
        try {
          const img = await imageBlobForPptx(photo);
          const file = `image${mediaIndex++}.jpg`;
          mediaFiles.push({name:`ppt/media/${file}`, data: await blobToU8(img.blob)});
          const photoTitle = String(photo.customTitle || "").trim();
          const photoNote = String(photo.customNote || "").trim();
          const fallbackCaption = photo.captureTime || photo.name || "Photo";
          const caption = photoTitle || fallbackCaption;
          prepared.push({...img, file, caption, photoNote});
        } catch (err) {
          console.warn("Skipping photo in PPTX export", err);
        }
      }

      const chunks = [];
      if (prepared.length) {
        for (let i=0;i<prepared.length;i+=4) chunks.push(prepared.slice(i,i+4));
      } else {
        chunks.push([]);
      }

      chunks.forEach((chunk, chunkIndex) => {
        let shapeId = 2;
        let shapes = "";
        const imageRels = [];
        const title = chunkIndex ? `${item.info.title} — photos ${chunkIndex*4+1}–${chunkIndex*4+chunk.length}` : item.info.title;
        shapes += pptTextShape(shapeId++,"Title",0.42,0.25,12.5,0.45,title,{fontSize:1900,bold:true,color:"111827"});
        shapes += pptTextShape(shapeId++,"Meta",0.45,0.73,12.35,0.35,item.info.meta,{fontSize:900,color:"6b7280"});

        const hasNote = String(item.note || "").trim() && chunkIndex === 0;
        const noteText = hasNote ? item.note : (chunkIndex === 0 && !chunk.length ? "No photos attached." : "");
        if (hasNote || !chunk.length) {
          const noteW = chunk.length ? 5.1 : 12.15;
          shapes += pptTextShape(shapeId++,"Notes",0.45,1.18,noteW,5.8,noteText,{fontSize:1150,color:"111827",fill:"f9fafb",line:"e5e7eb"});
        }

        if (chunk.length) {
          const x0 = hasNote ? 5.85 : 0.65;
          const y0 = 1.25;
          const gridW = hasNote ? 6.9 : 12.0;
          const gridH = 5.55;
          const gap = 0.18;
          const boxes = chunk.length === 1
            ? [{x:x0,y:y0,w:gridW,h:gridH}]
            : chunk.length === 2
              ? [{x:x0,y:y0,w:gridW,h:(gridH-gap)/2},{x:x0,y:y0+(gridH+gap)/2,w:gridW,h:(gridH-gap)/2}]
              : [0,1,2,3].map(i => ({x:x0+(i%2)*(gridW+gap)/2,y:y0+Math.floor(i/2)*(gridH+gap)/2,w:(gridW-gap)/2,h:(gridH-gap)/2}));

          chunk.forEach((img, idx) => {
            const box = boxes[idx];
            const metaHeight = img.photoNote ? 0.62 : 0.28;
            const imageBoxHeight = Math.max(0.7, box.h - metaHeight);
            const fit = fitInBox(img.width,img.height,box.x,box.y,box.w,imageBoxHeight);
            const rId = `rId${imageRels.length+2}`;
            imageRels.push({rId, file:img.file});
            shapes += pptPicture(shapeId++,rId,fit.x,fit.y,fit.w,fit.h,`Photo ${idx+1}`);
            if (img.caption) {
              shapes += pptTextShape(shapeId++,"Caption",box.x,box.y+imageBoxHeight,box.w,0.24,img.caption,{fontSize:680,bold:!!img.photoNote,color:"374151",fill:"ffffff"});
            }
            if (img.photoNote) {
              shapes += pptTextShape(shapeId++,"Photo note",box.x,box.y+imageBoxHeight+0.24,box.w,0.38,img.photoNote,{fontSize:560,color:"4b5563",fill:"f9fafb",line:"e5e7eb"});
            }
          });
        }
        addSlide(shapes, imageRels);
      });
    }

    const slideCount = slideData.length;
    files.push({name:"[Content_Types].xml", data:contentTypesXml(slideCount)});
    files.push({name:"_rels/.rels", data:rootRelsXml()});
    files.push({name:"ppt/presentation.xml", data:presentationXml(slideCount)});
    files.push({name:"ppt/_rels/presentation.xml.rels", data:presentationRelsXml(slideCount)});
    files.push({name:"ppt/presProps.xml", data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentationPr xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>`});
    files.push({name:"ppt/viewProps.xml", data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:viewPr xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>`});
    files.push({name:"ppt/tableStyles.xml", data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`});
    files.push({name:"ppt/theme/theme1.xml", data:themeXml()});
    files.push({name:"ppt/slideMasters/slideMaster1.xml", data:slideMasterXml()});
    files.push({name:"ppt/slideMasters/_rels/slideMaster1.xml.rels", data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>`});
    files.push({name:"ppt/slideLayouts/slideLayout1.xml", data:slideLayoutXml()});
    files.push({name:"ppt/slideLayouts/_rels/slideLayout1.xml.rels", data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`});

    slideData.forEach((slide, i) => {
      const num = i+1;
      files.push({name:`ppt/slides/slide${num}.xml`, data:slideXml(slide.shapes)});
      files.push({name:`ppt/slides/_rels/slide${num}.xml.rels`, data:slideRelsXml(slide.imageRels)});
    });
    files.push(...mediaFiles);
    return makeZip(files);
  }

  async function exportNotesPhotosPptx() {
    const btn = $("#exportPptxBtn");
    const original = btn ? btn.textContent : "";
    if (btn) { btn.disabled = true; btn.textContent = "Building…"; }
    try {
      const items = await collectNotesPhotosForPptx();
      if (!items.length) {
        toast("No notes or photos to export");
        return;
      }
      const pptx = await makeConferencePptx(items);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(pptx);
      a.download = `${safeFilenamePart(CONFERENCE.id || CONFERENCE.name || "conference")}-notes-photos-${new Date().toISOString().slice(0,10)}.pptx`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast("PowerPoint exported");
    } catch (err) {
      console.error(err);
      toast("Could not export PowerPoint");
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = original || "Export PPTX"; }
    }
  }

  function profileFromForm() {
    return {
      ...(profileDraft || profile),
      id:(profileDraft || profile).id || crypto.randomUUID(),
      name:$("#profileName")?.value.trim() || "",
      position:$("#profilePosition")?.value.trim() || "",
      affiliation:$("#profileAffiliation")?.value.trim() || "",
      affiliations:[$("#profileAffiliation")?.value.trim() || ""].filter(Boolean),
      email:$("#profileEmail")?.value.trim() || "",
      emails:[$("#profileEmail")?.value.trim() || ""].filter(Boolean),
      orcid:$("#profileOrcid")?.value.trim() || "",
      linkedin:$("#profileLinkedin")?.value.trim() || "",
      website:$("#profileWebsite")?.value.trim() || "",
      bio:$("#profileBio")?.value.trim() || "",
      papers:$("#profilePapers")?.value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean) || []
    };
  }

  function renderProfilePhoto(source=profile) {
    if(profilePhotoUrl){URL.revokeObjectURL(profilePhotoUrl);profilePhotoUrl="";}
    const img=$("#profilePhotoPreview"),clear=$("#clearProfilePhotoBtn");if(!img)return;
    if(source?.photoBlob instanceof Blob){profilePhotoUrl=URL.createObjectURL(source.photoBlob);img.src=profilePhotoUrl;img.hidden=false;if(clear)clear.hidden=false;}
    else{img.removeAttribute("src");img.hidden=true;if(clear)clear.hidden=true;}
  }

  function fillProfileForm(source=profile) {
    if (!$("#profileName")) return;
    $("#profileName").value=source.name||"";
    $("#profilePosition").value=source.position||"";
    $("#profileAffiliation").value=source.affiliation||(source.affiliations||[])[0]||"";
    $("#profileEmail").value=source.email||(source.emails||[])[0]||"";
    $("#profileOrcid").value=source.orcid||"";
    $("#profileLinkedin").value=source.linkedin||"";
    $("#profileWebsite").value=source.website||"";
    $("#profileBio").value=source.bio||"";
    $("#profilePapers").value=(source.papers||[]).map(x=>typeof x==="string"?x:(x.doi||x.title||"")).filter(Boolean).join("\n");
    renderProfilePhoto(source);
  }

  function beginProfileEdit() {
    profileDraft={...profile};
    fillProfileForm(profileDraft);
    $("#profileSection").hidden=false;
    $("#editProfileBtn").setAttribute("aria-expanded","true");
    $("#profileName").focus();
  }

  function cancelProfileEdit() {
    profileDraft=null;
    fillProfileForm(profile);
    $("#profileSection").hidden=true;
    $("#editProfileBtn").setAttribute("aria-expanded","false");
    $("#editProfileBtn").focus();
  }

  async function saveProfile() {
    const next=profileFromForm();
    if(next.email&&!normalizeEmail(next.email)){toast('Enter a valid email address');$('#profileEmail').focus();return;}
    if(next.orcid){const value=normalizeOrcid(next.orcid);if(!value){toast('Enter a valid ORCID identifier');$('#profileOrcid').focus();return;}next.orcid=value;}
    for(const field of ['website','linkedin'])if(next[field]){const value=normalizeWebUrl(next[field]);if(!value){toast(`${field==='website'?'Website':'LinkedIn'} must use a safe HTTPS URL`);$(`#profile${field==='website'?'Website':'Linkedin'}`).focus();return;}next[field]=value;}
    const unsafePaper=next.papers.find(value=>/^[a-z][a-z0-9+.-]*:/i.test(value)&&!/^doi:/i.test(value)&&!normalizeWebUrl(value));
    if(unsafePaper){toast('Selected paper links must use HTTPS or DOI references');$('#profilePapers').focus();return;}
    try{
      await trackPersonalWrite(USER_STORE?.saveProfile(next));
      profile=next;profileDraft=null;
      $("#profileSection").hidden=true;$("#editProfileBtn").setAttribute("aria-expanded","false");
      fillProfileForm(profile);renderFriendBook();
      toast("Conference card saved");
    }catch(error){console.error(error);toast("Could not save conference card");}
  }

  function friendContactHtml(friend) {
    const emails=[...new Set([...(friend.emails||[]),friend.email].map(normalizeEmail).filter(Boolean))];
    const affiliations=[...new Set([...(friend.affiliations||[]),friend.affiliation].filter(Boolean))];
    const linkRows=[
      normalizeOrcid(friend.orcid)?{label:"ORCID",url:`https://orcid.org/${normalizeOrcid(friend.orcid)}`}:null,
      friend.linkedin?{label:"LinkedIn",url:friend.linkedin}:null,
      friend.website?{label:"Website",url:friend.website}:null,
      ...(friend.links||[]).map((link,index)=>typeof link==="string"?{label:`Link ${index+1}`,url:link}:link)
    ].map(link=>link?.url?{...link,url:normalizeExternalLink(link.url)}:link).filter(link=>link?.url);
    const links=linkRows.map(link=>`<a href="${esc(link.url)}" target="_blank" rel="noopener noreferrer">${esc(link.label||"Link")} ↗</a>`).join(" · ");
    const papers=(friend.papers||[]).map(p=>typeof p==="string"?p:(p.doi||p.title||"")).filter(Boolean);
    const events=MODEL.calendarItems().slice().sort((a,b)=>`${a.date}|${a.start}`.localeCompare(`${b.date}|${b.start}`));
    const eventOptions=events.map(e=>`<option value="${esc(e.id)}" ${e.id===friend.metAtEventId?'selected':''}>${esc(`${e.date} ${e.start} · ${e.title}`)}</option>`).join("");
    const expanded=expandedFriendIds.has(friend.id),detailsId=`friend-details-${String(friend.id).replace(/[^a-zA-Z0-9_-]/g,"-")}`;
    return `<article class="friend-card${expanded?' expanded':''}" data-friend-id="${esc(friend.id)}">
      <button class="friend-card-toggle" data-friend-toggle="${esc(friend.id)}" type="button" aria-expanded="${expanded}" aria-controls="${esc(detailsId)}"><span>${esc(friend.name||"Contact")}</span><span class="friend-expand-icon" aria-hidden="true">⌄</span></button>
      <div id="${esc(detailsId)}" class="friend-card-details" ${expanded?'':'hidden'}>
        ${friend.position?`<p><strong>Position</strong><span>${esc(friend.position)}</span></p>`:""}
        ${affiliations.length?`<p><strong>Affiliation</strong><span>${esc(affiliations.join(" · "))}</span></p>`:""}
        ${emails.length?`<p><strong>Email</strong><span>${emails.map(email=>`<a href="mailto:${esc(email)}">${esc(email)}</a>`).join(" · ")}</span></p>`:""}
        ${links?`<p><strong>Links</strong><span>${links}</span></p>`:""}
        ${friend.bio?`<p><strong>About</strong><span>${esc(friend.bio)}</span></p>`:""}
        ${papers.length?`<p><strong>Papers</strong><span>${papers.map(esc).join(" · ")}</span></p>`:""}
        <div class="friend-private"><label>Met at<select data-friend-event="${esc(friend.id)}"><option value="">— conference generally —</option>${eventOptions}</select></label><label>Met at note<input data-friend-met-at="${esc(friend.id)}" value="${esc(friend.metAt||CONFERENCE.shortName||CONFERENCE.name||"")}" placeholder="Poster session, conference dinner…"></label><label>Private notes<textarea rows="2" data-friend-note="${esc(friend.id)}">${esc(friend.privateNotes||"")}</textarea></label><label>Private tags<input data-friend-tags="${esc(friend.id)}" value="${esc((friend.tags||[]).join(", "))}" placeholder="met at dinner, memristors"></label></div>
        <div class="friend-card-footer"><span>Saved locally · ${esc(friend.metAtConferenceId||CONFERENCE.id||"")}</span><button class="friend-delete" data-friend-delete="${esc(friend.id)}" type="button">Delete contact</button></div>
      </div>
    </article>`;
  }

  function renderFriendBook() {
    if (!CONFERENCE.features?.friendBook) return;
    const summary=$("#myCardSummary");
    if(friendProfilePhotoUrl){URL.revokeObjectURL(friendProfilePhotoUrl);friendProfilePhotoUrl="";}
    if(summary){
      const photo=profile?.photoBlob instanceof Blob?(friendProfilePhotoUrl=URL.createObjectURL(profile.photoBlob),`<img class="friend-profile-photo" src="${esc(friendProfilePhotoUrl)}" alt="">`):"";
      const details=[
        profile.position?`<p>${esc(profile.position)}</p>`:"",
        (profile.affiliation||(profile.affiliations||[])[0])?`<p>${esc(profile.affiliation||(profile.affiliations||[])[0])}</p>`:"",
        normalizeEmail(profile.email||(profile.emails||[])[0])?`<p><a href="mailto:${esc(normalizeEmail(profile.email||(profile.emails||[])[0]))}">${esc(normalizeEmail(profile.email||(profile.emails||[])[0]))}</a></p>`:"",
        normalizeOrcid(profile.orcid)?`<p><a href="https://orcid.org/${esc(normalizeOrcid(profile.orcid))}" target="_blank" rel="noopener noreferrer">ORCID ↗</a></p>`:"",
        normalizeWebUrl(profile.linkedin)?`<p><a href="${esc(normalizeWebUrl(profile.linkedin))}" target="_blank" rel="noopener noreferrer">LinkedIn ↗</a></p>`:"",
        normalizeWebUrl(profile.website)?`<p><a href="${esc(normalizeWebUrl(profile.website))}" target="_blank" rel="noopener noreferrer">Website ↗</a></p>`:"",
        profile.bio?`<p>${esc(profile.bio)}</p>`:"",
        (profile.papers||[]).length?`<p><strong>Selected papers</strong><br>${(profile.papers||[]).map(x=>esc(typeof x==="string"?x:(x.doi||x.title||""))).filter(Boolean).join(" · ")}</p>`:""
      ].filter(Boolean).join("");
      summary.innerHTML=profile?.name?`<div class="my-card-summary-layout ${photo?'with-photo':'no-photo'}">${photo}<div><h4>${esc(profile.name)}</h4>${details}</div></div>`:`<h4>Create your conference card</h4><p>Add your details with Edit, then share them by QR or vCard.</p>`;
    }
    const editor=$("#profileSection");if(editor&&profileDraft===null)editor.hidden=true;
    friends.sort((a,b)=>String(a.name||"").localeCompare(String(b.name||""),undefined,{sensitivity:"base"}));
    const list=$("#friendList");if(list) list.innerHTML=friends.length?friends.map(friendContactHtml).join(""):`<div class="empty-state"><strong>No contacts saved yet</strong>Scan a conference card QR or import a .vcf file.</div>`;
    if($("#friendCount")) $("#friendCount").textContent=String(friends.length);
  }

  async function saveFriendPrivate(id, field, value) {
    const idx=friends.findIndex(x=>x.id===id);if(idx<0)return;
    const friend={...friends[idx]};
    if(field==="privateNotes")friend.privateNotes=value;
    if(field==="tags")friend.tags=String(value||"").split(",").map(x=>x.trim()).filter(Boolean);
    if(field==="metAt")friend.metAt=String(value||"").trim();
    if(field==="metAtEventId")friend.metAtEventId=String(value||"").trim();
    friends[idx]=await trackPersonalWrite(USER_STORE.saveFriend(friend));
  }

  function friendIdentity(friend) {
    const email=String((friend.emails||[])[0]||friend.email||"").trim().toLowerCase();
    if(email)return `email:${email}`;
    const orcid=String(friend.orcid||"").replace(/^https?:\/\/orcid\.org\//i,"").trim().toLowerCase();
    if(orcid)return `orcid:${orcid}`;
    return `name:${String(friend.name||"").trim().toLowerCase()}|${String((friend.affiliations||[])[0]||friend.affiliation||"").trim().toLowerCase()}`;
  }

  async function addFriendFromVCard(text) {
    try {
      const parsed=SERVICES.vcard.parseVCard(text);
      const signature=friendIdentity(parsed);
      const existing=friends.find(x=>friendIdentity(x)===signature);
      const saved=await trackPersonalWrite(USER_STORE.saveFriend({...existing,...parsed,id:existing?.id||crypto.randomUUID(),metAtConferenceId:CONFERENCE.id,metAtEventId:existing?.metAtEventId||"",metAt:existing?.metAt||CONFERENCE.shortName||CONFERENCE.name||"",savedAt:existing?.savedAt||Date.now(),privateNotes:existing?.privateNotes||"",tags:existing?.tags||[]}));
      friends=existing?friends.map(x=>x.id===saved.id?saved:x):[...friends,saved];
      renderFriendBook();toast(existing?"Contact updated":"Contact saved to Friend Book");
      return true;
    } catch(err){console.error(err);toast("Could not read that vCard");return false;}
  }

  async function stopFriendQrScan({close=true}={}) {
    const active=qrScanner;qrScanner=null;qrScanStarting=false;qrScanProcessing=false;
    if(active){try{await active.stop();}catch{}try{active.destroy();}catch{}}
    const video=$("#qrScanVideo");
    if(video?.srcObject){for(const track of video.srcObject.getTracks?.()||[])track.stop();video.srcObject=null;}
    const dialog=$("#qrScanDialog");if(close&&dialog?.open)dialog.close();
  }

  function qrCameraErrorMessage(error) {
    const text=String(error?.message||error||"");
    if(/denied|permission|notallowed/i.test(text))return "Camera permission was denied. Allow camera access in browser settings, or use Import vCard.";
    if(/secure|https/i.test(text))return "Live scanning requires HTTPS. Use Import vCard on this connection.";
    if(/not found|notfound|device|camera/i.test(text))return "No usable camera was found. Use Import vCard instead.";
    return "Live QR scanning is unavailable on this device. Use Import vCard instead.";
  }

  async function openFriendQrScan() {
    if(qrScanStarting||qrScanner)return;
    const dialog=$("#qrScanDialog"),status=$("#qrScanStatus"),video=$("#qrScanVideo");
    if(!dialog||!video)return;
    if(!dialog.open)dialog.showModal();
    status.textContent="Starting rear camera…";
    if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia){status.textContent=qrCameraErrorMessage(window.isSecureContext?"Camera not found":"HTTPS required");return;}
    qrScanStarting=true;
    try{
      const QrScanner=window.CONFERENCE_QR_SCANNER_CLASS||(await import("./src/vendor/qr-scanner/qr-scanner.min.js")).default;
      if(!dialog.open){qrScanStarting=false;return;}
      const scanner=new QrScanner(video,async result=>{
        if(qrScanProcessing||scanner!==qrScanner)return;
        qrScanProcessing=true;status.textContent="Conference card found. Saving contact…";
        const saved=await addFriendFromVCard(result?.data||result);
        if(saved){await stopFriendQrScan();return;}
        qrScanProcessing=false;status.textContent="That QR code is not a valid conference contact card. Keep scanning or use Import vCard.";
      },{preferredCamera:"environment",maxScansPerSecond:10,highlightScanRegion:true,highlightCodeOutline:true,returnDetailedScanResult:true,onDecodeError:()=>{}});
      qrScanner=scanner;qrScanStarting=false;await scanner.start();
      if(scanner===qrScanner)status.textContent="Point the rear camera at a Conference Companion contact QR code.";
    }catch(error){console.error(error);await stopFriendQrScan({close:false});status.textContent=qrCameraErrorMessage(error);}
  }

  function downloadMyVcard() {
    if(!profile?.name)return toast("Create your conference card first");
    SERVICES.vcard.downloadVCard(profile,`${safeFilenamePart(profile.name)}-${safeFilenamePart(CONFERENCE.id||"conference")}.vcf`);
  }

  function calendarLocationLabel(locationId) {
    const resolved=resolvedVenue(locationId);if(!resolved)return locationLabel(locationId);
    return resolved.room?.name?`${resolved.room.name}, ${resolved.venue.name}`:resolved.venue.name;
  }

  function downloadCalendar(items, filename) {
    if(!items.length)return toast("No calendar items to export");
    SERVICES.calendar.downloadICS(filename,{conference:CONFERENCE,manifest:CONFIG.manifest,items,locationLabel:calendarLocationLabel});
    toast("Calendar exported");
  }

  function exportStarredCalendar() {
    const items=state.favorites.map(id=>byId.get(id)).filter(Boolean);
    const posterSessionIds=new Set(state.posterFavorites.map(id=>posterById.get(id)?.posterSessionId).filter(Boolean));
    for(const sessionId of posterSessionIds){const posterItem=byId.get(sessionId);if(posterItem&&!items.some(x=>x.id===posterItem.id))items.push(posterItem);}
    downloadCalendar(items,`${safeFilenamePart(CONFERENCE.id||"conference")}-starred.ics`);
  }

  function exportFullCalendar() {
    downloadCalendar(MODEL.calendarItems(),`${safeFilenamePart(CONFERENCE.id||"conference")}-programme.ics`);
  }

  function exportSingleCalendar(id) {
    const item=byId.get(id);if(!item)return;
    downloadCalendar([item],`${safeFilenamePart(CONFERENCE.id||"conference")}-${safeFilenamePart(item.title)}.ics`);
  }

  async function exportState() {
    const btn=$("#exportBtn"),old=btn?.textContent;if(btn){btn.disabled=true;btn.textContent="Building…";}
    try{
      const photos=await getAllPhotos();
      const blob=await SERVICES.backup.createPersonalBackup({conferenceId:CONFERENCE.id,state:{...state},profile,friends,photos});
      const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`${safeFilenamePart(CONFERENCE.id||"conference")}-personal-backup-${new Date().toISOString().slice(0,10)}.zip`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);toast("Backup exported");
    }catch(err){console.error(err);toast("Could not create backup");}finally{if(btn){btn.disabled=false;btn.textContent=old||"Export backup ZIP";}}
  }

  async function importState(file) {
    const epoch=personalDataEpoch;
    let oldSnapshot=null,photosChanged=false,userDataChanged=false,prefsChanged=false,restoreCommitted=false;
    const importButton=$('#importBtn'),originalImportLabel=importButton?.textContent;
    if(importButton){importButton.disabled=true;importButton.textContent='Checking backup…';}
    toast('Checking backup…');
    try {
      const {payload,photoFiles}=await SERVICES.backup.parsePersonalBackup(file);
      if(epoch!==personalDataEpoch||personalDataDeleting)return;
      const conferenceMismatch=payload.conferenceId!==CONFERENCE.id;
      const message=`Restore this backup by replacing all saved personal data${conferenceMismatch?` from ${payload.conferenceId} into ${CONFERENCE.id}`:''}? Current favorites, notes, photos, contacts, profile and preferences will be replaced.`;
      if(!confirm(message))return;
      if(importButton)importButton.textContent='Restoring backup…';
      toast('Restoring backup…');
      const incoming=payload.state;
      const nextState={...defaultState};
      for(const key of Object.keys(defaultState))if(Object.hasOwn(incoming,key))nextState[key]=incoming[key];
      nextState.favorites=(incoming.favorites||[]).filter(id=>byId.has(id));
      nextState.posterFavorites=(incoming.posterFavorites||[]).filter(id=>posterById.has(id));
      const rawNotes=incoming.notes||{};
      nextState.notes=Object.fromEntries(Object.entries(rawNotes).filter(([key,value])=>{const idx=String(key).indexOf(":");const type=idx>=0?key.slice(0,idx):"event",id=idx>=0?key.slice(idx+1):key;return typeof value==="string"&&((type==="event"&&byId.has(id))||(type==="poster"&&posterById.has(id)));}));
      const nextProfile=payload.profile||{};
      const nextFriends=payload.friends||[];
      const nextPhotos=[];
      for(const meta of payload.photos||[]){
        const blob=photoFiles.get(meta.file);
        if(!blob)throw new Error(`Backup photo is missing: ${meta.file}`);
        if(typeof createImageBitmap==='function'){const bitmap=await createImageBitmap(blob);bitmap.close();}
        else {const url=URL.createObjectURL(blob);try{const img=new Image();img.src=url;await img.decode();}finally{URL.revokeObjectURL(url);}}
        const row={...meta,blob};delete row.file;delete row.type;
        row.ownerKey=photoOwnerKey(row.ownerType,row.ownerId);nextPhotos.push(row);
      }
      if(nextProfile.photoBlob){
        if(typeof createImageBitmap==='function'){const bitmap=await createImageBitmap(nextProfile.photoBlob);bitmap.close();}
        else {const url=URL.createObjectURL(nextProfile.photoBlob);try{const img=new Image();img.src=url;await img.decode();}finally{URL.revokeObjectURL(url);}}
      }
      if(epoch!==personalDataEpoch||personalDataDeleting)return;

      personalDataRestoring=true;personalDataEpoch++;
      const shell=document.querySelector('.app-shell');if(shell)shell.inert=true;
      await flushPendingPersonalDebounces();
      await Promise.allSettled([...pendingPersonalWrites]);
      await stopFriendQrScan();
      if(!$('#photoViewer').hidden)closePhotoViewer();
      if($('#shareQrViewer').open)closeShareQr();
      if($('#detailModal').open)$('#detailModal').close();
      oldSnapshot={
        state:await USER_STORE.getState(),profile:await USER_STORE.getProfile(),friends:await USER_STORE.listFriends(),
        photos:await clonePhotoRowsForRestore(await getAllPhotos()),prefs:localStorage.getItem(PREFS_KEY)
      };
      await replacePhotoRows(nextPhotos);photosChanged=true;
      const normalizedFriends=await USER_STORE.replacePersonalData({state:{favorites:nextState.favorites,posterFavorites:nextState.posterFavorites,notes:nextState.notes},profile:nextProfile,friends:nextFriends});userDataChanged=true;
      const prefs={theme:nextState.theme,compact:nextState.compact,timeMode:nextState.timeMode,locationId:nextState.locationId,track:nextState.track,day:nextState.day,posterCategory:nextState.posterCategory,view:nextState.view,galleryMode:nextState.galleryMode};
      localStorage.setItem(PREFS_KEY,JSON.stringify(prefs));prefsChanged=true;
      restoreCommitted=true;

      state=nextState;profile=nextProfile;profileDraft=null;friends=normalizedFriends;expandedFriendIds.clear();
      $("#profileSection").hidden=true;$("#editProfileBtn").setAttribute("aria-expanded","false");
      fillProfileForm();renderFriendBook();applyTheme();syncSettings();renderDays();renderProgram();renderPosters();renderMySchedule();renderGalleryNotes();await renderGallery();toast("Backup restored");
    } catch(err){
      console.error(err);
      if(oldSnapshot&&!restoreCommitted){
        try{
          if(photosChanged)await replacePhotoRows(oldSnapshot.photos);
          if(userDataChanged)await USER_STORE.replacePersonalData({state:oldSnapshot.state,profile:oldSnapshot.profile,friends:oldSnapshot.friends});
          if(prefsChanged){if(oldSnapshot.prefs==null)localStorage.removeItem(PREFS_KEY);else localStorage.setItem(PREFS_KEY,oldSnapshot.prefs);}
        }catch(rollbackError){console.error(`Backup restore rollback failed: ${rollbackError?.name||'Error'}: ${rollbackError?.message||String(rollbackError)}`);toast('Restore failed and stored data could not be fully rolled back');return;}
      }
      toast(restoreCommitted?"Backup restored. Refresh to update the display.":"Could not restore that backup. Existing personal data was preserved.");
    }finally{
      if(personalDataRestoring){personalDataRestoring=false;const shell=document.querySelector('.app-shell');if(shell)shell.inert=false;}
      if(importButton){importButton.disabled=false;importButton.textContent=originalImportLabel||'Import backup ZIP';}
    }
  }

  function isStandalone() {
    return window.matchMedia("(display-mode: standalone)").matches ||
      window.navigator.standalone === true;
  }

  function installPlatform() {
    const ua=navigator.userAgent||"",ipad=navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1;
    if(/iPad|iPhone|iPod/.test(ua)||ipad)return "ios";
    if(/Android/i.test(ua))return "android";
    return "desktop";
  }

  function manualInstallInstructions() {
    const platform=installPlatform();
    if(platform==="ios")return "In Safari, tap the Share button, choose Add to Home Screen, then tap Add. iPhone and iPad browsers do not provide a programmatic install prompt.";
    if(platform==="android")return "Open your browser menu and choose Install app or Add to Home screen. If that option is missing, first reload while online and try the menu again.";
    return "Open your browser menu and choose Install Conference Companion, Install app, or Create shortcut. This browser does not expose a programmatic install prompt.";
  }

  function updateInstallUI() {
    const btn = $("#installBtn");
    const help = $("#installHelp");
    if (!btn || !help) return;

    if (isStandalone()) {
      btn.textContent = "Installed";
      btn.disabled = true;
      help.textContent = "This planner is already running as an installed app.";
      return;
    }

    btn.disabled = false;

    if (deferredInstallPrompt) {
      btn.textContent = "Install";
      help.textContent = "Install this planner with your browser's native prompt. It opens in its own standalone window.";
    } else {
      btn.textContent = "Show instructions";
      help.textContent = manualInstallInstructions();
    }
  }

  async function installApp() {
    if (isStandalone()) {
      updateInstallUI();
      return;
    }

    if (deferredInstallPrompt) {
      const promptEvent = deferredInstallPrompt;
      deferredInstallPrompt = null;
      try {
        await promptEvent.prompt();
        const choice=await promptEvent.userChoice;
        if(choice?.outcome==="dismissed")toast("Installation was cancelled");
      } catch(error) { console.error(error);toast("The native installation prompt could not be opened"); }
      updateInstallUI();
      return;
    }

    const instructions=$("#installInstructions"),dialog=$("#installDialog");
    if(instructions)instructions.textContent=manualInstallInstructions();
    if(dialog&&!dialog.open)dialog.showModal();
  }

  async function deleteAllPersonalData() {
    const warning="Delete all personal data for this conference? This permanently removes favorites, notes, app-stored photos and annotations, Friend Book contacts, your profile, and preferences. Official programme data and the installed app remain. Previously downloaded backups and photos separately saved on your device cannot be deleted by this app.";
    if(!confirm(warning))return;
    const button=$("#deletePersonalDataBtn");if(button){button.disabled=true;button.textContent="Deleting…";}
    personalDataDeleting=true;personalDataEpoch++;
    clearTimeout(photoMetaSaveTimer);photoMetaSaveTimer=null;
    $$("[data-friend-note],[data-friend-tags],[data-friend-met-at]").forEach(el=>{clearTimeout(el._saveTimer);el._saveTimer=null;});
    await stopFriendQrScan();
    closePhotoViewer();
    if($("#detailModal")?.open)$("#detailModal").close();
    try{
      await Promise.allSettled([...pendingPersonalWrites]);
      await Promise.all([USER_STORE?.clearAll(),clearAllPhotos()]);
      localStorage.removeItem(PREFS_KEY);
      state={...defaultState,day:detectConferenceDay(),view:"settings",notes:{}};
      profile={};profileDraft=null;friends=[];expandedFriendIds.clear();
      $("#editProfileBtn").setAttribute("aria-expanded","false");
      fillProfileForm();renderFriendBook();applyTheme();syncSettings();renderDays();renderProgram();renderPosters();renderMySchedule();renderGalleryNotes();await renderGallery();
      toast("All personal data for this conference was deleted");
    }catch(error){console.error(error);toast("Personal data could not be completely deleted. Please try again.");}
    finally{personalDataDeleting=false;if(button){button.disabled=false;button.textContent="Delete all";}}
  }

  function setupConferenceUi() {
    const roomIds=[...new Set(ITEMS.map(e=>e.locationId).filter(Boolean))];
    const roomFilters=$("#roomFilters");
    if (roomFilters) roomFilters.innerHTML = `<button class="chip active" data-room="all">All locations</button>` + roomIds.map(id=>`<button class="chip" data-room="${esc(id)}">${esc(locationLabel(id))}</button>`).join("");

    const trackIds=[...new Set(ITEMS.map(e=>e.trackId).filter(Boolean))];
    const trackFilters=$("#trackFilters");
    if (trackFilters) trackFilters.innerHTML = trackIds.length>1 ? `<button class="chip active" data-track="all">All tracks</button>` + trackIds.map(id=>`<button class="chip" data-track="${esc(id)}">${esc(MODEL.trackById.get(id)?.name || id)}</button>`).join("") : "";

    const categories=[...new Set(POSTERS.map(p=>p.category).filter(Boolean))];
    const posterFilters=$("#posterFilters");
    if (posterFilters) posterFilters.innerHTML = `<button class="chip active" data-category="all">All</button>` + categories.map(c=>`<button class="chip" data-category="${esc(c)}">${esc(c)}</button>`).join("");

    const postersEnabled=!!CONFERENCE.features?.posters && POSTERS.length>0;
    $("#postersView")?.toggleAttribute("hidden",!postersEnabled);
    $("#postersNavBtn")?.toggleAttribute("hidden",!postersEnabled);
    const friendsEnabled=!!CONFERENCE.features?.friendBook;
    $("#friendView")?.toggleAttribute("hidden",!friendsEnabled);
    $("#friendsNavBtn")?.toggleAttribute("hidden",!friendsEnabled);
    $("#myCardSection")?.toggleAttribute("hidden",!friendsEnabled);
    $("#calendarSection")?.toggleAttribute("hidden",!CONFERENCE.features?.calendarExport);

    const timeHelp=$("#conferenceTimeHelp"); if(timeHelp) timeHelp.textContent=`Programme times use ${CONFERENCE.timezoneLabel || CONFERENCE.timezone || "the conference timezone"}.`;
    const timeOption=$("#timeModeSelect option[value=conference]"); if(timeOption) timeOption.textContent=CONFERENCE.city || "Conference";

    const locList=$("#conferenceLocations");
    if(locList){
      const venues=LOCATION_ROWS.filter(x=>x.type!=="room");
      locList.innerHTML=venues.map(v=>{const rooms=LOCATION_ROWS.filter(r=>r.parentLocationId===v.id).map(r=>r.name).join(", "); const desc=[rooms,v.description,v.address].filter(Boolean).join(" · "); const body=`<div><strong>${esc(v.name)}</strong><p>${esc(desc)}</p></div><span>↗</span>`,mapUrl=normalizeWebUrl(v.mapUrl); return mapUrl?`<a class="source-card venue-card" href="${esc(mapUrl)}" target="_blank" rel="noopener noreferrer">${body}</a>`:`<div class="source-card venue-card">${body}</div>`;}).join("");
      $("#locationsSection")?.toggleAttribute("hidden",!venues.length);
    }
    const info=$("#officialConferenceInfo");
    if(info){
      const links=(CONFERENCE.links||[]).map(l=>({link:l,url:normalizeExternalLink(l.url)})).filter(x=>x.url).map(({link,url})=>`<a class="source-card" href="${esc(url)}" target="_blank" rel="noopener noreferrer"><div><strong>${esc(link.label)}</strong><p>${esc(link.description||"")}</p></div><span>↗</span></a>`).join("");
      const sponsorLogos=Array.isArray(BRANDING.sponsorLogos)?BRANDING.sponsorLogos:null;
      const sponsors=sponsorLogos
        ?sponsorLogos.map(item=>{const light=item.light?packageAssetUrl(item.light):'',dark=item.dark?packageAssetUrl(item.dark):'',initial=light||dark,height=Math.max(20,Math.min(120,Number(item.height)||48));return initial?`<img src="${esc(initial)}" data-light="${esc(light)}" data-dark="${esc(dark)}" alt="${esc(item.name||'Sponsor or partner logo')}" style="height:${height}px" loading="lazy">`:'';}).join("")
        :(BRANDING.sponsorAssets||[]).map(src=>`<img src="${esc(packageAssetUrl(src))}" alt="Sponsor or partner logo" loading="lazy">`).join("");
      const contactEmail=normalizeEmail(CONFERENCE.contactEmail);
      info.innerHTML=`<div class="official-info-card"><strong>${esc(CONFERENCE.fullName || CONFERENCE.name || "Conference")}</strong><p>${esc(CONFERENCE.startDate||"")}–${esc(CONFERENCE.endDate||"")}${CONFERENCE.city?` · ${esc(CONFERENCE.city)}`:""}</p>${contactEmail?`<a href="mailto:${esc(contactEmail)}">${esc(contactEmail)}</a>`:""}</div>${links?`<div class="location-list source-links">${links}</div>`:""}${sponsors?`<div class="sponsor-grid">${sponsors}</div>`:""}`;
    }
  }

  async function setupDataReleaseUi() {
    const manifest=CONFIG.manifest||{};
    const status=$("#dataReleaseStatus"),changes=$("#dataReleaseChanges"),rollback=$("#rollbackDataBtn");
    const published=manifest.publishedAt?new Date(manifest.publishedAt):null;
    const publishedText=published&&!Number.isNaN(published.getTime())?published.toLocaleString(undefined,{dateStyle:"medium",timeStyle:"short"}):String(manifest.publishedAt||"");
    let diagnostics=null;try{diagnostics=await SERVICES.getPackageDiagnostics?.();}catch{}
    const rollbackActive=!!(CONFIG.rollbackActive||LOAD_INFO.rollbackActive||diagnostics?.rollbackActive);
    if(status) status.textContent=`Data v${manifest.dataVersion ?? "?"} · schema ${manifest.schemaVersion ?? "?"}${publishedText?` · published ${publishedText}`:""} · ${CONFIG.packageSource||"validated package"}${rollbackActive?" · rollback active":""}`;
    const notice=$("#rollbackNotice"),resume=$("#resumeDataUpdatesBtn");if(notice)notice.hidden=!rollbackActive;if(resume)resume.hidden=!rollbackActive;
    const releaseChanges=(LOAD_INFO.changes?.length?LOAD_INFO.changes:(manifest.changelog||[]).slice(-3)).slice(-5).reverse();
    const warnings=CONFIG.packageWarnings||[];
    if(changes) changes.innerHTML=[...releaseChanges.map(c=>`<div class="data-release-change"><strong>v${esc(c.version ?? "?")}</strong>${esc(c.message||"Conference data release")}</div>`),...warnings.map(w=>`<div class="data-release-change"><strong>Notice</strong>${esc(w)}</div>`)].join("");
    if(rollback)rollback.hidden=rollbackActive||!(diagnostics?.records?.length>1);
  }

  function syncSettings() {
    $("#themeSelect").value=state.theme;
    $("#timeModeSelect").value=state.timeMode;
    $("#compactToggle").setAttribute("aria-checked",state.compact?"true":"false");
    $$("#roomFilters .chip").forEach(x=>x.classList.toggle("active",x.dataset.room===state.locationId));
    $$("#trackFilters .chip").forEach(x=>x.classList.toggle("active",x.dataset.track===state.track));
    $$("#posterFilters .chip").forEach(x=>x.classList.toggle("active",x.dataset.category===state.posterCategory));
  }

  function wire() {
    $("#programSearch").addEventListener("input",renderProgram);
    $("#posterSearch").addEventListener("input",renderPosters);

    $$("#roomFilters .chip").forEach(btn => btn.addEventListener("click",()=>{
      state.locationId=btn.dataset.room; saveState(); syncSettings(); renderProgram();
    }));
    $$("#trackFilters .chip").forEach(btn => btn.addEventListener("click",()=>{
      state.track=btn.dataset.track; saveState(); syncSettings(); renderProgram();
    }));
    $$("#posterFilters .chip").forEach(btn => btn.addEventListener("click",()=>{
      state.posterCategory=btn.dataset.category; saveState(); syncSettings(); renderPosters();
    }));
    $$(".nav-btn").forEach(btn=>btn.addEventListener("click",()=>showView(btn.dataset.target)));

    $("#smartPhotoImportBtn").addEventListener("click",()=>$("#smartPhotoInput").click());
    $("#smartPhotoInput").addEventListener("change",async e=>{
      await beginSmartPhotoImport(e.target.files);
      e.target.value="";
    });
    $("#photoImportList").addEventListener("change",e=>{
      const select=e.target.closest("[data-import-select]");
      if (!select) return;
      const item=pendingPhotoImports[Number(select.dataset.importSelect)];
      if (item) {
        item.selectedKey=select.value;
        renderPhotoImportReview();
      }
    });

    $("#photoImportList").addEventListener("click",e=>{
      const btn=e.target.closest("[data-import-unclassified]");
      if (!btn) return;
      const index=Number(btn.dataset.importUnclassified);
      const item=pendingPhotoImports[index];
      if (!item) return;
      item.selectedKey="unclassified:unclassified";
      renderPhotoImportReview();
    });
    $("#photoImportSave").addEventListener("click",saveSmartPhotoAssignments);
    $("#photoImportCancel").addEventListener("click",closePhotoImportDialog);
    $("#photoImportClose").addEventListener("click",closePhotoImportDialog);
    $("#photoImportDialog").addEventListener("click",e=>{ if(e.target===$("#photoImportDialog")) closePhotoImportDialog(); });

    $$(".gallery-tab").forEach(btn => btn.addEventListener("click", () => {
      state.galleryMode = btn.dataset.galleryPanel === "notes" ? "notes" : "photos";
      saveState();
      if (state.galleryMode === "notes") renderGalleryNotes();
      syncGalleryMode();
    }));

    let galleryPhotoSearchTimer = null;
    $("#galleryPhotoSearch").addEventListener("input", e => {
      galleryPhotoQuery = e.target.value;
      clearTimeout(galleryPhotoSearchTimer);
      galleryPhotoSearchTimer = setTimeout(() => renderGallery(), 120);
    });

    $("#galleryNoteSearch").addEventListener("input", e => {
      galleryNoteQuery = e.target.value;
      renderGalleryNotes();
    });

    $("#galleryNotesContent").addEventListener("click", e => {
      const card = e.target.closest("[data-note-owner-type]");
      if (!card) return;
      card.dataset.noteOwnerType === "poster"
        ? openPoster(card.dataset.noteOwnerId)
        : openEvent(card.dataset.noteOwnerId);
    });

    $("#galleryContent").addEventListener("click", async e => {
      const del = e.target.closest("[data-gallery-delete]");
      if (del) {
        e.stopPropagation();
        if (confirm("Delete this photo from the presentation?")) {
          await deletePhoto(del.dataset.galleryDelete);
          await renderGallery();
          toast("Photo deleted");
        }
        return;
      }
      const thumb = e.target.closest("[data-gallery-photo]");
      if (thumb) {
        const galleryIds = [...$("#galleryContent").querySelectorAll("[data-gallery-photo]")]
          .map(node => node.dataset.galleryPhoto);
        openStoredPhoto(thumb.dataset.galleryPhoto, galleryIds);
        return;
      }
      const owner = e.target.closest("[data-gallery-owner-type]");
      if (owner) {
        const type = owner.dataset.galleryOwnerType;
        if (type === "unclassified") return;
        type === "poster" ? openPoster(owner.dataset.galleryOwnerId) : openEvent(owner.dataset.galleryOwnerId);
      }
    });

    $("#nowBtn").addEventListener("click", jumpToNow);

    $("#statusCard").addEventListener("click", () => {
      if ($("#statusCard").classList.contains("status-clickable")) jumpToNow();
    });
    $("#statusCard").addEventListener("keydown", e => {
      if (!$("#statusCard").classList.contains("status-clickable")) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        jumpToNow();
      }
    });

    $("#themeSelect").addEventListener("change",e=>{state.theme=e.target.value;saveState();applyTheme();});
    $("#timeModeSelect").addEventListener("change",e=>{state.timeMode=e.target.value;saveState();renderProgram();renderMySchedule();});
    $("#compactToggle").addEventListener("click",()=>{
      state.compact=!state.compact;saveState();applyTheme();syncSettings();
    });
    $("#exportBtn").addEventListener("click",exportState);
    $("#exportPptxBtn").addEventListener("click",exportNotesPhotosPptx);
    $("#importBtn").addEventListener("click",()=>$("#importInput").click());
    $("#importInput").addEventListener("change",e=>{if(e.target.files[0])importState(e.target.files[0]);e.target.value="";});
    $("#installBtn").addEventListener("click", installApp);
    $("#installDialogClose")?.addEventListener("click",()=>$("#installDialog").close());
    $("#installDialogDone")?.addEventListener("click",()=>$("#installDialog").close());
    $("#exportStarredIcsBtn")?.addEventListener("click",exportStarredCalendar);
    $("#exportFullIcsBtn")?.addEventListener("click",exportFullCalendar);
    $("#rollbackDataBtn")?.addEventListener("click",async()=>{
      if(!SERVICES.rollbackConferencePackage)return;
      if(!confirm("Switch to the previous locally validated conference-data release? Automatic updates will stay paused across reloads until you choose Resume automatic updates."))return;
      try{await SERVICES.rollbackConferencePackage();location.reload();}catch(err){console.error(err);toast(err?.message||"No previous release is available");}
    });
    $("#resumeDataUpdatesBtn")?.addEventListener("click",async()=>{
      if(!SERVICES.resumeConferencePackageUpdates)return;
      try{await SERVICES.resumeConferencePackageUpdates();location.reload();}catch(err){console.error(err);toast(err?.message||"Could not resume automatic updates");}
    });

    $("#editProfileBtn")?.addEventListener("click",beginProfileEdit);
    $("#saveProfileBtn")?.addEventListener("click",saveProfile);
    $("#cancelProfileBtn")?.addEventListener("click",cancelProfileEdit);
    $("#profilePhotoInput")?.addEventListener("change",async e=>{const file=e.target.files?.[0];if(!file)return;const epoch=personalDataEpoch,photoBlob=await prepareImageBlob(file);if(personalDataDeleting||epoch!==personalDataEpoch)return;profileDraft={...(profileDraft||profile),photoBlob};renderProfilePhoto(profileDraft);e.target.value="";});
    $("#clearProfilePhotoBtn")?.addEventListener("click",()=>{profileDraft={...(profileDraft||profile)};delete profileDraft.photoBlob;renderProfilePhoto(profileDraft);});
    $("#friendShareBtn")?.addEventListener("click",openShareQr);
    $("#downloadVcardBtn")?.addEventListener("click",downloadMyVcard);
    $("#scanFriendBtn")?.addEventListener("click",openFriendQrScan);
    $("#importVcardBtn")?.addEventListener("click",()=>$("#friendVcardInput")?.click());
    $("#friendVcardInput")?.addEventListener("change",async e=>{const f=e.target.files[0];if(f)await addFriendFromVCard(await f.text());e.target.value="";});
    $("#qrScanClose")?.addEventListener("click",()=>stopFriendQrScan());
    $("#qrScanCancel")?.addEventListener("click",()=>stopFriendQrScan());
    $("#qrScanDialog")?.addEventListener("cancel",e=>{e.preventDefault();stopFriendQrScan();});
    $("#shareQrViewer")?.addEventListener("cancel",e=>{e.preventDefault();closeShareQr();});
    $("#photoViewer")?.addEventListener("cancel",e=>{e.preventDefault();closePhotoViewer();});
    $("#photoViewer")?.addEventListener("click",e=>{if(e.target===$("#photoViewer"))closePhotoViewer();});
    $("#friendList")?.addEventListener("input",e=>{
      const metEvent=e.target.closest("[data-friend-event]");if(metEvent){saveFriendPrivate(metEvent.dataset.friendEvent,"metAtEventId",metEvent.value);return;}
      const metAt=e.target.closest("[data-friend-met-at]");if(metAt){clearTimeout(metAt._saveTimer);metAt._saveTimer=setTimeout(()=>saveFriendPrivate(metAt.dataset.friendMetAt,"metAt",metAt.value),250);return;}
      const note=e.target.closest("[data-friend-note]");if(note){clearTimeout(note._saveTimer);note._saveTimer=setTimeout(()=>saveFriendPrivate(note.dataset.friendNote,"privateNotes",note.value),250);return;}
      const tags=e.target.closest("[data-friend-tags]");if(tags){clearTimeout(tags._saveTimer);tags._saveTimer=setTimeout(()=>saveFriendPrivate(tags.dataset.friendTags,"tags",tags.value),250);}
    });
    $("#friendList")?.addEventListener("click",async e=>{
      const toggle=e.target.closest("[data-friend-toggle]");if(toggle){const id=toggle.dataset.friendToggle;if(expandedFriendIds.has(id))expandedFriendIds.delete(id);else expandedFriendIds.add(id);renderFriendBook();return;}
      const del=e.target.closest("[data-friend-delete]");if(!del)return;if(confirm("Delete this Friend Book contact?")){await trackPersonalWrite(USER_STORE.deleteFriend(del.dataset.friendDelete));friends=friends.filter(x=>x.id!==del.dataset.friendDelete);expandedFriendIds.delete(del.dataset.friendDelete);renderFriendBook();toast("Contact deleted");}
    });

    $("#shareQrClose").addEventListener("click", closeShareQr);
    $("#shareQrViewer").addEventListener("click", e => {
      if (e.target === $("#shareQrViewer")) closeShareQr();
    });

    $("#clearBtn").addEventListener("click",()=>{
      if (!state.favorites.length && !state.posterFavorites.length) return toast("No favorites to clear");
      if (confirm("Clear all starred talks and posters?")) {
        state.favorites=[];state.posterFavorites=[];saveState();renderProgram();renderPosters();renderMySchedule();toast("Favorites cleared");
      }
    });
    $("#deletePersonalDataBtn")?.addEventListener("click",deleteAllPersonalData);

    let noteSaveRevision = 0;
    $("#modalContent").addEventListener("input", async e => {
      const note = e.target.closest("#modalNote");
      if (!note) return;
      const revision=++noteSaveRevision,status=$("#noteSaveStatus");
      if(status)status.textContent="Saving…";
      const saved=await saveNote(note.dataset.noteType,note.dataset.noteId,note.value);
      if(revision===noteSaveRevision&&status?.isConnected)status.textContent=saved?"Saved":"Could not save; please try again";
    });

    $("#modalContent").addEventListener("click", async e => {
      const calendarBtn = e.target.closest("#modalCalendarBtn");
      if (calendarBtn && currentModal?.type === "event") {
        exportSingleCalendar(currentModal.id);
        return;
      }
      const takeBtn = e.target.closest("#modalTakePhoto");
      if (takeBtn) {
        $("#cameraInput").click();
        return;
      }

      const addBtn = e.target.closest("#modalAddPhotos");
      if (addBtn) {
        $("#photoInput").click();
        return;
      }
      const delBtn = e.target.closest("[data-photo-delete]");
      if (delBtn) {
        e.stopPropagation();
        if (confirm("Delete this photo from the presentation?")) {
          await deletePhoto(delBtn.dataset.photoDelete);
          await renderModalPhotos();
          renderGallery();
          toast("Photo deleted");
        }
        return;
      }
      const thumb = e.target.closest("[data-photo-id]");
      if (thumb) {
        const presentationIds = [...$("#modalPhotos").querySelectorAll("[data-photo-id]")]
          .map(node => node.dataset.photoId);
        openStoredPhoto(thumb.dataset.photoId, presentationIds);
      }
    });
    $("#cameraInput").addEventListener("change", async e => {
      const files = e.target.files;
      await addSelectedPhotos(files, {saveDeviceCopy:true});
      e.target.value = "";
    });

    $("#photoInput").addEventListener("change", async e => {
      const files = e.target.files;
      await addSelectedPhotos(files);
      e.target.value = "";
    });
    $("#photoViewerClose").addEventListener("click", closePhotoViewer);
    $("#photoViewerPrev").addEventListener("click", e => {
      e.stopPropagation();
      movePhotoViewer(-1);
    });
    $("#photoViewerNext").addEventListener("click", e => {
      e.stopPropagation();
      movePhotoViewer(1);
    });

    const markPhotoMetaSaving = () => {
      const status = $("#photoViewerSaveStatus");
      if (status) status.textContent = "Saving…";
    };

    const markPhotoMetaSaved = () => {
      const status = $("#photoViewerSaveStatus");
      if (status) status.textContent = "Saved";
    };

    $("#photoViewerAssignment").addEventListener("change", async e => {
      const photoId = e.target.dataset.photoId;
      if (!photoId || !e.target.value) return;
      const target = assignmentFromKey(e.target.value);
      try {
        await updatePhotoAssignment(photoId, target.type, target.id);
        const photo = await getPhoto(photoId);
        const owner = $("#photoViewerOwner");
        if (owner && photo) owner.textContent = photoOwnerLabel(photo);
        if (photo) e.target.innerHTML = photoViewerAssignmentOptions(photo);
        await renderGallery();
        toast(target.type === "unclassified" ? "Photo set to Unclassified" : "Photo assignment updated");
      } catch (err) {
        console.error(err);
        toast("Could not update photo assignment");
      }
    });

    $("#photoViewerTitle").addEventListener("input", e => {
      const photoId = e.target.dataset.photoId;
      if (!photoId) return;
      markPhotoMetaSaving();
      clearTimeout(photoMetaSaveTimer);
      photoMetaSaveTimer = setTimeout(async () => {
        try {
          await updatePhotoTitle(photoId, e.target.value);
          await renderGallery();
          markPhotoMetaSaved();
        } catch (err) {
          console.error(err);
          toast("Could not save photo title");
        }
      }, 250);
    });

    $("#photoViewerTitle").addEventListener("change", async e => {
      const photoId = e.target.dataset.photoId;
      if (!photoId) return;
      clearTimeout(photoMetaSaveTimer);
      try {
        await updatePhotoTitle(photoId, e.target.value);
        await renderGallery();
        markPhotoMetaSaved();
      } catch (err) {
        console.error(err);
        toast("Could not save photo title");
      }
    });

    $("#photoViewerNote").addEventListener("input", e => {
      const photoId = e.target.dataset.photoId;
      if (!photoId) return;
      markPhotoMetaSaving();
      clearTimeout(photoMetaSaveTimer);
      photoMetaSaveTimer = setTimeout(async () => {
        try {
          await updatePhotoNote(photoId, e.target.value);
          await renderGallery();
          markPhotoMetaSaved();
        } catch (err) {
          console.error(err);
          toast("Could not save photo notes");
        }
      }, 250);
    });

    $("#photoViewerNote").addEventListener("change", async e => {
      const photoId = e.target.dataset.photoId;
      if (!photoId) return;
      clearTimeout(photoMetaSaveTimer);
      try {
        await updatePhotoNote(photoId, e.target.value);
        await renderGallery();
        markPhotoMetaSaved();
      } catch (err) {
        console.error(err);
        toast("Could not save photo notes");
      }
    });
    $("#photoViewer").addEventListener("click", e => {
      if (e.target === $("#photoViewer") || e.target === $("#photoViewerStage")) closePhotoViewer();
    });

    let photoSwipeStartX = null;
    let photoSwipeStartY = null;
    $("#photoViewerStage").addEventListener("touchstart", e => {
      const touch = e.touches[0];
      if (!touch) return;
      photoSwipeStartX = touch.clientX;
      photoSwipeStartY = touch.clientY;
    }, {passive:true});
    $("#photoViewerStage").addEventListener("touchend", e => {
      if (photoSwipeStartX == null || photoSwipeStartY == null) return;
      const touch = e.changedTouches[0];
      if (!touch) return;
      const dx = touch.clientX - photoSwipeStartX;
      const dy = touch.clientY - photoSwipeStartY;
      photoSwipeStartX = null;
      photoSwipeStartY = null;
      if (Math.abs(dx) < 45 || Math.abs(dx) <= Math.abs(dy)) return;
      movePhotoViewer(dx < 0 ? 1 : -1);
    }, {passive:true});
    document.addEventListener("keydown", e => {
      keepDialogFocusInside(e);
      if (!$("#photoViewer").hidden) {
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          movePhotoViewer(-1);
          return;
        }
        if (e.key === "ArrowRight") {
          e.preventDefault();
          movePhotoViewer(1);
          return;
        }
      }

      if (e.key !== "Escape") return;
      if (!$("#shareQrViewer").hidden) {
        closeShareQr();
        return;
      }
      if (!$("#photoViewer").hidden) closePhotoViewer();
    });

    $("#modalClose").addEventListener("click",()=>$("#detailModal").close());
    $("#detailModal").addEventListener("click",e=>{ if(e.target===$("#detailModal")) $("#detailModal").close(); });
    $("#detailModal").addEventListener("close",()=>{if(!photoViewerReturnToDetail)currentModal=null;});
    $("#modalStar").addEventListener("click",()=>{
      if (!currentModal) return;
      currentModal.type==="event" ? toggleEventFavorite(currentModal.id) : togglePosterFavorite(currentModal.id);
    });

    matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change",()=>{if(state.theme==="system")applyTheme();});
    matchMedia("(display-mode: standalone)").addEventListener?.("change",updateInstallUI);
    document.addEventListener("visibilitychange",()=>{if(document.hidden&&($("#qrScanDialog")?.open||qrScanner))stopFriendQrScan();});
    window.addEventListener("pagehide",()=>stopFriendQrScan());
  }

  function showEngineUpdateNotice() {
    if (document.querySelector(".update-banner")) return;
    const banner=document.createElement("div");banner.className="update-banner";banner.textContent="App update ready — it will apply on the next clean launch.";document.body.appendChild(banner);
    setTimeout(()=>banner.remove(),8000);
  }

  async function registerServiceWorker() {
    if (new URLSearchParams(location.search).get('builderPreview')==='1') return;
    if (!("serviceWorker" in navigator)) return;
    try {
      const reg=await navigator.serviceWorker.register("./service-worker.js", {scope:"./",updateViaCache:"none"});
      if (reg.waiting) showEngineUpdateNotice();
      reg.addEventListener("updatefound",()=>{const worker=reg.installing;if(!worker)return;worker.addEventListener("statechange",()=>{if(worker.state==="installed"&&navigator.serviceWorker.controller)showEngineUpdateNotice();});});
    } catch (err) { console.warn("Service worker registration failed",err); }
  }

  async function init() {
    profile=await USER_STORE?.getProfile().catch(()=>({})) || {};
    friends=await USER_STORE?.listFriends().catch(()=>([])) || [];
    state.day = state.day || detectConferenceDay();
    setupConferenceUi();
    await setupDataReleaseUi();
    if(LOAD_INFO.updated){const latest=(LOAD_INFO.changes||[]).at(-1);toast(`Programme updated to data v${CONFIG.manifest?.dataVersion}${latest?.message?` · ${latest.message}`:""}`);}
    fillProfileForm();
    renderFriendBook();
    applyTheme();
    renderDays();
    syncSettings();
    wire();
    renderProgram();
    renderAnnouncements();
    renderPosters();
    renderMySchedule();
    renderGalleryNotes();
    await renderGallery();
    showView(state.view || "program");
    updateInstallUI();
    registerServiceWorker();
  }

  window.addEventListener("conferenceinstallprompt", () => {
    deferredInstallPrompt = window.CONFERENCE_INSTALL_PROMPT || null;
    updateInstallUI();
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    window.CONFERENCE_INSTALL_PROMPT = null;
    updateInstallUI();
    toast(`${CONFERENCE.shortName || "Conference app"} installed`);
  });

  window.CONFERENCE_APP_READY=init();
  window.CONFERENCE_APP_READY.then(()=>{window.CONFERENCE_APP_INITIALIZED=true;},()=>{});
})();
