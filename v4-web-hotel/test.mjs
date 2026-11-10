// Run: node test.mjs
import assert from 'node:assert/strict';
import { parseColour, hexToHsl, hslToHex, contrast, hexToOklch, oklchToHex, apca, deltaEOK, hueName, hueDistance } from './colour.mjs';
import { extractColours } from './scrape-colours.mjs';
import { suggest } from './suggest-palette.mjs';
import { curate, shades, colourName } from './curate.mjs';
import { system, brandScale, simulate, evocativeName } from './system.mjs';
import { applyProperty, PROPERTY_TYPES } from './hotel.mjs';
import { pebbleExport, emailExport, bookingExport, printExport, cmyk } from './exports.mjs';
import { relChroma } from './suggest-palette.mjs';
import { guard } from './guard.mjs';
import { candidates, recommendations, similarPalettes, generateColour } from './choose.mjs';
import { decodePng, measureCoverage } from './render-scrape.mjs';
import { deflateSync } from 'node:zlib';

assert.deepEqual(parseColour('#FFF'), { hex: '#ffffff', alpha: 1 });
assert.deepEqual(parseColour('rgba(255, 0, 0, .5)'), { hex: '#ff0000', alpha: 0.5 });
assert.deepEqual(parseColour('rgb(0 128 0 / 50%)'), { hex: '#008000', alpha: 0.5 });
assert.equal(parseColour('hsl(120, 100%, 25%)').hex, '#008000');
assert.equal(parseColour('rgb(var(--x))'), null);
assert.equal(hslToHex(...hexToHsl('#1e73be')), '#1e73be');
assert.equal(contrast('#000000', '#ffffff').toFixed(0), '21');

// OKLCH round-trips, and an impossible chroma is pulled into gamut with its hue kept.
for (const hex of ['#1e73be', '#ff0000', '#00ff00', '#808080', '#fafafa']) assert.equal(oklchToHex(...hexToOklch(hex)), hex);
assert.ok(Math.abs(hexToOklch(oklchToHex(0.7, 0.4, 150))[2] - 150) < 2);
assert.ok(Math.abs(hexToOklch('#ff0000')[0] - 0.628) < 0.001);
// APCA reference values: black on white ~106, #888 on white ~63.
assert.equal(Math.round(apca('#000000', '#ffffff')), 106);
assert.equal(Math.round(apca('#888888', '#ffffff')), 63);
assert.equal(deltaEOK('#123456', '#123456'), 0);
assert.equal(hueName('#1e73be'), 'blue');
assert.equal(hueName('#f5f5f5'), 'white');

// Selectors and url() images are not colours; declarations are.
const tally = extractColours('.a:not(#abc){color:#123456;background:url("data:image/svg+xml,#ff0000") #fff} @media(x){.b{border:1px solid rgba(0,0,0,0)}}');
assert.deepEqual(Object.keys(tally).sort(), ['#123456', '#ffffff']);

// One neon mid-tone colour: tamed, fixed for contrast, expanded to 5.
const out = suggest({ url: 'test', colours: [{ hex: '#00aaff', count: 10 }, { hex: '#ffffff', count: 5 }] });
assert.equal(out.palette.length, 5);
for (const p of out.palette.slice(0, 3)) assert.ok(Math.max(p.wcag.white, p.wcag.darkText) >= 4.5, p.hex);
assert.equal(out.palette[0].original, '#00aaff');
assert.notEqual(out.palette[0].hex, '#00aaff');
assert.ok(contrast(out.palette[3].hex, out.palette[4].hex) >= 7);
assert.match(out.css, /--colour-on-primary/);

// Clashing hues get a harmony; every pair of main colours stays distinct.
const clash = suggest({ url: 'test', colours: [{ hex: '#1e73be', count: 10 }, { hex: '#be1e73', count: 5 }, { hex: '#73be1e', count: 3 }] });
for (const p of clash.palette.slice(1, 3)) assert.ok(p.harmony, p.hex);
const [a, b, c] = clash.palette;
assert.ok(deltaEOK(a.hex, b.hex) >= 0.08 && deltaEOK(a.hex, c.hex) >= 0.08 && deltaEOK(b.hex, c.hex) >= 0.08);

// An all-grey site still gets 5 colours.
assert.equal(suggest({ url: 'test', colours: [{ hex: '#333333', count: 4 }, { hex: '#ffffff', count: 9 }] }).palette.length, 5);

// Curator: every background style gives readable text, and the scheme has all the skill's roles.
for (const bg of ['white', 'offwhite', 'tinted', 'dark']) {
	const d = curate(out, bg);
	assert.deepEqual(d.roles.map((r) => r.key), ['primary', 'secondary', 'accent', 'background', 'surface', 'border', 'text-primary', 'text-secondary', 'text-muted', 'link']);
	for (const c of d.checks.filter((c) => c.label.startsWith('Text') || c.label.startsWith('Links'))) assert.ok(c.pass, `${bg}: ${c.label} ${c.ratio}`);
	assert.equal(d.curated.length, 3);
	assert.match(d.tailwind, /text: { primary:/);
}
assert.equal(curate(out, 'dark').roles.find((r) => r.key === 'text-primary').hex, '#fafafa');
assert.equal(curate(out, 'nonsense').background, 'white');

// Shades: 11 steps, the colour itself at 500, lightest to darkest.
const s = shades('#1e73be');
assert.equal(Object.keys(s).length, 11);
assert.equal(s[500], '#1e73be');
const Ls = Object.values(s).map((h) => hexToOklch(h)[0]);
assert.ok(Ls.every((L, i) => i === 0 || L < Ls[i - 1]));

// Warm colours make better calls to action: a cool accent swaps with a warm secondary.
const swap = curate({ ...clash, palette: clash.palette.map((p) => p.role === 'secondary' ? { ...p, hex: '#e8590c' } : p.role === 'accent' ? { ...p, hex: '#0b7a75' } : p) });
assert.equal(swap.palette.find((p) => p.role === 'accent').hex, '#e8590c');
assert.equal(colourName('#7a4a2a'), 'brown');

// v3 system.
// Architect lightness map: 11 steps at fixed OKLCH lightness, hue held.
const bs = brandScale('#2563eb');
assert.equal(bs.steps.length, 11);
assert.ok(Math.abs(hexToOklch(bs.steps.find((x) => x.step === 500).hex)[0] - 0.55) < 0.01);
for (const x of bs.steps.slice(1, -1)) assert.ok(hueDistance(hexToOklch(x.hex)[2], hexToOklch('#2563eb')[2]) < 6, x.step);
// Colour-blind simulation: greys stay grey, and red and green merge for green-blind viewers.
assert.equal(simulate('#808080', 'deuteranopia'), '#808080');
assert.ok(deltaEOK(simulate('#d62728', 'deuteranopia'), simulate('#2ca02c', 'deuteranopia')) < deltaEOK('#d62728', '#2ca02c') / 2);
assert.equal(evocativeName('#1e3a8a').split(' ').pop(), 'Navy');
assert.equal(evocativeName('#ffffff'), 'Linen');

for (const bg of ['white', 'dark']) {
	const sys = system(curate(clash, bg), 'https://example.com');
	const count = sys.extended.groups.reduce((n, g) => n + g.colours.length, 0);
	assert.ok(count >= 8 && count <= 12, `extended palette has ${count} colours`);
	assert.deepEqual(sys.extended.groups.map((g) => g.group), ['Primary', 'Secondary', 'Neutral', 'Accent']);
	for (const c of sys.darkChecks.filter((c) => c.min === 4.5 && c.label.startsWith('Text'))) assert.ok(c.pass, `dark: ${c.label} ${c.ratio}`);
	assert.equal(sys.cvd.length, 3);
	assert.match(sys.css, /\[data-theme="dark"\]/);
	assert.match(sys.tailwind4, /@theme \{/);
	assert.match(sys.sheet, /^<!DOCTYPE html>/);
	assert.ok(!/undefined|NaN/.test(sys.css + sys.tailwind4 + sys.tailwind3 + sys.sheet));
}

// v4: hotel property types.
const vivid = suggest({ url: 'test', colours: [{ hex: '#ff0055', count: 10 }, { hex: '#00c2ff', count: 6 }, { hex: '#ffd000', count: 3 }, { hex: '#ffffff', count: 9 }] });
const rel = (hex) => { const [L, C, H] = hexToOklch(hex); return relChroma(L, C, H); };
const lux = applyProperty(vivid, 'luxury');
assert.equal(lux.hotel.background, 'offwhite');
assert.equal(lux.hotel.curated.length, 3);
for (const c of lux.suggestion.palette.slice(0, 2)) assert.ok(rel(c.hex) <= PROPERTY_TYPES.luxury.maxRel + 0.03, c.role + ' ' + rel(c.hex));
for (const c of lux.suggestion.palette.slice(0, 3)) {
	assert.ok(hueDistance(hexToOklch(c.hex)[2], hexToOklch(vivid.palette.find((v) => v.role === c.role).hex)[2]) < 8, 'hue kept for ' + c.role);
	assert.ok(Math.max(c.wcag.white, c.wcag.darkText) >= 4.5, 'contrast kept for ' + c.role);
}
assert.equal(applyProperty(vivid, 'none').hotel, null);
// The "guests usually expect" note appears exactly when no main colour is in the expected family.
for (const type of ['eco', 'waterfront', 'business', 'heritage', 'resort']) {
	const out = applyProperty(vivid, type);
	const names = out.suggestion.palette.slice(0, 3).map((c) => colourName(c.hex));
	const expectNote = !names.some((n) => PROPERTY_TYPES[type].hues.includes(n));
	assert.equal(/Guests usually expect/.test(out.hotel.notes.join(' ')), expectNote, `${type}: ${names}`);
}

// v4: AAA text target and the web options.
const aaa = curate(vivid, 'white', { textTarget: 'aaa' });
assert.equal(aaa.textTarget, 7);
for (const c of aaa.checks.filter((c) => /^Text (primary|secondary|muted)|^Links/.test(c.label))) assert.ok(c.pass && c.min === 7, c.label);
assert.ok(aaa.checks.filter((c) => /buttons$/.test(c.label) && c.label.startsWith('Text on')).every((c) => c.min === 4.5));
const web = system(aaa, 'https://example.com', { states: true, photoCheck: true, darkMode: 'both' });
assert.ok(web.stateChecks.every((c) => c.pass), web.stateChecks.filter((c) => !c.pass).map((c) => c.label).join());
assert.ok(web.darkChecks.every((c) => c.pass), web.darkChecks.filter((c) => !c.pass).map((c) => c.label).join());
assert.ok(contrast('#ffffff', '#000000') > 4.5 && web.photo.alpha > 0.4 && web.photo.alpha < 0.7);
assert.match(web.css, /prefers-color-scheme: dark/);
assert.match(web.css, /\[data-theme="dark"\]/);
assert.match(web.css, /focus-ring/);
const plain = system(aaa, '', { states: false, photoCheck: false, darkMode: 'auto' });
assert.equal(plain.photo, null);
assert.ok(!/focus-ring|\[data-theme="dark"\]/.test(plain.css));

// v4: exports. The Pebble export leaves the theme's text colours commented out.
const peb = pebbleExport(aaa, web);
assert.match(peb, /\t--color-primary: #[0-9a-f]{6};\n\t--color-primary-rgb: \d+, \d+, \d+;/);
assert.ok(peb.split('\n').filter((l) => /--color-text/.test(l)).every((l) => l.trim().startsWith('//')));
assert.match(emailExport(aaa), /<a href=.*Book now<\/a>/);
assert.match(bookingExport(aaa, web), /Button text/);
assert.match(printExport(aaa), /C\d+ M\d+ Y\d+ K\d+/);
assert.deepEqual(cmyk('#ffffff'), [0, 0, 0, 0]);
assert.deepEqual(cmyk('#000000'), [0, 0, 0, 100]);
assert.deepEqual(cmyk('#ff0000'), [0, 100, 100, 0]);
assert.ok(!/undefined|NaN/.test(peb + emailExport(aaa) + bookingExport(aaa, web) + printExport(aaa) + web.css));

// v4: public mode refuses internal addresses and non-web schemes, and allows public sites.
for (const bad of ['http://127.0.0.1/', 'http://localhost/', 'http://10.1.2.3/', 'http://192.168.0.1/', 'http://172.20.0.5/', 'http://169.254.169.254/latest', 'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'file:///C:/Windows/win.ini']) {
	await assert.rejects(guard(bad), undefined, bad);
}
await guard('http://8.8.8.8/');

// Hover and pressed move the same way, even for very light or very dark buttons.
for (const hex of ['#d9c7a3', '#f2e6c9', '#1a1a2e', '#2563eb']) {
	const v = suggest({ url: 'test', colours: [{ hex, count: 10 }, { hex: '#ffffff', count: 5 }] });
	const sys = system(curate(v, 'white'), '', { states: true });
	const [n, h, a] = ['interactive-primary', 'interactive-primary-hover', 'interactive-primary-active'].map((k) => hexToOklch(sys.light[k])[0]);
	assert.ok(Math.sign(h - n) === Math.sign(a - n) && Math.abs(a - n) > Math.abs(h - n), hex);
}

// Choose step: 3-5 brand colours from the site, never black, white or grey.
const busy = { url: 'test', colours: ['#000000', '#ffffff', '#777777', '#1e73be', '#d62728', '#2ca02c', '#ff7f0e', '#9467bd', '#8c564b', '#1f74bf'].map((hex, i) => ({ hex, count: 100 - i * 5 })) };
const cands = candidates(busy);
assert.ok(cands.length >= 3 && cands.length <= 5, String(cands.length));
assert.deepEqual(cands.map((c) => c.role), ['primary', 'secondary', 'accent', 'extra', 'extra']);
assert.ok(cands.every((c) => !['#000000', '#ffffff', '#777777'].includes(c.hex)));
assert.ok(!cands.some((c) => c.hex === '#1f74bf'), 'near-identical blues count as one');
for (const c of cands) for (const r of c.recommendations) assert.ok(r.hex !== c.hex && r.label && r.reason, c.hex);
// A site with one brand colour gets suggested ones to make 3.
const sparse = candidates({ url: 'test', colours: [{ hex: '#1e73be', count: 9 }, { hex: '#ffffff', count: 20 }] });
assert.equal(sparse.length, 3);
assert.deepEqual(sparse.map((c) => c.source), ['site', 'suggested', 'suggested']);
// Property type adds a tuned option for colours that are too vivid for it.
assert.ok(recommendations('#ff0055', 'primary', null, 'luxury', null).some((r) => /luxury/.test(r.label)));

// Build step: picked colours are used exactly, the 4th and 5th come back as extras.
const picks = ['#3a6b8c', '#e07a5f', '#f2cc8f', '#81b29a', '#3d405b'];
const built = suggest(busy, { picks });
assert.deepEqual(built.palette.slice(0, 3).map((c) => c.hex), picks.slice(0, 3));
assert.deepEqual(built.extras.map((c) => c.hex), picks.slice(3));
assert.ok(built.palette.slice(0, 3).every((c) => c.changes.length === 0));
const heldOut = applyProperty(built, 'luxury', { retune: false });
assert.deepEqual(heldOut.suggestion.palette.slice(0, 3).map((c) => c.hex), picks.slice(0, 3));
const builtDesign = curate(heldOut.suggestion, 'white');
builtDesign.extras = built.extras;
const builtSys = system(builtDesign, '', {});
assert.match(builtSys.css, /--color-extra-2: #3d405b/);
assert.match(pebbleExport(builtDesign, builtSys), /--color-extra-1: #81b29a/);
assert.ok(!/book-now-outline/.test(builtSys.css));

// Picked roles stay put: a cool accent with a warm secondary gets a tip, not a swap.
const coolAccent = suggest(busy, { picks: ['#3a6b8c', '#e07a5f', '#2a9d8f'] });
const kept = curate(coolAccent, 'white', { keepOrder: true });
assert.deepEqual(kept.palette.slice(0, 3).map((c) => [c.role, c.hex]), [['primary', '#3a6b8c'], ['secondary', '#e07a5f'], ['accent', '#2a9d8f']]);
assert.match(kept.notes.join(' '), /Tip: your secondary/);

// Coverage: a test PNG (RGB, every row using a different PNG filter) decodes to the right pixels.
// 40x20 image: left half #1e73be (blue), right half white, with a 10x10 "photo" (red) in the top-right corner.
function makePng(width, height, pixel, bpp = 3) {
	const rows = [];
	const prev = Buffer.alloc(width * bpp);
	for (let y = 0; y < height; y++) {
		const line = Buffer.alloc(width * bpp);
		for (let x = 0; x < width; x++) line.set(pixel(x, y).slice(0, bpp), x * bpp);
		const filter = y % 5; // 0 none, 1 sub, 2 up, 3 average, 4 paeth
		const out = Buffer.alloc(width * bpp);
		for (let i = 0; i < line.length; i++) {
			const a = i >= bpp ? line[i - bpp] : 0, b = y ? prev[i] : 0, c = i >= bpp && y ? prev[i - bpp] : 0;
			const pred = [0, a, b, (a + b) >> 1, (() => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; })()][filter];
			out[i] = (line[i] - pred) & 255;
		}
		rows.push(Buffer.from([filter]), out);
		line.copy(prev);
	}
	const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); return Buffer.concat([len, Buffer.from(type), data, Buffer.alloc(4)]); };
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = bpp === 4 ? 6 : 2;
	return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}
const scene = (x, y) => (x >= 30 && y < 10 ? [220, 20, 20, 255] : x < 20 ? [0x1e, 0x73, 0xbe, 255] : [255, 255, 255, 255]);
for (const bpp of [3, 4]) {
	const img = decodePng(makePng(40, 20, scene, bpp));
	assert.equal(img.width, 40);
	for (const [x, y] of [[0, 0], [19, 19], [25, 3], [35, 5], [39, 19]]) {
		const i = (y * 40 + x) * bpp;
		assert.deepEqual([...img.data.subarray(i, i + 3)], scene(x, y).slice(0, 3), `pixel ${x},${y} (${bpp} channels)`);
	}
	// With the photo left out: blue is 400 of 700 pixels, white 300. The photo's red isn't counted at all.
	const cov = measureCoverage(img, [{ x: 30, y: 0, width: 10, height: 10 }], ['#1e73be', '#ffffff'], 1);
	assert.equal(cov.total, 700);
	assert.ok(Math.abs(cov.coverage['#1e73be'] - 400 / 700) < 1e-9 && Math.abs(cov.coverage['#ffffff'] - 300 / 700) < 1e-9, JSON.stringify(cov.coverage));
	assert.ok(!Object.keys(cov.coverage).some((hex) => hex === '#dc1414'));
	// Sampling every 2nd pixel gives the same shares here.
	const half = measureCoverage(img, [{ x: 30, y: 0, width: 10, height: 10 }], ['#1e73be', '#ffffff'], 2);
	assert.ok(Math.abs(half.coverage['#1e73be'] - 400 / 700) < 0.02);
}
// A small brand colour still counts; unknown specks (anti-aliasing) don't, unknown flat areas (a blended overlay) do.
const specks = decodePng(makePng(100, 100, (x, y) => (y === 0 && x < 3 ? [0x1e, 0x73, 0xbe] : y === 1 && x < 3 ? [123, 45, 67] : y >= 90 ? [10, 120, 90] : [255, 255, 255])));
const sc = measureCoverage(specks, [], ['#1e73be', '#ffffff'], 1);
assert.ok(sc.coverage['#1e73be'] > 0);
assert.equal(sc.coverage['#7b2d43'], undefined);
assert.ok(Math.abs(sc.coverage['#0a785a'] - 0.1) < 1e-9);

// Choose step with measured coverage: ranked by coverage, specks under 0.05% left out, coverage passed through.
const measured = { url: 'test', method: 'rendered', colours: [
	{ hex: '#ffffff', coverage: 0.6, count: 600 }, { hex: '#d62728', coverage: 0.2, count: 200 }, { hex: '#1e73be', coverage: 0.05, count: 50 },
	{ hex: '#2ca02c', coverage: 0.01, count: 10 }, { hex: '#9467bd', coverage: 0.0001, count: 1 },
] };
const mc = candidates(measured);
assert.deepEqual(mc.filter((c) => c.source === 'site').map((c) => c.hex), ['#d62728', '#1e73be', '#2ca02c']);
assert.equal(mc[0].coverage, 0.2);
assert.ok(!mc.some((c) => c.hex === '#9467bd'));
// Uploaded logo colours have no coverage but are kept, labelled as from your images.
const withLogo = candidates({ ...measured, colours: [...measured.colours, { hex: '#f5a623', count: 300, sources: ['photo or logo'] }] });
assert.equal(withLogo.find((c) => c.hex === '#f5a623')?.source, 'image');

const SCHEME_NAMES = ['Analogous', 'Complementary', 'Split-complementary', 'Triadic'];
// Similar palettes: same number of colours, readable, each colour distinct, none identical to the current choice.
for (const [picks, property] of [[['#3858e9', '#b79435', '#a977ff'], 'none'], [['#ff0055', '#00c2ff', '#ffd000', '#2ca02c', '#9467bd'], 'luxury']]) {
	const sims = similarPalettes(picks, property);
	assert.ok(sims.length >= 4, `${sims.length} palettes`);
	if (property === 'luxury') assert.ok(sims.some((s) => /luxury/.test(s.name)));
	for (const s of sims) {
		assert.equal(s.colours.length, picks.length, s.name);
		assert.ok(!s.colours.every((hex, i) => hex === picks[i]), s.name);
		for (let i = 0; i < s.colours.length; i++) for (let j = i + 1; j < s.colours.length; j++) assert.ok(deltaEOK(s.colours[i], s.colours[j]) >= 0.08 - 1e-9, `${s.name}: ${s.colours[i]} vs ${s.colours[j]}`);
	}
	for (const s of sims.filter((s) => s.name !== 'In harmony' && !SCHEME_NAMES.includes(s.name))) for (const hex of s.colours) assert.ok(Math.max(contrast(hex, '#ffffff'), contrast(hex, '#000000')) >= 4.5, `${s.name} ${hex}`);
}
assert.deepEqual(similarPalettes([]), []);

// Generated colours follow the rules, across many palettes, slots and property types.
{
	let seed = 7;
	const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
	const randomColour = () => oklchToHex(0.35 + rand() * 0.45, 0.06 + rand() * 0.14, rand() * 360);
	const harmonyAngles = [30, 90, 120, 150, 180];
	let generatedCount = 0, strict = 0;
	for (let n = 0; n < 40; n++) {
		const picks = Array.from({ length: 3 + (n % 3) }, randomColour);
		const property = ['none', 'luxury', 'resort', 'eco'][n % 4];
		const index = n % picks.length;
		const exclude = [];
		for (let k = 0; k < 4; k++) {
			const g = generateColour(picks, index, { property, exclude });
			if (!g) break;
			generatedCount++;
			const [L, C, H] = hexToOklch(g.hex);
			const others = picks.filter((_, i) => i !== index);
			const label = `${picks.join(' ')} slot ${index} -> ${g.hex}`;
			assert.ok(Math.max(contrast(g.hex, '#ffffff'), contrast(g.hex, oklchToHex(0.2, 0.02, H))) >= 4.5, `readable: ${label}`);
			assert.ok(deltaEOK(g.hex, picks[index]) >= 0.08, `different from current: ${label}`);
			assert.ok(exclude.every((e) => deltaEOK(e, g.hex) >= 0.05), `not shown before: ${label}`);
			if (Math.min(...others.map((o) => deltaEOK(o, g.hex))) >= 0.1) strict++;
			// Hue sits at a harmony angle from the reference colour (hex rounding moves hue slightly at low chroma).
			const ref = hexToOklch(index === 0 ? picks[1] : picks[0])[2];
			if (C > 0.04) assert.ok(harmonyAngles.some((a) => Math.abs(hueDistance(H, ref) - a) < 6), `harmony ${hueDistance(H, ref).toFixed(1)}°: ${label}`);
			const p = PROPERTY_TYPES[property];
			const rel = relChroma(L, C, H);
			if (p.maxRel) assert.ok(rel <= (index === 2 ? Math.min(1, p.maxRel + 0.2) : p.maxRel) + 0.03, `property cap: ${label}`);
			if (index !== 2 && L > 0.45 && L < 0.85) assert.ok(rel <= 0.88, `not vibrating: ${label}`);
			assert.ok(g.label.startsWith('Generated') && g.reason && g.name, label);
			exclude.push(g.hex);
		}
	}
	assert.ok(generatedCount >= 140, `generated ${generatedCount}`);
	assert.ok(strict / generatedCount > 0.9, `strict rules met in ${strict}/${generatedCount}`);
	// Accents stay clear of the error red and success green when anything allows it.
	const acc = generateColour(['#1e73be', '#2a9d8f', '#e9c46a'], 2, {});
	assert.ok(deltaEOK(acc.hex, oklchToHex(0.55, 0.18, 25)) >= 0.1 && deltaEOK(acc.hex, oklchToHex(0.55, 0.16, 145)) >= 0.1, acc.hex);
	// Five clicks, five different colours.
	const seen = [];
	for (let k = 0; k < 5; k++) seen.push(generateColour(['#3858e9', '#b79435', '#a977ff'], 1, { exclude: seen }).hex);
	assert.equal(new Set(seen).size, 5);
}

console.log('ok');
