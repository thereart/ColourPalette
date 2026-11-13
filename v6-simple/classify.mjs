// Labels each colour Brand, Background or Text from how the page uses it, with the reasons.
//  - Brand: colourful, or a neutral the site clearly treats as its own (named --primary/--brand/--accent,
//    or the background of its buttons). A brand colour that fills big areas is "Brand, used as a background".
//  - Background: a neutral (white, off-white, grey, near-black) or very pale tint mostly filling areas.
//  - Text: a neutral used mainly for text.

import { hexToOklch } from './colour.mjs';

const NEUTRAL = 0.035; // OKLCH chroma below this reads as white, grey or black
const BRAND_NAME = /brand|primary|secondary|tertiary|accent|highlight|cta|theme-colou?r/i;
const BG_NAME = /(^--|-)bg(-|$)|background|surface|canvas/i;
const TEXT_NAME = /text|font|heading|ink|copy/i;

const times = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function classify(colour) {
	const [L, C] = hexToOklch(colour.hex);
	const r = { bg: 0, bgLarge: 0, text: 0, border: 0, interactive: 0, interactiveBg: 0, heading: 0, nav: 0, ...colour.roles };
	const names = colour.variables ?? [];
	const brandNames = names.filter((n) => BRAND_NAME.test(n) && !BG_NAME.test(n) && !TEXT_NAME.test(n));
	const bgNames = names.filter((n) => BG_NAME.test(n));
	const neutral = C < NEUTRAL;

	// Large painted areas outweigh counts: text alone can't cover 2% of a page, so that much coverage means backgrounds.
	const fillsAreas = r.bgLarge > 0 || (colour.coverage >= 0.02 && r.bg > 0);
	// Slightly tinted greys and navies (e.g. slate-blue body text) used mainly for text, never as a button background, are text colours.
	const tintedText = C < 0.08 && r.text > r.bg * 2 && !r.interactiveBg && !brandNames.length && !fillsAreas;

	let label;
	if (tintedText) {
		label = 'text';
	} else if (!neutral) {
		// Very pale tints that only fill areas are tinted backgrounds, not brand colours.
		label = L > 0.92 && C < 0.06 && !r.interactive && !r.text && !brandNames.length ? 'background' : 'brand';
	} else if (!bgNames.length && (brandNames.length || (L < 0.3 && r.interactiveBg >= 2 && r.interactiveBg >= r.bg * 0.3))) {
		label = 'brand'; // e.g. a black-and-white brand whose buttons are black (not a grey or a footer that happens to be dark)
	} else {
		label = r.text > r.bg && !bgNames.length && !fillsAreas ? 'text' : 'background';
	}
	const used = r.bg + r.text + r.border;
	const asBackground = label === 'brand' && (r.bgLarge > 0 || (used > 0 && r.bg / used > 0.6));

	const reasons = [
		neutral ? (L > 0.9 ? 'Neutral: white or near-white' : L < 0.25 ? 'Neutral: black or near-black' : 'Neutral: grey') : L > 0.92 && C < 0.06 ? 'A very pale tint' : tintedText ? 'Slightly tinted, used mostly for text' : 'Colourful',
		r.interactive && `On ${times(r.interactive, 'button or link', 'buttons or links')}`,
		r.heading && `In ${times(r.heading, 'heading')}`,
		r.nav && `In the navigation or header ${times(r.nav, 'time')}`,
		r.bgLarge ? `Background of ${times(r.bgLarge, 'large area')}` : r.bg && `Background of ${times(r.bg, 'element')}`,
		r.text && `Text colour ${times(r.text, 'time')}`,
		r.border && `Border colour ${times(r.border, 'time')}`,
		brandNames.length && `Named ${brandNames.slice(0, 2).join(', ')}`,
		bgNames.length && `Named ${bgNames.slice(0, 2).join(', ')}`,
	].filter(Boolean);
	return { label, asBackground, reasons };
}
