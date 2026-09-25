// Length / area formatting and parsing. Internal unit is always the metre.

export const FT = 0.3048;
export const IN = 0.0254;

let current = 'metric'; // 'metric' | 'imperial'
let decimalComma = false;

export function setUnits(u) { current = u === 'imperial' ? 'imperial' : 'metric'; }
export function getUnits() { return current; }
export function setDecimalComma(on) { decimalComma = !!on; }

const dec = (s) => (decimalComma ? s.replace('.', ',') : s);

/** 3.524 → "3.52 m", 0.45 → "45 cm"; imperial → 11' 6 ½" */
export function fmtLen(m, opts = {}) {
  if (m == null || !isFinite(m)) return '—';
  const u = opts.units || current;
  if (u === 'imperial') return fmtFeetInches(m);
  if (!opts.forceM && Math.abs(m) < 1) return dec(String(Math.round(m * 100))) + ' cm';
  return dec(m.toFixed(opts.digits ?? 2)) + ' m';
}

/** Compact length for tight dimension chains: "1.20" / "4' 2"" */
export function fmtLenShort(m, opts = {}) {
  const u = opts.units || current;
  if (u === 'imperial') return fmtFeetInches(m);
  if (Math.abs(m) < 1) return dec(String(Math.round(m * 100))) + ' cm';
  return dec(m.toFixed(2));
}

export function fmtFeetInches(m) {
  const neg = m < 0; m = Math.abs(m);
  let eighths = Math.round(m / IN * 2) / 2; // nearest ½"
  let ft = Math.floor(eighths / 12);
  let inch = eighths - ft * 12;
  if (inch >= 12) { ft += 1; inch -= 12; }
  const whole = Math.floor(inch), half = inch - whole >= 0.5;
  const inStr = (whole || !half ? String(whole) : '') + (half ? (whole ? ' ½' : '½') : '');
  const s = ft > 0 ? `${ft}' ${inStr || 0}"` : `${inStr || 0}"`;
  return (neg ? '−' : '') + s;
}

export function fmtArea(m2, opts = {}) {
  if (m2 == null || !isFinite(m2)) return '—';
  const u = opts.units || current;
  if (u === 'imperial') return Math.round(m2 / (FT * FT)).toLocaleString('en-US') + ' ft²';
  return dec(m2.toFixed(1)) + ' m²';
}

export function fmtAngle(deg) { return dec((Math.round(deg * 10) / 10).toString()) + '°'; }

/**
 * Parse a user-typed length into metres. Accepts:
 *  "3.2", "3,2" (current unit: m or ft), "320cm", "320 mm", "3.2m",
 *  "10'", "10' 6\"", "10ft 6in", "126in", "126\"", "10-6" (ft-in), "5 1/2\"".
 * Returns null if it cannot be parsed.
 */
export function parseLen(str, unitsHint = current) {
  if (str == null) return null;
  let s = String(str).trim().toLowerCase().replace(/,/g, '.').replace(/[’′]/g, "'").replace(/[”″]/g, '"');
  if (!s) return null;
  const num = (t) => {
    t = t.trim();
    const frac = t.match(/^(\d+(?:\.\d+)?)?\s*(?:(\d+)\/(\d+))?$/);
    if (!frac || (!frac[1] && !frac[2])) return NaN;
    let n = frac[1] ? parseFloat(frac[1]) : 0;
    if (frac[2]) n += parseInt(frac[2], 10) / parseInt(frac[3], 10);
    return n;
  };
  let m;
  if ((m = s.match(/^(-?\d+(?:\.\d+)?)\s*mm$/))) return parseFloat(m[1]) / 1000;
  if ((m = s.match(/^(-?\d+(?:\.\d+)?)\s*cm$/))) return parseFloat(m[1]) / 100;
  if ((m = s.match(/^(-?\d+(?:\.\d+)?)\s*m$/))) return parseFloat(m[1]);
  // feet and inches
  if ((m = s.match(/^(\d+(?:\.\d+)?)\s*(?:'|ft|feet)\s*(?:-\s*)?([\d./ ]+)?\s*(?:"|in|inch|inches)?$/))) {
    const ft = parseFloat(m[1]);
    const inch = m[2] ? num(m[2]) : 0;
    if (isNaN(inch)) return null;
    return ft * FT + inch * IN;
  }
  if ((m = s.match(/^([\d./ ]+)\s*(?:"|in|inch|inches)$/))) {
    const inch = num(m[1]);
    return isNaN(inch) ? null : inch * IN;
  }
  if ((m = s.match(/^(\d+)-(\d+(?:\.\d+)?)$/)) && unitsHint === 'imperial') {
    return parseInt(m[1], 10) * FT + parseFloat(m[2]) * IN;
  }
  if ((m = s.match(/^-?\d+(?:\.\d+)?$/))) {
    const n = parseFloat(s);
    return unitsHint === 'imperial' ? n * FT : n;
  }
  return null;
}
