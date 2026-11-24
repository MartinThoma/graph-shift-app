/**
 * Resolve DOT color values (X11 names, numbered variants, hex, HSV) to CSS colors.
 */

/** X11 color names that differ from or are missing in CSS. */
const X11_EXTRAS: Record<string, string> = {
  lightgoldenrod: "#eedd82",
  navyblue: "#000080",
  violetred: "#d02090",
  crimson: "#dc143c",
  gray: "#c0c0c0",
  grey: "#c0c0c0",
  green: "#00ff00",
  maroon: "#b03060",
  purple: "#a020f0",
  lightslateblue: "#8470ff",
  invis: "none",
  transparent: "none",
  none: "none",
};

/** Base RGB for common X11 names that have numbered variants (red1..red4). */
const X11_BASE: Record<string, [number, number, number]> = {
  red: [255, 0, 0],
  green: [0, 255, 0],
  blue: [0, 0, 255],
  yellow: [255, 255, 0],
  orange: [255, 165, 0],
  cyan: [0, 255, 255],
  magenta: [255, 0, 255],
  gold: [255, 215, 0],
  pink: [255, 192, 203],
  purple: [160, 32, 240],
  brown: [165, 42, 42],
  tomato: [255, 99, 71],
  coral: [255, 114, 86],
  salmon: [250, 128, 114],
  orchid: [218, 112, 214],
  khaki: [255, 246, 143],
  turquoise: [0, 245, 255],
  wheat: [255, 231, 186],
  tan: [255, 165, 79],
  firebrick: [255, 48, 48],
  dodgerblue: [30, 144, 255],
  deepskyblue: [0, 191, 255],
  skyblue: [135, 206, 255],
  steelblue: [99, 184, 255],
  royalblue: [72, 118, 255],
  slateblue: [131, 111, 255],
  seagreen: [84, 255, 159],
  springgreen: [0, 255, 127],
  chartreuse: [127, 255, 0],
  olivedrab: [192, 255, 62],
  darkorange: [255, 127, 0],
  orangered: [255, 69, 0],
  deeppink: [255, 20, 147],
  hotpink: [255, 110, 180],
  plum: [255, 187, 255],
  thistle: [255, 225, 255],
  lightblue: [191, 239, 255],
  lightpink: [255, 174, 185],
  lightyellow: [255, 255, 224],
  lightcyan: [224, 255, 255],
  lightsalmon: [255, 160, 122],
  lightskyblue: [176, 226, 255],
  lightsteelblue: [202, 225, 255],
  palegreen: [154, 255, 154],
  paleturquoise: [187, 255, 255],
  goldenrod: [255, 193, 37],
  darkgoldenrod: [255, 185, 15],
  indianred: [255, 106, 106],
  sienna: [255, 130, 71],
  chocolate: [255, 127, 36],
  burlywood: [255, 211, 155],
  aquamarine: [127, 255, 212],
  cadetblue: [152, 245, 255],
  azure: [240, 255, 255],
  ivory: [255, 255, 240],
  honeydew: [240, 255, 240],
  snow: [255, 250, 250],
  seashell: [255, 245, 238],
  bisque: [255, 228, 196],
  peachpuff: [255, 218, 185],
  navajowhite: [255, 222, 173],
  lemonchiffon: [255, 250, 205],
  cornsilk: [255, 248, 220],
  mistyrose: [255, 228, 225],
  lavenderblush: [255, 240, 245],
  antiquewhite: [255, 239, 219],
};

const VARIANT_FACTORS = [1, 0.932, 0.804, 0.545];

function convertHsvToHex(h: number, s: number, v: number): string {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  const [r, g, b] = [
    [v, t, p],
    [q, v, p],
    [p, v, t],
    [p, q, v],
    [t, p, v],
    [v, p, q],
  ][((i % 6) + 6) % 6];
  return formatHex([r * 255, g * 255, b * 255]);
}

function formatHex([r, g, b]: number[]): string {
  return `#${[r, g, b].map((c) => Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Resolve a DOT color to a CSS color string, or null when unset/invalid.
 * Color lists (`red:blue`) resolve to their first entry.
 */
export function resolveColor(value: string | undefined | null): string | null {
  if (value == null) return null;
  let v = value.trim();
  if (!v) return null;
  // Color list: "red:blue;0.3" -> first color.
  if (v.includes(":") && !v.startsWith("#")) v = v.split(":")[0];
  else if (v.includes(":")) v = v.split(":")[0];
  v = v.split(";")[0].trim();
  // Scheme prefix "/x11/red" or "/blues9/3"
  if (v.startsWith("/")) {
    const parts = v.split("/");
    v = parts[parts.length - 1];
  }
  if (/^#[0-9a-f]{3,8}$/i.test(v)) return v.toLowerCase();
  // HSV "0.5,0.5,0.5" or "0.5 0.5 0.5"
  const hsv = v.split(/[ ,]+/).map(Number);
  if (hsv.length === 3 && hsv.every((n) => Number.isFinite(n) && n >= 0 && n <= 1)) {
    return convertHsvToHex(hsv[0], hsv[1], hsv[2]);
  }
  const lower = v.toLowerCase().replace(/\s+/g, "");
  if (lower in X11_EXTRAS) return X11_EXTRAS[lower];
  const gray = /^gr[ae]y(\d{1,3})$/.exec(lower);
  if (gray) {
    const level = Math.min(100, Number(gray[1]));
    const c = Math.round((level / 100) * 255);
    return formatHex([c, c, c]);
  }
  const numbered = /^([a-z]+)([1-4])$/.exec(lower);
  if (numbered && numbered[1] in X11_BASE) {
    const factor = VARIANT_FACTORS[Number(numbered[2]) - 1];
    return formatHex(X11_BASE[numbered[1]].map((c) => c * factor));
  }
  if (/^[a-z]+$/.test(lower)) return lower;
  return null;
}
