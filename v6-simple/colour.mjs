// Reading CSS colours (hex, rgb(), hsl()) as hex.

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export const toHex = (r, g, b) =>
	'#' + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');

export function hexToRgb(hex) {
	let h = hex.replace('#', '');
	if (h.length <= 4) h = [...h].map((c) => c + c).join('');
	return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
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
