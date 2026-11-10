#!/usr/bin/env node
// Local web UI for the colour tools (v5). Run: node server.mjs (or double-click Start.bat), then open http://localhost:4325
//
// Public mode (only for hosting it for a team): set PUBLIC_MODE=1. It then listens on all network
// addresses, refuses addresses inside private networks, limits each visitor to 30 requests per
// 10 minutes, and turns off "read the page as visitors see it".
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { guard } from './guard.mjs';
import { scrape } from './scrape-colours.mjs';
import { renderScrape } from './render-scrape.mjs';
import { suggest } from './suggest-palette.mjs';
import { curate } from './curate.mjs';
import { system } from './system.mjs';
import { applyProperty, PROPERTY_TYPES } from './hotel.mjs';
import { pebbleExport, emailExport, bookingExport, printExport } from './exports.mjs';
import { candidates, similarPalettes, generateColour } from './choose.mjs';
import { locateTheme, scanUsage, planThemeExport } from './pebble-theme.mjs';

const PORT = Number(process.env.PORT) || 4325;
const PUBLIC = process.env.PUBLIC_MODE === '1';
const page = new URL('./index.html', import.meta.url);
const cache = new Map(); // method:url -> scrape, so changing a setting doesn't re-read the site

const send = (res, status, body, type = 'application/json') => {
	res.writeHead(status, { 'Content-Type': `${type}; charset=utf-8` });
	res.end(type === 'application/json' ? JSON.stringify(body) : body);
};

const hits = new Map(); // ip -> request times
function rateLimited(ip) {
	const now = Date.now();
	const recent = (hits.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
	recent.push(now);
	hits.set(ip, recent);
	return recent.length > 30;
}

// Photo/logo colours arrive as "#rrggbb:share,..." (shares of the image, 0-1) from the page, which reads the images itself.
function parseImageColours(value) {
	return (value || '').split(',').slice(0, 24).map((part) => {
		const [hex, share] = part.split(':');
		return /^#[0-9a-f]{6}$/i.test(hex) && share >= 0 && share <= 1 ? { hex: hex.toLowerCase(), share: Number(share) } : null;
	}).filter(Boolean);
}

function mergeImageColours(colours, img, weight) {
	if (!img.length) return colours;
	const factor = { low: 0.25, medium: 0.5, high: 1 }[weight] ?? 0.5;
	const total = colours.colours.reduce((s, c) => s + c.count, 0) || 100;
	const list = colours.colours.map((c) => ({ ...c }));
	for (const { hex, share } of img) {
		const count = Math.max(1, Math.round(share * total * factor));
		const existing = list.find((c) => c.hex === hex);
		if (existing) Object.assign(existing, { count: existing.count + count, properties: { ...existing.properties, 'photo or logo': count }, sources: [...existing.sources, 'photo or logo'] });
		else list.push({ hex, count, translucent: 0, properties: { 'photo or logo': count }, variables: [], sources: ['photo or logo'] });
	}
	list.sort((a, b) => b.count - a.count);
	return { ...colours, colours: list, totalColours: list.length, imageColours: img.length };
}

function readOptions(sp) {
	const pick = (key, fallback, allowed) => (allowed.includes(sp.get(key)) ? sp.get(key) : fallback);
	const on = (key, fallback) => (sp.has(key) ? sp.get(key) === '1' : fallback);
	return {
		bg: pick('bg', 'auto', ['auto', 'white', 'offwhite', 'tinted', 'dark']),
		property: pick('property', 'none', Object.keys(PROPERTY_TYPES)),
		text: pick('text', 'aa', ['aa', 'aaa']),
		dark: pick('dark', 'manual', ['manual', 'auto', 'both']),
		imgWeight: pick('imgWeight', 'medium', ['low', 'medium', 'high']),
		states: on('states', true), photo: on('photo', true), render: on('render', true),
		pebble: on('pebble', true), email: on('email', true), booking: on('booking', true), print: on('print', false),
		theme: (sp.get('theme') || '').slice(0, 500), pebbleText: on('pebbleText', false), pebbleNew: on('pebbleNew', false),
	};
}

createServer(async (req, res) => {
	const { pathname, searchParams } = new URL(req.url, `http://${req.headers.host}`);
	if (pathname === '/') return send(res, 200, readFileSync(page), 'text/html');
	if (pathname === '/api/config') return send(res, 200, { publicMode: PUBLIC, propertyTypes: Object.fromEntries(Object.entries(PROPERTY_TYPES).map(([k, v]) => [k, v.label])) });
	if (pathname === '/api/generate') {
		const hexes = (key) => (searchParams.get(key) || '').split(',').filter((h) => /^#[0-9a-f]{6}$/i.test(h)).map((h) => h.toLowerCase());
		const picks = hexes('picks').slice(0, 5);
		const index = Number(searchParams.get('index'));
		if (!Number.isInteger(index) || index < 0 || index >= picks.length) return send(res, 400, { error: 'Pick a colour to change.' });
		const colour = generateColour(picks, index, { property: readOptions(searchParams).property, exclude: hexes('exclude').slice(0, 40) });
		return send(res, 200, { colour });
	}
	if (pathname === '/api/similar') {
		const picks = (searchParams.get('picks') || '').split(',').filter((h) => /^#[0-9a-f]{6}$/i.test(h)).map((h) => h.toLowerCase()).slice(0, 5);
		return send(res, 200, { palettes: similarPalettes(picks, readOptions(searchParams).property) });
	}
	if (pathname !== '/api/palette' && pathname !== '/api/colours') return send(res, 404, { error: 'Not found' });
	if (PUBLIC && rateLimited(req.socket.remoteAddress)) return send(res, 429, { error: 'Too many requests. Please wait a few minutes and try again.' });

	let target = (searchParams.get('url') || '').trim();
	if (!/^https?:\/\//i.test(target)) target = `https://${target}`;
	try {
		target = new URL(target).href;
	} catch {
		return send(res, 400, { error: "That doesn't look like a website address." });
	}
	const options = readOptions(searchParams);
	if (PUBLIC) options.render = false;
	try {
		const key = `${options.render ? 'rendered' : 'css'}:${target}`;
		let colours = searchParams.get('fresh') !== '1' && cache.get(key);
		if (!colours && options.render) {
			try {
				colours = await renderScrape(target);
			} catch (err) {
				// No browser or add-on: fall back to the CSS (ranked by code use), and say so. Real page errors still fail.
				if (!err.message.startsWith('"Read the page')) throw err;
				colours = { ...(await scrape(target)), warning: `${err.message} Until then, colours are ranked by how often the site's code uses them, not by how much of the page they cover.` };
			}
		}
		if (!colours) colours = await scrape(target, { guard: PUBLIC ? guard : undefined });
		if (!colours.totalColours) return send(res, 422, { error: 'No colours were found on that page. It may block automated visits or build its styles with JavaScript. Try turning on "Read the page as visitors see it".' });
		if (cache.size > 20) cache.delete(cache.keys().next().value);
		cache.set(key, colours);
		colours = mergeImageColours(colours, parseImageColours(searchParams.get('img')), options.imgWeight);

		// Step 1: the site's brand colours, each with recommended changes to keep or swap.
		if (pathname === '/api/colours') {
			const list = candidates(colours, { property: options.property });
			const fromSite = list.filter((c) => c.source !== 'suggested').length;
			const note = colours.method === 'rendered' && fromSite < 3
				? `Only ${fromSite} brand colour${fromSite === 1 ? '' : 's'} cover${fromSite === 1 ? 's' : ''} a visible part of this page outside its images, so the rest are suggestions. If the brand colours live in the logo or photos, add them under Settings > Property photos or logo.`
				: null;
			return send(res, 200, { colours, candidates: list, note, options });
		}

		// Step 2: the full system, built from the chosen colours exactly as picked.
		const picks = (searchParams.get('picks') || '').split(',').filter((h) => /^#[0-9a-f]{6}$/i.test(h)).map((h) => h.toLowerCase()).slice(0, 5);
		const { suggestion, hotel } = applyProperty(suggest(colours, { picks: picks.length ? picks : null }), options.property, { retune: !picks.length });
		const design = curate(suggestion, options.bg === 'auto' ? (hotel?.background ?? 'white') : options.bg, { textTarget: options.text, keepOrder: picks.length > 0 });
		if (hotel) Object.assign(design, { curated: hotel.curated, mood: hotel.label });
		design.extras = suggestion.extras ?? [];
		const sys = system(design, target, { states: options.states, photoCheck: options.photo, darkMode: options.dark });
		// Theme-aware Pebble export: read the site's own _variables.scss and search its styles. Local only.
		let pebbleTheme = null, themeError = null;
		if (options.pebble && options.theme && !PUBLIC) {
			const theme = locateTheme(options.theme);
			if (!theme) themeError = `Couldn't find assets/src/sass/base/_variables.scss in "${options.theme}". Use the theme folder (…/wp-content/themes/pebbledesign), the site folder, or the file itself.`;
			else {
				const { usage, blocks } = scanUsage(theme.root);
				pebbleTheme = planThemeExport({ text: readFileSync(theme.file, 'utf8'), file: theme.file, root: theme.root, usage, blocks }, design, sys, { text: options.pebbleText, newVars: options.pebbleNew });
			}
		}
		const exports = {
			pebble: options.pebble ? (pebbleTheme?.changeList ?? pebbleExport(design, sys, { text: options.pebbleText, newVars: options.pebbleNew })) : null,
			email: options.email ? emailExport(design) : null,
			booking: options.booking ? bookingExport(design, sys) : null,
			print: options.print ? printExport(design) : null,
		};
		send(res, 200, { colours, palette: suggestion, design, system: sys, hotel, exports, pebbleTheme, themeError, options });
	} catch (err) {
		const blocked = !options.render && /^(401|403|429|503)\b/.test(err.message);
		send(res, 502, { error: err.message.startsWith('"Read the page') ? err.message : `Couldn't load that website (${err.message}). ${blocked ? 'The site may block automated downloads: try turning on "Read the page as visitors see it" in Settings.' : 'Check the address and try again.'}` });
	}
}).on('error', (err) => {
	if (err.code !== 'EADDRINUSE') throw err;
	console.error(`Colour Palette is already running (port ${PORT} is in use). Open http://localhost:${PORT} in your browser, or close the other Colour Palette window first.`);
	process.exit(1);
}).listen(PORT, PUBLIC ? '0.0.0.0' : '127.0.0.1', () => console.log(`Colour Palette v5 is running: http://localhost:${PORT}${PUBLIC ? '  (public mode)' : ''}  (close this window to stop it)`));
