// Run: node test.mjs
import assert from 'node:assert/strict';
import { parseColour, hexToHsl, hslToHex, contrast, hexToOklch, oklchToHex, apca, deltaEOK, hueName } from './colour.mjs';
import { extractColours } from './scrape-colours.mjs';
import { suggest } from './suggest-palette.mjs';

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

console.log('ok');
