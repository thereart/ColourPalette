#!/usr/bin/env node
// Colour Palette v6: shows every colour on a web page, ranked either by how much of the page it covers
// or by how many times the site's CSS uses it.
// Run: node server.mjs (or double-click Start.bat), then open http://localhost:4326
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { renderScrape } from './render-scrape.mjs';
import { scrape } from './scrape-colours.mjs';
import { classify } from './classify.mjs';

const PORT = Number(process.env.PORT) || 4326;
const page = new URL('./index.html', import.meta.url);
const cache = new Map(); // method:url -> result, so switching back and forth doesn't re-read the site

const send = (res, status, body, type = 'application/json') => {
	res.writeHead(status, { 'Content-Type': `${type}; charset=utf-8` });
	res.end(type === 'application/json' ? JSON.stringify(body) : body);
};

// Times used in the CSS: the same shape as the coverage result, with each colour's share of all uses.
async function cssColours(url) {
	const result = await scrape(url);
	const total = result.colours.reduce((s, c) => s + c.count, 0) || 1;
	return { ...result, method: 'css', colours: result.colours.map((c) => ({ hex: c.hex, count: c.count, share: c.count / total, roles: c.roles, variables: c.variables })) };
}

// Each colour gets a label (brand, background or text) and the reasons for it.
const labelled = (result) => ({ ...result, colours: result.colours.map((c) => ({ ...c, ...classify(c) })) });

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
	const method = searchParams.get('method') === 'css' ? 'css' : 'coverage';
	try {
		const key = `${method}:${target}`;
		const result = cache.get(key) ?? labelled(method === 'css' ? await cssColours(target) : await renderScrape(target));
		if (!result.totalColours) return send(res, 422, { error: 'No colours were found on that page.' });
		if (cache.size > 20) cache.delete(cache.keys().next().value);
		cache.set(key, result);
		send(res, 200, result);
	} catch (err) {
		const setup = /setup is missing|Edge or Google Chrome/.test(err.message);
		const blocked = method === 'css' && /^(401|403|429|503)\b/.test(err.message);
		send(res, 502, {
			error: setup ? `${err.message} "Times used in the CSS" works without it.`
				: `Couldn't load that website (${err.message}). ${blocked ? 'The site may block plain downloads: try "% of page covered", which opens it in a real browser.' : 'Check the address and try again.'}`,
		});
	}
}).on('error', (err) => {
	if (err.code !== 'EADDRINUSE') throw err;
	console.error(`Colour Palette is already running (port ${PORT} is in use). Open http://localhost:${PORT} in your browser, or close the other Colour Palette window first.`);
	process.exit(1);
}).listen(PORT, '127.0.0.1', () => console.log(`Colour Palette v6 is running: http://localhost:${PORT}  (close this window to stop it)`));
