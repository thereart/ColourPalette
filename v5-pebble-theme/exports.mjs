// Extra exports: Pebble theme variables, email-safe HEX, booking engine fields, approximate print values.

import { hexToRgb, contrast } from './colour.mjs';

const rgb = (hex) => hexToRgb(hex).join(', ');
const pad = (s, n) => s + ' '.repeat(Math.max(1, n - s.length));

// Without a theme folder the tool can't see the site's file, so this is a plain list of Pebble variable names and
// values with no assumptions about what the site has now. Set the theme folder in Settings for an exact, checked export.
export function pebbleExport(design, system, opts = {}) {
	const r = Object.fromEntries(design.roles.map((x) => [x.key, x.hex]));
	const sem = (name) => system.semantic[name].steps.find((x) => x.step === 500).hex;
	const row = (name, value, note) => {
		const line = `--${name}: ${value};`;
		return [`${pad(line, 40)}// ${note}`, ...(value.startsWith('#') ? [`${pad(`--${name}-rgb: ${rgb(value)};`, 40)}// only if the file has a -rgb line for it`] : [])];
	};
	return [
		'// Pebble theme variables (assets/src/sass/base/_variables.scss)',
		'// The tool hasn\'t read this site\'s file, so for each one: replace its value, or add it if it\'s missing.',
		'// For an exact export (what changes, what\'s new, where each is used), set the theme folder in Settings.',
		'',
		...row('color-primary', r.primary, 'primary brand colour'),
		...row('color-secondary', r.secondary, 'secondary brand colour'),
		...row('color-accent', r.accent, 'accent: Book now buttons (some sites don\'t have this yet)'),
		...row('color-tertiary', r['text-primary'], 'dark brand colour; in Base it points at --grey-darker, so you may only need to change that'),
		...row('grey-darker', r['text-primary'], 'dark text and panels'),
		...row('color-bg', r.surface, 'section backgrounds'),
		...row('color-bg-light', r.background, 'light backgrounds; also used by form inputs and the footer subscribe box'),
		...row('color-bg-dark', r['text-primary'], 'dark section backgrounds'),
		...row('color-bg-divider', r.border, 'dividers'),
		...row('color-error', sem('error'), 'error messages'),
		...row('color-required', sem('error'), 'required-field marks'),
		...row('color-warning', sem('warning'), 'warnings'),
		...row('color-success', sem('success'), 'success messages'),
		...(opts.text ? ['', ...row('color-text', r['text-secondary'], 'body text'), ...row('color-text-light', r['text-muted'], 'captions'), ...row('color-text-dark', r['text-primary'], 'headings')] : []),
		...(opts.newVars ? [
			'',
			'// New variables: no Pebble style uses these yet, so they do nothing until you add them to the styles.',
			...(system.extras ?? []).flatMap((hex, i) => row(`color-extra-${i + 1}`, hex, `use e.g. .tag { background: var(--color-extra-${i + 1}); }`)),
			...(system.light['focus-ring'] ? row('color-focus', system.light['focus-ring'], 'use :focus-visible { outline: 3px solid var(--color-focus); }') : []),
			...(system.photo ? row('color-overlay', system.photo.tokens['overlay-scrim'], 'use .hero::after { background: var(--color-overlay); }') : []),
		] : []),
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
