# ColourPalette

Colour palette tool with inbuilt web scraper tool.

It reads a website's colours (leaving out images) and builds a web-ready colour palette and colour system from them. Each version is a small local web app with no build step.

## Run it

Needs [Node.js](https://nodejs.org) (18 or newer). On Windows, double-click `Start.bat` in a version's folder; it opens the app in your browser. Or from a terminal:

```bash
cd v4-web-hotel
npm install
node server.mjs
```

Then open the address it prints. Run the tests with `node test.mjs` in any version's folder.

## Versions

| Folder | Port | What it adds |
|---|---|---|
| `v1-color-expert` | 4321 | Scrapes a site's colours to JSON and suggests a 5-colour palette using OKLCH, character-based harmony, WCAG and APCA contrast. |
| `v2-color-curator` | 4322 | Background styles, full colour roles (background, surface, border, text), contrast checks, shades, colour psychology, curated palettes, Tailwind output. |
| `v3-mcpmarket` | 4323 | Dark mode, an extended 8-12 colour palette with names, colour-blindness simulation, status colours, gradients, 3-layer CSS tokens, a downloadable swatch sheet. |
| `v4-web-hotel` | 4324 | Ranks colours by how much of the page they cover (full-page screenshot, images left out). A choose step to keep, change or generate each brand colour, similar palettes, hotel property types, photo overlay and Book now checks, interaction states, and Pebble theme, email, booking engine and print exports. |
| `v5-pebble-theme` | 4325 | A theme-aware Pebble export: point it at a site's theme folder and it reads that site's own `_variables.scss` and searches its styles. Each variable is marked change, new, same, follows (a pointer that updates by itself) or skipped (not in the theme and unused), with how often it's used. It downloads the whole updated file (order, comments and line endings kept), shows the changed lines, covers dependent colours, and warns about knock-on effects (form fields, contrast pairs, saying whether the change causes a problem or it already exists). |

v4 and v5's page-coverage ranking opens the page in Microsoft Edge or Google Chrome through `playwright-core` (`npm install` adds it; no browser download). Without it, colours are ranked by how often the site's CSS uses them.

## Credits

The colour rules are based on these skills:

- [color-expert](https://github.com/meodai/skill.color-expert) by David Aerne (meodai), CC BY 4.0
- [color-curator](https://github.com/davepoon/buildwithclaude/tree/main/plugins/frontend-design-pro/skills/color-curator) by Dave Poon, MIT. The curated mood palettes in v2-v4 come from its reference file.
- [Color Palette Architect](https://github.com/arnavpuri/designskills) by Arnav Puri, MIT
- [AI Color Palette Designer](https://github.com/alpacalabsllc/skills-for-architects) by Alpaca Labs, MIT
- [UI Color Palettes](https://github.com/svengraziani/ui-design) by Sven Graziani: its shade usage guidelines only (the repo has no licence, so none of its palettes are copied)
- [Color Theory & OKLCH](https://mcpmarket.com/tools/skills/color-theory-design-systems) by Marvin Richter, from its MCP Market description

Also: OKLab/OKLCH by Björn Ottosson, the APCA contrast formula (SAPC 0.0.98G), Machado et al. (2009) colour-blindness simulation, and the Okabe-Ito colour-blind-safe palette.
