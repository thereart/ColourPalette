// Extra exports: Pebble theme variables, email-safe HEX, booking engine fields, approximate print values.

import { hexToRgb, contrast } from './colour.mjs';

const rgb = (hex) => hexToRgb(hex).join(', ');
const pad = (s, n) => s + ' '.repeat(Math.max(1, n - s.length));

// Matches wp-content/themes/pebbledesign/assets/src/sass/base/_variables.scss (VARIABLES (Brand Colours)).
export function pebbleExport(design, system) {
	const r = Object.fromEntries(design.roles.map((x) => [x.key, x.hex]));
	const sem = (name) => system.semantic[name].steps.find((x) => x.step === 500).hex;
	const v = (name, hex) => [`\t--${name}: ${hex};`, `\t--${name}-rgb: ${rgb(hex)};`];
	return [
		'// Pebble theme: paste into assets/src/sass/base/_variables.scss, inside :root under VARIABLES (Brand Colours),',
		'// replacing the matching lines. Then run npm run build. Also update the reference list at the top of the file.',
		'//',
		`//   - ${r.primary} Primary`,
		`//   - ${r.secondary} Secondary`,
		`//   - ${r['text-primary']} Tertiary`,
		`//   - ${r.surface} BG Colour`,
		'',
		'\t// Primary Colours',
		...v('color-primary', r.primary),
		'',
		'\t// Secondary Colours',
		...v('color-secondary', r.secondary),
		'',
		'\t// Tertiary Colours',
		...v('color-tertiary', r['text-primary']),
		'',
		'\t// Accent Colours (new: the theme has no accent variable yet; use it for Book now buttons)',
		...v('color-accent', r.accent),
		...(system.extras ?? []).flatMap((hex, i) => ['', `\t// Extra brand colour ${i + 1} (new)`, ...v(`color-extra-${i + 1}`, hex)]),
		'',
		'\t// Text Colours: left out on purpose. The theme\'s --color-text (#999999) is staying as it is for now.',
		'\t// It is about 2.8:1 on white, under the 4.5:1 WCAG AA minimum. When you\'re ready to change it, uncomment these:',
		...v('color-text', r['text-secondary']).map((l) => `\t// ${l.trim()}`),
		...v('color-text-light', r['text-muted']).map((l) => `\t// ${l.trim()}`),
		...v('color-text-dark', r['text-primary']).map((l) => `\t// ${l.trim()}`),
		'',
		'\t// Backgrounds Colours',
		...v('color-bg', r.surface),
		...v('color-bg-light', r.background),
		...v('color-bg-dark', r['text-primary']),
		`\t--color-bg-divider: ${r.border};`,
		'',
		'\t// Error Colours',
		`\t--color-required: ${sem('error')};`,
		`\t--color-warning: ${sem('warning')};`,
		`\t--color-success: ${sem('success')};`,
		`\t--color-error: ${sem('error')};`,
		...(system.light['focus-ring'] ? ['', '\t// Focus ring (new)', `\t--color-focus: ${system.light['focus-ring']};`] : []),
		...(system.photo ? ['', '\t// Photo overlay (new)', `\t--color-overlay: ${system.photo.tokens['overlay-scrim']};`] : []),
	].join('\n');
}

// Email programs ignore CSS variables and OKLCH, so emails need plain HEX written into each element.
export function emailExport(design) {
	const r = Object.fromEntries(design.roles.map((x) => [x.key, x.hex]));
	const p = (role) => design.palette.find((c) => c.role === role);
	const rows = [
		['Email background', r.surface], ['Content background', r.background], ['Headings', r['text-primary']],
		['Body text', r['text-secondary']], ['Small print', r['text-muted']], ['Links', r.link],
		['Button', r.accent], ['Button text', p('accent').textColour], ['Divider lines', r.border],
	];
	return [
		'EMAIL COLOURS (plain HEX: email programs don\'t support CSS variables or OKLCH)',
		'',
		...rows.map(([label, hex]) => `${pad(label, 22)}${hex.toUpperCase()}`),
		'',
		'Book now button for an email template (inline styles, works in Outlook and Gmail):',
		`<a href="https://example.com/book" style="display:inline-block;background-color:${r.accent};color:${p('accent').textColour};padding:14px 28px;border-radius:6px;font-family:Arial,sans-serif;font-weight:bold;text-decoration:none;">Book now</a>`,
		'',
		`Body text on content background: ${contrast(r['text-secondary'], r.background).toFixed(2)}:1. Button text on button: ${contrast(p('accent').textColour, r.accent).toFixed(2)}:1.`,
	].join('\n');
}

// Booking engines (Guesty, SiteMinder, Cloudbeds and others) let you set only a few colours; field names vary.
export function bookingExport(design, system) {
	const r = Object.fromEntries(design.roles.map((x) => [x.key, x.hex]));
	const p = (role) => design.palette.find((c) => c.role === role);
	const rows = [
		['Main / button colour', r.accent, 'Book now and other main buttons'],
		['Button text', p('accent').textColour, 'Text on those buttons'],
		['Secondary / brand colour', r.primary, 'Headers, selected dates, secondary buttons'],
		['Text on brand colour', p('primary').textColour, 'Text on the brand colour'],
		['Links', r.link, 'Text links'],
		['Page background', r.background, 'Behind the booking widget'],
		['Panel background', r.surface, 'Room cards and summary panels'],
		['Text', r['text-primary'], 'Headings and room names'],
		['Borders', r.border, 'Dividers and input outlines'],
		...(system.light['focus-ring'] ? [['Focus / selected outline', system.light['focus-ring'], 'Keyboard focus and selected inputs']] : []),
	];
	return [
		'BOOKING ENGINE COLOURS',
		'Engines name these fields differently. Match each by what it colours, not by its name.',
		'',
		...rows.map(([label, hex, use]) => `${pad(label, 28)}${hex.toUpperCase()}   ${use}`),
	].join('\n');
}

// shortcut: a plain RGB-to-CMYK formula, no ICC profile. Fine for briefing a printer; always get a printed proof.
export function cmyk(hex) {
	const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
	const k = 1 - Math.max(r, g, b);
	if (k >= 1) return [0, 0, 0, 100];
	return [...[r, g, b].map((v) => Math.round(((1 - v - k) / (1 - k)) * 100)), Math.round(k * 100)];
}

export function printExport(design) {
	const rows = design.palette.map((c) => [c.role, c.hex, cmyk(c.hex)]);
	return [
		'PRINT AND SIGNAGE COLOURS (approximate)',
		'These CMYK values are a starting point only: screens show more vivid colours than ink can,',
		'and each printer\'s paper and press differ. Ask your printer for a proof, or a Pantone match for signage.',
		'',
		...rows.map(([role, hex, [c, m, y, k]]) => `${pad(role, 12)}${hex.toUpperCase()}   C${c} M${m} Y${y} K${k}`),
	].join('\n');
}
