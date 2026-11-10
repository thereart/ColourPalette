// Colour maths shared by scrape-colours.mjs and suggest-palette.mjs.

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export const toHex = (r, g, b) =>
	'#' + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');

export function hexToRgb(hex) {
	let h = hex.replace('#', '');
	if (h.length <= 4) h = [...h].map((c) => c + c).join('');
	return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

export function rgbToHsl(r, g, b) {
	r /= 255; g /= 255; b /= 255;
	const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
	const l = (max + min) / 2;
	if (!d) return [0, 0, l * 100];
	const s = d / (1 - Math.abs(2 * l - 1));
	const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
	return [(h * 60 + 360) % 360, s * 100, l * 100];
}

export function hslToRgb(h, s, l) {
	h = ((h % 360) + 360) % 360; s = clamp(s, 0, 100) / 100; l = clamp(l, 0, 100) / 100;
	const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
	const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
	return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

export const hexToHsl = (hex) => rgbToHsl(...hexToRgb(hex));
export const hslToHex = (h, s, l) => toHex(...hslToRgb(h, s, l));

// WCAG 2 relative luminance and contrast ratio.
export function luminance(hex) {
	const [r, g, b] = hexToRgb(hex).map((v) => {
		v /= 255;
		return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a, b) {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
}

// OKLab / OKLCH (Björn Ottosson). Perceptual: equal steps look equal, unlike HSL.
export const toLinear = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
export const fromLinear = (c) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

export function hexToOklab(hex) {
	const [r, g, b] = hexToRgb(hex).map(toLinear);
	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
	return [
		0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
		1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
		0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
	];
}

// [L 0-1, C ~0-0.37, H degrees]
export function hexToOklch(hex) {
	const [L, a, b] = hexToOklab(hex);
	const C = Math.hypot(a, b);
	return [L, C, C < 1e-4 ? 0 : (Math.atan2(b, a) * 180 / Math.PI + 360) % 360];
}

function oklchToLinear(L, C, H) {
	const a = C * Math.cos(H * Math.PI / 180), b = C * Math.sin(H * Math.PI / 180);
	const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
	const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
	const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
	return [
		4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
		-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
		-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
	];
}

const inGamut = (rgb) => rgb.every((v) => v >= -1e-5 && v <= 1 + 1e-5);

// Most chroma sRGB can show at this lightness and hue.
export function maxChroma(L, H) {
	let lo = 0, hi = 0.4;
	for (let i = 0; i < 20; i++) {
		const mid = (lo + hi) / 2;
		if (inGamut(oklchToLinear(L, mid, H))) lo = mid; else hi = mid;
	}
	return lo;
}

// Out-of-gamut colours lose chroma, never lightness or hue, so they keep their identity.
export function oklchToHex(L, C, H) {
	L = clamp(L, 0, 1);
	let rgb = oklchToLinear(L, C, H);
	if (!inGamut(rgb)) rgb = oklchToLinear(L, maxChroma(L, H), H);
	return toHex(...rgb.map((v) => fromLinear(clamp(v, 0, 1))));
}

export const oklchCss = ([L, C, H]) => `oklch(${(L * 100).toFixed(1)}% ${C.toFixed(3)} ${H.toFixed(1)})`;

// Perceptual difference (Euclidean in OKLab). Under ~0.08 colours are hard to tell apart.
export function deltaEOK(a, b) {
	const [x, y] = [hexToOklab(a), hexToOklab(b)];
	return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

// APCA lightness contrast (Lc) of text on a background, SAPC 0.0.98G. Sign shows polarity; use the absolute value.
// Lc 90 preferred body text, 75 body text, 60 large text, 45 headlines.
export function apca(text, bg) {
	const Y = (hex) => {
		const [r, g, b] = hexToRgb(hex).map((v) => (v / 255) ** 2.4);
		const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
		return y < 0.022 ? y + (0.022 - y) ** 1.414 : y;
	};
	const [yt, yb] = [Y(text), Y(bg)];
	if (Math.abs(yb - yt) < 0.0005) return 0;
	const sapc = yb > yt ? (yb ** 0.56 - yt ** 0.57) * 1.14 : (yb ** 0.65 - yt ** 0.62) * 1.14;
	if (Math.abs(sapc) < 0.1) return 0;
	return (sapc > 0 ? sapc - 0.027 : sapc + 0.027) * 100;
}

// Plain-English hue name. Ranges from mrmrs' random-display-p3-color, via the color-expert skill.
export function hueName(hex) {
	const [L, C] = hexToOklch(hex);
	if (C < 0.03) return L > 0.9 ? 'white' : L < 0.25 ? 'black' : 'grey';
	const h = hexToHsl(hex)[0];
	return h < 15 || h >= 345 ? 'red' : h < 45 ? 'orange' : h < 70 ? 'yellow' : h < 165 ? 'green' : h < 195 ? 'cyan' : h < 260 ? 'blue' : h < 310 ? 'purple' : 'pink';
}

// Smallest angle between two hues, 0-180.
export const hueDistance = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

const num = (v, scale) => (v.endsWith('%') ? (parseFloat(v) / 100) * scale : parseFloat(v));

// Parses a CSS colour (hex, rgb(), hsl()) into { hex, alpha }, or null.
// shortcut: named colours (white, red...) and modern spaces (oklch, color-mix) are ignored; add them if a site relies on them.
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
	const rgb = m[1].startsWith('rgb')
		? parts.slice(0, 3).map((p) => num(p, 255))
		: hslToRgb(parseFloat(parts[0]), parseFloat(parts[1]), parseFloat(parts[2]));
	if (rgb.some(Number.isNaN) || Number.isNaN(alpha)) return null;
	return { hex: toHex(...rgb), alpha };
}
