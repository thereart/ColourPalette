// Builds a full colour system from the curated scheme (curate.mjs), using four skills listed on MCP Market:
//  - Color Palette Architect, Arnav Puri (MIT): github.com/arnavpuri/designskills, skills/color-palette
//    OKLCH lightness map for 50-950 scales, brand-tinted greys, semantic colours, dark-mode remap,
//    3-layer CSS tokens, Tailwind v4/v3, gradients.
//  - AI Color Palette Designer, Alpaca Labs (MIT): github.com/alpacalabsllc/skills-for-architects,
//    skills/color-palette-generator. 8-12 colours in four groups with descriptive names, HEX/RGB/HSL,
//    warm/cool balance, tinted whites, a self-styled HTML swatch sheet.
//  - UI Color Palettes, Sven Graziani: github.com/svengraziani/ui-design. Its shade usage guidelines only;
//    the repo has no licence, so none of its palettes are copied.
//  - Color Theory & OKLCH, Marvin Richter (source repo no longer online; built from its MCP Market listing):
//    colour-blind checks and the Okabe-Ito palette, elevation-based dark surfaces.

import { contrast, hexToOklch, oklchToHex, deltaEOK, hexToRgb, rgbToHsl, toHex, hueDistance, toLinear, fromLinear, clamp } from './colour.mjs';
import { colourName } from './curate.mjs';
import { character, relChroma } from './suggest-palette.mjs';

const WHITE = '#ffffff';

// [step, OKLCH lightness, share of the colour's chroma, use]
const BRAND_MAP = [
	[50, 0.97, 0.3, 'Tinted backgrounds (alerts, badges, selected)'], [100, 0.93, 0.4, 'Hover backgrounds'], [200, 0.87, 0.5, 'Active backgrounds'],
	[300, 0.78, 0.7, 'Borders'], [400, 0.68, 0.85, 'Placeholder text; buttons in dark mode'], [500, 0.55, 1, 'Base: buttons and primary actions'],
	[600, 0.48, 1, 'Button hover'], [700, 0.4, 1, 'Button active; text on tinted backgrounds'], [800, 0.32, 0.9, 'Headings on light backgrounds'],
	[900, 0.24, 0.8, 'Body text on light backgrounds'], [950, 0.16, 0.7, 'High-contrast text'],
];
const GRAY_MAP = [
	[50, 0.98, 'Page backgrounds'], [100, 0.96, 'Subtle backgrounds'], [200, 0.9, 'Dividers'], [300, 0.83, 'Borders'], [400, 0.71, 'Disabled text'],
	[500, 0.55, 'Secondary text, icons'], [600, 0.45, 'Strong icons'], [700, 0.37, 'Body text'], [800, 0.27, 'Dark mode: raised surfaces'],
	[900, 0.2, 'Headings; dark mode: surfaces'], [950, 0.13, 'Dark mode: page background'],
];
// OKLCH hue, then [lightness, chroma] per step.
const SEMANTIC = {
	success: [145, { 50: [0.97, 0.04], 400: [0.68, 0.15], 500: [0.55, 0.16], 700: [0.4, 0.14] }],
	warning: [85, { 50: [0.97, 0.04], 400: [0.72, 0.15], 500: [0.6, 0.16], 700: [0.45, 0.14] }],
	error: [25, { 50: [0.97, 0.04], 400: [0.68, 0.16], 500: [0.55, 0.18], 700: [0.4, 0.16] }],
	info: [230, { 50: [0.97, 0.04], 400: [0.68, 0.12], 500: [0.55, 0.14], 700: [0.4, 0.12] }],
};
const SEMANTIC_USE = { 50: 'Alert backgrounds', 400: 'Dark mode', 500: 'Icons, badges, borders', 700: 'Text' };

// Machado et al. (2009) full-severity simulation matrices, applied to linear sRGB.
const CVD = {
	protanopia: ['Red-blind (protanopia)', 'about 1 in 100 men', [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]]],
	deuteranopia: ['Green-blind (deuteranopia)', 'about 1 in 100 men, with milder forms in about 5 in 100', [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]]],
	tritanopia: ['Blue-blind (tritanopia)', 'rare', [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]]],
};
export const OKABE_ITO = [
	['Orange', '#e69f00'], ['Sky blue', '#56b4e9'], ['Bluish green', '#009e73'], ['Yellow', '#f0e442'],
	['Blue', '#0072b2'], ['Vermillion', '#d55e00'], ['Reddish purple', '#cc79a7'], ['Black', '#000000'],
];
const NOUNS = {
	red: ['Rose Quartz', 'Poppy', 'Oxblood'], orange: ['Apricot', 'Tangerine', 'Rust'], yellow: ['Butter', 'Saffron', 'Ochre'],
	green: ['Mint', 'Fern', 'Forest'], cyan: ['Seafoam', 'Lagoon', 'Teal'], blue: ['Sky', 'Cobalt', 'Navy'], purple: ['Lilac', 'Violet', 'Plum'],
	pink: ['Blush', 'Peony', 'Berry'], brown: ['Sand', 'Caramel', 'Walnut'], white: ['Linen', 'Linen', 'Linen'], grey: ['Mist', 'Stone', 'Slate'], black: ['Charcoal', 'Ink', 'Ink'],
};
const MODS = { pale: 'Soft', muted: 'Dusty', vivid: 'Bright', deep: 'Deep', dark: 'Dark' };

const rgbText = (hex) => `rgb(${hexToRgb(hex).join(', ')})`;
const hslText = (hex) => { const [h, s, l] = rgbToHsl(...hexToRgb(hex)).map(Math.round); return `hsl(${h}, ${s}%, ${l}%)`; };
const temperature = (hex) => { const n = colourName(hex); return ['red', 'orange', 'yellow', 'brown', 'pink'].includes(n) ? 'warm' : ['white', 'grey', 'black'].includes(n) ? 'neutral' : 'cool'; };
const bestText = (bg, options) => options.reduce((a, b) => (contrast(b, bg) > contrast(a, bg) ? b : a));
const toMap = (steps) => Object.fromEntries(steps.map((s) => [s.step, s.hex]));

// Descriptive names ("Deep Cobalt", "Warm Linen") instead of "blue" or "beige".
export function evocativeName(hex) {
	const [L, C, H] = hexToOklch(hex);
	const name = colourName(hex);
	const band = L > 0.75 ? 0 : L > 0.45 ? 1 : 2;
	if (['white', 'grey', 'black'].includes(name)) {
		const tone = C < 0.006 ? '' : H > 20 && H < 110 ? 'Warm ' : H > 180 && H < 300 ? 'Cool ' : '';
		return tone + NOUNS[name][band];
	}
	// Very light tints read soft however much chroma they have relative to their (small) maximum.
	return `${L > 0.85 ? 'Soft' : MODS[character(L, relChroma(L, C, H))] ?? ''} ${NOUNS[name][band]}`.trim();
}

const noun = (name) => name.split(' ').pop();

// Raises a colour's lightness (hue kept) until it reaches `min` contrast on a dark background.
function liftTo(hex, bg, min) {
	const [L, C, H] = hexToOklch(hex);
	for (let l = L; l <= 1; l += 0.01) {
		const next = oklchToHex(l, C, H);
		if (contrast(next, bg) >= min) return next;
	}
	return WHITE;
}

export function brandScale(hex) {
	const [Lb, C, H] = hexToOklch(hex);
	const steps = BRAND_MAP.map(([step, L, share, use]) => ({ step, hex: oklchToHex(L, C * share, H), use }));
	const nearest = BRAND_MAP.reduce((a, b) => (Math.abs(b[1] - Lb) < Math.abs(a[1] - Lb) ? b : a))[0];
	return { base: hex, nearest, steps };
}

export function grayScale(H) {
	return { steps: GRAY_MAP.map(([step, L, use]) => ({ step, hex: oklchToHex(L, 0.01, H), use })) };
}

export function simulate(hex, type) {
	const lin = hexToRgb(hex).map(toLinear);
	return toHex(...CVD[type][2].map((row) => fromLinear(clamp(row[0] * lin[0] + row[1] * lin[1] + row[2] * lin[2], 0, 1))));
}

// opts: states (focus/hover/active/disabled tokens), photoCheck (overlay + booking button), darkMode ('manual' | 'auto' | 'both').
export function system(design, scrapeUrl = '', opts = {}) {
	opts = { states: true, photoCheck: true, darkMode: 'manual', ...opts };
	const notes = [];
	const roles = Object.fromEntries(design.roles.map((r) => [r.key, r.hex]));
	const byRole = (role) => design.palette.find((c) => c.role === role);
	const P = byRole('primary').hex, S = byRole('secondary').hex, A = byRole('accent').hex;
	const H = hexToOklch(P)[2];

	// Scales and semantic colours.
	const scales = { brand: brandScale(P), secondary: brandScale(S), accent: brandScale(A), gray: grayScale(H) };
	const semantic = Object.fromEntries(Object.entries(SEMANTIC).map(([name, [hue, steps]]) => [name, {
		hue, steps: Object.entries(steps).map(([step, [L, C]]) => ({ step: +step, hex: oklchToHex(L, C, hue), use: SEMANTIC_USE[step] })),
	}]));
	for (const [name, { steps }] of Object.entries(semantic)) {
		const base = steps.find((s) => s.step === 500).hex;
		const clash = [['primary', P], ['secondary', S], ['accent', A]].find(([, hex]) => deltaEOK(hex, base) < 0.1);
		if (clash) notes.push(`The ${name} colour (${base}) is close to your ${clash[0]} (${clash[1]}), so people may read one as the other. Pair ${name} messages with an icon and a label, not colour alone.`);
	}

	// Dark mode: remap roles instead of inverting. Surfaces get lighter with elevation; brand colours use the 400 step with a little less chroma, since saturated colours glow on dark backgrounds.
	const g = toMap(scales.gray.steps);
	const soften = (hex) => { const [L, C, h] = hexToOklch(hex); return oklchToHex(L, C * 0.9, h); };
	const darkInteractive = soften(toMap(scales.brand.steps)[400]);
	const darkAccent = soften(toMap(scales.accent.steps)[400]);
	const dark = {
		'bg-primary': g[950], 'bg-secondary': g[900], 'bg-tertiary': g[800],
		'surface-1': oklchToHex(0.17, 0.01, H), 'surface-2': oklchToHex(0.21, 0.01, H), 'surface-3': oklchToHex(0.25, 0.01, H),
		'text-primary': g[50], 'text-secondary': g[300], 'text-tertiary': g[400], 'border-default': g[700],
		'interactive-primary': darkInteractive, 'on-interactive-primary': bestText(darkInteractive, [g[950], WHITE]),
		'interactive-accent': darkAccent, 'on-interactive-accent': bestText(darkAccent, [g[950], WHITE]),
		link: liftTo(darkInteractive, g[950], design.textTarget ?? 4.5),
		...Object.fromEntries(Object.entries(semantic).map(([name, s]) => [`color-${name}`, s.steps.find((x) => x.step === 400).hex])),
	};
	const light = {
		'bg-primary': roles.background, 'bg-secondary': roles.surface, 'bg-tertiary': g[100],
		'surface-1': roles.surface, 'surface-2': roles.surface, 'surface-3': roles.surface,
		'text-primary': roles['text-primary'], 'text-secondary': roles['text-secondary'], 'text-tertiary': roles['text-muted'], 'border-default': roles.border,
		'interactive-primary': P, 'on-interactive-primary': byRole('primary').textColour,
		'interactive-accent': A, 'on-interactive-accent': byRole('accent').textColour,
		link: roles.link,
		...Object.fromEntries(Object.entries(semantic).map(([name, s]) => [`color-${name}`, s.steps.find((x) => x.step === 700).hex])),
	};
	const check = (label, a, b, min) => ({ label, ratio: +contrast(a, b).toFixed(2), min, pass: contrast(a, b) >= min, sc: min >= 4.5 ? '1.4.3' : '1.4.11' });
	const stateChecks = [];
	if (opts.states) {
		// Hover/active move away from the background (darker on light, lighter on dark), so they never fade into it.
		// `away` is the colour to move away from: the label for buttons (so hover keeps its text readable), the background for links.
		// Direction is chosen once with the bigger (pressed) step, so hover and pressed always move the same way.
		const shift = (hex, away, amount) => {
			const [L, C, h] = hexToOklch(hex);
			let dir = hexToOklch(away)[0] > 0.5 ? -1 : 1;
			if (L + dir * 0.12 < 0.15 || L + dir * 0.12 > 0.95) dir = -dir;
			return oklchToHex(L + dir * amount, C, h);
		};
		const brandMap = toMap(scales.brand.steps);
		// Focus ring: the first brand shade with 3:1 against the background (WCAG 2.2 SC 2.4.13).
		const focusRing = (bg, order) => order.map((s) => brandMap[s]).find((hex) => contrast(hex, bg) >= 3) ?? (hexToOklch(bg)[0] > 0.5 ? '#000000' : WHITE);
		for (const [set, order, disabled] of [[light, [600, 700, 800, 900], [g[200], g[500]]], [dark, [300, 200, 100, 50], [g[800], g[500]]]]) {
			const bg = set['bg-primary'];
			Object.assign(set, {
				'interactive-primary-hover': shift(set['interactive-primary'], set['on-interactive-primary'], 0.06), 'interactive-primary-active': shift(set['interactive-primary'], set['on-interactive-primary'], 0.12),
				'interactive-accent-hover': shift(set['interactive-accent'], set['on-interactive-accent'], 0.06), 'interactive-accent-active': shift(set['interactive-accent'], set['on-interactive-accent'], 0.12),
				'link-hover': shift(set.link, bg, 0.08), 'focus-ring': focusRing(bg, order),
				'disabled-bg': disabled[0], 'disabled-text': disabled[1],
			});
		}
		stateChecks.push(
			{ ...check('Focus ring stands out from background (light)', light['focus-ring'], light['bg-primary'], 3), sc: '2.4.13' },
			{ ...check('Focus ring stands out from background (dark)', dark['focus-ring'], dark['bg-primary'], 3), sc: '2.4.13' },
			check('Text on primary buttons when hovered', light['on-interactive-primary'], light['interactive-primary-hover'], 4.5),
			check('Text on accent buttons when hovered', light['on-interactive-accent'], light['interactive-accent-hover'], 4.5),
		);
	}

	// Photo overlay and the booking button: hotel pages put text and "Book now" on top of photos.
	let photo = null;
	if (opts.photoCheck) {
		const accentColour = byRole('accent');
		// Smallest black overlay that keeps white text at 4.5:1 even over a white photo.
		let alpha = 0;
		while (alpha < 1 && contrast(WHITE, toHex(...[0, 0, 0].map(() => 255 * (1 - alpha)))) < 4.5) alpha = +(alpha + 0.01).toFixed(2);
		const lightest = toHex(...[0, 0, 0].map(() => 255 * (1 - alpha)));
		const [rr, gg, bb] = hexToRgb(toMap(scales.brand.steps)[950]);
		let tint = 0;
		while (tint < 1 && contrast(WHITE, toHex(...[rr, gg, bb].map((v) => v * tint + 255 * (1 - tint)))) < 4.5) tint = +(tint + 0.01).toFixed(2);
		const errorBase = toMap(semantic.error.steps)[500];
		const relOf = (hex) => { const [L, C, h] = hexToOklch(hex); return relChroma(L, C, h); };
		const flag = (label, pass, detail) => ({ label, pass, detail });
		const photoChecks = [
			check('White text on a darkened photo (worst case: a white photo)', WHITE, lightest, 4.5),
			check('Book now button on a light photo, under the overlay', A, lightest, 3),
			check('Book now button on a dark photo', A, '#000000', 3),
			check('Book now label on the button', accentColour.textColour, A, 4.5),
			check('Book now button in a light header', A, roles.background, 3),
			flag('Book now is the most colourful button', relOf(A) >= relOf(P) - 0.02, `Accent ${Math.round(relOf(A) * 100)}% of its maximum colourfulness, primary ${Math.round(relOf(P) * 100)}%. The booking button should be the one that pops.`),
			flag("Book now doesn't look like an error", deltaEOK(A, errorBase) >= 0.1, `Distance from the error red ${errorBase}: ${deltaEOK(A, errorBase).toFixed(3)} (needs 0.1 or more).`),
		];
		const fails = photoChecks.filter((c) => !c.pass);
		if (fails.length) notes.push(`Photos and booking: ${fails.map((c) => c.label.toLowerCase()).join('; ')} ${fails.length === 1 ? 'needs' : 'need'} attention.`);
		photo = {
			alpha, tintAlpha: tint, checks: photoChecks,
			tokens: {
				'overlay-scrim': `rgba(0, 0, 0, ${alpha})`,
				'overlay-scrim-gradient': `linear-gradient(to top, rgba(0, 0, 0, ${alpha}) 0%, rgba(0, 0, 0, ${(alpha / 2).toFixed(2)}) 50%, rgba(0, 0, 0, 0) 100%)`,
				'overlay-scrim-brand': `rgba(${rr}, ${gg}, ${bb}, ${tint})`,
				'overlay-text': WHITE,
			},
		};
	}

	const T = design.textTarget ?? 4.5;
	const darkChecks = [
		check('Text primary on background', dark['text-primary'], dark['bg-primary'], T),
		check('Text secondary on background', dark['text-secondary'], dark['bg-primary'], T),
		check('Text tertiary on background', dark['text-tertiary'], dark['bg-primary'], T),
		check('Text primary on raised surface', dark['text-primary'], dark['surface-3'], T),
		check('Links on background', dark.link, dark['bg-primary'], T),
		check('Text on primary buttons', dark['on-interactive-primary'], dark['interactive-primary'], 4.5),
		check('Text on accent buttons', dark['on-interactive-accent'], dark['interactive-accent'], 4.5),
		check('Primary buttons stand out from background', dark['interactive-primary'], dark['bg-primary'], 3),
		check('Accent buttons stand out from background', dark['interactive-accent'], dark['bg-primary'], 3),
	];
	const darkFails = darkChecks.filter((c) => !c.pass);
	if (darkFails.length) notes.push(`Dark mode: ${darkFails.length} contrast check(s) fail (${darkFails.map((c) => c.label.toLowerCase()).join('; ')}).`);

	// Colour blindness: pairs that look different normally but merge for some people.
	const pairs = [['primary', P], ['secondary', S], ['accent', A], ['success', toMap(semantic.success.steps)[500]], ['error', toMap(semantic.error.steps)[500]]];
	const cvd = Object.entries(CVD).map(([type, [label, share]]) => {
		const sim = Object.fromEntries(pairs.map(([role, hex]) => [role, simulate(hex, type)]));
		const confused = [];
		for (let i = 0; i < pairs.length; i++) for (let j = i + 1; j < pairs.length; j++) {
			const [a, b] = [pairs[i][0], pairs[j][0]];
			if (deltaEOK(pairs[i][1], pairs[j][1]) >= 0.08 && deltaEOK(sim[a], sim[b]) < 0.08) confused.push([a, b]);
		}
		return { type, label, share, swatches: sim, confused };
	});
	const confusedAll = cvd.filter((c) => c.confused.length);
	if (confusedAll.length) notes.push(`Colour blindness: ${confusedAll.map((c) => `${c.label.split(' (')[0].toLowerCase()} viewers can't tell ${c.confused.map((p) => p.join(' from ')).join(', ')}`).join('; ')}. Add a second cue (icons, labels, underlines, patterns) wherever those colours carry meaning.`);

	// Extended palette: 8-12 colours in four groups, with warm/cool balance and a tinted white.
	const brand = toMap(scales.brand.steps), secondary = toMap(scales.secondary.steps), accent = toMap(scales.accent.steps);
	const groups = {
		Primary: [[P, 'Buttons, links and key brand moments'], [brand[800], 'Headings on light backgrounds']],
		Secondary: [[S, 'Supporting sections and icons'], [secondary[100], 'Tinted panels, badges, selected states'], ...(design.extras ?? []).map((e) => [e.hex, e.usage])],
		Neutral: [[roles.background, 'Page background'], [roles['text-muted'], 'Captions, placeholders, quiet icons'], [roles['text-primary'], 'Headings and body text']],
		Accent: [[A, 'Calls to action and highlights'], [accent[100], 'Soft highlight backgrounds']],
	};
	const temps = [P, S, A].map(temperature).filter((t) => t !== 'neutral');
	if (temps.length && temps.every((t) => t === temps[0])) {
		const counter = temps[0] === 'warm' ? oklchToHex(0.55, 0.025, 230) : oklchToHex(0.55, 0.025, 70);
		groups.Neutral.push([counter, `${temps[0] === 'warm' ? 'Cool' : 'Warm'} counterpoint: dividers, icons, captions`]);
		notes.push(`All the brand colours are ${temps[0]}, so the extended palette adds a ${temps[0] === 'warm' ? 'cool' : 'warm'} neutral for balance.`);
	}
	if (roles.background.toLowerCase() === WHITE) notes.push('The background is pure white. A white tinted toward the palette (Off-white or Light tinted) usually feels more finished.');
	const seen = new Map(); // name -> lightness
	const extendedGroups = Object.entries(groups).map(([group, items]) => ({
		group,
		colours: items.map(([hex, use]) => {
			let name = evocativeName(hex);
			const L = hexToOklch(hex)[0];
			if (seen.has(name)) name = `${L > seen.get(name) ? 'Light' : 'Dark'} ${noun(name)}`;
			for (let n = 2; seen.has(name); n++) name = `${evocativeName(hex)} ${n}`;
			seen.set(name, L);
			return { name, hex, rgb: rgbText(hex), hsl: hslText(hex), use, textColour: bestText(hex, [roles['text-primary'], roles.background, WHITE, '#000000']) };
		}),
	}));
	const harmony = byRole('accent').harmony || byRole('secondary').harmony || 'monochromatic';
	const balance = new Set(temps).size > 1 ? 'balancing warm and cool tones' : `in ${temps[0] ?? 'neutral'} tones with a ${temps[0] === 'warm' ? 'cool' : 'warm'} counterpoint`;
	const extended = {
		name: `${noun(evocativeName(P))} & ${noun(evocativeName(A))}`,
		strategy: `A ${harmony} scheme built around ${evocativeName(P)}, ${balance}.`,
		groups: extendedGroups,
	};

	// Gradients: under 60° of hue turn reads subtle, 90-180° vibrant. "in oklch" keeps the middle from going grey.
	const [Lp, Cp, Hp] = hexToOklch(P);
	const turn = Math.round(hueDistance(Hp, hexToOklch(A)[2]));
	const gradients = [
		{ name: 'Subtle', note: '30° hue turn: calm backgrounds and headers', css: `linear-gradient(135deg in oklch, ${P}, ${oklchToHex(Lp, Cp, Hp + 30)})` },
		{ name: turn >= 90 ? 'Vibrant' : 'Bold', note: `Primary to accent, ${turn}° hue turn: hero sections`, css: `linear-gradient(135deg in oklch, ${P}, ${S}, ${A})` },
		{ name: 'Mesh', note: 'Soft corner glows on a tinted base', css: `radial-gradient(at 0% 0%, ${oklchToHex(0.7, 0.15, Hp)} 0%, transparent 50%), radial-gradient(at 100% 0%, ${oklchToHex(0.7, 0.15, hexToOklch(S)[2])} 0%, transparent 50%), radial-gradient(at 100% 100%, ${oklchToHex(0.7, 0.15, hexToOklch(A)[2])} 0%, transparent 50%), ${oklchToHex(0.97, 0.01, Hp)}` },
	];

	const out = { notes, extended, scales, semantic, light, dark, darkChecks, stateChecks, photo, cvd, okabeIto: OKABE_ITO, gradients, opts, extras: (design.extras ?? []).map((e) => e.hex) };
	return { ...out, css: tokensCss(out), tailwind4: tailwind4(out, roles), tailwind3: tailwind3(out, roles), sheet: swatchSheet(out, design, scrapeUrl) };
}

const primitives = (s) => [
	...['brand', 'secondary', 'accent', 'gray'].flatMap((name) => s.scales[name].steps.map((x) => [`${name}-${x.step}`, x.hex])),
	...Object.entries(s.semantic).flatMap(([name, v]) => v.steps.map((x) => [`${name}-${x.step}`, x.hex])),
];

function tokensCss(s) {
	const block = (selector, entries) => `${selector} {\n${entries.map(([k, v]) => `  --${k}: ${v};`).join('\n')}\n}`;
	const darkRefs = Object.entries(s.dark).map(([k, v]) => {
		const ref = primitives(s).find(([, hex]) => hex === v);
		return [k, ref ? `var(--${ref[0]})` : v];
	});
	const indent = (text) => text.split('\n').map((l) => `  ${l}`).join('\n');
	// manual: a data-theme switch; auto: follows the device setting; both: follows the device unless the site's switch says otherwise.
	const darkCss = {
		manual: ['/* Layer 2: dark mode, switched on with <html data-theme="dark"> */', block('[data-theme="dark"]', darkRefs)],
		auto: ['/* Layer 2: dark mode follows the visitor\'s device setting */', `@media (prefers-color-scheme: dark) {\n${indent(block(':root', darkRefs))}\n}`],
		both: ['/* Layer 2: dark mode follows the device, unless the site\'s switch sets data-theme */',
			`@media (prefers-color-scheme: dark) {\n${indent(block(':root:not([data-theme="light"])', darkRefs))}\n}`, block('[data-theme="dark"]', darkRefs)],
	}[s.opts.darkMode] ?? [];
	const scheme = { manual: 'light', auto: 'light dark', both: 'light dark' }[s.opts.darkMode];
	const extra = s.photo ? Object.entries(s.photo.tokens) : [];
	return [
		'/* Layer 1: primitives (raw colours) */',
		block(':root', [...primitives(s), ['color-primary', s.light['interactive-primary']], ['color-secondary', s.scales.secondary.base], ['color-accent', s.light['interactive-accent']], ...s.extras.map((hex, i) => [`color-extra-${i + 1}`, hex])]),
		'',
		'/* Layer 2: semantic roles (light). Components only use these. */',
		block(':root', [...Object.entries(s.light), ...extra]).replace(/\n}$/, `\n  color-scheme: ${scheme};\n}`),
		'',
		...darkCss,
		'',
		'/* Layer 3: components */',
		s.opts.states
			? '.btn-primary { background: var(--interactive-primary); color: var(--on-interactive-primary); }\n.btn-primary:hover { background: var(--interactive-primary-hover); }\n.btn-primary:active { background: var(--interactive-primary-active); }\n.btn-accent { background: var(--interactive-accent); color: var(--on-interactive-accent); }\n.btn-accent:hover { background: var(--interactive-accent-hover); }\n.btn-accent:active { background: var(--interactive-accent-active); }\nbutton:disabled, .btn[aria-disabled="true"] { background: var(--disabled-bg); color: var(--disabled-text); }\n:focus-visible { outline: 3px solid var(--focus-ring); outline-offset: 2px; }\na:hover { color: var(--link-hover); }'
			: '.btn-primary { background: var(--interactive-primary); color: var(--on-interactive-primary); }\n.btn-primary:hover { background: oklch(from var(--interactive-primary) calc(l - 0.07) c h); }\n.btn-accent { background: var(--interactive-accent); color: var(--on-interactive-accent); }',
		'a { color: var(--link); text-decoration: underline; } /* colour alone isn\'t enough to mark a link */',
		'.card { background: var(--surface-1); border: 1px solid var(--border-default); color: var(--text-secondary); }',
		'.alert-error { background: var(--error-50); color: var(--error-700); border-left: 4px solid var(--error-500); }',
		...(s.photo ? ['.hero::after { content: ""; position: absolute; inset: 0; background: var(--overlay-scrim-gradient); } /* darkens photos so text and Book now stay readable */', '.hero__content { position: relative; color: var(--overlay-text); }'] : []),
		...(s.opts.darkMode !== 'manual' ? ['', '/* In <head>, so the browser bar matches: */', `/* <meta name="theme-color" content="${s.light['bg-primary']}" media="(prefers-color-scheme: light)"> */`, `/* <meta name="theme-color" content="${s.dark['bg-primary']}" media="(prefers-color-scheme: dark)"> */`] : []),
	].join('\n');
}

function tailwind4(s, roles) {
	return ['@import "tailwindcss";', '@theme {', ...primitives(s).map(([k, v]) => `  --color-${k}: ${v};`),
		`  --color-primary: ${s.light['interactive-primary']};`, `  --color-secondary: ${s.scales.secondary.base};`, `  --color-accent: ${s.light['interactive-accent']};`,
		`  --color-background: ${roles.background};`, `  --color-surface: ${roles.surface};`, '}'].join('\n');
}

function tailwind3(s, roles) {
	const obj = (name, steps) => `      ${name}: { ${steps.map((x) => `${x.step}: '${x.hex}'`).join(', ')} },`;
	return ['// tailwind.config.js', 'module.exports = {', '  theme: {', '    extend: {', '      colors: {',
		...['brand', 'secondary', 'accent', 'gray'].map((n) => obj(n, s.scales[n].steps)),
		...Object.entries(s.semantic).map(([n, v]) => obj(n, v.steps)),
		`      primary: '${s.light['interactive-primary']}',`, `      background: '${roles.background}',`, `      surface: '${roles.surface}',`,
		`      text: { primary: '${roles['text-primary']}', secondary: '${roles['text-secondary']}', muted: '${roles['text-muted']}' },`,
		'      },', '    },', '  },', '};'].join('\n');
}

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// A self-contained page that uses the palette for its own styling (the AI Color Palette Designer's output).
export function swatchSheet(s, design, url) {
	const r = Object.fromEntries(design.roles.map((x) => [x.key, x.hex]));
	const verdict = (ratio, min) => (ratio >= min ? `Passes WCAG 2.2 AA (SC 1.4.3, needs ${min}:1)` : `Fails WCAG 2.2 AA (SC 1.4.3, needs ${min}:1)`);
	const pair = (label, fg, bg, min, sample) => `<div class="pair" style="background:${bg};color:${fg}"><p class="sample">${sample}</p><p>${label} · ${contrast(fg, bg).toFixed(2)}:1 · ${verdict(contrast(fg, bg), min)}</p></div>`;
	const primary = design.palette.find((c) => c.role === 'primary'), accent = design.palette.find((c) => c.role === 'accent');
	const all = s.extended.groups.flatMap((g) => g.colours);
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(s.extended.name)} palette</title>
<style>
:root {
${all.map((c, i) => `  --c${i + 1}: ${c.hex}; /* ${c.name} */`).join('\n')}
  --bg: ${r.background}; --surface: ${r.surface}; --text: ${r['text-primary']}; --text-2: ${r['text-secondary']}; --border: ${r.border}; --primary: ${primary.hex}; --accent: ${accent.hex};
}
* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; background: var(--bg); color: var(--text-2); font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 1040px; margin: 0 auto; padding: 48px 24px; }
h1, h2 { color: var(--text); } h1 { margin: 0; font-size: 34px; } h2 { margin: 40px 0 12px; border-bottom: 2px solid var(--primary); padding-bottom: 6px; }
.lead { margin: 6px 0 0; } .source { font-size: 14px; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; }
.sw { border-radius: 12px; overflow: hidden; border: 1px solid var(--border); background: var(--surface); }
.sw .chip { height: 120px; padding: 12px; font-weight: 700; }
.sw dl { margin: 0; padding: 12px; font-size: 13px; display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; }
.sw dt { font-weight: 600; color: var(--text); }
.pair { border-radius: 12px; padding: 20px; margin-bottom: 10px; border: 1px solid var(--border); }
.pair p { margin: 0; font-size: 14px; } .pair .sample { font-size: 20px; font-weight: 600; margin-bottom: 6px; }
.strip { display: flex; flex-wrap: wrap; gap: 10px; }
.dot { width: 56px; height: 56px; border-radius: 50%; border: 1px solid var(--border); }
footer { margin-top: 48px; font-size: 13px; }
</style>
</head>
<body>
<main>
<h1>${esc(s.extended.name)}</h1>
<p class="lead">${esc(s.extended.strategy)}</p>
<p class="source">From the colours on ${esc(url)}</p>
${s.extended.groups.map((g) => `<h2>${g.group}</h2>
<div class="grid">${g.colours.map((c) => `<div class="sw"><div class="chip" style="background:${c.hex};color:${c.textColour}">${esc(c.name)}</div>
<dl><dt>HEX</dt><dd>${c.hex.toUpperCase()}</dd><dt>RGB</dt><dd>${c.rgb}</dd><dt>HSL</dt><dd>${c.hsl}</dd><dt>Use</dt><dd>${esc(c.use)}</dd></dl></div>`).join('')}</div>`).join('\n')}
<h2>Pairings</h2>
${pair('Body text on background', r['text-secondary'], r.background, 4.5, 'Body text reads comfortably here.')}
${pair('Heading on background', r['text-primary'], r.background, 4.5, 'A heading in the main text colour')}
${pair('Button text on primary', primary.textColour, primary.hex, 4.5, 'Primary button')}
${pair('Button text on accent', accent.textColour, accent.hex, 4.5, 'Book now')}
<h2>Harmony</h2>
<div class="strip">${all.map((c) => `<div class="dot" style="background:${c.hex}" title="${esc(c.name)} ${c.hex}"></div>`).join('')}</div>
<footer>Contrast measured with the WCAG 2.2 formula (SC 1.4.3 Contrast (Minimum): 4.5:1 for normal text, 3:1 for large text).</footer>
</main>
</body>
</html>
`;
}
