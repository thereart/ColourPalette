#!/usr/bin/env node
// Local web UI for the colour tools (v2). Run: node server.mjs (or double-click Start.bat), then open http://localhost:4322
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { scrape } from './scrape-colours.mjs';
import { suggest } from './suggest-palette.mjs';
import { curate } from './curate.mjs';

const PORT = Number(process.env.PORT) || 4322;
const page = new URL('./index.html', import.meta.url);
const cache = new Map(); // url -> scrape, so changing the background style doesn't re-read the site

const send = (res, status, body, type = 'application/json') => {
	res.writeHead(status, { 'Content-Type': `${type}; charset=utf-8` });
	res.end(type === 'application/json' ? JSON.stringify(body) : body);
};

createServer(async (req, res) => {
	const { pathname, searchParams } = new URL(req.url, `http://${req.headers.host}`);
	if (pathname === '/') return send(res, 200, readFileSync(page), 'text/html');
	if (pathname !== '/api/palette') return send(res, 404, { error: 'Not found' });

	let target = (searchParams.get('url') || '').trim();
	if (!/^https?:\/\//i.test(target)) target = `https://${target}`;
	try {
		target = new URL(target).href;
	} catch {
		return send(res, 400, { error: "That doesn't look like a website address." });
	}
	try {
		const colours = (searchParams.get('fresh') !== '1' && cache.get(target)) || (await scrape(target));
		if (!colours.totalColours) return send(res, 422, { error: 'No colours were found on that page. It may block automated visits or build its styles with JavaScript.' });
		if (cache.size > 20) cache.delete(cache.keys().next().value);
		cache.set(target, colours);
		const palette = suggest(colours);
		send(res, 200, { colours, palette, design: curate(palette, searchParams.get('bg') || 'white') });
	} catch (err) {
		send(res, 502, { error: `Couldn't load that website (${err.message}). Check the address and try again.` });
	}
}).listen(PORT, '127.0.0.1', () => console.log(`Colour Palette v2 is running: http://localhost:${PORT}  (close this window to stop it)`));
