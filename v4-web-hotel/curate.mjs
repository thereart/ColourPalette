// Turns a suggested palette (suggest-palette.mjs) into a full website colour scheme, following the
// color-curator skill by Dave Poon (MIT): https://github.com/davepoon/buildwithclaude
// (plugins/frontend-design-pro/skills/color-curator).
//  - Background style picks background, surface and text (pure white, off-white, light tinted, dark).
//  - Roles: background, surface, border, text primary / secondary / muted.
//  - Contrast: text 4.5:1, interactive elements 3:1.
//  - Warm colours come forward (calls to action), cool colours recede (large areas).
//  - 50-950 shade scales, colour psychology, curated palettes in a similar mood, Tailwind config.

import { contrast, hexToOklch, oklchToHex, maxChroma, deltaEOK, hueName } from './colour.mjs';

export const BACKGROUNDS = { white: 'Pure white', offwhite: 'Off-white (warm)', tinted: 'Light tinted', dark: 'Dark / moody' };

const PSYCHOLOGY = {
	black: ['Luxury, power, sophistication', 'Premium brands, tech, fashion'],
	white: ['Clean, minimal, pure', 'Healthcare, minimal brands'],
	grey: ['Neutral, balanced, calm', 'Supporting text and surfaces'],
	red: ['Energy, urgency, passion', 'Food, entertainment, sales'],
	orange: ['Friendly, energetic, creative', 'Startups, creative, food'],
	yellow: ['Optimism, warmth, caution', "Children's, food, warnings"],
	green: ['Nature, growth, money', 'Finance, eco, health'],
	cyan: ['Fresh, clear, calm', 'Tech, health, water and travel'],
	blue: ['Trust, calm, professional', 'Corporate, tech, finance'],
	purple: ['Luxury, creativity, wisdom', 'Beauty, spiritual, creative'],
	pink: ['Playful, feminine, modern', 'Fashion, beauty, youth'],
	brown: ['Earthy, reliable, warm', 'Food, outdoor, organic'],
};

// The skill's curated palettes, grouped by mood.
const CURATED = [
	['Dark & Premium', 'Obsidian Gold', '#c9a227', '#0a0a0a', '#1a1a1a', '#fafafa', '#737373'],
	['Dark & Premium', 'Midnight Coral', '#ff6b6b', '#0f0f0f', '#1e1e1e', '#ffffff', '#888888'],
	['Dark & Premium', 'Deep Ocean', '#00d4ff', '#0a0a0a', '#141414', '#f0f0f0', '#666666'],
	['Clean & Minimal', 'Pure Contrast', '#000000', '#ffffff', '#f5f5f5', '#171717', '#737373'],
	['Clean & Minimal', 'Warm Minimal', '#1a1a1a', '#faf8f5', '#f0ede8', '#1a1a1a', '#8a8a8a'],
	['Clean & Minimal', 'Cool Slate', '#3b82f6', '#f8fafc', '#f1f5f9', '#0f172a', '#64748b'],
	['Bold & Energetic', 'Electric Orange', '#ff6b35', '#0a0a0a', '#171717', '#ffffff', '#ffd23f'],
	['Bold & Energetic', 'Neon Punch', '#ff00ff', '#000000', '#1a1a1a', '#ffffff', '#00ffff'],
	['Bold & Energetic', 'Brutalist Yellow', '#000000', '#ffe951', '#ffffff', '#000000', '#000000'],
	['Warm & Inviting', 'Scandinavian', '#c17f59', '#faf8f5', '#f0ede8', '#2c2c2c', '#8a8178'],
	['Warm & Inviting', 'Forest Cabin', '#2d5a27', '#f5f2eb', '#ebe7dc', '#1c1c1c', '#6b6b5e'],
	['Warm & Inviting', 'Desert Sunset', '#d4764e', '#fdf6e3', '#f4ece0', '#3b3024', '#b55b3a'],
	['Cool & Professional', 'Corporate Blue', '#2563eb', '#ffffff', '#f8fafc', '#1e293b', '#64748b'],
	['Cool & Professional', 'Tech Slate', '#6366f1', '#f9fafb', '#f3f4f6', '#111827', '#6b7280'],
	['Cool & Professional', 'Finance Green', '#059669', '#ffffff', '#f0fdf4', '#064e3b', '#6b7280'],
	['Creative & Playful', 'Candy', '#ec4899', '#ffffff', '#fdf4ff', '#1f1f1f', '#8b5cf6'],
	['Creative & Playful', 'Retro Pop', '#f472b6', '#fef3c7', '#ffffff', '#1c1917', '#38bdf8'],
	['Creative & Playful', 'Memphis', '#ff6b6b', '#ffffff', '#e0f2fe', '#000000', '#fbbf24'],
].map(([mood, name, primary, background, surface, text, extra]) => ({ mood, name, colours: { primary, background, surface, text, extra } }));

const SHADE_STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

// Like hueName, but dark, low-chroma oranges and reds read as brown.
export function colourName(hex) {
	const name = hueName(hex);
	const [L, C] = hexToOklch(hex);
	return ['red', 'orange', 'yellow'].includes(name) && L < 0.55 && C < 0.12 ? 'brown' : name;
}

const isWarm = (hex) => ['red', 'orange', 'yellow'].includes(hueName(hex));

// Steps OKLCH lightness from the background towards the text colour until it reaches the target contrast.
function towards(bg, text, target, H, C = 0.01) {
	const [Lb] = hexToOklch(bg), [Lt] = hexToOklch(text);
	for (let t = 0.02; t <= 1; t += 0.01) {
		const hex = oklchToHex(Lb + (Lt - Lb) * t, C, H);
		if (contrast(hex, bg) >= target) return hex;
	}
	return text;
}

// Moves a colour's lightness away from the background until it reaches the target contrast, keeping hue.
function readableOn(hex, bg, target) {
	if (contrast(hex, bg) >= target) return hex;
	const [L, C, H] = hexToOklch(hex);
	const step = hexToOklch(bg)[0] > 0.5 ? -0.01 : 0.01;
	for (let l = L; l >= 0 && l <= 1; l += step) {
		const next = oklchToHex(l, C, H);
		if (contrast(next, bg) >= target) return next;
	}
	return step < 0 ? '#000000' : '#ffffff';
}

// 50-950 scale with the colour itself at 500; lighter steps lose some chroma so tints stay soft.
export function shades(hex) {
	const [Lb, C, H] = hexToOklch(hex);
	const rel = C / (maxChroma(Lb, H) || 1);
	const at = (L, r) => oklchToHex(L, r * maxChroma(L, H), H);
	const light = [0, 1, 2, 3, 4].map((i) => at(0.97 - (0.97 - Lb) * (i / 5), rel * (0.4 + 0.6 * (i / 5))));
	const dark = [1, 2, 3, 4, 5].map((i) => at(Lb - (Lb - 0.2) * (i / 5), rel * (1 - 0.3 * (i / 5))));
	return Object.fromEntries(SHADE_STEPS.map((step, i) => [step, [...light, hex, ...dark][i]]));
}

// textTarget 'aaa' raises text to WCAG AAA (7:1); button labels stay at AA (4.5:1).
// keepOrder: the colours' roles were chosen by a person, so a better role order is suggested rather than applied.
export function curate(suggestion, background = 'white', { textTarget = 'aa', keepOrder = false } = {}) {
	if (!BACKGROUNDS[background]) background = 'white';
	const T = textTarget === 'aaa' ? 7 : 4.5;
	const notes = [];
	const palette = suggestion.palette.map((c) => ({ ...c }));
	const by = (role) => palette.find((c) => c.role === role);

	// Warm colours come forward, so they make better calls to action than cool ones.
	const secondary = by('secondary'), accent = by('accent');
	if (keepOrder && !isWarm(accent.hex) && isWarm(secondary.hex)) {
		notes.push(`Tip: your secondary (${colourName(secondary.hex)}) is warm and your accent is cool. Warm colours come forward, so swapping them would make Book now stand out more.`);
	} else if (!isWarm(accent.hex) && isWarm(secondary.hex)) {
		[secondary.role, accent.role] = ['accent', 'secondary'];
		[secondary.usage, accent.usage] = [accent.usage, secondary.usage];
		notes.push(`Swapped secondary and accent: ${colourName(secondary.hex)} is warm, and warm colours come forward, so it works better for calls to action.`);
		palette.sort((a, b) => ['primary', 'secondary', 'accent', 'dark', 'light'].indexOf(a.role) - ['primary', 'secondary', 'accent', 'dark', 'light'].indexOf(b.role));
	}

	const primary = by('primary'), dark = by('dark'), light = by('light');
	const H = hexToOklch(primary.hex)[2];

	// Background style -> background, surface, main text (the skill's mapping table).
	let bg, surface, text;
	if (background === 'dark') {
		bg = hexToOklch(dark.hex)[0] <= 0.25 ? dark.hex : oklchToHex(0.18, 0.01, H);
		// Lifted enough that cards show (the skill's dark palettes pair #0a0a0a with #1a1a1a).
		surface = oklchToHex(Math.max(hexToOklch(bg)[0] + 0.07, 0.22), 0.01, H);
		text = '#fafafa';
		notes.push('On a dark background the dark colour takes the 60% role, and the light colour is used for text.');
	} else {
		if (background === 'offwhite') [bg, surface] = ['#faf8f5', '#f0ede8'];
		else if (background === 'tinted') {
			bg = light.hex.toLowerCase() === '#ffffff' ? oklchToHex(0.975, 0.012, H) : light.hex;
			surface = oklchToHex(hexToOklch(bg)[0] - 0.03, 0.015, H);
		} else {
			bg = '#ffffff';
			surface = light.hex.toLowerCase() === '#ffffff' ? oklchToHex(0.975, 0.006, H) : light.hex;
		}
		text = contrast(dark.hex, bg) >= 7 ? dark.hex : readableOn(dark.hex, bg, 7);
	}
	const textSecondary = towards(bg, text, T === 7 ? 10 : 7, H);
	const textMuted = towards(bg, text, T, H);
	const border = towards(bg, text, 1.4, H);
	const link = readableOn(primary.hex, bg, T);
	if (link !== primary.hex) notes.push(`Links use ${link}, a ${hexToOklch(bg)[0] > 0.5 ? 'darker' : 'lighter'} shade of the primary, because the primary itself is under ${T}:1 on this background.`);

	const roles = [
		{ role: 'Primary', key: 'primary', hex: primary.hex, usage: 'Brand, buttons, calls to action' },
		{ role: 'Secondary', key: 'secondary', hex: by('secondary').hex, usage: 'Hover, icons, supporting elements' },
		{ role: 'Accent', key: 'accent', hex: by('accent').hex, usage: 'Highlights and key calls to action (10%)' },
		{ role: 'Background', key: 'background', hex: bg, usage: 'Page background (60%)' },
		{ role: 'Surface', key: 'surface', hex: surface, usage: 'Cards, modals, inputs, sections (30%)' },
		{ role: 'Border', key: 'border', hex: border, usage: 'Dividers and outlines' },
		{ role: 'Text primary', key: 'text-primary', hex: text, usage: 'Headings and important text' },
		{ role: 'Text secondary', key: 'text-secondary', hex: textSecondary, usage: 'Body text and descriptions' },
		{ role: 'Text muted', key: 'text-muted', hex: textMuted, usage: 'Captions and placeholders' },
		{ role: 'Link', key: 'link', hex: link, usage: 'Text links' },
	];

	// The skill's contrast requirements: text 4.5:1, interactive elements 3:1.
	const check = (label, a, b, min) => ({ label, ratio: +contrast(a, b).toFixed(2), min, pass: contrast(a, b) >= min });
	const checks = [
		check('Text primary on background', text, bg, T),
		check('Text secondary on background', textSecondary, bg, T),
		check('Text muted on background', textMuted, bg, T),
		check('Text primary on surface', text, surface, T),
		check('Links on background', link, bg, T),
		check('Text on primary buttons', primary.textColour, primary.hex, 4.5),
		check('Text on accent buttons', by('accent').textColour, by('accent').hex, 4.5),
		check('Primary buttons stand out from background', primary.hex, bg, 3),
		check('Accent buttons stand out from background', by('accent').hex, bg, 3),
	];
	const failed = checks.filter((c) => !c.pass);
	if (failed.length) notes.push(`${failed.length} contrast check(s) fail on this background: ${failed.map((c) => c.label.toLowerCase()).join('; ')}. Try another background style, or keep those colours for large shapes rather than text or buttons.`);

	const psychology = palette.slice(0, 3).map((c) => {
		const name = colourName(c.hex);
		const [feel, bestFor] = PSYCHOLOGY[name];
		return { role: c.role, hex: c.hex, name, temperature: isWarm(c.hex) ? 'warm: comes forward' : 'cool: recedes', feel, bestFor };
	});

	// Closest curated palettes: similar primary and similar light/dark background.
	const bgDark = hexToOklch(bg)[0] < 0.5;
	const curated = CURATED.map((p) => ({ ...p, score: deltaEOK(primary.hex, p.colours.primary) + (bgDark !== hexToOklch(p.colours.background)[0] < 0.5 ? 0.3 : 0) }))
		.sort((a, b) => a.score - b.score).slice(0, 3).map(({ score, ...p }) => p);

	const shadeScales = { primary: shades(primary.hex), accent: shades(by('accent').hex) };
	const scale = (s) => Object.entries(s).map(([k, v]) => `${k}: '${v}'`).join(', ');
	const tailwind = [
		'colors: {',
		`  primary: { DEFAULT: '${primary.hex}', ${scale(shadeScales.primary)} },`,
		`  secondary: '${by('secondary').hex}',`,
		`  accent: { DEFAULT: '${by('accent').hex}', ${scale(shadeScales.accent)} },`,
		`  background: '${bg}',`,
		`  surface: '${surface}',`,
		`  border: '${border}',`,
		`  link: '${link}',`,
		`  text: { primary: '${text}', secondary: '${textSecondary}', muted: '${textMuted}' },`,
		'}',
	].join('\n');
	const css = [
		':root {',
		...roles.map((r) => `  --color-${r.key}: ${r.hex};`),
		`  --color-on-primary: ${primary.textColour};`,
		`  --color-on-accent: ${by('accent').textColour};`,
		...Object.entries(shadeScales).flatMap(([name, s]) => Object.entries(s).map(([k, v]) => `  --color-${name}-${k}: ${v};`)),
		'}',
	].join('\n');

	return { textTarget: T, background, backgroundLabel: BACKGROUNDS[background], mood: curated[0].mood, notes, palette, roles, checks, psychology, curated, shades: shadeScales, tailwind, css };
}
