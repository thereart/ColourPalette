#!/usr/bin/env node
// Reads a scrape-colours.mjs JSON file and suggests a 5-colour web palette: primary, secondary and
// accent (the site's 3 most used colours, tweaked where needed) plus a dark and a light neutral.
//
// The rules follow the color-expert skill by David Aerne (meodai), CC BY 4.0:
// https://github.com/meodai/skill.color-expert
//  - All edits happen in OKLCH, which is perceptual (HSL's "lightness" and "saturation" aren't).
//  - Colours that don't fit the screen lose chroma, never hue or lightness.
//  - Hue harmony alone is a weak rule, so only clear hue clashes are moved. Character (chroma and
//    lightness) drives mood more, so the secondary shares the primary's character and the accent
//    is left as the one vivid colour.
//  - Contrast is checked with WCAG 2 and APCA; "too similar" uses OKLab distance (0.08 guard).
//  - Output has semantic tokens over the raw colours, and 60-30-10 usage guidance.
//
// Usage: node suggest-palette.mjs <colours.json> [output.json]

import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { contrast, apca, hexToOklch, oklchToHex, oklchCss, maxChroma, deltaEOK, hueDistance, hueName, clamp } from './colour.mjs';

const WHITE = '#ffffff';
const AA = 4.5; // WCAG AA, normal text
const HARMONIES = [[0, 'monochromatic'], [30, 'analogous'], [120, 'triadic'], [150, 'split-complementary'], [180, 'complementary']];
const GENERATE_ORDER = [[180, 'complementary'], [30, 'analogous'], [150, 'split-complementary'], [120, 'triadic']];
const HUE_TOLERANCE = 15; // degrees off a harmony before a hue counts as a clash
const DISTINCT = 0.08; // OKLab distance below which two colours are hard to tell apart
// Share of the most chroma a hue can show: above VIVID_MAX, mid-tones vibrate, so they come down to VIVID_CAP.
const VIVID_MAX = 0.95, VIVID_CAP = 0.85;
const USAGE = {
	light: '60%: page backgrounds and large surfaces',
	primary: '30% (with secondary): headers, sections, buttons',
	secondary: '30% (with primary): supporting sections, cards, icons',
	accent: '10%: calls to action and highlights only',
	dark: 'Body text and headings',
	extra: 'Extra brand colour: tags, illustrations, section highlights',
};

const pct = (n) => Math.round(n * 100);
export const relChroma = (L, C, H) => { const m = maxChroma(L, H); return m ? clamp(C / m, 0, 1) : 0; };
const fromRel = (L, rel, H) => oklchToHex(L, rel * maxChroma(L, H), H);
const darkText = (H) => oklchToHex(0.2, 0.02, H);
export const isNeutral = ([L, C]) => C < 0.03 || L < 0.15 || L > 0.97;

// Name of the harmony a hue makes with the primary's hue, without changing anything.
export function harmonyWith(H, primaryH) {
	const diff = Math.abs(((H - primaryH + 540) % 360) - 180);
	return HARMONIES.reduce((best, cur) => (Math.abs(diff - cur[0]) < Math.abs(diff - best[0]) ? cur : best))[1];
}

// Ellen Divers' character groups, as used in the skill.
export function character(L, rel) {
	if (L > 0.82 && rel < 0.6) return 'pale';
	if (L < 0.4) return rel >= 0.5 ? 'deep' : 'dark';
	return rel >= 0.6 ? 'vivid' : 'muted';
}

// Merges near-identical colours (#1e73be and #1f74bf) so they count as one.
export function groupColours(colours) {
	const groups = [];
	for (const c of colours) {
		const g = groups.find((g) => deltaEOK(g.hex, c.hex) < 0.04);
		if (g) { g.count += c.count; g.merged.push(c.hex); } else groups.push({ hex: c.hex, lch: hexToOklch(c.hex), count: c.count, merged: [] });
	}
	return groups.sort((a, b) => b.count - a.count);
}

// Moves OKLCH lightness the shortest way until white or dark text on the colour passes AA.
export function fixContrast(L, rel, H, changes) {
	const ok = (l) => { const hex = fromRel(l, rel, H); return Math.max(contrast(hex, WHITE), contrast(hex, darkText(H))) >= AA; };
	if (ok(L)) return L;
	let down = L, up = L;
	while (down > 0 && contrast(fromRel(down, rel, H), WHITE) < AA) down -= 0.005;
	while (up < 1 && contrast(fromRel(up, rel, H), darkText(H)) < AA) up += 0.005;
	const next = clamp(L - down <= up - L ? down : up, 0, 1);
	changes.push(`Lightness ${pct(L)}% -> ${pct(next)}% (OKLCH) so white or dark text on it passes WCAG AA 4.5:1; mid-tones fail with both. Hue and character kept.`);
	return next;
}

// The facts shown for every palette colour.
export function describe(hex, role) {
	const [L, C, H] = hexToOklch(hex);
	const dark = darkText(H);
	const text = contrast(hex, WHITE) >= contrast(hex, dark) ? WHITE : dark;
	const name = hueName(hex);
	return {
		role, hex, name, character: ['white', 'black', 'grey'].includes(name) ? 'neutral' : character(L, relChroma(L, C, H)), oklch: oklchCss([L, C, H]),
		useWith: text === WHITE ? 'white text' : 'dark text', textColour: text,
		wcag: { white: +contrast(hex, WHITE).toFixed(2), darkText: +contrast(hex, dark).toFixed(2) },
		apca: Math.round(Math.abs(apca(text, hex))), usage: USAGE[role],
	};
}

// Tweaks one main colour. `p` is the finished primary (null while fixing the primary itself).
function improve([L, C, H], role, p, changes) {
	let rel = relChroma(L, C, H);
	let harmony = null;
	if (p && C >= 0.04) {
		const diff = ((H - p.H + 540) % 360) - 180; // signed, -180..180
		const [offset, name] = HARMONIES.reduce((best, cur) => (Math.abs(Math.abs(diff) - cur[0]) < Math.abs(Math.abs(diff) - best[0]) ? cur : best));
		harmony = name;
		if (Math.abs(Math.abs(diff) - offset) > HUE_TOLERANCE) {
			const newH = (p.H + Math.sign(diff || 1) * offset + 360) % 360;
			changes.push(`Hue ${Math.round(H)}° -> ${Math.round(newH)}° (OKLCH) to sit ${name} to the primary; at ${Math.round(Math.abs(diff))}° it fell between harmonies and clashed.`);
			H = newH;
		}
	}
	if (role === 'secondary' && p && Math.abs(rel - p.rel) > 0.25) {
		changes.push(`Chroma ${pct(rel)}% -> ${pct(p.rel)}% of what this hue can show, to share the primary's ${p.character} character. Chroma and lightness set a palette's mood more than hue does.`);
		rel = p.rel;
	}
	if (role !== 'accent' && rel > VIVID_MAX && L > 0.45 && L < 0.85) {
		changes.push(`Chroma ${pct(rel)}% -> ${pct(VIVID_CAP)}% of the maximum so it doesn't vibrate on screen; the accent is kept as the one vivid colour.`);
		rel = VIVID_CAP;
	}
	L = fixContrast(L, rel, H, changes);
	return { ...describe(fromRel(L, rel, H), role), harmony };
}

// picks: colours a person chose in the choose step (in order). They're used exactly as given;
// the 4th and 5th come back as `extras`. The scrape still supplies the site's neutrals.
export function suggest(scrape, { picks = null } = {}) {
	const locked = !!picks?.length;
	const groups = groupColours(scrape.colours);
	const chromatic = locked ? picks.slice(0, 3).map((hex) => ({ hex, lch: hexToOklch(hex), merged: [] })) : groups.filter((g) => !isNeutral(g.lch));
	const neutrals = groups.filter((g) => isNeutral(g.lch));
	const notes = [];
	const main = [];
	let p = null;

	if (!chromatic.length) notes.push('The site has no brand colours (only greys, black and white), so a placeholder blue primary was used. Swap in the brand colour and run again.');

	// New colours turn the primary's hue to an unused harmony, with a different lightness.
	const generate = (role) => {
		const used = main.map((m) => hueDistance(hexToOklch(m.hex)[2], p.H));
		const [offset, name] = GENERATE_ORDER.find(([o]) => !used.some((u) => Math.abs(u - o) < 10));
		const changes = [`New colour: ${name} to the primary (${offset}° round the OKLCH hue wheel).`];
		const L = p.L > 0.6 ? p.L - 0.15 : p.L + 0.15;
		const rel = role === 'accent' ? Math.min(1, p.rel + 0.15) : p.rel;
		const H = (p.H + offset) % 360;
		return { ...improve([L, rel * maxChroma(L, H), H], role, p, changes), original: null, changes };
	};

	for (const [i, role] of ['primary', 'secondary', 'accent'].entries()) {
		const source = chromatic[i] ?? (i === 0 ? { hex: null, lch: [0.5, 0.12, 250], merged: [] } : null);
		if (!source) { main.push(generate(role)); continue; }
		if (locked && source.hex) {
			main.push({ ...describe(source.hex, role), harmony: p ? harmonyWith(source.lch[2], p.H) : null, original: source.hex, merged: source.merged, changes: [] });
			if (i === 0) { const [L, C, H] = source.lch; p = { L, C, H, rel: relChroma(L, C, H), character: main[0].character }; }
			continue;
		}
		const changes = [];
		const colour = { ...improve(source.lch, role, p, changes), original: source.hex, merged: source.merged, changes };
		const clash = main.find((m) => deltaEOK(m.hex, colour.hex) < DISTINCT);
		if (clash) {
			const replacement = generate(role);
			replacement.original = source.hex;
			replacement.changes.unshift(`Replaced ${source.hex}: too close to the ${clash.role} (${clash.hex}) to tell apart.`);
			main.push(replacement);
		} else {
			main.push(colour);
		}
		if (i === 0) {
			const [L, C, H] = hexToOklch(main[0].hex);
			p = { L, C, H, rel: relChroma(L, C, H), character: main[0].character };
		}
	}
	if (chromatic.length && chromatic.length < 3) notes.push(`The site uses ${chromatic.length} brand colour(s), so the palette was expanded to 5 with harmonies generated from the primary.`);

	// Neutrals: the site's own darkest and lightest if it has them, otherwise tinted with the primary's hue.
	const siteDark = neutrals.find((n) => n.lch[0] < 0.35);
	const siteLight = neutrals.find((n) => n.lch[0] > 0.93);
	let darkHex = siteDark?.hex ?? oklchToHex(0.22, 0.02, p.H);
	const lightHex = siteLight?.hex ?? oklchToHex(0.985, 0.006, p.H);
	const darkChanges = siteDark ? [] : ['New colour: near-black tinted with the primary hue, for text.'];
	if (contrast(darkHex, lightHex) < 7) {
		const [, C, H] = hexToOklch(darkHex);
		const before = darkHex;
		darkHex = oklchToHex(0.22, Math.min(C, 0.02), H);
		darkChanges.push(`Darkened ${before} -> ${darkHex} so body text on the light colour reaches 7:1 (WCAG AAA).`);
	}
	const dark = { ...describe(darkHex, 'dark'), original: siteDark?.hex ?? null, changes: darkChanges };
	const light = { ...describe(lightHex, 'light'), original: siteLight?.hex ?? null, changes: siteLight ? [] : ['New colour: off-white tinted with the primary hue, for backgrounds.'] };

	// Greyscale sanity check: colours that only differ by hue blur together for many people.
	for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) {
		if (Math.abs(hexToOklch(main[i].hex)[0] - hexToOklch(main[j].hex)[0]) < 0.05) {
			notes.push(`The ${main[i].role} and ${main[j].role} have almost the same lightness, so they look alike in greyscale. Don't rely on them alone to tell things apart (e.g. a button on a section of the other colour).`);
		}
	}

	const palette = [...main, dark, light];
	const changed = main.filter((m) => m.changes.length).length;
	notes.unshift(locked ? 'Built from the colours you chose, exactly as picked.' : changed ? `${changed} of the 3 main colours were tweaked or generated; see each colour's changes.` : 'The 3 main colours already work together and pass contrast; no changes needed.');
	notes.push('Use roughly 60% light, 30% primary and secondary, and 10% accent (the 60-30-10 rule), with dark for text.');

	// Semantic tokens: components use roles, so the palette can change without touching them.
	const onToken = (c) => (c.textColour === WHITE ? WHITE : contrast(dark.hex, c.hex) >= AA ? 'var(--colour-dark)' : c.textColour);
	const link = main.find((m) => contrast(m.hex, light.hex) >= AA)?.role ?? 'dark';
	const hover = (role) => `oklch(from var(--colour-${role}) calc(l ${hexToOklch(palette.find((c) => c.role === role).hex)[0] < 0.35 ? '+' : '-'} 0.08) c h)`;
	const css = [
		'/* Palette */',
		...palette.map((c) => `--colour-${c.role}: ${c.hex};`),
		'/* Roles: use these in components */',
		'--colour-surface: var(--colour-light);',
		'--colour-text: var(--colour-dark);',
		`--colour-link: var(--colour-${link});`,
		...main.map((m) => `--colour-on-${m.role}: ${onToken(m)};`),
		`--colour-primary-hover: ${hover('primary')};`,
		`--colour-accent-hover: ${hover('accent')};`,
	].join('\n');

	const extras = locked ? picks.slice(3).map((hex) => ({ ...describe(hex, 'extra'), harmony: harmonyWith(hexToOklch(hex)[2], p.H), original: hex, changes: [] })) : [];
	return { source: scrape.url, generatedAt: new Date().toISOString(), notes, palette, extras, css };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const [input, out] = process.argv.slice(2);
	if (!input) {
		console.error('Usage: node suggest-palette.mjs <colours.json> [output.json]');
		process.exit(1);
	}
	const result = suggest(JSON.parse(readFileSync(input, 'utf8')));
	const file = out || input.replace(/\.json$/i, '') + '-palette.json';
	writeFileSync(file, JSON.stringify(result, null, '\t') + '\n');
	for (const c of result.palette) console.log(`${c.role.padEnd(9)} ${c.hex}  ${c.character} ${c.name}${c.original && c.original !== c.hex ? `  (was ${c.original})` : ''}`);
	result.notes.forEach((n) => console.log(`- ${n}`));
	console.log(`-> ${file}`);
}
