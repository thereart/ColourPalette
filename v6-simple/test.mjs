// Run: node test.mjs
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { parseColour, hexToRgb } from './colour.mjs';
import { decodePng, measureCoverage } from './render-scrape.mjs';
import { extractColours } from './scrape-colours.mjs';
import { classify } from './classify.mjs';

// Times used in the CSS: every use in a declaration counts; selectors (#abc as an id) and url() images don't.
const tally = extractColours(`
	.a:not(#abc) { color: #1e73be; background: url("data:image/svg+xml,#ff0000") #fff; }
	.b { border: 1px solid #1E73BE; box-shadow: 0 0 2px rgba(0, 0, 0, 0); }
	@media (min-width: 600px) { .c { background-color: rgb(30, 115, 190); color: #ffffff; } }
`);
assert.deepEqual(Object.keys(tally).sort(), ['#1e73be', '#ffffff']);
assert.equal(tally['#1e73be'].count, 3, 'hex in any case and rgb() count as the same colour');
assert.equal(tally['#ffffff'].count, 2);

// Reading CSS colours as browsers report them.
assert.deepEqual(parseColour('#FFF'), { hex: '#ffffff', alpha: 1 });
assert.deepEqual(parseColour('rgb(30, 115, 190)'), { hex: '#1e73be', alpha: 1 });
assert.deepEqual(parseColour('rgba(255, 0, 0, 0.5)'), { hex: '#ff0000', alpha: 0.5 });
assert.equal(parseColour('rgba(0, 0, 0, 0)').alpha, 0);
assert.equal(parseColour('hsl(120, 100%, 25%)').hex, '#008000');
assert.equal(parseColour('transparent'), null);
assert.deepEqual(hexToRgb('#1e73be'), [30, 115, 190]);

// A test PNG (every row using a different PNG filter), so decoding is checked against known pixels.
function makePng(width, height, pixel, bpp = 3) {
	const rows = [];
	const prev = Buffer.alloc(width * bpp);
	for (let y = 0; y < height; y++) {
		const line = Buffer.alloc(width * bpp);
		for (let x = 0; x < width; x++) line.set(pixel(x, y).slice(0, bpp), x * bpp);
		const filter = y % 5; // none, sub, up, average, paeth
		const out = Buffer.alloc(width * bpp);
		for (let i = 0; i < line.length; i++) {
			const a = i >= bpp ? line[i - bpp] : 0, b = y ? prev[i] : 0, c = i >= bpp && y ? prev[i - bpp] : 0;
			const paeth = () => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
			out[i] = (line[i] - [0, a, b, (a + b) >> 1, paeth()][filter]) & 255;
		}
		rows.push(Buffer.from([filter]), out);
		line.copy(prev);
	}
	const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); return Buffer.concat([len, Buffer.from(type), data, Buffer.alloc(4)]); };
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = bpp === 4 ? 6 : 2;
	return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}

// 40x20 page: left half blue, right half white, a 10x10 photo (red) in the top-right corner.
const scene = (x, y) => (x >= 30 && y < 10 ? [220, 20, 20, 255] : x < 20 ? [0x1e, 0x73, 0xbe, 255] : [255, 255, 255, 255]);
for (const bpp of [3, 4]) {
	const img = decodePng(makePng(40, 20, scene, bpp));
	for (const [x, y] of [[0, 0], [19, 19], [25, 3], [35, 5], [39, 19]]) {
		const i = (y * 40 + x) * bpp;
		assert.deepEqual([...img.data.subarray(i, i + 3)], scene(x, y).slice(0, 3), `pixel ${x},${y} (${bpp} channels)`);
	}
	// With the photo left out: blue covers 400 of 700 pixels, white 300; the photo's red isn't counted at all.
	const cov = measureCoverage(img, [{ x: 30, y: 0, width: 10, height: 10 }], ['#1e73be', '#ffffff'], 1);
	assert.equal(cov.total, 700);
	assert.ok(Math.abs(cov.coverage['#1e73be'] - 400 / 700) < 1e-9);
	assert.ok(Math.abs(cov.coverage['#ffffff'] - 300 / 700) < 1e-9);
	assert.equal(cov.coverage['#dc1414'], undefined);
	// Sampling every 2nd pixel gives the same shares to within 2%.
	const half = measureCoverage(img, [{ x: 30, y: 0, width: 10, height: 10 }], ['#1e73be', '#ffffff'], 2);
	assert.ok(Math.abs(half.coverage['#1e73be'] - 400 / 700) < 0.02);
}

// Small CSS colours (link text, icons) still count; stray unknown pixels (anti-aliasing) don't;
// a large flat colour that isn't in the CSS (e.g. a translucent overlay blended onto a background) does.
const specks = decodePng(makePng(100, 100, (x, y) => (y === 0 && x < 3 ? [0x1e, 0x73, 0xbe] : y === 1 && x < 3 ? [123, 45, 67] : y >= 90 ? [10, 120, 90] : [255, 255, 255])));
const sc = measureCoverage(specks, [], ['#1e73be', '#ffffff'], 1);
assert.ok(sc.coverage['#1e73be'] > 0);
assert.equal(sc.coverage['#7b2d43'], undefined);
assert.ok(Math.abs(sc.coverage['#0a785a'] - 0.1) < 1e-9);

// Brand / Background / Text.
const roles = (r) => ({ bg: 0, bgLarge: 0, text: 0, border: 0, interactive: 0, interactiveBg: 0, heading: 0, nav: 0, ...r });
const label = (hex, r = {}, extra = {}) => classify({ hex, roles: roles(r), variables: [], ...extra });
// Colourful colours on buttons and links are brand; filling large areas makes them "brand, used as a background".
assert.equal(label('#3858e9', { interactive: 20, text: 10, bg: 3 }).label, 'brand');
assert.equal(label('#3858e9', { interactive: 20, text: 10, bg: 3 }).asBackground, false);
assert.deepEqual([label('#58cc02', { bg: 2, bgLarge: 1, text: 6 }).label, label('#58cc02', { bg: 2, bgLarge: 1, text: 6 }).asBackground], ['brand', true]);
// White and pale tints filling areas are backgrounds, even when white text sits on buttons.
assert.equal(label('#ffffff', { bg: 300, bgLarge: 3, text: 40, interactive: 31 }).label, 'background');
assert.equal(label('#f6f6f6', { bg: 3, bgLarge: 3 }).label, 'background');
assert.equal(label('#ddf4ff', { bg: 1, bgLarge: 1 }).label, 'background');
// Neutrals used mostly for text are text, unless they cover a lot of the page (then it's dark sections).
assert.equal(label('#1a1919', { text: 5, heading: 2 }).label, 'text');
assert.equal(label('#23282d', { text: 30, bg: 4, bgLarge: 2 }, { coverage: 0.19 }).label, 'background');
assert.equal(label('#333333', { text: 30, bg: 4 }, { coverage: 0.03 }).label, 'background');
// A black brand: near-black buttons make it brand. A grey that happens to be on a few buttons doesn't.
assert.equal(label('#111111', { bg: 6, interactiveBg: 4, interactive: 4, text: 2 }).label, 'brand');
assert.equal(label('#5a5a5a', { bg: 3, interactiveBg: 3, interactive: 3 }).label, 'background');
assert.equal(label('#000000', { bg: 8, interactiveBg: 2, text: 12 }).label, 'text');
// Names count: --color-primary makes a neutral brand; --bg names keep it a background; --text-primary isn't brand.
assert.equal(label('#000000', { bg: 1 }, { variables: ['--color-primary'] }).label, 'brand');
assert.equal(label('#000000', { bg: 1, interactiveBg: 3 }, { variables: ['--color-bg-dark'] }).label, 'background');
assert.equal(label('#222222', { text: 9 }, { variables: ['--color-text-primary'] }).label, 'text');
// Reasons are given in plain words.
assert.match(label('#3858e9', { interactive: 20 }).reasons.join(' '), /Colourful.*On 20 buttons or links/);

// CSS mode: roles come from each rule's selector and property.
const cssTally = extractColours(`
	.site-header .btn-primary { background-color: #e07a5f; color: #ffffff; }
	a:hover { color: #e07a5f; }
	h2.section-title { color: #3a6b8c; }
	body { background: #faf8f5; color: #222222; }
	.card { border: 1px solid #dddddd; }
	:root { --color-primary: #e07a5f; }
`);
const rr = (hex) => cssTally[hex].roles;
assert.deepEqual([rr('#e07a5f').bg, rr('#e07a5f').interactiveBg, rr('#e07a5f').text, rr('#e07a5f').nav], [1, 1, 1, 1]);
assert.ok(rr('#e07a5f').interactive >= 2, 'button background and link hover both count');
assert.equal(rr('#3a6b8c').heading, 1);
assert.deepEqual([rr('#faf8f5').bg, rr('#faf8f5').bgLarge], [1, 1]);
assert.equal(rr('#dddddd').border, 1);
assert.deepEqual(cssTally['#e07a5f'].variables, ['--color-primary']);
assert.equal(classify(cssTally['#e07a5f']).label, 'brand');
assert.equal(classify(cssTally['#faf8f5']).label, 'background');
assert.equal(classify(cssTally['#222222']).label, 'text', 'the body text colour, even though body is a large area');

console.log('ok');
