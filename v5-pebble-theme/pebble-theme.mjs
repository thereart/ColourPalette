// Theme-aware Pebble export. Reads the site's real _variables.scss and searches the theme's styles,
// so the export says what each variable is now, what changes, what's new, what follows by itself,
// where each variable is used, and what else that change will affect.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, basename, relative, sep } from 'node:path';
import { parseColour, hexToRgb, contrast, deltaEOK } from './colour.mjs';

const VARIABLES_PATH = ['assets', 'src', 'sass', 'base', '_variables.scss'];
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'vendor', 'languages']);
const SCAN_EXT = /\.(scss|php|js)$/;

// Accepts the theme folder, the WordPress site folder, or the _variables.scss file itself.
export function locateTheme(input) {
	const p = (input || '').trim().replace(/^"|"$/g, '');
	if (!p) return null;
	const tries = p.endsWith('.scss')
		? [p]
		: [join(p, ...VARIABLES_PATH), join(p, 'wp-content', 'themes', 'pebbledesign', ...VARIABLES_PATH)];
	const file = tries.find((f) => existsSync(f) && statSync(f).isFile());
	if (!file) return null;
	// The theme root is four folders up from assets/src/sass/base/_variables.scss.
	const root = file.split(sep).join('/').endsWith(VARIABLES_PATH.join('/')) ? dirname(dirname(dirname(dirname(dirname(file))))) : dirname(file);
	return { file, root };
}

// Every "--name: value;" with its line, whether it's in a plain :root block, and the section comment above it.
export function parseVariables(text) {
	const lines = text.split(/\r?\n/);
	const vars = {};
	let selector = null, section = null, depth = 0, brandBlockEnd = null, inBrand = false;
	lines.forEach((line, i) => {
		const open = line.match(/^\s*([^{}]+?)\s*\{\s*$/);
		if (open && depth === 0) { selector = open[1].trim(); section = null; }
		const comment = line.match(/^\s*\/\/\s*(.+?)\s*$/);
		if (comment && depth > 0) section = comment[1];
		const decl = line.match(/^\s*--([\w-]+)\s*:\s*([^;]+);/);
		if (decl && !(decl[1] in vars && vars[decl[1]].root)) {
			vars[decl[1]] = { name: decl[1], value: decl[2].trim(), line: i, root: selector === ':root', selector, section };
			if (decl[1] === 'color-primary' && selector === ':root') inBrand = true;
		}
		depth += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
		if (depth === 0 && inBrand && brandBlockEnd === null && /\}/.test(line)) brandBlockEnd = i;
	});
	return { lines, vars, brandBlockEnd, eol: text.includes('\r\n') ? '\r\n' : '\n' };
}

const triplet = (v) => v.match(/^\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*$/);
const refOf = (v) => v.match(/^var\(\s*--([\w-]+)\s*\)$/)?.[1] ?? null;

// The colour a variable ends up as (following var() references), or null if it isn't a colour.
export function resolveColour(vars, name, seen = new Set()) {
	const v = vars[name];
	if (!v || seen.has(name)) return null;
	seen.add(name);
	const ref = refOf(v.value);
	if (ref) return resolveColour(vars, ref, seen);
	const t = triplet(v.value);
	if (t) return '#' + t.slice(1, 4).map((n) => (+n).toString(16).padStart(2, '0')).join('');
	return parseColour(v.value)?.hex ?? null;
}

// Where each variable is used: var(--name) in the theme's .scss, .php and .js (compiled output and vendor code skipped).
const usageCache = new Map(); // root -> { at, usage, blocks }
export function scanUsage(root) {
	const cached = usageCache.get(root);
	if (cached && Date.now() - cached.at < 30000) return cached;
	const usage = {}, blocks = [];
	const walk = (dir) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const name = entry.name, full = join(dir, name);
			if (entry.isDirectory()) { if (!SKIP_DIRS.has(name) && !name.startsWith('.')) walk(full); continue; }
			if (!SCAN_EXT.test(name) || name === '_variables.scss') continue;
			const content = readFileSync(full, 'utf8');
			if (content.length > 2e6) continue; // bundled or generated code
			const lines = content.split(/\r?\n/);
			const file = relative(root, full).split(sep).join('/');
			let selector = '';
			let block = null;
			lines.forEach((line, i) => {
				const open = line.match(/^\s*([^{};]+?)\s*\{\s*$/);
				if (open) { selector = open[1].trim(); block = { file, line: i + 1, selector, color: [], background: [] }; blocks.push(block); }
				for (const m of line.matchAll(/var\(\s*--([\w-]+)/g)) {
					const base = m[1].replace(/-rgb$/, '');
					(usage[base] ??= []).push({ file, line: i + 1, selector, text: line.trim().slice(0, 140) });
					if (block) {
						if (/^\s*color\s*:/.test(line)) block.color.push(base);
						if (/^\s*background(-color)?\s*:/.test(line)) block.background.push(base);
					}
				}
			});
		}
	};
	walk(root);
	const result = { at: Date.now(), usage, blocks: blocks.filter((b) => b.color.length && b.background.length) };
	usageCache.set(root, result);
	return result;
}

// Palette roles -> Pebble variables. `optional` ones need a setting; `new` ones are only for themes without them.
function proposals(design, system, opts) {
	const r = Object.fromEntries(design.roles.map((x) => [x.key, x.hex]));
	const sem = (name) => system.semantic[name].steps.find((x) => x.step === 500).hex;
	return [
		['color-primary', r.primary, 'Primary brand colour'],
		['color-secondary', r.secondary, 'Secondary brand colour'],
		['color-accent', r.accent, 'Accent: Book now buttons and highlights', '.button--book { background-color: var(--color-accent); }'],
		['color-tertiary', r['text-primary'], 'Dark brand colour: headings and dark panels'],
		['grey-darker', r['text-primary'], 'Dark text and panels (Base points tertiary, dark text and dark backgrounds at it)'],
		['color-bg', r.surface, 'Section backgrounds'],
		['color-bg-light', r.background, 'Light backgrounds'],
		['color-bg-dark', r['text-primary'], 'Dark section backgrounds'],
		['color-bg-divider', r.border, 'Dividers'],
		['color-required', sem('error'), 'Required-field marks'],
		['color-error', sem('error'), 'Error messages'],
		['color-warning', sem('warning'), 'Warnings'],
		['color-success', sem('success'), 'Success messages'],
		...(opts.text ? [
			['color-text', r['text-secondary'], 'Body text'],
			['color-text-light', r['text-muted'], 'Light text: captions'],
			['color-text-dark', r['text-primary'], 'Dark text: headings'],
		] : []),
		...(opts.newVars ? [
			...(system.extras ?? []).map((hex, i) => [`color-extra-${i + 1}`, hex, `Extra brand colour ${i + 1}`, `.tag, .badge, illustrations: background: var(--color-extra-${i + 1});`, true]),
			...(system.light['focus-ring'] ? [['color-focus', system.light['focus-ring'], 'Keyboard focus ring', ':focus-visible { outline: 3px solid var(--color-focus); outline-offset: 2px; }', true]] : []),
			...(system.photo ? [['color-overlay', system.photo.tokens['overlay-scrim'], 'Darkens photos under text', '.hero::after { background: var(--color-overlay); }', true]] : []),
		] : []),
	].map(([name, value, role, suggestion, isNew]) => ({ name, value, role, suggestion, isNew }));
}

const NEUTRAL_NAMES = /^(black|white|grey(-light|-lighter|-dark)?)$/;

export function planThemeExport({ text, file, root, usage, blocks }, design, system, opts = {}) {
	const { lines, vars, brandBlockEnd, eol } = parseVariables(text);
	const props = proposals(design, system, opts);
	const planned = Object.fromEntries(props.map((p) => [p.name, p]));
	const current = (name) => resolveColour(vars, name);
	const uses = (name) => usage[name] ?? [];
	const rows = [];

	for (const p of props) {
		const v = vars[p.name];
		const row = { name: p.name, role: p.role, proposed: p.value, uses: uses(p.name).length, where: uses(p.name).slice(0, 6), suggestion: p.suggestion };
		if (!v || !v.root) {
			// Missing: added only if the styles already use it, or new variables were asked for. Otherwise it would do nothing.
			if (row.uses) rows.push({ ...row, status: 'new', current: null, raw: null, note: `Missing from the file, but the theme's styles use it ${row.uses} times.` });
			else if (p.isNew) rows.push({ ...row, status: 'new', current: null, raw: null, note: `Not in this theme yet, and nothing uses it, so it does nothing until a style does, e.g. ${p.suggestion}` });
			else rows.push({ ...row, status: 'skipped', current: null, raw: null, note: `Not in this theme, and no style uses it, so it's left out. To use it, add it and a style such as ${p.suggestion ?? `color: var(--${p.name})`}.` });
			continue;
		}
		const ref = refOf(v.value);
		const now = current(p.name);
		row.current = now; row.raw = v.value; row.line = v.line + 1;
		// A reference to another planned variable updates by itself, keeping the theme's link.
		const sameColour = (a, b) => (a.startsWith('#') && b.startsWith('#') ? deltaEOK(a, b) < 0.005 : a === b);
		if (ref && planned[ref] && sameColour(planned[ref].value, p.value)) {
			rows.push({ ...row, status: 'follows', note: `Points at --${ref}, so it follows that change by itself.` });
		} else if (now && p.value.startsWith('#') && deltaEOK(now, p.value) < 0.005) {
			rows.push({ ...row, status: 'same' });
		} else {
			rows.push({ ...row, status: 'change', note: ref ? `Was a pointer to --${ref}; becomes a colour of its own.` : null });
		}
	}

	// Copies: other colour variables typed as the same value as a planned variable's old colour (e.g. a heading colour
	// set to the old primary's hex) get the new value too. Plain neutrals (white, black, greys) are left alone.
	for (const v of Object.values(vars)) {
		if (!v.root || planned[v.name] || NEUTRAL_NAMES.test(v.name) || v.name.endsWith('-rgb') || refOf(v.value) || triplet(v.value)) continue;
		const now = current(v.name);
		if (!now) continue;
		const source = rows.find((r) => r.status === 'change' && r.current && deltaEOK(r.current, now) < 0.004);
		if (source) rows.push({ name: v.name, role: `Copy of --${source.name}`, status: 'change', current: now, raw: v.value, line: v.line + 1, proposed: source.proposed, uses: uses(v.name).length, where: uses(v.name).slice(0, 6), note: `Typed as the old --${source.name} colour (${source.current}), so it moves with it.` });
	}

	// Pointers to changed variables that aren't planned themselves (e.g. --color-text-h2: var(--color-primary)) follow by themselves.
	const changedNames = new Set(rows.filter((r) => r.status === 'change').map((r) => r.name));
	const followers = Object.values(vars).filter((v) => v.root && !planned[v.name] && !v.name.endsWith('-rgb') && changedNames.has(refOf(v.value)));

	// The new colour of every variable, to re-check text/background pairs the theme's styles use together.
	const newValue = (name, seen = new Set()) => {
		if (seen.has(name)) return null;
		seen.add(name);
		const row = rows.find((r) => r.name === name && (r.status === 'change' || r.status === 'new'));
		if (row && row.proposed.startsWith('#')) return row.proposed;
		const ref = vars[name] && refOf(vars[name].value);
		return ref ? newValue(ref, seen) : current(name);
	};

	const warnings = [];
	for (const r of rows.filter((r) => r.status === 'change' && r.current && r.uses)) {
		const shift = deltaEOK(r.current, r.proposed);
		if (shift < 0.008) continue;
		// Form fields and the footer subscribe box are where even a slight background shift shows (white inputs turning cream).
		const isForm = (w) => /form|input|subscribe|wpcf7|select|textarea|search/i.test(`${w.file} ${w.selector} ${w.text}`);
		const all = [...(usage[r.name] ?? [])].sort((a, b) => isForm(b) - isForm(a));
		const forms = all.filter(isForm);
		const places = [...new Set(all.map((w) => `${w.file}${w.selector ? ` (${w.selector})` : ''}`))].slice(0, 4).join('; ');
		const size = shift > 0.15 ? 'a big change' : shift < 0.04 ? 'slight, but visible next to white' : 'a clear change';
		warnings.push({ name: r.name, text: `--${r.name} changes from ${r.current} to ${r.proposed} (${size}) and is used ${r.uses} time${r.uses === 1 ? '' : 's'}: ${places}${all.length > 4 ? ' and more' : ''}.${forms.length ? ` That includes ${forms.length} form or input style${forms.length === 1 ? '' : 's'}, e.g. ${forms[0].file} (${forms[0].selector}).` : ''}` });
	}
	for (const b of blocks) {
		const touched = [...b.color, ...b.background].some((n) => changedNames.has(n) || followers.some((f) => f.name === n));
		if (!touched) continue;
		const fg = newValue(b.color[0]), bg = newValue(b.background[0]);
		const oldFg = current(b.color[0]), oldBg = current(b.background[0]);
		if (!fg || !bg || !fg.startsWith('#') || !bg.startsWith('#') || contrast(fg, bg) >= 4.5) continue;
		const now = oldFg && oldBg ? contrast(oldFg, oldBg) : null;
		const cause = now === null ? '' : now >= 4.5 ? ` This change causes it (it's ${now.toFixed(2)}:1 now).` : ` It's already under today (${now.toFixed(2)}:1), so this isn't new${contrast(fg, bg) < now - 0.05 ? ', but the change makes it worse' : ''}.`;
		warnings.push({ name: b.color[0], kind: now !== null && now < 4.5 ? 'existing' : 'new', text: `Contrast: in ${b.file}:${b.line} (${b.selector}), text --${b.color[0]} on --${b.background[0]} would be ${contrast(fg, bg).toFixed(2)}:1, under the 4.5:1 minimum.${cause}` });
	}
	for (const r of rows.filter((r) => r.status !== 'new' && !r.uses && r.status !== 'follows')) {
		r.note = [r.note, "Nothing in this theme's styles uses it, so this has no visible effect yet."].filter(Boolean).join(' ');
	}

	// The updated file: values changed in place (comments and order kept), -rgb twins updated, new ones added to the brand block.
	const out = [...lines];
	const diff = [];
	const setValue = (i, name, value) => {
		const before = out[i];
		out[i] = out[i].replace(new RegExp(`(--${name}\\s*:\\s*)([^;]+)(;)`), `$1${value}$3`);
		if (out[i] !== before) diff.push({ line: i + 1, before, after: out[i] });
	};
	for (const r of rows.filter((r) => r.status === 'change')) {
		setValue(r.line - 1, r.name, r.proposed);
		const twin = vars[`${r.name}-rgb`];
		if (twin?.root && triplet(twin.value) && r.proposed.startsWith('#')) setValue(twin.line, `${r.name}-rgb`, hexToRgb(r.proposed).join(', '));
	}
	// Reference list at the top of the file ("- #5b9d93 Primary").
	const refList = { Primary: 'color-primary', Secondary: 'color-secondary', Tertiary: 'color-tertiary', 'BG Colour': 'color-bg' };
	out.forEach((line, i) => {
		const m = line.match(/^(\s*-\s*)#[0-9a-f]{3,8}(\s+)(Primary|Secondary|Tertiary|BG Colour)\s*$/i);
		const hex = m && newValue(refList[m[3]]);
		if (hex?.startsWith('#') && !line.includes(hex)) { const before = out[i]; out[i] = `${m[1]}${hex}${m[2]}${m[3]}`; diff.push({ line: i + 1, before, after: out[i] }); }
	});
	const added = rows.filter((r) => r.status === 'new');
	if (added.length && brandBlockEnd !== null) {
		const insert = ['', '\t// Added by Colour Palette', ...added.flatMap((r) => [`\t--${r.name}: ${r.proposed};`, ...(r.proposed.startsWith('#') ? [`\t--${r.name}-rgb: ${hexToRgb(r.proposed).join(', ')};`] : [])])];
		out.splice(brandBlockEnd, 0, ...insert);
		insert.forEach((after, k) => after && diff.push({ line: brandBlockEnd + 1 + k, before: null, after }));
	}

	const count = (s) => rows.filter((r) => r.status === s).length;
	const changeList = [
		`// Pebble theme changes for ${relative(root, file).split(sep).join('/') || basename(file)}`,
		'// change = set this value, new = add it, same = already right, follows = updates by itself, skipped = not used here',
		...rows.filter((r) => r.status !== 'skipped').map((r) => `--${r.name}: ${r.status === 'follows' ? r.raw : r.proposed};${' '.repeat(Math.max(1, 34 - r.name.length - (r.status === 'follows' ? r.raw : r.proposed).length))}// ${r.status}${r.current && r.status === 'change' ? ` (was ${r.current})` : ''}${r.uses ? `, used ${r.uses}x` : ', not used by any style'}`),
		...rows.filter((r) => r.status === 'skipped').map((r) => `// skipped --${r.name}: ${r.proposed} (not in this theme, and no style uses it)`),
		...followers.map((f) => `--${f.name}: ${f.value};${' '.repeat(Math.max(1, 34 - f.name.length - f.value.length))}// follows --${refOf(f.value)}, no edit needed`),
	].join('\n');

	return {
		file, root, rows, followers: followers.map((f) => ({ name: f.name, value: f.value, uses: uses(f.name).length })),
		warnings, diff: diff.sort((a, b) => a.line - b.line), updatedFile: out.join(eol), changeList,
		summary: { change: count('change'), new: count('new'), same: count('same'), follows: count('follows') + followers.length, skipped: count('skipped') },
	};
}
