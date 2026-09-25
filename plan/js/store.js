// App state: current plan, selection, settings, undo/redo, autosave and a tiny event bus.
//
// Events:  'change'   (plan mutated; payload { label })
//          'select'   (selection changed; payload selection)
//          'settings' (settings changed)
//          'tab'      (tab switched; payload tab id)
//          'focus'    (request another view to focus something; payload { kind, id })

import { clonePlan, normalizePlan } from './model.js';
import { samplePlan } from './sample.js';

const KEY = 'mr3dfloor.plan.v1';
const SKEY = 'mr3dfloor.settings.v1';

const safeGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const safeSet = (k, v) => { try { localStorage.setItem(k, v); return true; } catch { return false; } };

const listeners = new Map();

function loadSettings() {
  const def = { units: 'metric', lang: (navigator.language || 'en').startsWith('fr') ? 'fr' : 'en', dimMode: 'inside', showFurniture: true, showDims: true, showChains: true, showGrid: true, snap: true, showPhotos: true };
  try { return Object.assign(def, JSON.parse(safeGet(SKEY) || '{}')); } catch { return def; }
}

function loadPlan() {
  try {
    const raw = safeGet(KEY);
    if (raw) return normalizePlan(JSON.parse(raw));
  } catch { /* fall through */ }
  return samplePlan();
}

export const store = {
  plan: loadPlan(),
  selection: null,          // { kind: 'wall'|'node'|'opening'|'object'|'room'|'photo'|'note', id }
  settings: loadSettings(),
  tab: 'plan',
  undoStack: [],
  redoStack: [],

  on(evt, fn) { if (!listeners.has(evt)) listeners.set(evt, new Set()); listeners.get(evt).add(fn); return () => listeners.get(evt).delete(fn); },
  emit(evt, payload) { for (const fn of listeners.get(evt) || []) { try { fn(payload); } catch (e) { console.error(e); } } },

  /** Mutate the plan inside fn(plan); records an undo step. Returns fn's result. */
  commit(label, fn) {
    const before = JSON.stringify(this.plan);
    const res = fn(this.plan);
    const after = JSON.stringify(this.plan);
    if (before !== after) {
      this.undoStack.push({ label, json: before });
      if (this.undoStack.length > 200) this.undoStack.shift();
      this.redoStack = [];
      this.save();
      this.emit('change', { label });
    }
    return res;
  },

  /** Begin a continuous gesture (drag): snapshot now, apply live updates with live(), finish with end(). */
  beginGesture(label) {
    const before = JSON.stringify(this.plan);
    return {
      live: () => this.emit('change', { label, live: true }),
      end: () => {
        if (JSON.stringify(this.plan) !== before) {
          this.undoStack.push({ label, json: before });
          this.redoStack = [];
          this.save();
        }
        this.emit('change', { label });
      },
      cancel: () => { this.plan = normalizePlan(JSON.parse(before)); this.emit('change', { label }); },
    };
  },

  undo() {
    const s = this.undoStack.pop(); if (!s) return;
    this.redoStack.push({ label: s.label, json: JSON.stringify(this.plan) });
    this.plan = normalizePlan(JSON.parse(s.json));
    this.validateSelection(); this.save(); this.emit('change', { label: 'undo' });
  },
  redo() {
    const s = this.redoStack.pop(); if (!s) return;
    this.undoStack.push({ label: s.label, json: JSON.stringify(this.plan) });
    this.plan = normalizePlan(JSON.parse(s.json));
    this.validateSelection(); this.save(); this.emit('change', { label: 'redo' });
  },

  replacePlan(p, label = 'open') {
    this.undoStack.push({ label, json: JSON.stringify(this.plan) });
    this.redoStack = [];
    this.plan = normalizePlan(clonePlan(p));
    this.selection = null;
    this.save();
    this.emit('change', { label });
    this.emit('select', null);
  },

  select(sel) {
    this.selection = sel && sel.id != null ? sel : null;
    this.emit('select', this.selection);
  },

  validateSelection() {
    const s = this.selection; if (!s) return;
    const p = this.plan;
    const ok = s.kind === 'node' ? !!p.nodes[s.id]
      : ({ wall: p.walls, opening: p.openings, object: p.objects, room: p.rooms, photo: p.photos, note: p.notes }[s.kind] || []).some((x) => x.id === s.id);
    if (!ok) this.select(null);
  },

  setSetting(k, val) { this.settings[k] = val; safeSet(SKEY, JSON.stringify(this.settings)); this.emit('settings', this.settings); },

  save() { safeSet(KEY, JSON.stringify(this.plan)); },
};

// ---------------------------------------------------------------- photo blobs (IndexedDB)
// Photos added by the user are stored as Blobs keyed by photo id; sample photos use `src`.

const DB = 'mr3dfloor', OS = 'photos';
let dbp = null;
function db() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    try {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(OS);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    } catch (e) { reject(e); }
  });
  return dbp;
}
const urlCache = new Map();

export const photoBlobs = {
  async put(id, blob) {
    const d = await db();
    await new Promise((res, rej) => { const tx = d.transaction(OS, 'readwrite'); tx.objectStore(OS).put(blob, id); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
    if (urlCache.has(id)) { URL.revokeObjectURL(urlCache.get(id)); urlCache.delete(id); }
  },
  async get(id) {
    try {
      const d = await db();
      return await new Promise((res, rej) => { const r = d.transaction(OS).objectStore(OS).get(id); r.onsuccess = () => res(r.result || null); r.onerror = () => rej(r.error); });
    } catch { return null; }
  },
  async remove(id) {
    try { const d = await db(); d.transaction(OS, 'readwrite').objectStore(OS).delete(id); } catch { /* ignore */ }
  },
};

/** URL to display a photo record (sample src or stored blob). Resolves null if missing. */
export async function photoURL(photo) {
  if (photo.src) return photo.src;
  if (urlCache.has(photo.id)) return urlCache.get(photo.id);
  const b = await photoBlobs.get(photo.id);
  if (!b) return null;
  const u = URL.createObjectURL(b);
  urlCache.set(photo.id, u);
  return u;
}
