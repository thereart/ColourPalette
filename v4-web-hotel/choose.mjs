// The choose step: the site's own brand colours (3-5, no black, white or greys), each with
// recommended changes a person can pick from before the full colour system is built.

import { contrast, hexToOklch, oklchToHex, maxChroma, deltaEOK, hueDistance } from './colour.mjs';
import { suggest, groupColours, isNeutral, relChroma, harmonyWith, describe, fixContrast, character } from './suggest-palette.mjs';
import { PROPERTY_TYPES } from './hotel.mjs';
import { evocativeName, simulate } from './system.mjs';
import { colourName } from './curate.mjs';

const WHITE = '#ffffff';
const ROLES = ['primary', 'secondary', 'accent', 'extra', 'extra'];
const HARMONIES = [[0, 'monochromatic'], [30, 'analogous'], [120, 'triadic'], [150, 'split-complementary'], [180, 'complementary']];
const at = (L, rel, H) => oklchToHex(L, rel * maxChroma(L, H), H);
export const MIN_COVERAGE = 0.0005;

// Each option keeps the hue unless it says otherwise. The first one is the best overall fix, when there is one.
export function recommendations(hex, role, primaryHex, property, improved) {
	const [L, C, H] = hexToOklch(hex);
	const rel = relChroma(L, C, H);
	const dark = oklchToHex(0.2, 0.02, H);
	const out = [];
	const add = (next, label, reason) => {
		if (deltaEOK(next, hex) < 0.015 || out.some((o) => deltaEOK(o.hex, next) < 0.015)) return;
		out.push({ hex: next, label, reason, name: evocativeName(next) });
	};
	if (improved && improved.hex !== hex && improved.changes.length) add(improved.hex, 'Recommended', improved.changes.join(' '));

	const p = PROPERTY_TYPES[property];
	if (p?.maxRel) {
		const cap = role === 'accent' ? Math.min(1, p.maxRel + 0.2) : p.maxRel;
		if (rel > cap + 0.02) add(at(L, cap, H), `Suits a ${p.label.toLowerCase()}`, `Less colourful (${Math.round(cap * 100)}% of the maximum) for a ${p.label.toLowerCase()} feel.`);
	}
	if (contrast(hex, WHITE) < 4.5) {
		for (let l = L; l > 0; l -= 0.005) {
			const next = at(l, rel, H);
			if (contrast(next, WHITE) >= 4.5) { add(next, 'Darker, for white text', `White text on it reaches 4.5:1 (it's ${contrast(hex, WHITE).toFixed(1)}:1 now).`); break; }
		}
	}
	if (contrast(hex, dark) < 4.5) {
		for (let l = L; l < 1; l += 0.005) {
			const next = at(l, rel, H);
			if (contrast(next, oklchToHex(0.2, 0.02, H)) >= 4.5) { add(next, 'Lighter, for dark text', `Dark text on it reaches 4.5:1 (it's ${contrast(hex, dark).toFixed(1)}:1 now).`); break; }
		}
	}
	if (role !== 'primary' && primaryHex) {
		const pH = hexToOklch(primaryHex)[2];
		const diff = ((H - pH + 540) % 360) - 180;
		const [offset, name] = HARMONIES.reduce((best, cur) => (Math.abs(Math.abs(diff) - cur[0]) < Math.abs(Math.abs(diff) - best[0]) ? cur : best));
		if (C >= 0.04 && Math.abs(Math.abs(diff) - offset) > 15) {
			add(at(L, rel, (pH + Math.sign(diff || 1) * offset + 360) % 360), `In harmony with the primary (${name})`, `Hue turned to sit ${name} to the primary; it's ${Math.round(Math.abs(diff))}° away now, between harmonies.`);
		}
	}
	if (rel > 0.45) add(at(L, rel * 0.7, H), 'Calmer', 'Less colourful, for a softer, more refined look.');
	if (rel < 0.8) add(at(L, Math.min(1, rel * 1.3 + 0.1), H), 'Richer', 'More colourful, so it stands out more.');
	return out.slice(0, 6);
}

export function candidates(colours, { property = 'none' } = {}) {
	// The site's brand colours, most used first; near-identical ones (under 0.08 apart) count as one.
	// Measured pages rank by how much of the page a colour covers; specks under 0.05% (a stray icon) don't count as brand colours.
	const rendered = colours.method === 'rendered';
	// Uploaded photo/logo colours have no page coverage, so they're kept and labelled as from your images.
	const fromImages = (c) => c.sources?.includes('photo or logo');
	if (rendered) colours = { ...colours, colours: colours.colours.filter((c) => c.coverage >= MIN_COVERAGE || fromImages(c) || isNeutral(hexToOklch(c.hex))) };
	const byHex = Object.fromEntries(colours.colours.map((c) => [c.hex, c]));
	const site = [];
	for (const g of groupColours(colours.colours).filter((g) => !isNeutral(g.lch))) {
		const members = [g.hex, ...g.merged].map((hex) => byHex[hex]);
		const coverage = rendered ? members.reduce((s, c) => s + (c?.coverage ?? 0), 0) : null;
		const source = members.some((c) => c && fromImages(c)) && !coverage ? 'image' : 'site';
		const same = site.find((s) => deltaEOK(s.hex, g.hex) < 0.08);
		if (same) { same.count += g.count; if (rendered) same.coverage += coverage; }
		else if (site.length < 5) site.push({ hex: g.hex, count: g.count, coverage, source });
	}

	// Fewer than 3: add the colours the suggester generates from the primary.
	const suggestion = suggest(colours);
	for (const c of suggestion.palette.filter((c) => ['primary', 'secondary', 'accent'].includes(c.role) && !c.original)) {
		if (site.length >= 3) break;
		site.push({ hex: c.hex, count: 0, source: 'suggested', why: c.changes.join(' ') });
	}

	const primaryHex = site[0]?.hex;
	return site.map((c, i) => {
		const role = ROLES[i];
		const improved = suggestion.palette.find((s) => s.original === c.hex);
		const facts = describe(c.hex, role === 'extra' ? 'secondary' : role);
		return {
			...c, role, name: evocativeName(c.hex),
			harmony: i ? harmonyWith(hexToOklch(c.hex)[2], hexToOklch(primaryHex)[2]) : null,
			useWith: facts.useWith, contrast: Math.max(facts.wcag.white, facts.wcag.darkText),
			suggestChange: !!(improved && improved.hex !== c.hex && improved.changes.length),
			recommendations: recommendations(c.hex, role, i ? primaryHex : null, property, improved),
		};
	});
}

// Whole-palette alternatives built from the current choices (picks, in role order), for the choose step.
// Each keeps the number of colours. Colours that are new or changed are made readable with white or dark text.
const SCHEMES = [
	['Analogous', 'Neighbouring hues: calm and natural.', [0, 30, -30, 60, -60]],
	['Complementary', 'Opposite hues: high contrast, energetic. Use the opposite colour sparingly.', [0, 180, 180, 30, 210]],
	['Split-complementary', 'Contrast with less tension than complementary.', [0, 150, 210, 30, 180]],
	['Triadic', 'Three evenly spaced hues: balanced and lively.', [0, 120, 240, 60, 180]],
];

export function similarPalettes(picks, property = 'none') {
	if (!picks.length) return [];
	const parts = picks.map((hex) => { const [L, C, H] = hexToOklch(hex); return { L, H, rel: relChroma(L, C, H) }; });
	// Readable version of a colour at this lightness, colourfulness and hue.
	const usable = (L, rel, H) => at(fixContrast(L, rel, H, []), rel, H);
	const out = [];
	const add = (name, note, colours) => {
		// Colours in one palette must be tell-apart-able (0.08 apart): a too-close one moves lighter or darker.
		colours = colours.reduce((done, hex) => {
			let next = hex;
			for (let tries = 0; tries < 4 && done.some((d) => deltaEOK(d, next) < 0.08); tries++) {
				const [L, C, H] = hexToOklch(next);
				const nextL = L > 0.6 ? L - 0.15 : L + 0.15;
				next = usable(nextL, relChroma(L, C, H), H);
			}
			return [...done, next];
		}, []);
		if (colours.every((hex, i) => deltaEOK(hex, picks[i]) < 0.015)) return; // same as now
		if (out.some((p) => p.colours.every((hex, i) => deltaEOK(hex, colours[i]) < 0.015))) return; // already listed
		out.push({ name, note, colours, names: colours.map(evocativeName) });
	};

	add('Easy to read', 'Each colour adjusted just enough for readable text on it.', parts.map(({ L, H, rel }) => usable(L, rel, H)));
	add('Calmer', 'Same hues, less colourful: softer and more refined.', parts.map(({ L, H, rel }) => usable(L, rel * 0.7, H)));
	add('Richer', 'Same hues, more colourful: bolder and more energetic.', parts.map(({ L, H, rel }) => usable(L, Math.min(1, rel * 1.3 + 0.1), H)));
	const p = PROPERTY_TYPES[property];
	if (p?.maxRel) add(`Suits a ${p.label.toLowerCase()}`, p.guidance, parts.map(({ L, H, rel }, i) => usable(L, Math.min(rel, i === 2 ? Math.min(1, p.maxRel + 0.2) : p.maxRel), H)));
	add('In harmony', 'Primary kept; the others turned to the nearest colour-wheel harmony with it.', parts.map(({ L, H, rel }, i) => {
		if (!i) return picks[0];
		const diff = ((H - parts[0].H + 540) % 360) - 180;
		const [offset] = HARMONIES.reduce((best, cur) => (Math.abs(Math.abs(diff) - cur[0]) < Math.abs(Math.abs(diff) - best[0]) ? cur : best));
		return Math.abs(Math.abs(diff) - offset) > 15 ? usable(L, rel, (parts[0].H + Math.sign(diff || 1) * offset + 360) % 360) : picks[i];
	}));
	// Colour-wheel schemes around the primary, keeping each colour's own lightness and colourfulness.
	for (const [name, note, offsets] of SCHEMES) {
		add(name, note, parts.map(({ L, rel }, i) => (i ? usable(L, Math.max(rel, 0.35), (parts[0].H + offsets[i] + 360) % 360) : picks[0])));
	}
	return out;
}

// Generates a new colour for one slot (index) of the current choices (picks), following the skills' rules:
//  - hue at a harmony angle from the primary (or from the secondary when replacing the primary)       [color-expert, architect, designer]
//  - OKLCH throughout; out-of-gamut colours lose chroma, never hue or lightness                        [color-expert, architect]
//  - character: secondary/extras share the primary's colourfulness, the accent is the vivid one         [color-expert]
//  - mid-tones capped so they don't vibrate; the property type's colourfulness ceiling respected       [color-expert, hotel presets]
//  - readable: white or dark text on it reaches WCAG AA 4.5:1                                           [all]
//  - distinct from the other colours (OKLab 0.1), also for red- and green-blind viewers (0.06)          [color-expert, color theory]
//  - accent: warm when possible (comes forward for calls to action), never close to error or success   [curator, architect]
//  - balance: adds the missing temperature when the others are all warm or all cool                     [designer]
// exclude: colours already shown for this slot, so each call gives a different one (different hue first).
const GEN_OFFSETS = [[30, 'analogous'], [-30, 'analogous'], [120, 'triadic'], [-120, 'triadic'], [150, 'split-complementary'], [-150, 'split-complementary'], [180, 'complementary'], [90, 'tetradic'], [-90, 'tetradic']];
const ERROR_RED = oklchToHex(0.55, 0.18, 25), SUCCESS_GREEN = oklchToHex(0.55, 0.16, 145);
const isWarmColour = (hex) => ['red', 'orange', 'yellow'].includes(colourName(hex));

export function generateColour(picks, index, { property = 'none', exclude = [] } = {}) {
	const role = ROLES[index];
	const current = picks[index];
	const others = picks.filter((_, i) => i !== index);
	const ref = index === 0 ? picks[1] : picks[0]; // harmony is measured from the primary, or from the secondary when replacing the primary
	if (!ref) return null;
	const Hr = hexToOklch(ref)[2];
	const [Lp, Cp, Hp] = hexToOklch(picks[0]);
	const pRel = relChroma(Lp, Cp, Hp);
	const [Lc, Cc, Hc] = hexToOklch(current);
	const p = PROPERTY_TYPES[property];
	const cap = p?.maxRel ? (role === 'accent' ? Math.min(1, p.maxRel + 0.2) : p.maxRel) : 1;
	// Target colourfulness by role, never so low it reads as grey.
	const target = Math.max(0.3, role === 'accent' ? Math.max(0.6, Math.min(1, pRel + 0.15)) : role === 'primary' ? relChroma(Lc, Cc, Hc) : pRel);
	const temps = others.map(isWarmColour);
	const wantWarm = temps.every(Boolean) ? false : temps.every((t) => !t) ? true : null;
	const shownHues = [current, ...exclude].map((hex) => hexToOklch(hex)[2]);

	const options = [];
	for (const [offset, harmony] of GEN_OFFSETS) {
		const H = (Hr + offset + 360) % 360;
		// Lightness stays near the colour being replaced, so the palette keeps its light/dark balance.
		for (const L0 of [0, 0.08, -0.08, 0.16, -0.16].map((d) => Math.min(0.85, Math.max(0.3, Lc + d)))) {
			let rel = Math.min(target, cap);
			if (role !== 'accent' && L0 > 0.45 && L0 < 0.85) rel = Math.min(rel, 0.85);
			const L = fixContrast(L0, rel, H, []);
			const hex = at(L, rel, H);
			const warm = isWarmColour(hex);
			const minDist = Math.min(...others.map((o) => deltaEOK(o, hex)));
			const cvdOk = ['protanopia', 'deuteranopia'].every((t) => others.every((o) => deltaEOK(simulate(o, t), simulate(hex, t)) >= 0.06));
			const semanticOk = role !== 'accent' || (deltaEOK(hex, ERROR_RED) >= 0.1 && deltaEOK(hex, SUCCESS_GREEN) >= 0.1);
			const fresh = deltaEOK(hex, current) >= 0.08 && exclude.every((e) => deltaEOK(e, hex) >= 0.05);
			// Distinct enough is enough (0.15); beyond that, staying close to the original lightness matters more.
			let score = Math.min(minDist, 0.15) - Math.abs(L - L0) - Math.abs(L - Lc) * 0.8;
			if (role === 'accent' && warm) score += 0.15;
			if (wantWarm !== null && warm === wantWarm) score += 0.1;
			if (shownHues.some((h) => hueDistance(h, hexToOklch(hex)[2]) < 20)) score -= 0.25; // a new hue before a new shade of an old one
			options.push({ hex, offset, harmony, rel, warm, minDist, cvdOk, semanticOk, fresh, score });
		}
	}
	// Strictest rules first; relax only if nothing passes (very full or very tight palettes).
	const tiers = [
		(o) => o.fresh && o.minDist >= 0.1 && o.cvdOk && o.semanticOk,
		(o) => o.fresh && o.minDist >= 0.08 && o.semanticOk,
		(o) => o.fresh && o.minDist >= 0.08,
		(o) => o.fresh,
	];
	const pick = tiers.map((t) => options.filter(t).sort((a, b) => b.score - a.score)[0]).find(Boolean);
	if (!pick) return null;

	const facts = describe(pick.hex, role === 'extra' ? 'secondary' : role);
	const [L, C, H] = hexToOklch(pick.hex);
	const why = [
		`${pick.harmony[0].toUpperCase()}${pick.harmony.slice(1)} to the ${index === 0 ? 'secondary' : 'primary'} (${Math.abs(pick.offset)}° round the OKLCH colour wheel).`,
		role === 'accent' ? 'The most colourful of the set, so Book now stands out.' : role === 'primary' ? `Keeps a ${character(L, relChroma(L, C, H))} character.` : `Shares the primary's ${character(Lp, pRel)} character.`,
		`${facts.useWith === 'white text' ? 'White' : 'Dark'} text on it: ${Math.max(facts.wcag.white, facts.wcag.darkText).toFixed(1)}:1 (WCAG AA).`,
		pick.cvdOk ? 'Stays distinct for red- and green-blind viewers.' : 'Close to another colour for some colour-blind viewers, so pair it with labels or icons.',
		role === 'accent' && pick.warm ? 'Warm, so it comes forward for calls to action.' : '',
		wantWarm !== null && pick.warm === wantWarm ? `Adds a ${pick.warm ? 'warm' : 'cool'} tone to balance the palette.` : '',
		cap < 1 && target > cap ? `Kept calm to suit a ${p.label.toLowerCase()}.` : '',
	].filter(Boolean).join(' ');
	return { hex: pick.hex, name: evocativeName(pick.hex), label: `Generated: ${pick.harmony}`, reason: why, generated: true };
}
