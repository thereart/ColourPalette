// Run: node test.mjs
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { parseColour, hexToRgb } from './colour.mjs';
import { decodePng, measureCoverage } from './render-scrape.mjs';

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

console.log('ok');
