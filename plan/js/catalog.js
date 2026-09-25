// Object library: defaults, categories and architectural plan symbols.
//
// Symbols are drawn in the object's local frame, centred at (0,0), x ∈ [-w/2, w/2], y ∈ [-d/2, d/2].
// The "front" of the object (the side you use it from) is +y (bottom edge before rotation), the
// "back" (against the wall) is -y. All strokes use non-scaling-stroke so they stay crisp at any zoom.
//
// shape3d tells the 3D view which builder to use; color is the 3D / plan fill tint.

export const CATEGORIES = [
  { id: 'bath', en: 'Bathroom', fr: 'Salle de bain' },
  { id: 'kitchen', en: 'Kitchen', fr: 'Cuisine' },
  { id: 'laundry', en: 'Laundry & utility', fr: 'Buanderie et mécanique' },
  { id: 'living', en: 'Living', fr: 'Séjour' },
  { id: 'bedroom', en: 'Bedroom', fr: 'Chambre' },
  { id: 'dining', en: 'Dining & office', fr: 'Salle à manger et bureau' },
  { id: 'structure', en: 'Structure', fr: 'Structure' },
];

// w = width (local x), d = depth (local y), h = height, all metres.
export const CATALOG = {
  // Bathroom
  shower:        { cat: 'bath', en: 'Shower', fr: 'Douche', w: 0.91, d: 0.91, h: 2.0, color: '#9fd3e6', shape3d: 'shower' },
  showerRect:    { cat: 'bath', en: 'Shower 60"', fr: 'Douche 60 po', w: 1.52, d: 0.81, h: 2.0, color: '#9fd3e6', shape3d: 'shower', sym: 'shower' },
  showerCorner:  { cat: 'bath', en: 'Neo-angle shower', fr: 'Douche en coin', w: 0.97, d: 0.97, h: 2.0, color: '#9fd3e6', shape3d: 'showerCorner' },
  bathtub:       { cat: 'bath', en: 'Bathtub', fr: 'Baignoire', w: 1.52, d: 0.76, h: 0.56, color: '#e9f1f5', shape3d: 'tub' },
  freestandingTub: { cat: 'bath', en: 'Freestanding tub', fr: 'Bain autoportant', w: 1.7, d: 0.8, h: 0.6, color: '#f4f7f9', shape3d: 'tubFree' },
  toilet:        { cat: 'bath', en: 'Toilet', fr: 'Toilette', w: 0.46, d: 0.71, h: 0.78, color: '#f4f7f9', shape3d: 'toilet' },
  vanity:        { cat: 'bath', en: 'Vanity', fr: 'Vanité', w: 0.91, d: 0.53, h: 0.86, color: '#c9b79c', shape3d: 'vanity' },
  vanityDouble:  { cat: 'bath', en: 'Double vanity', fr: 'Vanité double', w: 1.52, d: 0.56, h: 0.86, color: '#c9b79c', shape3d: 'vanity', sinks: 2, sym: 'vanity' },
  pedestalSink:  { cat: 'bath', en: 'Pedestal sink', fr: 'Lavabo sur colonne', w: 0.56, d: 0.46, h: 0.86, color: '#f4f7f9', shape3d: 'pedestal' },
  bidet:         { cat: 'bath', en: 'Bidet', fr: 'Bidet', w: 0.38, d: 0.56, h: 0.4, color: '#f4f7f9', shape3d: 'toilet', sym: 'bidet' },
  linen:         { cat: 'bath', en: 'Linen closet', fr: 'Lingerie', w: 0.61, d: 0.41, h: 2.1, color: '#d8cbb5', shape3d: 'box', sym: 'cabinet' },

  // Kitchen
  counter:       { cat: 'kitchen', en: 'Base cabinet', fr: 'Comptoir', w: 1.2, d: 0.64, h: 0.91, color: '#d8cbb5', shape3d: 'counter', sym: 'counter' },
  sinkCounter:   { cat: 'kitchen', en: 'Sink cabinet', fr: 'Évier', w: 0.91, d: 0.64, h: 0.91, color: '#d8cbb5', shape3d: 'counter', sinks: 1, sym: 'kitchenSink' },
  range:         { cat: 'kitchen', en: 'Range / stove', fr: 'Cuisinière', w: 0.76, d: 0.66, h: 0.91, color: '#bfc5ca', shape3d: 'range' },
  fridge:        { cat: 'kitchen', en: 'Refrigerator', fr: 'Réfrigérateur', w: 0.91, d: 0.76, h: 1.78, color: '#e3e6e8', shape3d: 'box', sym: 'fridge' },
  dishwasher:    { cat: 'kitchen', en: 'Dishwasher', fr: 'Lave-vaisselle', w: 0.61, d: 0.64, h: 0.86, color: '#d4d8db', shape3d: 'box', sym: 'dishwasher' },
  island:        { cat: 'kitchen', en: 'Island', fr: 'Îlot', w: 1.83, d: 0.91, h: 0.91, color: '#d8cbb5', shape3d: 'counter', sym: 'counter' },
  upperCabinet:  { cat: 'kitchen', en: 'Wall cabinet', fr: 'Armoire haute', w: 0.91, d: 0.33, h: 0.76, elev: 1.37, color: '#e0d6c4', shape3d: 'box', sym: 'upper' },

  // Laundry & utility
  washer:        { cat: 'laundry', en: 'Washer', fr: 'Laveuse', w: 0.69, d: 0.71, h: 0.97, color: '#e8ebed', shape3d: 'appliance', sym: 'washer' },
  dryer:         { cat: 'laundry', en: 'Dryer', fr: 'Sécheuse', w: 0.69, d: 0.71, h: 0.97, color: '#e8ebed', shape3d: 'appliance', sym: 'dryer' },
  waterHeater:   { cat: 'laundry', en: 'Water heater', fr: 'Chauffe-eau', w: 0.56, d: 0.56, h: 1.52, color: '#dfe3e6', shape3d: 'cylinder', sym: 'waterHeater' },
  furnace:       { cat: 'laundry', en: 'Furnace', fr: 'Fournaise', w: 0.56, d: 0.74, h: 1.3, color: '#c7ccd0', shape3d: 'box', sym: 'furnace' },
  panel:         { cat: 'laundry', en: 'Electrical panel', fr: 'Panneau électrique', w: 0.36, d: 0.1, h: 0.76, elev: 1.0, color: '#9aa3aa', shape3d: 'box', sym: 'panel' },
  laundrySink:   { cat: 'laundry', en: 'Laundry tub', fr: 'Évier de buanderie', w: 0.61, d: 0.56, h: 0.86, color: '#eef0f2', shape3d: 'counter', sinks: 1, sym: 'kitchenSink' },

  // Living
  sofa:          { cat: 'living', en: 'Sofa', fr: 'Sofa', w: 2.13, d: 0.91, h: 0.84, color: '#8fa3b8', shape3d: 'sofa' },
  sectional:     { cat: 'living', en: 'Sectional', fr: 'Sectionnel', w: 2.6, d: 2.0, h: 0.84, color: '#8fa3b8', shape3d: 'sectional' },
  armchair:      { cat: 'living', en: 'Armchair', fr: 'Fauteuil', w: 0.86, d: 0.86, h: 0.84, color: '#a2b3c4', shape3d: 'sofa', sym: 'armchair' },
  coffeeTable:   { cat: 'living', en: 'Coffee table', fr: 'Table basse', w: 1.12, d: 0.61, h: 0.43, color: '#b99a74', shape3d: 'table', sym: 'table' },
  tvUnit:        { cat: 'living', en: 'TV unit', fr: 'Meuble télé', w: 1.6, d: 0.45, h: 0.55, color: '#6d6f73', shape3d: 'box', sym: 'tv' },
  fireplace:     { cat: 'living', en: 'Fireplace', fr: 'Foyer', w: 1.22, d: 0.51, h: 1.1, color: '#8c7b6b', shape3d: 'box', sym: 'fireplace' },
  bookshelf:     { cat: 'living', en: 'Bookshelf', fr: 'Bibliothèque', w: 0.91, d: 0.33, h: 1.83, color: '#b99a74', shape3d: 'box', sym: 'shelf' },

  // Bedroom
  bedQueen:      { cat: 'bedroom', en: 'Queen bed', fr: 'Lit double (queen)', w: 1.52, d: 2.03, h: 0.6, color: '#c8d4e3', shape3d: 'bed', sym: 'bed' },
  bedKing:       { cat: 'bedroom', en: 'King bed', fr: 'Lit king', w: 1.93, d: 2.03, h: 0.6, color: '#c8d4e3', shape3d: 'bed', sym: 'bed' },
  bedSingle:     { cat: 'bedroom', en: 'Single bed', fr: 'Lit simple', w: 0.99, d: 1.91, h: 0.55, color: '#c8d4e3', shape3d: 'bed', sym: 'bed' },
  nightstand:    { cat: 'bedroom', en: 'Nightstand', fr: 'Table de chevet', w: 0.5, d: 0.4, h: 0.6, color: '#b99a74', shape3d: 'box', sym: 'cabinet' },
  dresser:       { cat: 'bedroom', en: 'Dresser', fr: 'Commode', w: 1.5, d: 0.5, h: 0.8, color: '#b99a74', shape3d: 'box', sym: 'cabinet' },
  closet:        { cat: 'bedroom', en: 'Closet / wardrobe', fr: 'Garde-robe', w: 1.83, d: 0.61, h: 2.1, color: '#d8cbb5', shape3d: 'box', sym: 'closet' },

  // Dining & office
  diningTable:   { cat: 'dining', en: 'Dining table', fr: 'Table à manger', w: 1.52, d: 0.91, h: 0.76, color: '#b99a74', shape3d: 'table', sym: 'table' },
  roundTable:    { cat: 'dining', en: 'Round table', fr: 'Table ronde', w: 1.07, d: 1.07, h: 0.76, color: '#b99a74', shape3d: 'roundTable', sym: 'roundTable' },
  chair:         { cat: 'dining', en: 'Chair', fr: 'Chaise', w: 0.46, d: 0.5, h: 0.9, color: '#8a7760', shape3d: 'chair' },
  desk:          { cat: 'dining', en: 'Desk', fr: 'Bureau', w: 1.4, d: 0.7, h: 0.75, color: '#b99a74', shape3d: 'table', sym: 'desk' },

  // Structure
  stairs:        { cat: 'structure', en: 'Stairs', fr: 'Escalier', w: 0.91, d: 3.05, h: 2.6, color: '#c9c3b8', shape3d: 'stairs', steps: 13 },
  column:        { cat: 'structure', en: 'Column', fr: 'Colonne', w: 0.3, d: 0.3, h: 2.44, color: '#b7b7b7', shape3d: 'box', sym: 'column' },
  box:           { cat: 'structure', en: 'Generic object', fr: 'Objet générique', w: 0.6, d: 0.6, h: 0.9, color: '#c9ced3', shape3d: 'box', sym: 'box' },
};

export const catalogLabel = (type, lang = 'en') => CATALOG[type]?.[lang] || CATALOG[type]?.en || type;

// ------------------------------------------------------------------- symbols

const S = 'vector-effect="non-scaling-stroke"';
const f = (n) => +n.toFixed(4);
const rect = (x, y, w, h, extra = '') => `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" ${S} ${extra}/>`;
const rrect = (x, y, w, h, r, extra = '') => `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" rx="${f(r)}" ${S} ${extra}/>`;
const line = (x1, y1, x2, y2, extra = '') => `<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" ${S} ${extra}/>`;
const circle = (cx, cy, r, extra = '') => `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" ${S} ${extra}/>`;
const ellipse = (cx, cy, rx, ry, extra = '') => `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(rx)}" ry="${f(ry)}" ${S} ${extra}/>`;
const path = (d, extra = '') => `<path d="${d}" ${S} ${extra}/>`;
const NOFILL = 'fill="none"';

function sinks(w, d, n, oval = true) {
  let s = '';
  for (let i = 0; i < n; i++) {
    const cx = -w / 2 + w * (i + 0.5) / n;
    s += oval ? ellipse(cx, d * 0.08, Math.min(w / n * 0.32, 0.22), d * 0.28, NOFILL) : rrect(cx - Math.min(w / n * 0.38, 0.3), -d * 0.28, Math.min(w / n * 0.76, 0.6), d * 0.6, 0.03, NOFILL);
    s += circle(cx, -d * 0.36, Math.min(0.025, d * 0.05));
  }
  return s;
}

const SYMBOLS = {
  shower(w, d) {
    const r = Math.min(w, d);
    return rect(-w / 2, -d / 2, w, d) + rect(-w / 2 + 0.04, -d / 2 + 0.04, w - 0.08, d - 0.08, NOFILL)
      + line(-w / 2 + 0.04, -d / 2 + 0.04, w / 2 - 0.04, d / 2 - 0.04, NOFILL + ' class="thin"')
      + line(w / 2 - 0.04, -d / 2 + 0.04, -w / 2 + 0.04, d / 2 - 0.04, NOFILL + ' class="thin"')
      + circle(0, 0, r * 0.05, 'class="drain"')
      + line(-w / 2, d / 2, w / 2, d / 2, 'class="glass"');
  },
  showerCorner(w, d) {
    const c = Math.min(w, d) * 0.4;
    const pts = `${-w / 2},${-d / 2} ${w / 2},${-d / 2} ${w / 2},${d / 2 - c} ${w / 2 - c},${d / 2} ${-w / 2},${d / 2}`;
    return `<polygon points="${pts}" ${S}/>` + circle(0, 0, 0.04, 'class="drain"')
      + path(`M${f(w / 2)},${f(d / 2 - c)} L${f(w / 2 - c)},${f(d / 2)}`, 'class="glass"');
  },
  bathtub(w, d) {
    return rect(-w / 2, -d / 2, w, d) + rrect(-w / 2 + 0.07, -d / 2 + 0.07, w - 0.14, d - 0.14, Math.min(w, d) * 0.3, NOFILL)
      + circle(-w / 2 + 0.2, 0, 0.03, 'class="drain"');
  },
  freestandingTub(w, d) {
    return rrect(-w / 2, -d / 2, w, d, d / 2) + rrect(-w / 2 + 0.07, -d / 2 + 0.07, w - 0.14, d - 0.14, d / 2 - 0.07, NOFILL)
      + circle(0, 0, 0.03, 'class="drain"');
  },
  toilet(w, d) {
    const tankD = d * 0.28;
    return rrect(-w / 2, -d / 2, w, tankD, 0.03) + ellipse(0, -d / 2 + tankD + (d - tankD) / 2, w * 0.42, (d - tankD) / 2)
      + ellipse(0, -d / 2 + tankD + (d - tankD) / 2 + 0.02, w * 0.26, (d - tankD) / 2 * 0.62, NOFILL);
  },
  bidet(w, d) {
    return ellipse(0, 0, w / 2, d / 2) + ellipse(0, 0.03, w * 0.3, d * 0.32, NOFILL) + circle(0, -d * 0.36, 0.02);
  },
  vanity(w, d, t) { return rect(-w / 2, -d / 2, w, d) + sinks(w, d, t.sinks || 1, true); },
  pedestalSink(w, d) { return path(`M${f(-w / 2)},${f(-d / 2)} H${f(w / 2)} V${f(0)} A${f(w / 2)},${f(d / 2)} 0 0 1 ${f(-w / 2)},0 Z`) + ellipse(0, 0.02, w * 0.3, d * 0.28, NOFILL) + circle(0, -d * 0.35, 0.02); },
  kitchenSink(w, d, t) { return rect(-w / 2, -d / 2, w, d) + sinks(w, d, t.sinks || 1, false); },
  counter(w, d) { return rect(-w / 2, -d / 2, w, d) + line(-w / 2, d / 2 - 0.04, w / 2, d / 2 - 0.04, 'class="thin"'); },
  upper(w, d) { return rect(-w / 2, -d / 2, w, d, 'class="dashed"') + line(-w / 2, -d / 2, w / 2, d / 2, 'class="thin"') + line(w / 2, -d / 2, -w / 2, d / 2, 'class="thin"'); },
  range(w, d) {
    const rx = w * 0.18, ry = d * 0.18;
    return rect(-w / 2, -d / 2, w, d) + circle(-w / 4, -d / 4 + 0.02, Math.min(rx, ry), NOFILL) + circle(w / 4, -d / 4 + 0.02, Math.min(rx, ry) * 0.8, NOFILL)
      + circle(-w / 4, d / 4 - 0.02, Math.min(rx, ry) * 0.8, NOFILL) + circle(w / 4, d / 4 - 0.02, Math.min(rx, ry), NOFILL);
  },
  fridge(w, d) { return rect(-w / 2, -d / 2, w, d) + line(-w / 2, d / 2 - 0.05, w / 2, d / 2 - 0.05) + text('REF', Math.min(w, d)); },
  dishwasher(w, d) { return rect(-w / 2, -d / 2, w, d) + text('DW', Math.min(w, d)); },
  washer(w, d) { return rect(-w / 2, -d / 2, w, d) + circle(0, 0.03, Math.min(w, d) * 0.32, NOFILL) + line(-w / 2, -d / 2 + 0.1, w / 2, -d / 2 + 0.1, 'class="thin"'); },
  dryer(w, d) { return rect(-w / 2, -d / 2, w, d) + rect(-w * 0.3, -d * 0.22, w * 0.6, d * 0.5, NOFILL) + line(-w / 2, -d / 2 + 0.1, w / 2, -d / 2 + 0.1, 'class="thin"'); },
  waterHeater(w, d) { return ellipse(0, 0, w / 2, d / 2) + text('WH', Math.min(w, d)); },
  furnace(w, d) { return rect(-w / 2, -d / 2, w, d) + text('F', Math.min(w, d)); },
  panel(w, d) { return rect(-w / 2, -d / 2, w, d, 'class="solidfill"'); },
  sofa(w, d) {
    const arm = Math.min(0.2, w * 0.12), back = Math.min(0.22, d * 0.26);
    return rrect(-w / 2, -d / 2, w, d, 0.06) + rect(-w / 2 + arm, -d / 2 + back, w - 2 * arm, d - back, NOFILL)
      + line(0, -d / 2 + back, 0, d / 2, 'class="thin"');
  },
  armchair(w, d) {
    const arm = Math.min(0.18, w * 0.2), back = Math.min(0.2, d * 0.25);
    return rrect(-w / 2, -d / 2, w, d, 0.06) + rect(-w / 2 + arm, -d / 2 + back, w - 2 * arm, d - back, NOFILL);
  },
  sectional(w, d) {
    const a = 0.9;
    return path(`M${f(-w / 2)},${f(-d / 2)} H${f(w / 2)} V${f(-d / 2 + a)} H${f(-w / 2 + a)} V${f(d / 2)} H${f(-w / 2)} Z`)
      + path(`M${f(-w / 2 + 0.22)},${f(d / 2)} V${f(-d / 2 + 0.22)} H${f(w / 2)}`, NOFILL + ' class="thin"');
  },
  table(w, d) { return rect(-w / 2, -d / 2, w, d); },
  roundTable(w, d) { return ellipse(0, 0, w / 2, d / 2); },
  desk(w, d) { return rect(-w / 2, -d / 2, w, d) + rect(w / 2 - Math.min(0.45, w * 0.35), -d / 2 + 0.03, Math.min(0.42, w * 0.33), d - 0.06, NOFILL + ' class="thin"'); },
  chair(w, d) { return rrect(-w / 2, -d / 2 + d * 0.18, w, d * 0.82, 0.04) + rrect(-w / 2, -d / 2, w, d * 0.18, 0.03); },
  tv(w, d) { return rect(-w / 2, -d / 2, w, d) + rect(-w * 0.4, -d / 2 + 0.02, w * 0.8, 0.05, 'class="solidfill"'); },
  fireplace(w, d) { return rect(-w / 2, -d / 2, w, d) + path(`M${f(-w * 0.3)},${f(d / 2)} V${f(-d * 0.1)} H${f(w * 0.3)} V${f(d / 2)}`, NOFILL); },
  shelf(w, d) { return rect(-w / 2, -d / 2, w, d) + line(-w / 2, 0, w / 2, 0, 'class="thin"'); },
  bed(w, d) {
    const pill = Math.min(0.5, d * 0.22);
    const n = w > 1.3 ? 2 : 1;
    let s = rect(-w / 2, -d / 2, w, d) + line(-w / 2, -d / 2 + pill + 0.12, w / 2, -d / 2 + pill + 0.12, 'class="thin"');
    for (let i = 0; i < n; i++) {
      const pw = w / n - 0.14, px = -w / 2 + 0.07 + i * w / n;
      s += rrect(px, -d / 2 + 0.06, pw, pill, 0.06, NOFILL);
    }
    s += path(`M${f(-w / 2)},${f(-d / 2 + pill + 0.12)} L${f(w / 2 - 0.3)},${f(d / 2)}`, NOFILL + ' class="thin"');
    return s;
  },
  cabinet(w, d) { return rect(-w / 2, -d / 2, w, d) + line(-w / 2, d / 2 - 0.03, w / 2, d / 2 - 0.03, 'class="thin"'); },
  closet(w, d) {
    return rect(-w / 2, -d / 2, w, d) + line(-w / 2 + 0.04, 0, w / 2 - 0.04, 0, 'class="thin"')
      + line(-w / 2, d / 2 - 0.03, 0.02, d / 2 - 0.03) + line(-0.02, d / 2 - 0.07, w / 2, d / 2 - 0.07);
  },
  stairs(w, d, t) {
    const n = t.steps || 13;
    let s = rect(-w / 2, -d / 2, w, d);
    for (let i = 1; i < n; i++) s += line(-w / 2, -d / 2 + d * i / n, w / 2, -d / 2 + d * i / n, 'class="thin"');
    // Walking line with arrow toward "up" (the back, -y).
    s += line(0, d / 2 - 0.1, 0, -d / 2 + 0.15) + path(`M${f(-0.08)},${f(-d / 2 + 0.3)} L0,${f(-d / 2 + 0.15)} L${f(0.08)},${f(-d / 2 + 0.3)}`, NOFILL);
    return s;
  },
  column(w, d) { return rect(-w / 2, -d / 2, w, d, 'class="solidfill"'); },
  box(w, d) { return rect(-w / 2, -d / 2, w, d) + line(-w / 2, -d / 2, w / 2, d / 2, 'class="thin"') + line(w / 2, -d / 2, -w / 2, d / 2, 'class="thin"'); },
};

function text(s, size) {
  const fs = Math.max(0.08, Math.min(0.22, size * 0.28));
  return `<text x="0" y="0" font-size="${f(fs)}" text-anchor="middle" dominant-baseline="central" class="symtext">${s}</text>`;
}

/** SVG markup (local frame) for an object's plan symbol. */
export function symbolSVG(o) {
  const t = CATALOG[o.type] || CATALOG.box;
  const fn = SYMBOLS[t.sym || o.type] || SYMBOLS.box;
  return fn(o.w, o.d, t);
}

/** Create a new object of type at (x, y). */
export function makeObject(type, x, y, uidFn) {
  const t = CATALOG[type] || CATALOG.box;
  return { id: uidFn('ob'), type, x, y, w: t.w, d: t.d, h: t.h, rot: 0, elev: t.elev || 0 };
}
