// Reading CSS colours (hex, rgb(), hsl()) as hex.

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export const toHex = (r, g, b) =>
	'#' + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');

export function hexToRgb(hex) {
	let h = hex.replace('#', '');
	if (h.length <= 4) h = [...h].map((c) => c + c).join('');
	return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

// OKLCH lightness (0-1) and chroma (colourfulness, about 0-0.37), Björn Ottosson's OKLab. Unlike HSL, equal steps look equal.
export function hexToOklch(hex) {
	const [r, g, b] = hexToRgb(hex).map((c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
	const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
	const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
	const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
	return [L, Math.hypot(a, bb)];
}

function hslToRgb(h, s, l) {
	h = ((h % 360) + 360) % 360; s = clamp(s, 0, 100) / 100; l = clamp(l, 0, 100) / 100;
	const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
	const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
	return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

const num = (v, scale) => (v.endsWith('%') ? (parseFloat(v) / 100) * scale : parseFloat(v));

// A CSS colour as { hex, alpha }, or null. Browsers report computed colours as rgb()/rgba(), which this covers.
// shortcut: oklch()/color() computed values are skipped; pixels in those colours still count if they cover 0.5% or more.
export function parseColour(str) {
	str = str.trim().toLowerCase();
	if (str[0] === '#') {
		let h = str.slice(1);
		if (![3, 4, 6, 8].includes(h.length) || /[^0-9a-f]/.test(h)) return null;
		if (h.length <= 4) h = [...h].map((c) => c + c).join('');
		return { hex: '#' + h.slice(0, 6), alpha: h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1 };
	}
	const m = str.match(/^(rgba?|hsla?)\((.*)\)$/);
	if (!m || /var\(|calc\(/.test(m[2])) return null;
	const parts = m[2].split(/[\s,/]+/).filter(Boolean);
	if (parts.length < 3) return null;
	const alpha = parts[3] !== undefined ? clamp(num(parts[3], 1), 0, 1) : 1;
	const rgb = m[1].startsWith('rgb') ? parts.slice(0, 3).map((p) => num(p, 255)) : hslToRgb(parseFloat(parts[0]), parseFloat(parts[1]), parseFloat(parts[2]));
	if (rgb.some(Number.isNaN) || Number.isNaN(alpha)) return null;
	return { hex: toHex(...rgb), alpha };
}
