// Summary tab: totals, per-room take-off, door & window schedule, wall list, object list.

import * as M from './model.js';
import { store } from './store.js';
import { t, lang } from './i18n.js';
import { fmtLen, fmtArea } from './units.js';
import { catalogLabel } from './catalog.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Stable, human wall labels: W1, W2… in plan order. */
export function wallLabels(plan) {
  const m = new Map();
  const p = lang() === 'fr' ? 'M' : 'W';
  plan.walls.forEach((w, i) => m.set(w.id, p + (i + 1)));
  return m;
}

/** Room name(s) on each side of a wall, for schedules. */
function wallRooms(plan, rooms, w) {
  const names = [];
  for (const f of rooms) {
    for (let i = 0; i < f.ids.length; i++) {
      const a = f.ids[i], b = f.ids[(i + 1) % f.ids.length];
      if ((w.a === a && w.b === b) || (w.a === b && w.b === a)) { names.push(f.room?.name || '—'); break; }
    }
  }
  return names.join(' / ');
}

export function scheduleRows(plan) {
  const rooms = M.computeRooms(plan);
  const labels = wallLabels(plan);
  return plan.openings.map((o, i) => {
    const w = M.wallById(plan, o.wallId);
    const L = M.wallLength(plan, w);
    return {
      mark: (o.type === 'window' ? 'F' : o.type === 'opening' ? 'O' : 'P') + (i + 1),
      id: o.id, type: o.type, wall: labels.get(w.id), rooms: wallRooms(plan, rooms, w),
      width: o.width, height: o.height, sill: o.sill, fromA: o.offset, fromB: L - o.offset - o.width,
    };
  });
}

export function createSummaryView(container) {
  let active = false;
  function render() {
    if (!active) return;
    const plan = store.plan;
    const tk = M.takeoff(plan);
    const rows = scheduleRows(plan);
    const labels = wallLabels(plan);
    const stat = (k, v, sub = '') => `<div class="card stat-card"><span>${k}</span><b>${v}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
    let h = `<div class="sum-wrap">
      <header class="sum-head"><h2>${esc(plan.name)}</h2><p>${fmtLen(tk.width)} × ${fmtLen(tk.depth)} · ≈ ${fmtArea(tk.area)}</p></header>
      <div class="stat-grid">
        ${stat(t('area'), fmtArea(tk.area), `${tk.rooms.length} ${t('rooms').toLowerCase()}`)}
        ${stat(t('baseboard'), fmtLen(tk.baseboard, { forceM: true }))}
        ${stat(t('doorTrim'), fmtLen(tk.doorTrim, { forceM: true }), `${tk.counts.doors} × ${t('door').toLowerCase()}`)}
        ${stat(t('windowTrim'), fmtLen(tk.windowTrim, { forceM: true }), `${tk.counts.windows} × ${t('window').toLowerCase()}`)}
        ${stat(t('openingTrim'), fmtLen(tk.openingTrim, { forceM: true }), `${tk.counts.openings} × ${t('opening').toLowerCase()}`)}
        ${stat(t('wallArea'), fmtArea(tk.wallArea))}
      </div>
      <section class="card"><h3>${t('rooms')}</h3><div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>${t('room')}</th><th class="n">${t('area')}</th><th class="n">${t('perimeter')}</th><th class="n">${t('baseboard')}</th><th class="n">${t('wallArea')}</th></tr></thead><tbody>`;
    for (const r of tk.rooms) {
      h += `<tr data-goto-kind="room" data-goto-id="${r.face.room?.id || ''}"><td>${esc(r.name || '—')}</td><td class="n">${fmtArea(r.area)}</td><td class="n">${fmtLen(r.perimeter, { forceM: true })}</td><td class="n">${fmtLen(r.baseboard, { forceM: true })}</td><td class="n">${fmtArea(r.wallArea)}</td></tr>`;
    }
    h += `</tbody><tfoot><tr><td>${t('total')}</td><td class="n">${fmtArea(tk.area)}</td><td></td><td class="n">${fmtLen(tk.baseboard, { forceM: true })}</td><td class="n">${fmtArea(tk.wallArea)}</td></tr></tfoot></table></div></section>`;

    h += `<section class="card"><h3>${t('openings')} — ${t('schedule')}</h3><div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>#</th><th>${t('type')}</th><th>${t('wallOf')}</th><th>${t('room')}</th><th class="n">${t('width')}</th><th class="n">${t('height')}</th><th class="n">${t('sill')}</th><th class="n">${t('offset')} A</th><th class="n">${t('offset')} B</th></tr></thead><tbody>`;
    for (const r of rows) {
      h += `<tr data-goto-kind="opening" data-goto-id="${r.id}"><td><span class="mark mark-${r.type === 'window' ? 'win' : 'door'}">${r.mark}</span></td><td>${t(r.type)}</td><td>${r.wall}</td><td>${esc(r.rooms)}</td><td class="n">${fmtLen(r.width)}</td><td class="n">${fmtLen(r.height)}</td><td class="n">${r.type === 'window' ? fmtLen(r.sill) : '—'}</td><td class="n">${fmtLen(r.fromA)}</td><td class="n">${fmtLen(r.fromB)}</td></tr>`;
    }
    h += `</tbody></table></div></section>`;

    h += `<section class="card"><h3>${t('walls')}</h3><div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>#</th><th>${t('kind')}</th><th class="n">${t('length')}</th><th class="n">${t('insideDims')}</th><th class="n">${t('thickness')}</th><th class="n">${t('openings')}</th></tr></thead><tbody>`;
    for (const w of plan.walls) {
      h += `<tr data-goto-kind="wall" data-goto-id="${w.id}"><td>${labels.get(w.id)}</td><td>${w.kind === 'virtual' ? t('virtualWall') : t('wall')}</td><td class="n">${fmtLen(M.wallLength(plan, w))}</td><td class="n">${w.kind === 'virtual' ? '—' : fmtLen(M.wallInsideLength(plan, w))}</td><td class="n">${w.kind === 'virtual' ? '—' : fmtLen(w.thickness)}</td><td class="n">${M.openingsOf(plan, w.id).length || ''}</td></tr>`;
    }
    h += `</tbody></table></div></section>`;

    if (plan.objects.length) {
      const counts = new Map();
      for (const o of plan.objects) counts.set(o.type, (counts.get(o.type) || 0) + 1);
      h += `<section class="card"><h3>${t('objects')}</h3><div class="chips">${[...counts].map(([ty, n]) => `<span class="chip">${esc(catalogLabel(ty, lang()))}<b>${n}</b></span>`).join('')}</div></section>`;
    }
    h += `<p class="disclaimer">${t('estimateNote')}</p></div>`;
    container.innerHTML = h;
  }
  container.addEventListener('click', (e) => {
    const tr = e.target.closest('[data-goto-kind]');
    if (!tr || !tr.dataset.gotoId) return;
    store.emit('navigate', { tab: 'plan', focus: { kind: tr.dataset.gotoKind, id: tr.dataset.gotoId } });
  });
  store.on('change', (ev) => { if (!ev?.live) render(); });
  store.on('settings', render);
  return { activate() { active = true; render(); }, deactivate() { active = false; } };
}

/** CSV of the opening schedule + rooms (for spreadsheet / quoting). */
export function scheduleCSV(plan) {
  const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const m = (x) => (x == null ? '' : x.toFixed(3));
  const tk = M.takeoff(plan);
  let s = 'section,mark,type,wall,room,width_m,height_m,sill_m,from_a_m,from_b_m,area_m2,perimeter_m,baseboard_m\n';
  for (const r of tk.rooms) s += ['room', '', '', '', q(r.name), '', '', '', '', '', m(r.area), m(r.perimeter), m(r.baseboard)].join(',') + '\n';
  for (const r of scheduleRows(plan)) s += ['opening', r.mark, r.type, r.wall, q(r.rooms), m(r.width), m(r.height), m(r.sill), m(r.fromA), m(r.fromB), '', '', ''].join(',') + '\n';
  for (const o of plan.objects) s += ['object', '', o.type, '', q(o.label || ''), m(o.w), m(o.h), m(o.elev), m(o.x), m(o.y), '', '', ''].join(',') + '\n';
  return s;
}
