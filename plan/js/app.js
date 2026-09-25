// App shell: header, tabs, menus, import/export, lazy-loaded views.

import { store } from './store.js';
import { t } from './i18n.js';
import { setUnits, setDecimalComma, fmtLen, fmtArea } from './units.js';
import * as M from './model.js';
import { samplePlan } from './sample.js';
import { icon } from './icons.js';
import { createPlanView } from './editor.js';
import { createSummaryView, scheduleCSV } from './summary.js';

const TABS = ['summary', 'plan', 'model', 'photo'];
const app = document.getElementById('app');

function applySettings() {
  setUnits(store.settings.units);
  setDecimalComma(store.settings.lang === 'fr');
  document.documentElement.lang = store.settings.lang === 'fr' ? 'fr-CA' : 'en';
  if (store.settings.theme && store.settings.theme !== 'auto') document.documentElement.dataset.theme = store.settings.theme;
  else delete document.documentElement.dataset.theme;
}
applySettings();

app.innerHTML = `
<header class="top">
  <a class="icon-btn back" href="../" aria-label="MR 3D Floor">${icon('back')}</a>
  <div class="title"><input class="plan-name" aria-label="${t('name')}" spellcheck="false"><div class="sub"></div></div>
  <div class="top-actions">
    <button class="icon-btn" data-act="undo" aria-label="${t('undo')}" title="${t('undo')} (⌘Z)">${icon('undo')}</button>
    <button class="icon-btn" data-act="redo" aria-label="${t('redo')}" title="${t('redo')} (⇧⌘Z)">${icon('redo')}</button>
    <button class="icon-btn more" data-act="menu" aria-label="${t('export')}" aria-haspopup="menu">${icon('more')}</button>
  </div>
</header>
<nav class="tabs" role="tablist">${TABS.map((id) => `<button role="tab" data-tab="${id}">${t(id)}</button>`).join('')}<span class="tab-ind"></span></nav>
<div class="metrics" aria-live="polite"></div>
<main class="views">${TABS.map((id) => `<section class="view view-${id}" data-view="${id}" role="tabpanel" hidden></section>`).join('')}</main>
<div class="menu" role="menu" hidden></div>
<input type="file" class="import-input" accept=".json,application/json" hidden>
<div class="toast" hidden></div>`;

const $ = (s) => app.querySelector(s);
const views = {};
const viewEl = (id) => app.querySelector(`[data-view="${id}"]`);

// ---------------------------------------------------------------- header
const nameInput = $('.plan-name');
nameInput.addEventListener('change', () => store.commit('rename', (p) => { p.name = nameInput.value.trim() || p.name; }));
nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') nameInput.blur(); });

function renderHeader() {
  const p = store.plan;
  if (document.activeElement !== nameInput) nameInput.value = p.name;
  const tk = M.takeoff(p);
  $('.sub').textContent = `${fmtLen(tk.width)} × ${fmtLen(tk.depth)} · ≈ ${fmtArea(tk.area)}`;
  $('.metrics').innerHTML = [
    [t('baseboard'), fmtLen(tk.baseboard, { forceM: true })],
    [t('doorTrim'), fmtLen(tk.doorTrim, { forceM: true })],
    [t('windowTrim'), fmtLen(tk.windowTrim, { forceM: true })],
    [t('openingTrim'), fmtLen(tk.openingTrim, { forceM: true })],
  ].map(([k, v]) => `<span><em>${k}</em> ${v}</span>`).join('');
  app.querySelector('[data-act="undo"]').disabled = !store.undoStack.length;
  app.querySelector('[data-act="redo"]').disabled = !store.redoStack.length;
  document.title = `${p.name} — MR 3D Floor Studio`;
}

// ---------------------------------------------------------------- tabs
async function ensureView(id) {
  if (views[id]) return views[id];
  const el = viewEl(id);
  if (id === 'plan') views[id] = createPlanView(el);
  else if (id === 'summary') views[id] = createSummaryView(el);
  else if (id === 'model') {
    el.innerHTML = '<div class="loading">…</div>';
    try { const m = await import('./view3d.js'); el.innerHTML = ''; views[id] = m.createModelView(el); }
    catch (e) { console.error(e); el.innerHTML = `<p class="err">3D view unavailable: ${e.message}</p>`; views[id] = { activate() {}, deactivate() {} }; }
  } else if (id === 'photo') {
    el.innerHTML = '<div class="loading">…</div>';
    try { const m = await import('./photos.js'); el.innerHTML = ''; views[id] = m.createPhotoView(el); }
    catch (e) { console.error(e); el.innerHTML = `<p class="err">Photo viewer unavailable: ${e.message}</p>`; views[id] = { activate() {}, deactivate() {} }; }
  }
  return views[id];
}

let currentTab = null;
async function showTab(id, opts = {}) {
  if (!TABS.includes(id)) id = 'plan';
  if (currentTab && currentTab !== id) views[currentTab]?.deactivate?.();
  currentTab = id;
  store.tab = id;
  for (const b of app.querySelectorAll('.tabs [data-tab]')) { const on = b.dataset.tab === id; b.classList.toggle('is-on', on); b.setAttribute('aria-selected', on); }
  for (const s of app.querySelectorAll('.view')) s.hidden = s.dataset.view !== id;
  moveIndicator();
  app.dataset.tab = id;
  const v = await ensureView(id);
  if (currentTab !== id) return v;
  v.activate?.();
  if (!opts.noHash) history.replaceState(null, '', '#' + id);
  store.emit('tab', id);
  return v;
}
function moveIndicator() {
  const b = app.querySelector('.tabs .is-on'), ind = $('.tab-ind');
  if (!b) return;
  ind.style.width = b.offsetWidth + 'px';
  ind.style.transform = `translateX(${b.offsetLeft}px)`;
}
$('.tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) showTab(b.dataset.tab); });
window.addEventListener('resize', moveIndicator);

store.on('navigate', async ({ tab, focus }) => {
  const v = await showTab(tab);
  if (focus) {
    if (tab === 'photo' && focus.kind === 'photo') v.open?.(focus.id);
    else v.focus?.(focus);
  }
});

// ---------------------------------------------------------------- menu
const menu = $('.menu');
function menuHTML() {
  const s = store.settings;
  const item = (act, ic, label, extra = '') => `<button role="menuitem" data-act="${act}" ${extra}>${icon(ic)}<span>${label}</span></button>`;
  return `
    <div class="menu-sec"><h5>${t('export')}</h5>
      ${item('exportJSON', 'file', t('exportJSON'))}${item('exportSVG', 'plan', t('exportSVG'))}${item('exportPNG', 'photo', t('exportPNG'))}${item('exportCSV', 'list', t('exportCSV'))}${item('print', 'print', t('print'))}
    </div>
    <div class="menu-sec"><h5>${t('import')}</h5>
      ${item('importJSON', 'upload', t('import') + ' (.json)')}${item('sample', 'sparkle', t('sample'))}${item('new', 'plus', t('newPlan'))}
    </div>
    <div class="menu-sec"><h5>${t('settings')}</h5>
      <div class="menu-seg"><span>${t('units')}</span><div class="seg"><button data-set="units:metric" class="${s.units !== 'imperial' ? 'is-on' : ''}">m</button><button data-set="units:imperial" class="${s.units === 'imperial' ? 'is-on' : ''}">ft-in</button></div></div>
      <div class="menu-seg"><span>${t('language')}</span><div class="seg"><button data-set="lang:fr" class="${s.lang === 'fr' ? 'is-on' : ''}">FR</button><button data-set="lang:en" class="${s.lang !== 'fr' ? 'is-on' : ''}">EN</button></div></div>
      <div class="menu-seg"><span>☾</span><div class="seg"><button data-set="theme:auto" class="${!s.theme || s.theme === 'auto' ? 'is-on' : ''}">Auto</button><button data-set="theme:light" class="${s.theme === 'light' ? 'is-on' : ''}">☀︎</button><button data-set="theme:dark" class="${s.theme === 'dark' ? 'is-on' : ''}">☾</button></div></div>
    </div>`;
}
function openMenu() {
  menu.innerHTML = menuHTML();
  menu.hidden = false;
  setTimeout(() => document.addEventListener('pointerdown', closeOnOutside, { capture: true }), 0);
}
function closeMenu() { menu.hidden = true; document.removeEventListener('pointerdown', closeOnOutside, { capture: true }); }
function closeOnOutside(e) { if (!menu.contains(e.target) && !e.target.closest('[data-act="menu"]')) closeMenu(); }

app.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-act], [data-set]');
  if (!b || (b.closest('.view') && !b.closest('.menu'))) return;
  if (b.dataset.set) {
    const [k, v] = b.dataset.set.split(':');
    store.setSetting(k, v);
    applySettings();
    if (k === 'lang') { location.reload(); return; }
    menu.innerHTML = menuHTML();
    return;
  }
  const act = b.dataset.act;
  if (act === 'undo') return store.undo();
  if (act === 'redo') return store.redo();
  if (act === 'menu') return menu.hidden ? openMenu() : closeMenu();
  closeMenu();
  const p = store.plan;
  const base = (p.name || 'plan').replace(/[^\w\-]+/g, '_');
  if (act === 'exportJSON') download(`${base}.mr3dfloor.json`, new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' }));
  if (act === 'exportSVG') download(`${base}.svg`, new Blob([await planSVG()], { type: 'image/svg+xml' }));
  if (act === 'exportPNG') download(`${base}.png`, await svgToPNG(await planSVG(), 2));
  if (act === 'exportCSV') download(`${base}.csv`, new Blob(['﻿' + scheduleCSV(p)], { type: 'text/csv' }));
  if (act === 'print') printPlan();
  if (act === 'importJSON') $('.import-input').click();
  if (act === 'sample') { store.replacePlan(samplePlan(), 'sample'); views.plan?.fit(); toast(t('sample')); }
  if (act === 'new') { if (confirm(t('confirmNew'))) { store.replacePlan(M.emptyPlan(t('floor') + ' 1'), 'new'); showTab('plan'); } }
});

$('.import-input').addEventListener('change', async (e) => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (!data || typeof data !== 'object' || !data.nodes || !Array.isArray(data.walls)) throw new Error('Not an MR 3D Floor plan file');
    store.replacePlan(data, 'import');
    await showTab('plan');
    views.plan?.fit();
    toast(`${t('import')} ✓`);
  } catch (err) { toast('⚠︎ ' + err.message); }
});

function download(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

let planCSS = null;
async function planSVG() {
  await ensureView('plan');
  if (planCSS == null) { try { planCSS = await (await fetch('css/plan.css')).text(); } catch { planCSS = ''; } }
  return views.plan.exportSVG({ css: planCSS, background: getComputedStyle(document.documentElement).getPropertyValue('--surface').trim() || '#ffffff' });
}
function svgToPNG(svgText, scale = 2) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.width * scale; c.height = img.height * scale;
      const g = c.getContext('2d'); g.scale(scale, scale); g.drawImage(img, 0, 0);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG failed'))), 'image/png');
    };
    img.onerror = () => reject(new Error('SVG render failed'));
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgText);
  });
}
async function printPlan() {
  const svg = await planSVG();
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(`<!doctype html><title>${store.plan.name}</title><style>body{margin:0}svg{width:100%;height:auto}</style>${svg}<script>setTimeout(()=>print(),300)<\/script>`);
  w.document.close();
}

let toastTimer = 0;
function toast(msg) {
  const el = $('.toast');
  el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
}

// ---------------------------------------------------------------- wiring
store.on('change', (ev) => { if (!ev?.live) renderHeader(); });
store.on('settings', () => { applySettings(); renderHeader(); });
renderHeader();
showTab((location.hash || '#plan').slice(1), { noHash: true });
window.addEventListener('hashchange', () => showTab(location.hash.slice(1), { noHash: true }));

// Expose for debugging / automation.
window.mr3d = { store, showTab, views };
