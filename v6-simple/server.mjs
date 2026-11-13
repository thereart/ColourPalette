#!/usr/bin/env node
// Colour Palette v6: shows every colour on a web page, by how much of the page it covers.
// Run: node server.mjs (or double-click Start.bat), then open http://localhost:4326
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { renderScrape } from './render-scrape.mjs';

const PORT = Number(process.env.PORT) || 4326;
const page = new URL('./index.html', import.meta.url);

const send = (res, status, body, type = 'application/json') => {
	res.writeHead(status, { 'Content-Type': `${type}; charset=utf-8` });
	res.end(type === 'application/json' ? JSON.stringify(body) : body);
};

createServer(async (req, res) => {
	const { pathname, searchParams } = new URL(req.url, `http://${req.headers.host}`);
	if (pathname === '/') return send(res, 200, readFileSync(page), 'text/html');
	if (pathname !== '/api/colours') return send(res, 404, { error: 'Not found' });

	let target = (searchParams.get('url') || '').trim();
	if (!/^https?:\/\//i.test(target)) target = `https://${target}`;
	try {
		target = new URL(target).href;
	} catch {
		return send(res, 400, { error: "That doesn't look like a website address." });
	}
	try {
		const result = await renderScrape(target);
		if (!result.totalColours) return send(res, 422, { error: 'No colours were found on that page.' });
		send(res, 200, result);
	} catch (err) {
		const setup = /setup is missing|Edge or Google Chrome/.test(err.message);
		send(res, 502, { error: setup ? err.message : `Couldn't load that website (${err.message}). Check the address and try again.` });
	}
}).on('error', (err) => {
	if (err.code !== 'EADDRINUSE') throw err;
	console.error(`Colour Palette is already running (port ${PORT} is in use). Open http://localhost:${PORT} in your browser, or close the other Colour Palette window first.`);
	process.exit(1);
}).listen(PORT, '127.0.0.1', () => console.log(`Colour Palette v6 is running: http://localhost:${PORT}  (close this window to stop it)`));
