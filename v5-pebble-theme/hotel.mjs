// Hotel property types: each steers how colourful the brand colours may be, which background suits it,
// which hues guests expect, and which curated hotel palettes to show. Brand hues are never changed:
// only chroma (colourfulness), then lightness again if contrast needs it.

import { hexToOklch, oklchToHex, maxChroma, deltaEOK } from './colour.mjs';
import { relChroma, fixContrast, describe } from './suggest-palette.mjs';
import { colourName } from './curate.mjs';

// maxRel: most colourfulness for primary/secondary (share of what the hue can show); the accent gets
// +0.2 so the booking button can still stand out. hues: colour names guests expect for this kind of place.
export const PROPERTY_TYPES = {
	none: { label: 'Not set' },
	luxury: { label: 'Luxury hotel', maxRel: 0.55, bg: 'offwhite', hues: null,
		guidance: 'Deep, muted colours and warm off-whites read as calm and expensive. Keep the one bright colour for the booking button, and let photography do the rest.' },
	boutique: { label: 'Boutique hotel', maxRel: 0.7, bg: 'tinted', hues: null,
		guidance: 'One distinctive signature colour, used with confidence, on quiet tinted neutrals. Personality comes from the signature colour and the photography, not from many colours.' },
	resort: { label: 'Beach / holiday resort', maxRel: 0.85, bg: 'offwhite', hues: ['cyan', 'blue', 'green', 'orange', 'yellow'],
		guidance: 'Sunny and relaxed: sandy off-whites, sea or palm colours, and a bright warm accent for booking.' },
	waterfront: { label: 'Waterfront / coastal', maxRel: 0.75, bg: 'tinted', hues: ['blue', 'cyan'],
		guidance: 'Blues, teals and sand. A warm accent (coral, sun-orange) stands out against the water colours, which makes it ideal for the booking button.' },
	business: { label: 'Business / city hotel', maxRel: 0.6, bg: 'white', hues: ['blue', 'grey', 'black'],
		guidance: 'Clean and efficient: crisp white, cool greys and one confident brand colour. Guests are booking quickly, so the booking button must be obvious.' },
	eco: { label: 'Eco-lodge / nature retreat', maxRel: 0.5, bg: 'offwhite', hues: ['green', 'brown'],
		guidance: 'Earthy and muted: greens, browns and stone on natural off-whites. Avoid neon or very saturated colours, which read as artificial.' },
	heritage: { label: 'Heritage / historic', maxRel: 0.5, bg: 'offwhite', hues: ['red', 'green', 'blue', 'brown'],
		guidance: 'Deep traditional colours (burgundy, forest, navy) on cream. Gold or brass tones work as accents.' },
};

// Original hotel palettes for inspiration: [type, name, primary, background, surface, text, accent].
const HOTEL_PALETTES = [
	['luxury', 'Champagne Noir', '#2b2724', '#f7f3ec', '#efe8dc', '#1f1b18', '#b08d57'],
	['luxury', 'Midnight Velvet', '#1f2a44', '#f6f4f0', '#ebe6dd', '#161a24', '#a8834a'],
	['boutique', 'Terracotta Studio', '#a4553a', '#faf6f1', '#f1e8df', '#2a211d', '#2f5d62'],
	['boutique', 'Ink & Blush', '#23303f', '#fbf7f5', '#f3e7e2', '#1b222c', '#d98c84'],
	['resort', 'Sand & Surf', '#0e7c86', '#fbf6ec', '#f3e9d6', '#1f2a2e', '#f28c5a'],
	['resort', 'Palm Shade', '#2f6b4f', '#fdf8ef', '#f2ead9', '#1e2622', '#f2b84b'],
	['waterfront', 'Harbour Blue', '#1d4e6b', '#f7f9f9', '#e8eef0', '#14232b', '#e07a5f'],
	['waterfront', 'Tidal Teal', '#13707a', '#f8f6f1', '#ece6da', '#16272a', '#f0a35e'],
	['business', 'City Slate', '#2c3e50', '#ffffff', '#f3f5f7', '#1b2631', '#e67e22'],
	['business', 'Executive Navy', '#1e3a5f', '#ffffff', '#f2f4f7', '#121a26', '#2e8b57'],
	['eco', 'Forest Floor', '#3f5e3a', '#f6f3ec', '#ebe5d8', '#232a20', '#b5763c'],
	['eco', 'Moss & Stone', '#5b6b4e', '#f5f4ef', '#e7e5dc', '#24261f', '#8c5a3c'],
	['heritage', 'Burgundy Library', '#6b1e2e', '#f8f3ea', '#efe6d6', '#231a1a', '#b08d57'],
	['heritage', 'Old Navy', '#1f2f4a', '#f7f2e7', '#ece3d1', '#171c26', '#8a3b2e'],
].map(([type, name, primary, background, surface, text, accent]) => ({ type, mood: PROPERTY_TYPES[type].label, name, colours: { primary, background, surface, text, extra: accent } }));

// Lowers a main colour's colourfulness to the property's ceiling, then re-checks contrast.
function retune(c, cap, label) {
	const [L, C, H] = hexToOklch(c.hex);
	const rel = relChroma(L, C, H);
	if (rel <= cap + 0.02) return c;
	const changes = [...c.changes, `Colourfulness ${Math.round(rel * 100)}% -> ${Math.round(cap * 100)}% of the maximum, for a ${label.toLowerCase()} feel. Hue kept, so it's still the brand colour.`];
	const newL = fixContrast(L, cap, H, changes);
	const hex = oklchToHex(newL, cap * maxChroma(newL, H), H);
	return { ...c, ...describe(hex, c.role), harmony: c.harmony, original: c.original ?? c.hex, merged: c.merged, changes };
}

// Applies a property type to suggest-palette's output.
// retune false: the colours were chosen by a person (property tuning was offered as a recommendation instead).
export function applyProperty(suggestion, type, { retune: tune = true } = {}) {
	const p = PROPERTY_TYPES[type];
	if (!p || type === 'none') return { suggestion, hotel: null };
	const notes = [];
	const palette = suggestion.palette.map((c) => {
		if (!tune || c.role === 'dark' || c.role === 'light') return c;
		return retune(c, c.role === 'accent' ? Math.min(1, p.maxRel + 0.2) : p.maxRel, p.label);
	});
	const tuned = palette.filter((c, i) => c !== suggestion.palette[i]).length;
	if (tuned) notes.push(`${tuned} colour(s) made calmer to suit a ${p.label.toLowerCase()}; hues are unchanged.`);

	const names = palette.slice(0, 3).map((c) => colourName(c.hex));
	if (p.hues && !names.some((n) => p.hues.includes(n))) {
		notes.push(`Guests usually expect ${p.hues.join(', ')} for a ${p.label.toLowerCase()}, and none of the main colours are in that family. That can be a deliberate way to stand out; if not, see the hotel palettes below.`);
	}

	// Closest hotel palettes: same property type first, then similar primary colour.
	const primary = palette[0].hex;
	const curated = HOTEL_PALETTES
		.map((h) => ({ ...h, score: deltaEOK(primary, h.colours.primary) + (h.type === type ? 0 : 0.25) }))
		.sort((a, b) => a.score - b.score).slice(0, 3).map(({ score, type: t, ...h }) => h);

	return {
		suggestion: { ...suggestion, palette },
		hotel: { type, label: p.label, guidance: p.guidance, background: p.bg, notes, curated },
	};
}
