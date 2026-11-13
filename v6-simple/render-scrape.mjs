// Reads a page the way visitors see it: opens it in Edge or Chrome (already on the computer) through
// playwright-core, takes a full-page screenshot, and measures how much of the page each colour covers,
// pixel by pixel. Images, video, canvas, inline SVG, iframes and photo backgrounds are left out of the
// count entirely. Returns the same shape as scrape-colours.mjs, plus `coverage` (0-1) on each colour.
//
// Needs the playwright-core package, which Start.bat installs on first run (npm install does the same).

import { inflateSync } from 'node:zlib';
import { parseColour, toHex } from './colour.mjs';

const MAX_HEIGHT = 12000; // px of page measured; very long pages are measured from the top down to here
const STEP = 2; // sample every 2nd pixel across and down: a quarter of the pixels, same answer to within a fraction of a percent
const SAME = 4; // a pixel within 4/255 per channel of a CSS colour counts as that colour (allows for rendering rounding)
const MIN_UNNAMED = 0.005; // flat colours not in the CSS (e.g. a translucent overlay blended onto a background) count from 0.5% up

// How a colour is used, counted per element (or per CSS rule in CSS mode). Shared with scrape-colours.mjs.
export const emptyRoles = () => ({ bg: 0, bgLarge: 0, text: 0, border: 0, interactive: 0, interactiveBg: 0, heading: 0, nav: 0 });
export function countRole(roles, role, { interactive, heading, nav, large }) {
	roles[role]++;
	if (role === 'bg' && large) roles.bgLarge++;
	if (interactive) { roles.interactive++; if (role === 'bg') roles.interactiveBg++; }
	if (heading && role === 'text') roles.heading++;
	if (nav) roles.nav++;
}

// Minimal PNG reader for Chrome screenshots: 8-bit RGB or RGBA, not interlaced.
export function decodePng(buf) {
	let pos = 8, width, height, bitDepth, colourType, interlace;
	const idat = [];
	while (pos < buf.length) {
		const len = buf.readUInt32BE(pos);
		const type = buf.toString('ascii', pos + 4, pos + 8);
		const data = buf.subarray(pos + 8, pos + 8 + len);
		if (type === 'IHDR') [width, height, bitDepth, colourType, interlace] = [data.readUInt32BE(0), data.readUInt32BE(4), data[8], data[9], data[12]];
		else if (type === 'IDAT') idat.push(data);
		else if (type === 'IEND') break;
		pos += 12 + len;
	}
	if (bitDepth !== 8 || ![2, 6].includes(colourType) || interlace) throw new Error('unsupported screenshot format');
	const bpp = colourType === 6 ? 4 : 3, stride = width * bpp;
	const raw = inflateSync(Buffer.concat(idat));
	const out = Buffer.alloc(height * stride);
	for (let y = 0; y < height; y++) {
		const filter = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
		for (let x = 0; x < stride; x++) {
			const a = x >= bpp ? out[dst + x - bpp] : 0, b = y ? out[dst - stride + x] : 0, c = x >= bpp && y ? out[dst - stride + x - bpp] : 0;
			let v = raw[src + x];
			if (filter === 1) v += a;
			else if (filter === 2) v += b;
			else if (filter === 3) v += (a + b) >> 1;
			else if (filter === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
			out[dst + x] = v & 255;
		}
	}
	return { width, height, bpp, data: out };
}

// Share of the page (outside the excluded rectangles) each colour covers.
// cssColours: hex colours the page's CSS uses; pixels are matched to them, anti-aliased edges are ignored.
export function measureCoverage({ width, height, bpp, data }, exclude, cssColours, step = STEP) {
	const mask = new Uint8Array(width * height);
	for (const r of exclude) {
		const [x0, y0] = [Math.max(0, Math.floor(r.x)), Math.max(0, Math.floor(r.y))];
		const [x1, y1] = [Math.min(width, Math.ceil(r.x + r.width)), Math.min(height, Math.ceil(r.y + r.height))];
		for (let y = y0; y < y1; y++) mask.fill(1, y * width + x0, y * width + Math.max(x0, x1));
	}
	const counts = new Map();
	let total = 0;
	for (let y = 0; y < height; y += step) {
		for (let x = 0; x < width; x += step) {
			if (mask[y * width + x]) continue;
			const i = (y * width + x) * bpp;
			const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
			counts.set(key, (counts.get(key) || 0) + 1);
			total++;
		}
	}
	const rgb = (key) => [key >> 16, (key >> 8) & 255, key & 255];
	const known = cssColours.map((hex) => [hex, [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))]);
	const result = new Map(); // hex -> pixels
	const unnamed = [];
	for (const [key, n] of counts) {
		const p = rgb(key);
		const match = known.find(([, k]) => Math.abs(k[0] - p[0]) <= SAME && Math.abs(k[1] - p[1]) <= SAME && Math.abs(k[2] - p[2]) <= SAME);
		// Small brand colours (link text, icons) still count; unknown colours under the threshold are anti-aliasing noise.
		if (!match && n < total * MIN_UNNAMED) continue;
		if (match) { result.set(match[0], (result.get(match[0]) || 0) + n); continue; }
		unnamed.push([p, n]);
	}
	// Flat colours not in the CSS (a shaded area, an overlay blend) often come as several near-identical shades:
	// each still has to pass the threshold on its own, then shades within 8/255 per channel count as one, under the most common.
	const groups = [];
	for (const [p, n] of unnamed.sort((a, b) => b[1] - a[1])) {
		const g = groups.find((x) => x.p.every((v, i) => Math.abs(v - p[i]) <= 8));
		if (g) g.n += n; else groups.push({ p, n });
	}
	for (const g of groups) result.set(toHex(...g.p), (result.get(toHex(...g.p)) || 0) + g.n);
	return { total, coverage: Object.fromEntries([...result].map(([hex, n]) => [hex, total ? n / total : 0])) };
}

export async function renderScrape(url) {
	let chromium;
	try {
		({ chromium } = await import('playwright-core'));
	} catch {
		throw new Error('A one-off setup is missing. Close this window and double-click Start.bat again (it installs it), or run npm install in this folder.');
	}
	let browser;
	for (const channel of ['msedge', 'chrome']) {
		try { browser = await chromium.launch({ channel }); break; } catch { /* try the next browser */ }
	}
	if (!browser) throw new Error('This needs Microsoft Edge or Google Chrome on this computer.');

	try {
		const page = await browser.newPage({ viewport: { width: 1366, height: 900 }, deviceScaleFactor: 1 });
		try {
			await page.goto(url, { waitUntil: 'load', timeout: 45000 });
		} catch (err) {
			// Keep the first line ("net::ERR_NAME_NOT_RESOLVED at ...") and drop Playwright's call log.
			throw new Error(err.message.split('\n')[0].replace(/^page\.goto:\s*/, ''));
		}
		// Give late content a few seconds to arrive. Busy sites (tracking, live chat) never go fully quiet, so this can't fail.
		await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
		// How each colour is used (background, text, border; on buttons/links, headings, the nav; large areas),
		// the page's CSS variable names, and every image area to leave out, in page coordinates.
		const { uses, named, exclude, pageHeight } = await page.evaluate(() => {
			const media = 'img, picture, video, canvas, svg, iframe, object, embed';
			const interactive = 'a, button, [role="button"], input[type="submit"], input[type="button"], .btn, .button, [class*="btn-"], [class*="button"]';
			const uses = [], exclude = [];
			for (const el of document.querySelectorAll('body, body *')) {
				const style = getComputedStyle(el);
				const r = el.getBoundingClientRect();
				const box = { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height };
				if (el.matches(media) || /url\(/.test(style.backgroundImage)) { if (box.width && box.height) exclude.push(box); continue; }
				if (el.closest(media) || style.display === 'none' || style.visibility === 'hidden' || !(box.width && box.height)) continue;
				// flags: 1 button/link, 2 heading, 4 nav/header, 8 large area (half the window wide and 150px tall)
				const flags = (el.closest(interactive) ? 1 : 0) | (el.closest('h1, h2, h3, h4, h5, h6') ? 2 : 0)
					| (el.closest('nav, header, [role="navigation"]') ? 4 : 0) | (box.width >= innerWidth * 0.5 && box.height >= 150 ? 8 : 0);
				uses.push([style.backgroundColor, 'bg', flags]);
				// Text colour only counts where there's text (every element has a colour, most show none).
				const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) || (el.matches('input[type="submit"], input[type="button"]') && el.value);
				if (hasText) uses.push([style.color, 'text', flags]);
				const side = ['Top', 'Right', 'Bottom', 'Left'].find((s) => parseFloat(style[`border${s}Width`]) && style[`border${s}Style`] !== 'none');
				if (side) uses.push([style[`border${side}Color`], 'border', flags]);
			}
			// Custom properties set on :root/html, read from every stylesheet the page is allowed to read.
			const names = new Set();
			for (const sheet of document.styleSheets) {
				let rules;
				try { rules = sheet.cssRules; } catch { continue; } // other sites' stylesheets can't be read
				for (const rule of rules) {
					if (rule.selectorText && /(^|,)\s*(:root|html)\s*(,|$)/.test(rule.selectorText)) for (const prop of rule.style) if (prop.startsWith('--')) names.add(prop);
				}
			}
			const root = getComputedStyle(document.documentElement);
			return { uses, named: [...names].map((n) => [n, root.getPropertyValue(n).trim()]), exclude, pageHeight: document.documentElement.scrollHeight };
		});

		const height = Math.min(pageHeight, MAX_HEIGHT);
		const shot = await page.screenshot({ fullPage: true, type: 'png', clip: { x: 0, y: 0, width: 1366, height }, animations: 'disabled' });
		const tally = {};
		const PROP = { bg: 'background-color', text: 'color', border: 'border-color' };
		const newEntry = (hex) => ({ hex, properties: {}, variables: [], roles: emptyRoles(), sources: ['rendered page'] });
		for (const [value, role, flags] of uses) {
			const c = parseColour(value);
			if (!c || c.alpha < 1) continue; // translucent colours blend with what's behind, so the blend is measured instead
			const entry = (tally[c.hex] ??= newEntry(c.hex));
			entry.properties[PROP[role]] = (entry.properties[PROP[role]] || 0) + 1;
			countRole(entry.roles, role, { interactive: flags & 1, heading: flags & 2, nav: flags & 4, large: flags & 8 });
		}
		const { coverage } = measureCoverage(decodePng(shot), exclude, Object.keys(tally));
		for (const hex of Object.keys(coverage)) tally[hex] ??= { ...newEntry(hex), properties: { 'blended (overlay or shadow)': 1 } };
		for (const [name, value] of named) {
			const t = value.match(/^(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})$/); // "-rgb" style triplets
			const hex = t ? toHex(+t[1], +t[2], +t[3]) : parseColour(value)?.hex;
			if (hex && tally[hex] && !tally[hex].variables.includes(name)) tally[hex].variables.push(name);
		}

		// count = coverage in thousandths, so it ranks like the CSS scrape's counts; colours not visible are dropped.
		const colours = Object.values(tally)
			.filter((c) => coverage[c.hex] > 0)
			.map((c) => ({ ...c, coverage: +coverage[c.hex].toFixed(4), count: Math.max(1, Math.round(coverage[c.hex] * 1000)) }))
			.sort((a, b) => b.coverage - a.coverage);
		return {
			url, scrapedAt: new Date().toISOString(), method: 'rendered', measured: { width: 1366, height, pageHeight, imagesLeftOut: exclude.length },
			totalColours: colours.length, stylesheets: [], skipped: [], colours,
		};
	} finally {
		await browser.close();
	}
}
