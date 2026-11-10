#!/usr/bin/env node
// Scrapes a web page's colours from its CSS (linked stylesheets, <style> blocks, inline styles,
// theme-color meta) and writes them, most used first, to a JSON file. Images are left out:
// <img>, inline <svg> and every CSS url(...) (background images, data URIs) are ignored.
//
// Usage: node scrape-colours.mjs <url> [output.json]

import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseColour } from './colour.mjs';

const COLOUR_TOKEN = /#[0-9a-f]{3,8}\b|(?:rgba?|hsla?)\([^)]*\)/gi;
// WordPress core ships the same default colours on every site; they aren't the site's design.
const SKIP_STYLESHEET = /\/wp-(?:includes|admin)\//;
const SKIP_PROPERTY = /^--wp--preset--|^--wp-admin/;

const stripCss = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/url\((?:"[^"]*"|'[^']*'|[^)]*)\)/gi, '');

// Adds every colour in a block of declarations ("color: #fff; background: ...") to the tally.
function addDeclarations(text, tally, source) {
	for (const decl of text.split(';')) {
		const i = decl.indexOf(':');
		if (i < 0) continue;
		const prop = decl.slice(0, i).trim().toLowerCase();
		if (!prop || SKIP_PROPERTY.test(prop)) continue;
		for (const token of decl.slice(i + 1).match(COLOUR_TOKEN) || []) {
			const c = parseColour(token);
			if (!c || c.alpha === 0) continue;
			const entry = (tally[c.hex] ??= { hex: c.hex, count: 0, translucent: 0, properties: {}, variables: [], sources: [] });
			entry.count++;
			if (c.alpha < 1) entry.translucent++;
			entry.properties[prop] = (entry.properties[prop] || 0) + 1;
			if (prop.startsWith('--') && !entry.variables.includes(prop)) entry.variables.push(prop);
			if (!entry.sources.includes(source)) entry.sources.push(source);
		}
	}
}

// Rule bodies are the innermost {...} blocks, so selectors (#id, :not(#abc)) are never read as colours.
export function extractColours(css, tally = {}, source = 'inline') {
	for (const [, body] of stripCss(css).matchAll(/\{([^{}]*)\}/g)) addDeclarations(body, tally, source);
	return tally;
}

async function get(url) {
	const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (colour-scraper)' }, signal: AbortSignal.timeout(20000) });
	if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
	return res.text();
}

export async function scrape(pageUrl) {
	const tally = {}, stylesheets = [], skipped = [];
	const html = (await get(pageUrl)).replace(/<(script|svg|noscript)\b[\s\S]*?<\/\1>/gi, '');

	for (const [, css] of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) extractColours(css, tally, 'style-tag');
	for (const [, , style] of html.matchAll(/\sstyle\s*=\s*(["'])([\s\S]*?)\1/gi)) addDeclarations(stripCss(style), tally, 'style-attribute');
	for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
		if (/name\s*=\s*["']theme-color["']/i.test(tag)) {
			const content = tag.match(/content\s*=\s*["']([^"']+)["']/i)?.[1];
			if (content) addDeclarations(`theme-color: ${content}`, tally, 'meta');
		}
	}

	const queue = [];
	for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
		const href = tag.match(/href\s*=\s*["']([^"']+)["']/i)?.[1];
		const url = href && new URL(href.replace(/&amp;/g, '&'), pageUrl).href;
		if (url && /rel\s*=\s*["'][^"']*stylesheet/i.test(tag) && !queue.includes(url)) queue.push(url);
	}
	// The queue grows as @import rules are found.
	for (let i = 0; i < queue.length; i++) {
		const url = queue[i];
		if (SKIP_STYLESHEET.test(url)) { skipped.push({ url, reason: 'WordPress core stylesheet' }); continue; }
		try {
			const css = await get(url);
			stylesheets.push(url);
			extractColours(css, tally, url);
			for (const [, imp] of css.matchAll(/@import\s+(?:url\()?\s*["']?([^"')\s;]+)/gi)) {
				const next = new URL(imp, url).href;
				if (!queue.includes(next)) queue.push(next);
			}
		} catch (err) {
			skipped.push({ url, reason: err.message });
		}
	}

	const colours = Object.values(tally).sort((a, b) => b.count - a.count);
	return { url: pageUrl, scrapedAt: new Date().toISOString(), totalColours: colours.length, stylesheets, skipped, colours };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const [url, out] = process.argv.slice(2);
	if (!url) {
		console.error('Usage: node scrape-colours.mjs <url> [output.json]');
		process.exit(1);
	}
	const pageUrl = /^https?:\/\//.test(url) ? url : `https://${url}`;
	const result = await scrape(pageUrl);
	const file = out || `colours-${new URL(pageUrl).hostname}.json`;
	writeFileSync(file, JSON.stringify(result, null, '\t') + '\n');
	console.log(`${result.totalColours} colours from ${result.stylesheets.length} stylesheets -> ${file}`);
	for (const s of result.skipped) console.warn(`skipped ${s.url}: ${s.reason}`);
}
