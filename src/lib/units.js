/* units.js — the conversion table, kept apart from the skill so the numbers
   can be read and checked without reading any logic around them.
   Every factor is to the SI base of its dimension. Temperature is the odd one
   out (offsets, not just factors) and is handled separately. */

export const DIMENSIONS = {
  length: {
    base: 'm',
    units: {
      nm: 1e-9, um: 1e-6, mm: 0.001, cm: 0.01, m: 1, km: 1000,
      in: 0.0254, ft: 0.3048, yd: 0.9144, mi: 1609.344, nmi: 1852,
      thou: 0.0000254, furlong: 201.168, league: 4828.032, au: 1.495978707e11, ly: 9.4607304725808e15
    },
    aliases: {
      nanometre: 'nm', nanometer: 'nm', micrometre: 'um', micrometer: 'um', micron: 'um',
      millimetre: 'mm', millimeter: 'mm', centimetre: 'cm', centimeter: 'cm',
      metre: 'm', meter: 'm', kilometre: 'km', kilometer: 'km',
      inch: 'in', inches: 'in', '"': 'in', foot: 'ft', feet: 'ft', "'": 'ft',
      yard: 'yd', mile: 'mi', miles: 'mi', 'nautical mile': 'nmi',
      'astronomical unit': 'au', lightyear: 'ly', 'light year': 'ly'
    }
  },
  /* Angles are a real dimension with a real SI base (the radian), so they go in
     the table like everything else. The factors are exact by definition rather
     than measured - a degree IS pi/180 radians - which is why they are written
     as expressions instead of decimals that would only be approximations. */
  angle: {
    base: 'rad',
    units: {
      rad: 1,
      deg: Math.PI / 180,
      grad: Math.PI / 200,
      turn: 2 * Math.PI,
      arcmin: Math.PI / 10800,
      arcsec: Math.PI / 648000,
      mil: (2 * Math.PI) / 6400
    },
    aliases: {
      radian: 'rad', radians: 'rad', degree: 'deg', degrees: 'deg', '\u00b0': 'deg',
      gradian: 'grad', gradians: 'grad', gon: 'grad', grade: 'grad',
      turns: 'turn', revolution: 'turn', revolutions: 'turn', rev: 'turn', cycle: 'turn',
      arcminute: 'arcmin', arcminutes: 'arcmin', arcsecond: 'arcsec', arcseconds: 'arcsec',
      mils: 'mil'
    }
  },
  mass: {
    base: 'kg',
    units: { mg: 1e-6, g: 0.001, kg: 1, t: 1000, oz: 0.028349523125, lb: 0.45359237, st: 6.35029318, 'ton-us': 907.18474, 'ton-uk': 1016.0469088, ct: 0.0002 },
    aliases: {
      milligram: 'mg', gram: 'g', gramme: 'g', kilogram: 'kg', kilo: 'kg', kg: 'kg',
      tonne: 't', 'metric ton': 't', ounce: 'oz', pound: 'lb', lbs: 'lb', pounds: 'lb',
      stone: 'st', 'short ton': 'ton-us', 'long ton': 'ton-uk', carat: 'ct'
    }
  },
  volume: {
    base: 'l',
    units: {
      ml: 0.001, cl: 0.01, dl: 0.1, l: 1, m3: 1000,
      tsp: 0.00492892159375, tbsp: 0.01478676478125, floz: 0.0295735295625,
      cup: 0.2365882365, pt: 0.473176473, qt: 0.946352946, gal: 3.785411784,
      'floz-uk': 0.0284130625, 'pt-uk': 0.56826125, 'gal-uk': 4.54609
    },
    aliases: {
      millilitre: 'ml', milliliter: 'ml', centilitre: 'cl', litre: 'l', liter: 'l',
      'cubic metre': 'm3', 'cubic meter': 'm3',
      teaspoon: 'tsp', tablespoon: 'tbsp', 'fluid ounce': 'floz', 'fl oz': 'floz',
      cups: 'cup', pint: 'pt', quart: 'qt', gallon: 'gal',
      'imperial pint': 'pt-uk', 'imperial gallon': 'gal-uk', 'uk gallon': 'gal-uk'
    }
  },
  speed: {
    base: 'm/s',
    /* No 'c' for the speed of light: single-letter 'c' means Celsius to
       everyone who types it, and a unit table is not the place to win that
       argument. */
    units: { 'm/s': 1, 'km/h': 1 / 3.6, mph: 0.44704, kn: 0.514444444, 'ft/s': 0.3048 },
    aliases: { kph: 'km/h', kmh: 'km/h', 'kilometres per hour': 'km/h', 'miles per hour': 'mph', knot: 'kn', knots: 'kn', 'metres per second': 'm/s' }
  },
  area: {
    base: 'm2',
    units: { mm2: 1e-6, cm2: 1e-4, m2: 1, km2: 1e6, ha: 10000, in2: 0.00064516, ft2: 0.09290304, yd2: 0.83612736, acre: 4046.8564224, mi2: 2589988.110336 },
    aliases: { 'square metre': 'm2', 'square meter': 'm2', 'sq m': 'm2', 'square foot': 'ft2', 'sq ft': 'ft2', 'square feet': 'ft2', hectare: 'ha', acres: 'acre', 'square mile': 'mi2', 'square kilometre': 'km2' }
  },
  data: {
    base: 'B',
    /* Decimal SI for kB/MB/GB, binary for KiB/MiB/GiB. Conflating them is the
       classic "my 500GB drive shows 465GB" confusion, so both are here and
       neither is renamed. */
    units: { b: 0.125, B: 1, kB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12, KiB: 1024, MiB: 1048576, GiB: 1073741824, TiB: 1099511627776 },
    aliases: { bit: 'b', bits: 'b', byte: 'B', bytes: 'B', kilobyte: 'kB', megabyte: 'MB', gigabyte: 'GB', terabyte: 'TB', kibibyte: 'KiB', mebibyte: 'MiB', gibibyte: 'GiB' }
  },
  time: {
    base: 's',
    units: { ms: 0.001, s: 1, min: 60, h: 3600, d: 86400, wk: 604800, yr: 31557600 },
    aliases: { millisecond: 'ms', second: 's', sec: 's', minute: 'min', mins: 'min', hour: 'h', hr: 'h', hours: 'h', day: 'd', days: 'd', week: 'wk', weeks: 'wk', year: 'yr', years: 'yr' }
  }
};

/* Temperature converts through Celsius rather than by a factor, because a
   scale with an offset has no meaningful "factor to base". */
export const TEMPERATURE = {
  toC: { C: (v) => v, F: (v) => (v - 32) * 5 / 9, K: (v) => v - 273.15, R: (v) => (v - 491.67) * 5 / 9 },
  fromC: { C: (v) => v, F: (v) => v * 9 / 5 + 32, K: (v) => v + 273.15, R: (v) => (v + 273.15) * 9 / 5 },
  aliases: {
    c: 'C', celsius: 'C', centigrade: 'C', '°c': 'C',
    f: 'F', fahrenheit: 'F', '°f': 'F',
    k: 'K', kelvin: 'K', r: 'R', rankine: 'R'
  }
};

/** name → { dimension, unit } | null. Case-insensitive except where a unit's
 *  case is load-bearing (mB vs MB, b vs B). */
export function resolveUnit (raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  const lower = s.toLowerCase().replace(/\s+/g, ' ');

  for (const [dim, def] of Object.entries(DIMENSIONS)) {
    if (Object.prototype.hasOwnProperty.call(def.units, s)) return { dimension: dim, unit: s };
  }
  /* Temperature is resolved BEFORE the case-insensitive sweep below, because
     its symbols are single letters and single letters collide with everything.
     Whoever types "C" means Celsius. */
  const t = TEMPERATURE.aliases[lower] || (Object.prototype.hasOwnProperty.call(TEMPERATURE.toC, s) ? s : null);
  if (t) return { dimension: 'temperature', unit: t };

  for (const [dim, def] of Object.entries(DIMENSIONS)) {
    const viaAlias = def.aliases[lower];
    if (viaAlias) return { dimension: dim, unit: viaAlias };
    const ci = Object.keys(def.units).find(u => u.toLowerCase() === lower);
    /* Data units are the one place where case decides meaning (b = bit,
       B = byte), so a case-insensitive match there would be a wrong answer
       rather than a lenient one. */
    if (ci && dim !== 'data') return { dimension: dim, unit: ci };
  }

  /* Plurals last, so "cups" resolves but "s" (seconds) is never stripped to "". */
  if (lower.endsWith('s') && lower.length > 2) return resolveUnit(lower.slice(0, -1));
  return null;
}
