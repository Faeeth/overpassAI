/**
 * Smoke test: load the app, exercise the main paths, and report anything the
 * browser complains about. Screenshots go next to this script.
 */
import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const BASE = process.env.SMOKE_BASE ?? 'http://127.0.0.1:5173/'

const problems = []
const log = (...args) => console.log(...args)

/**
 * Which Overpass instance to point the app at.
 *
 * Public instances block clients that have been busy, so pinning one keeps the
 * run independent of whichever is refusing today:
 *
 *   SMOKE_ENDPOINT=https://overpass.osm.ch/api/interpreter npm run smoke
 */
const ENDPOINT = process.env.SMOKE_ENDPOINT

/**
 * Where to point the map before running the query, as "lat,lon,zoom".
 *
 * A regional instance has no data outside its area, so the location has to
 * follow the endpoint or the run proves nothing:
 *
 *   SMOKE_ENDPOINT=https://overpass.osm.ch/api/interpreter SMOKE_VIEW=47.3769,8.5417,14
 */
const VIEW = process.env.SMOKE_VIEW

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

if (ENDPOINT) {
  // The app reads its endpoint from persisted UI state, so seeding that is
  // less brittle than clicking through the server menu.
  await page.addInitScript((endpointUrl) => {
    try {
      localStorage.setItem(
        'overpassai.ui.v1',
        JSON.stringify({ state: { endpointUrl }, version: 0 }),
      )
    } catch {
      /* storage unavailable; the app falls back to its default */
    }
  }, ENDPOINT)
}

page.on('console', (msg) => {
  if (msg.type() === 'error') problems.push(`console.error: ${msg.text()}`)
  if (msg.type() === 'warning' && /React|Warning/.test(msg.text())) {
    problems.push(`console.warn: ${msg.text()}`)
  }
})
page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`))
page.on('requestfailed', (req) => {
  const url = req.url()
  // Tile requests fail in CI-ish environments; not our bug.
  if (/tile|basemaps|arcgisonline/.test(url)) return
  problems.push(`requestfailed: ${url} (${req.failure()?.errorText})`)
})

log('1. loading the page')
await page.goto(BASE, { waitUntil: 'load' })
await page.waitForTimeout(3000)

// The dev server re-optimises dependencies on first run after a dependency
// change, which aborts the in-flight module requests. One reload settles it.
if (!(await page.locator('.topbar').count())) {
  log('   (dev server was re-optimising; reloading)')
  problems.length = 0
  await page.reload({ waitUntil: 'load' })
  await page.waitForTimeout(2000)
}

const title = await page.title()
log(`   title: ${title}`)

log('2. checking the shell rendered')
for (const selector of ['.topbar', '.panel', '.map', '.results', '.blocks']) {
  const count = await page.locator(selector).count()
  log(`   ${selector}: ${count}`)
  if (count === 0) problems.push(`missing element: ${selector}`)
}

const blockCount = await page.locator('.block').count()
log(`   blocks rendered: ${blockCount}`)
if (blockCount < 3) problems.push(`expected the starter query to render blocks, got ${blockCount}`)

await page.screenshot({ path: join(here, 'shot-01-dark.png'), fullPage: false })

log('3. switching to the text view')
await page.getByRole('tab', { name: /Text/ }).click()
await page.waitForTimeout(500)
const cm = await page.locator('.cm-content').count()
log(`   codemirror surfaces: ${cm}`)
if (cm === 0) problems.push('the text editor did not mount')
const editorText = await page.locator('.cm-content').innerText().catch(() => '')
log(`   editor starts with: ${editorText.slice(0, 40).replace(/\n/g, ' ')}`)
await page.screenshot({ path: join(here, 'shot-02-text.png') })

log('4. editing the text and checking the blocks follow')
await page.locator('.cm-content').click()
await page.keyboard.press('Control+A')
await page.keyboard.type('[out:json][timeout:25];\nnode["amenity"="bench"]({{bbox}});\nout geom 100;')
await page.waitForTimeout(600)
await page.getByRole('tab', { name: /Blocks/ }).click()
await page.waitForTimeout(400)
const summaries = await page.locator('.block__summary').allInnerTexts()
log(`   block summaries: ${JSON.stringify(summaries)}`)
if (!summaries.some((s) => s.includes('bench'))) {
  problems.push('a text edit did not reach the block view')
}
await page.screenshot({ path: join(here, 'shot-03-synced.png') })

log('5. editing a block and checking the text follows')
const valueInput = page.getByRole('combobox', { name: 'Tag value' }).first()
if (await valueInput.count()) {
  await valueInput.fill('waste_basket')
  await page.waitForTimeout(400)
  await page.keyboard.press('Escape')
  await page.getByRole('tab', { name: /Text/ }).click()
  await page.waitForTimeout(400)
  const text = await page.locator('.cm-content').innerText()
  log(`   text now: ${text.replace(/\n/g, ' ').slice(0, 90)}`)
  if (!text.includes('waste_basket')) problems.push('a block edit did not reach the text view')
} else {
  problems.push('no tag value field found in the block editor')
}

log('6. light theme')
await page.evaluate(() => {
  document.documentElement.dataset.theme = 'light'
})
await page.getByRole('tab', { name: /Blocks/ }).click()
await page.waitForTimeout(400)
await page.screenshot({ path: join(here, 'shot-04-light.png') })

log('7. running the query against the live Overpass API')
await page.evaluate(() => {
  document.documentElement.dataset.theme = 'dark'
})

if (VIEW) {
  const [lat, lon, zoom] = VIEW.split(',').map(Number)
  log(`   moving the map to ${lat}, ${lon} at zoom ${zoom}`)
  await page.evaluate(
    ([latitude, longitude, level]) => {
      window.__mapForTests?.jumpTo({ center: [longitude, latitude], zoom: level })
    },
    [lat, lon, zoom],
  )
  await page.waitForTimeout(1500)
}

await page.getByRole('button', { name: 'Run', exact: true }).click()
let haveResults = await page
  .locator('.results__count')
  .waitFor({ timeout: 60000 })
  .then(() => true)
  .catch(() => false)

// Public Overpass instances go busy regularly. The app offers a one-click
// retry elsewhere; use it, which exercises that path too.
if (!haveResults) {
  const retry = page.getByRole('button', { name: /Try .* instead/ })
  if (await retry.count()) {
    log('   server was busy; using the "try another server" button')
    await retry.click()
    haveResults = await page
      .locator('.results__count')
      .waitFor({ timeout: 90000 })
      .then(() => true)
      .catch(() => false)
  }
}

if (!haveResults) {
  log('   SKIPPED: no public Overpass instance answered, so result checks are skipped')
}
await page.waitForTimeout(2500)

// A regional instance legitimately returns nothing outside its coverage, so
// the count decides whether the result assertions mean anything, not merely
// whether the server answered.
const found = Number(
  (await page.locator('.results__count').innerText().catch(() => '0')).replace(/[^0-9]/g, ''),
)
if (haveResults && found === 0) {
  log('   note: the server answered with 0 results, so result checks are skipped')
  log('   (a regional instance such as overpass.osm.ch has no data outside its area)')
}
const summary = await page.locator('.results__summary').innerText().catch(() => '(none)')
log(`   results: ${summary.replace(/\n/g, ' ')}`)
await page.screenshot({ path: join(here, 'shot-05-results.png') })

// A broken MapLibre worker leaves the basemap drawing while GeoJSON layers
// render nothing at all, with no error anywhere. Only counting painted
// features catches it.
const painted = await page.evaluate(() => {
  const canvas = document.querySelector('.map canvas')
  if (!canvas) return -1
  const maps = window.__mapForTests
  if (!maps) return -2
  return maps.queryRenderedFeatures({ layers: ['results-point', 'results-line', 'results-fill'] })
    .length
})
log(`   features painted on the map: ${painted}`)
if (found > 0 && painted === 0) {
  problems.push('results are in the table but nothing is drawn on the map')
}
if (painted < 0) problems.push(`could not inspect the map (code ${painted})`)

log('8. opening a result in the inspector')
const firstRow = page.locator('.table tbody tr').first()
if (await firstRow.count()) {
  await firstRow.click()
  await page.waitForTimeout(600)
  const inspector = await page.locator('.inspector').count()
  log(`   inspector: ${inspector}`)
  if (found > 0 && !inspector) {
    problems.push('clicking a result row did not open the inspector')
  }
  await page.screenshot({ path: join(here, 'shot-06-inspector.png') })
}

log('9. the preset catalogue')
await page.getByRole('button', { name: /Browse features/ }).click()
await page.waitForTimeout(500)
const presets = await page.locator('.preset').count()
log(`   presets listed: ${presets}`)
if (presets < 20) problems.push(`expected a full preset catalogue, saw ${presets}`)
await page.screenshot({ path: join(here, 'shot-07-presets.png') })
await page.keyboard.press('Escape')
await page.waitForTimeout(300)

log('10. the export dialog')
await page.getByRole('button', { name: 'Export' }).click()
await page.waitForTimeout(400)
const formats = await page.locator('.option').count()
log(`   export formats: ${formats}`)
await page.screenshot({ path: join(here, 'shot-08-export.png') })
await page.keyboard.press('Escape')

log('10b. an incomplete block is caught before anything is sent')
{
  // The reported crash: add a filter, leave it blank, press Run, and get a
  // parse error from a server in Germany about a query you never wrote.
  let overpassCalls = 0
  const countCalls = (request) => {
    if (/\/api\/interpreter/.test(request.url())) overpassCalls += 1
  }
  page.on('request', countCalls)

  await page.getByRole('tab', { name: /Blocks/ }).click()
  await page.waitForTimeout(300)

  await page.getByRole('button', { name: 'Add a filter' }).first().click()
  await page.waitForTimeout(250)
  await page.getByRole('menuitem', { name: 'By id' }).click()
  await page.waitForTimeout(400)

  const marked = await page.locator('.block[data-severity="error"]').count()
  const blockIssue = await page.locator('.block__issue--error').first().innerText().catch(() => '')
  log(`   blocks marked as broken: ${marked}`)
  log(`   the block says: ${blockIssue.replace(/\n/g, ' ').slice(0, 70)}`)
  if (marked === 0) problems.push('an empty id filter was not marked on the block')

  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await page.waitForTimeout(1200)

  const title = await page.locator('.results__message--error h3').innerText().catch(() => '')
  const listed = await page.locator('.issue').count()
  log(`   results panel says: ${title}`)
  log(`   issues listed: ${listed}, requests sent to Overpass: ${overpassCalls}`)

  if (!/not ready to run/i.test(title)) {
    problems.push('running an incomplete query did not report it as not ready')
  }
  if (overpassCalls > 0) {
    problems.push('an invalid query was sent to the server instead of being refused')
  }

  await page.screenshot({ path: join(here, 'shot-10-validation.png') })
  page.off('request', countCalls)

  // Clicking an issue should jump to the block it belongs to.
  if (listed) {
    await page.locator('.issue__jump').first().click()
    await page.waitForTimeout(600)
    const highlighted = await page.locator('.block[data-highlighted="true"]').count()
    log(`   clicking the issue highlighted ${highlighted} block(s)`)
    if (!highlighted) problems.push('clicking an issue did not highlight its block')
  }
}

log('11. the permalink')
const hash = await page.evaluate(() => window.location.hash)
log(`   hash length: ${hash.length}`)
if (!hash.startsWith('#q=')) problems.push('the permalink hash was not written')

const shared = await browser.newPage({ viewport: { width: 1280, height: 800 } })
await shared.goto(`${BASE}${hash}`, { waitUntil: 'load' })
await shared.waitForTimeout(2500)
const sharedSummaries = await shared.locator('.block__summary').allInnerTexts()
log(`   reopened from the link: ${JSON.stringify(sharedSummaries)}`)
if (!sharedSummaries.some((s) => s.includes('waste_basket'))) {
  problems.push('a shared link did not restore the query')
}
await shared.close()

log('12. reordering blocks by dragging')
await page.getByRole('tab', { name: /Blocks/ }).click()
await page.waitForTimeout(400)

// Build a query with two Find blocks, so a reorder is unambiguous.
await page.getByRole('tab', { name: /Text/ }).click()
await page.locator('.cm-content').click()
await page.keyboard.press('Control+A')
await page.keyboard.type(
  '[out:json][timeout:25];\nnode["amenity"="bar"]({{bbox}});\nnode["amenity"="cafe"]({{bbox}});\nout geom 10;',
)
await page.waitForTimeout(600)
await page.getByRole('tab', { name: /Blocks/ }).click()
await page.waitForTimeout(500)

const orderBefore = await page.locator('.block__summary').allInnerTexts()
const grips = page.locator('.block__grip')
const source = grips.nth(1) // the "bar" block; index 0 is the settings block
const target = grips.nth(2) // the "cafe" block

const from = await source.boundingBox()
const to = await target.boundingBox()
if (from && to) {
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  // dnd-kit needs a few pixels of travel before it starts, then steps so the
  // collision detection has frames to work with.
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(
      from.x + from.width / 2,
      from.y + from.height / 2 + ((to.y - from.y) * i) / 8 + 10,
    )
    await page.waitForTimeout(40)
  }
  await page.mouse.up()
  await page.waitForTimeout(600)
}

const orderAfter = await page.locator('.block__summary').allInnerTexts()
log(`   before: ${JSON.stringify(orderBefore.slice(1, 3))}`)
log(`   after:  ${JSON.stringify(orderAfter.slice(1, 3))}`)
if (JSON.stringify(orderBefore) === JSON.stringify(orderAfter)) {
  problems.push('dragging a block did not change the order')
}

// The reorder has to reach the text too, which is the whole point of the
// blocks rendering the tree rather than mirroring it.
await page.getByRole('tab', { name: /Text/ }).click()
await page.waitForTimeout(400)
const textAfterDrag = await page.locator('.cm-content').innerText()
log(`   text order: ${textAfterDrag.replace(/\n/g, ' ').slice(0, 110)}`)
if (textAfterDrag.indexOf('cafe') > textAfterDrag.indexOf('bar')) {
  problems.push('the reorder did not reach the query text')
}
await page.getByRole('tab', { name: /Blocks/ }).click()
await page.waitForTimeout(300)

log('13. saving and reopening a project file')
const downloadPromise = page.waitForEvent('download', { timeout: 15000 }).catch(() => null)
await page.getByRole('button', { name: 'Export' }).click()
await page.waitForTimeout(400)
await page.getByRole('button', { name: /Save file/ }).click()
const download = await downloadPromise

if (!download) {
  problems.push('exporting a project produced no download')
} else {
  const path = join(here, 'tmp-project.overpassai.json')
  await download.saveAs(path)
  const { readFileSync, unlinkSync } = await import('node:fs')
  const project = JSON.parse(readFileSync(path, 'utf8'))
  log(`   file: format=${project.format} v${project.version}`)
  log(`   holds the query: ${typeof project.source === 'string' && project.source.length > 0}`)
  log(`   holds results:   ${project.result?.geojson?.features?.length ?? 0} features`)
  log(`   holds the tree:  ${Array.isArray(project.ast?.statements)}`)

  if (project.format !== 'overpassai.project') problems.push('the project file has the wrong format tag')
  if (!project.source) problems.push('the project file has no query in it')
  if (!Array.isArray(project.ast?.statements)) problems.push('the project file has no parsed tree')

  // Reopen it in a clean page by dropping it on the window.
  const fresh = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  await fresh.goto(BASE, { waitUntil: 'load' })
  await fresh.waitForTimeout(2500)

  const buffer = readFileSync(path, 'utf8')
  await fresh.evaluate(async (contents) => {
    const file = new File([contents], 'project.overpassai.json', { type: 'application/json' })
    const transfer = new DataTransfer()
    transfer.items.add(file)
    window.dispatchEvent(
      Object.assign(new Event('drop', { bubbles: true, cancelable: true }), {
        dataTransfer: transfer,
      }),
    )
  }, buffer)
  await fresh.waitForTimeout(2000)

  const restored = await fresh.locator('.block__summary').allInnerTexts()
  const restoredCount = await fresh.locator('.results__count').innerText().catch(() => '0')
  log(`   reopened blocks:  ${JSON.stringify(restored.slice(1))}`)
  log(`   reopened results: ${restoredCount} (without re-running)`)

  if (!restored.some((s) => s.includes('amenity'))) {
    problems.push('reopening a project did not restore the query blocks')
  }
  if (found > 0 && restoredCount === '0') {
    problems.push('reopening a project did not restore the saved results')
  }

  await fresh.screenshot({ path: join(here, 'shot-09-reopened.png') })
  await fresh.close()
  unlinkSync(path)
}

await browser.close()

console.log('\n================ RESULT ================')
if (problems.length) {
  console.log(`${problems.length} problem(s):`)
  for (const p of problems) console.log(' -', p)
  process.exitCode = 1
} else {
  console.log('No problems detected.')
}
