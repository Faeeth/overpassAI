# OverpassAI

Query OpenStreetMap by stacking blocks, or by writing Overpass QL. Both views
edit the same query, so you can start with blocks and finish by hand.

The whole thing runs in the browser. No backend, no build-time data, no API
key for anything in the default path.

---

## Why

[overpass-turbo](https://overpass-turbo.eu/) is complete and dependable, and it
assumes you already know Overpass QL. That is a real barrier: the syntax is
unusual, the tag vocabulary is unwritten, and the first query most people want
takes a trip to the wiki.

This keeps what works about it and adds the missing half:

- **A block editor that is not a toy.** Blocks render the parsed query tree
  directly, so anything you can express in Overpass QL survives a round trip.
- **Real two-way sync.** A full OverpassQL parser turns text into blocks, and a
  printer turns blocks back into text. Paste an existing overpass-turbo query
  and it becomes blocks.
- **Tag autocompletion from taginfo**, with live usage counts, in both views.
- **A save format you can reopen**, holding the results *and* the query that
  produced them.

## Getting started

```sh
npm install
npm run dev          # http://127.0.0.1:5173
```

Use `127.0.0.1`, not `localhost`. They are different origins to OpenStreetMap,
and only the former is registered as an OAuth redirect.

```sh
npm run check        # types, lint, unit tests
npm run smoke        # drives a real browser against the dev server
npm run a11y         # axe-core plus keyboard, target size, reflow and zoom checks
npm run usability    # task-based runs, counting the friction in each
npm run test:live    # checks our output against a real Overpass server
npm run build        # static site in dist/
```

## Testing

Seven layers, because they catch different things.

| Layer | Command | What it covers |
| --- | --- | --- |
| Unit and integration | `npm test` | The language, the services, the stores. Offline and deterministic: the Overpass server is a `fetch` stub in `src/services/__tests__/mockOverpass.ts` |
| Browser | `npm run smoke` | The real app in Chromium: block and text views staying in step, drag and drop, the map actually painting, export and reopen |
| Accessibility | `npm run a11y` | axe-core across seven states in both themes, plus keyboard-only operation, target sizes, reflow at 320px and 200% zoom |
| Contrast | `npm run contrast` | Every rendered text element measured against its real background, in both themes and inside the editor |
| Usability | `npm run usability` | Seven task-based runs, each counting the interactions it took against the fewest it could have taken |
| Syntax oracle | `npm run test:live` | Every corpus query compiled and sent to a real Overpass instance |
| Types and lint | `npm run typecheck`, `npm run lint` | |

Four of those files exist because of a specific class of failure rather than a
specific function:

- `robustness.test.ts` throws malformed queries, hostile links, corrupt saved
  files and malformed server responses at everything. Nothing may take the page
  down, because a blank screen is unrecoverable for the user.
- `injection.test.ts` puts hostile content in OSM tag values and checks what
  comes out of the exporters, which leave for spreadsheets and GIS tools that
  do not have React's escaping.
- `performance.test.ts` is a set of budgets, loose enough to survive a busy
  machine and tight enough to fail when something turns quadratic.
- `lines.test.ts` checks that the parser and the printer agree on which source
  line each block sits on, since a disagreement sends a click to the wrong
  place.

`src/core/__tests__/corpus.ts` holds a corpus of real queries that three
different checks run against: parse/print/reparse stability, compilation to
valid Overpass QL, and the live oracle. **When a query is reported as broken,
add it to the corpus.** That is what turns a bug report into a regression test.

### Why the mock is a stub and not a container

The point of these tests is the *shapes* Overpass answers with, and those are
fixed strings: an HTML parse-error page returned with HTTP 200, a JSON body
carrying a `remark`, a 429, a dispatcher timeout. Running the real server would
make the suite slow, non-deterministic and dependent on someone else's uptime,
while testing nothing extra.

### Why the live oracle exists anyway

A hand-written parser is a stand-in for the grammar, and a stand-in can be
wrong in the same direction twice. If the printer emits something invalid and
the parser reads it back happily, every round-trip test passes and the server
still rejects the query. That is not hypothetical: it is exactly how `foreach`
was broken here. The input set belongs *after* the keyword, as
`foreach.w(...)`, and both halves agreed on `.w foreach(...)` until a real
server was asked.

The oracle is not part of `npm test`: it needs the network and it is
deliberately slow. Do not lower its request interval — running the corpus at
2.5 second spacing was enough to get blocked by overpass-api.de for over ten
minutes. If the main instance refuses you:

```sh
OVERPASS_ENDPOINT=https://overpass.osm.ch/api/interpreter npm run test:live
```

### What the usability runs are for

`npm run usability` is not a set of assertions about markup. It is a simulated
person trying to get something done, with the cost counted: interactions, time,
whether it succeeded, and every dead end on the way. Each task declares a
*floor* — the fewest interactions it could take if the interface were perfect —
and the gap between the two is where the design is in the way.

It has already earned its keep twice. It found a menu that closed in the same
frame it opened, because clicking a trigger near the edge of a scrolling panel
makes the browser scroll it into view and that fired the handler meant to close
the menu when the page moves. And it found a keyboard trap: `indentWithTab` in
CodeMirror swallows Tab, so focus went into the text editor and never came out.
Neither is visible to axe-core, a type checker or a unit test.

### Pointing the browser test somewhere else

`npm run smoke` drives the dev server at `127.0.0.1:5173` by default. Three
variables move it:

```sh
SMOKE_BASE=http://127.0.0.1:4173/overpassAI/ \
SMOKE_ENDPOINT=https://overpass.osm.ch/api/interpreter \
SMOKE_VIEW=47.3769,8.5417,15 \
npm run smoke
```

`SMOKE_VIEW` has to follow `SMOKE_ENDPOINT`: a regional instance has no data
outside its own area, and a query that legitimately returns nothing proves
nothing. The script says so rather than passing quietly.

## How it fits together

```
      text  ──parse──▶  AST  ──print──▶  text
                         │
              blocks ◀───┴───▶ blocks        (blocks render the AST directly)
                         │
                     compile                 ({{bbox}} and {{geocodeArea:…}}
                         │                    resolved against the map and
                         ▼                    Nominatim)
                   Overpass API
                         │
                         ▼
            GeoJSON ──▶ map, table, exports
```

| Area | What lives there |
| --- | --- |
| `src/core` | The query language: `ast.ts`, `parser.ts`, `printer.ts`, `compile.ts`, `mutate.ts` |
| `src/services` | Overpass, Nominatim, taginfo, OSM sign-in, OSM JSON to GeoJSON |
| `src/features` | Permalinks, the local library, presets, exporters |
| `src/components` | Blocks, text editor, map, results, toolbar |
| `src/store` | Query, results and interface state |

Two design decisions carry most of the weight:

**The AST is the single source of truth.** Blocks are not a separate model that
has to be kept in step with the text; they are a rendering of the tree. The
text view is `print(ast)` and a text edit is `parse(source)`.

**The parser never drops anything.** Every statement and filter is attempted
with backtracking, and whatever cannot be modelled is preserved verbatim in a
`raw` node and shown as an "Advanced" block. That is what makes switching
between views safe for queries the block editor has no UI for.

That permissiveness leaves a gap, which `src/core/validate.ts` closes. A
freshly added filter has empty fields and prints as `node[""]` or `node(id:)`,
and without a check the first thing you would hear about it is a parse error
from a server in Germany, about a line in a query you never wrote. So the tree
is validated before every send and continuously against the blocks: errors
name the block and refuse the run, warnings (an unbounded query, an empty tag
value) explain themselves and let it through. The result is computed once per
change and kept in the query store; doing it inside each block looked harmless
and meant walking the whole tree once per block on every render.

Both halves also report which source line each block sits on, which is what
lets the two views point at each other: a problem in the text names its block,
and a block can reveal itself in the text.

## Services and keys

| Service | What for | Key needed |
| --- | --- | --- |
| Overpass API | Running queries | No |
| Nominatim | Turning a place name into an area | No |
| taginfo | Tag key and value autocompletion | No |
| Basemaps | Map background | No |
| OpenStreetMap OAuth | Optional sign-in | A public client id |

Overpass sends `Access-Control-Allow-Origin: *`, so the browser talks to it
directly. Nominatim caps clients at one request per second, which the client
enforces with a serial queue and a session cache.

### Basemaps

CARTO's basemaps are deliberately absent: they now stamp "API KEY REQUIRED"
across keyless tiles. The four on offer are the Esri light and dark grey
canvases, the standard OSM rendering, and Esri satellite imagery.

The default is a grey canvas rather than full-colour OSM, for the same reason
the results are drawn in magenta: a basemap here is context, not content. That
magenta is the one hydrographers use on nautical charts, chosen because it
stays legible over every other colour a chart carries, which is exactly the
problem a result layer has over beige buildings, green landuse and blue water.

### Optional OpenStreetMap sign-in

Nothing requires an account. Signing in adds your name, saving queries to your
OSM preferences, and filing a note from a result. See [`.env.example`](.env.example)
for how to register an application; copy it to `.env.local` with your client id.

The client is public, uses OAuth 2.0 with PKCE, and has no secret. The
code-for-token exchange runs in the browser against an endpoint that allows
CORS, which is what lets the app stay static.

## Sharing and saving

**Permalink** (the share button) puts the *query* in the URL, deflated and
base64url encoded. Never the results: the link stays short, the recipient gets
fresh data, and nothing from your session leaves the browser.

**Project file** (`.overpassai.json`) holds the query, the parsed tree, the map
position and the results. Reopening it restores all of them without touching
the network, so you can review an old answer and adjust the question that
produced it. Drop one anywhere on the window to open it.

**Library** keeps queries in `localStorage`. That is this browser only: it does
not sync, and clearing site data erases it. Export the library to a file for a
copy that lasts.

## Deploying

The build is a static `dist/`. The included workflow publishes to GitHub Pages
on every push to `main`.

`vite.config.ts` sets `base` to `/overpassAI/` for builds and `/` for the dev
server, so the two registered OAuth redirect URIs both resolve from
`import.meta.env.BASE_URL`. Deploying somewhere that serves from the root, such
as Netlify or Cloudflare Pages, means building with `BASE_PATH=/`.

To enable sign-in on the deployed site, add a repository variable named
`VITE_OSM_CLIENT_ID` under *Settings → Secrets and variables → Actions →
Variables*.

### The MapLibre worker

Worth knowing before it bites you: MapLibre builds its worker URL at run time,
so no bundler can rewrite it. Left alone, the build emits no worker, the
basemap keeps drawing because raster tiles are decoded on the main thread, and
every GeoJSON layer silently renders nothing. A plugin in `vite.config.ts`
emits the worker as an asset and `src/services/mapWorker.ts` points MapLibre at
it. `npm run smoke` asserts that features are actually painted, because the
failure is invisible from the outside.

## Licence

The code is MIT. The data is OpenStreetMap's, under the
[ODbL](https://opendatacommons.org/licenses/odbl/): attribute it, and share
derived databases under the same terms. Exports carry the attribution.

## Performance notes

Three decisions carry most of it, and each is guarded by a test.

**The query language is cheap.** Parsing, printing and validating a
500-statement query costs a few milliseconds each, so the block editor can
revalidate on every keystroke without any incremental invalidation machinery.
The one thing that was not cheap was `lineCol`, which rescanned the source from
the top on each call and made parsing quadratic in the number of statements; it
now binary-searches a line index built once.

**Validation runs once per change**, in the query store, rather than once per
block at render time.

**CodeMirror is loaded on demand.** It is 115 kB gzipped and the app opens on
the block view, so most first loads never need it. It is fetched when the text
tab is opened and prefetched on hover, which takes the first load from 531 kB
to 414 kB gzipped.

MapLibre is the remaining bulk at 279 kB gzipped and is not deferred: the map is
the primary view. Leaflet would be a tenth of the size and would not hold up
under the 50 000-point results these queries produce.

Result conversion handles 50 000 nodes in about 20 ms, and a 2 000-fragment
multipolygon boundary in about the same. The parser caps statement nesting at
64 levels: recursive descent recurses once per level, and without a limit a
pasted `((((((…` overflows the stack and takes the page with it.

## Accessibility

Target: WCAG 2.2 Level AA. `npm run a11y` reports no axe-core violations in any
of the seven states it checks, in both themes, and `npm run contrast` finds no
text below 4.5:1 anywhere, including the syntax colours in the editor.

Getting there changed some design decisions rather than just some values:

- **The accent has two forms.** The chart magenta is tuned to be seen over a
  map, which leaves white text on it at 3.32:1. Filled controls use a darker
  `--accent-surface`, so the Run button's label passes while the result layer
  keeps the colour it needs.
- **The block role colours are text as well as edges.** Three of them were
  nudged darker in the light theme so the block labels clear 4.5:1. The 3px
  edge keeps the original hue, since a graphical object only needs 3:1.
- **The active-line highlight is barely a tint.** The previous one moved the
  background far enough to drag the gutter numbers under AA, which is a poor
  trade for marking a line the caret already marks.
- **Skip links.** Reaching the results meant tabbing past the entire query
  panel. Three skip links take it to one keystroke.
- **The result table uses a roving tabindex.** Making every row focusable put
  250 tab stops between the results and anything after them; now one row is
  tabbable and the arrow keys move between them.
- **MapLibre's geolocate control is gone**, replaced by a button in this app's
  own control group. Its own control landed in the same corner as these and
  ended up underneath them, leaving 3px of it clickable.
