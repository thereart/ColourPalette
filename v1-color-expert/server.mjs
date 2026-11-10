#!/usr/bin/env node
// Local web UI for the colour tools. Run: node server.mjs (or double-click Start.bat), then open http://localhost:4321
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { scrape } from './scrape-colours.mjs';
import { suggest } from './suggest-palette.mjs';

const PORT = Number(process.env.PORT) || 4321;
const page = new URL('./index.html', import.meta.url);

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
		const colours = await scrape(target);
		if (!colours.totalColours) return send(res, 422, { error: 'No colours were found on that page. It may block automated visits or build its styles with JavaScript.' });
		send(res, 200, { colours, palette: suggest(colours) });
	} catch (err) {
		send(res, 502, { error: `Couldn't load that website (${err.message}). Check the address and try again.` });
	}
}).listen(PORT, '127.0.0.1', () => console.log(`Colour Palette is running: http://localhost:${PORT}  (close this window to stop it)`));
