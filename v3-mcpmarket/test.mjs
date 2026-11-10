// Run: node test.mjs
import assert from 'node:assert/strict';
import { parseColour, hexToHsl, hslToHex, contrast, hexToOklch, oklchToHex, apca, deltaEOK, hueName, hueDistance } from './colour.mjs';
import { extractColours } from './scrape-colours.mjs';
import { suggest } from './suggest-palette.mjs';
import { curate, shades, colourName } from './curate.mjs';
import { system, brandScale, simulate, evocativeName } from './system.mjs';

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

console.log('ok');
