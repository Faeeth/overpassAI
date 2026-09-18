/**
 * Task-based usability runs.
 *
 * Not assertions about markup: a simulated person trying to get something
 * done, with the cost counted. Each task records the interactions it took, how
 * long it ran, whether it succeeded, and every dead end on the way.
 *
 * The number that matters is interactions against the floor — the fewest
 * interactions the task could take if the interface were perfect. A task that
 * costs three times its floor is telling you where the design is in the way.
 *
 *     SMOKE_ENDPOINT=https://overpass.osm.ch/api/interpreter \
 *     SMOKE_VIEW=47.3769,8.5417,14 node scripts/usability.mjs
 */

import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const BASE = process.env.SMOKE_BASE ?? 'http://127.0.0.1:5173/'
const ENDPOINT = process.env.SMOKE_ENDPOINT
const VIEW = process.env.SMOKE_VIEW ?? '47.3769,8.5417,14'

const report = []

const browser = await chromium.launch()

/** Counts every click and keypress a task costs. */
function instrument(page) {
  const counter = { interactions: 0, frictions: [] }
  const click = page.click.bind(page)
  page.click = async (...args) => {
    counter.interactions += 1
    return click(...args)
  }
  return counter
}

async function task({ name, floor, why, run }) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()

  if (ENDPOINT) {
    await page.addInitScript((endpointUrl) => {
      try {
        localStorage.setItem(
          'overpassai.ui.v1',
          JSON.stringify({ state: { endpointUrl, onboardingDismissed: true }, version: 0 }),
        )
      } catch {
        /* storage unavailable */
      }
    }, ENDPOINT)
  }

  const friction = []
  const note = (message) => friction.push(message)

  // A count of deliberate user actions, incremented by the helper below.
  let interactions = 0
  const act = async (label, fn) => {
    interactions += 1
    try {
      await fn()
    } catch (err) {
      note(`could not ${label}: ${String(err).split('\n')[0].slice(0, 90)}`)
      throw err
    }
  }

  await page.goto(BASE, { waitUntil: 'load' })
  await page.waitForTimeout(2500)

  const started = Date.now()
  let outcome = 'done'
  try {
    await run({ page, act, note })
  } catch {
    outcome = 'failed'
  }
  const seconds = ((Date.now() - started) / 1000).toFixed(1)

  report.push({ name, floor, why, interactions, seconds, outcome, friction })

  console.log(
    `\n${outcome === 'done' ? 'OK  ' : 'FAIL'} ${name}\n` +
      `     ${interactions} interactions (floor ${floor}), ${seconds}s`,
  )
  for (const f of friction) console.log(`     ! ${f}`)

  await page.screenshot({ path: join(here, `ux-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`) })
  await context.close()
}

const moveMap = async (page) => {
  const [lat, lon, zoom] = VIEW.split(',').map(Number)
  await page.evaluate(
    ([la, lo, z]) => window.__mapForTests?.jumpTo({ center: [lo, la], zoom: z }),
    [lat, lon, zoom],
  )
  await page.waitForTimeout(1200)
}

// ---------------------------------------------------------------------------

console.log('=== Task-based usability runs ===')

await task({
  name: 'Find benches in the current view, blocks only',
  floor: 4,
  why: 'The commonest first thing anyone does. Pick a feature, run, read.',
  async run({ page, act, note }) {
    await moveMap(page)

    await act('open the feature catalogue', () =>
      page.getByRole('button', { name: /Browse features/ }).click(),
    )
    await page.waitForTimeout(500)

    await act('search for benches', () =>
      page.getByRole('textbox', { name: /Search features/ }).fill('bench'),
    )
    await page.waitForTimeout(500)

    const matches = await page.locator('.preset').count()
    if (matches === 0) {
      note('searching "bench" in the catalogue returns nothing')
      throw new Error('no preset')
    }

    await act('pick the first match', () => page.locator('.preset').first().click())
    await page.waitForTimeout(600)

    // Did it land ready to run, or does it still need work?
    const problems = await page.locator('.block[data-severity="error"]').count()
    if (problems) note(`picking a feature left ${problems} block(s) needing attention`)

    await act('run', () => page.getByRole('button', { name: 'Run', exact: true }).click())
    const got = await page
      .locator('.results__count')
      .waitFor({ timeout: 60000 })
      .then(() => true)
      .catch(() => false)

    if (!got) {
      note('no result appeared within 60 seconds')
      throw new Error('no result')
    }

    const count = await page.locator('.results__count').innerText()
    note(`result: ${count} elements`)
  },
})

await task({
  name: 'Change what is searched for without starting over',
  floor: 2,
  why: 'Refining is the loop people actually spend their time in.',
  async run({ page, act, note }) {
    await moveMap(page)

    await act('edit the tag value', () =>
      page.getByRole('combobox', { name: 'Tag value' }).first().fill('cafe'),
    )
    await page.waitForTimeout(700)

    const suggestions = await page.locator('.combo__option').count()
    if (suggestions === 0) note('no tag suggestions appeared while typing a value')
    else note(`${suggestions} value suggestions offered`)

    await page.keyboard.press('Escape')

    // The starter query searches a named place, which has to resolve first.
    await act('run', () => page.getByRole('button', { name: 'Run', exact: true }).click())
    const got = await page
      .locator('.results__count')
      .waitFor({ timeout: 60000 })
      .then(() => true)
      .catch(() => false)
    if (!got) {
      const message = await page.locator('.results__message--error').innerText().catch(() => '')
      note(`no result: ${message.replace(/\s+/g, ' ').slice(0, 90)}`)
      throw new Error('no result')
    }
  },
})

await task({
  name: 'Search near a previous result',
  floor: 8,
  why: 'The first genuinely two-step query, and where Overpass gets hard.',
  async run({ page, act, note }) {
    await moveMap(page)

    // Start from a clean, viewport-scoped query written as text, since this is
    // about whether the blocks can express the second step at all.
    await act('switch to the text view', () => page.getByRole('tab', { name: /Text/ }).click())
    await page.waitForTimeout(900)
    await act('select the query', () => page.locator('.cm-content').click())
    await page.keyboard.press('Control+A')
    await page.keyboard.type(
      '[out:json][timeout:25];\nnode["railway"="tram_stop"]({{bbox}})->.stops;\nout geom;',
    )
    await page.waitForTimeout(700)

    await act('switch back to blocks', () => page.getByRole('tab', { name: /Blocks/ }).click())
    await page.waitForTimeout(600)

    await act('add a second Find block', () =>
      page.getByRole('button', { name: 'Add a block' }).last().click(),
    )
    await page.waitForTimeout(300)
    await act('choose Find features', () =>
      page.getByRole('menuitem', { name: 'Find features' }).click(),
    )
    await page.waitForTimeout(500)

    const filterButtons = page.getByRole('button', { name: 'Add a filter' })
    await act('open the filter menu on the new block', () => filterButtons.last().click())
    await page.waitForTimeout(300)

    const nearAvailable = await page.getByRole('menuitem', { name: 'Near' }).count()
    if (!nearAvailable) {
      note('no "Near" filter offered in the filter menu')
      throw new Error('no Near')
    }
    await act('choose Near', () => page.getByRole('menuitem', { name: 'Near' }).click())
    await page.waitForTimeout(500)

    // Can the radius be pointed at the saved set without reading the manual?
    const setOptions = await page
      .locator('.block')
      .last()
      .locator('select')
      .last()
      .locator('option')
      .allInnerTexts()
    note(`the Near filter offers: ${JSON.stringify(setOptions)}`)

    if (!setOptions.some((o) => o.includes('stops'))) {
      note('the saved set "stops" is not offered to the Near filter')
    }

    const errors = await page.locator('.block[data-severity="error"]').count()
    if (errors) {
      const message = await page.locator('.block__issue--error').first().innerText()
      note(`${errors} block(s) still wrong: ${message.replace(/\s+/g, ' ').slice(0, 80)}`)
    }
  },
})

await task({
  name: 'Understand why a query returned nothing',
  floor: 1,
  why: 'An empty result is ambiguous: no data, or a mistake?',
  async run({ page, act, note }) {
    await moveMap(page)

    await act('write a query that matches nothing', async () => {
      await page.getByRole('tab', { name: /Text/ }).click()
      await page.waitForTimeout(900)
      await page.locator('.cm-content').click()
      await page.keyboard.press('Control+A')
      await page.keyboard.type(
        '[out:json][timeout:25];\nnode["amenity"="definitely_not_a_real_tag"]({{bbox}});\nout geom;',
      )
    })
    await page.waitForTimeout(700)

    await act('run', () => page.getByRole('button', { name: 'Run', exact: true }).click())
    await page.locator('.results__count').waitFor({ timeout: 60000 }).catch(() => {})
    await page.waitForTimeout(1500)

    const message = await page.locator('.results__message').innerText().catch(() => '')
    note(`the app says: ${message.replace(/\s+/g, ' ').slice(0, 130)}`)

    if (!message) note('an empty result shows nothing explaining itself')
  },
})

await task({
  name: 'Export the results as a spreadsheet',
  floor: 3,
  why: 'The commonest thing done with a result.',
  async run({ page, act, note }) {
    await moveMap(page)

    // Scope to the viewport rather than the starter query's named place, so
    // this measures the export and not the server's coverage.
    await page.getByRole('tab', { name: /Text/ }).click()
    await page.waitForTimeout(900)
    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+A')
    await page.keyboard.type('[out:json][timeout:25];node["amenity"="bench"]({{bbox}});out geom 50;')
    await page.waitForTimeout(700)

    await act('run', () => page.getByRole('button', { name: 'Run', exact: true }).click())
    await page.locator('.results__count').waitFor({ timeout: 60000 }).catch(() => {})
    await page.waitForTimeout(1500)

    const count = await page.locator('.results__count').innerText().catch(() => '0')
    if (count.replace(/[^0-9]/g, '') === '0') {
      note('the server returned nothing, so the export could not be exercised')
      throw new Error('no data')
    }

    await act('open export', () => page.getByRole('button', { name: 'Export' }).click())
    await page.waitForTimeout(500)

    await act('choose CSV', () => page.getByRole('button', { name: /CSV/ }).click())
    const download = page.waitForEvent('download', { timeout: 15000 }).catch(() => null)
    await act('save', () => page.getByRole('button', { name: /Save file/ }).click())

    const file = await download
    if (!file) {
      note('no file was produced')
      throw new Error('no download')
    }
    note(`downloaded ${file.suggestedFilename()}`)
  },
})

await task({
  name: 'Recover a query after closing the tab',
  floor: 1,
  why: 'Losing work is the failure people forgive least.',
  async run({ page, act, note }) {
    await act('write something worth keeping', async () => {
      await page.getByRole('tab', { name: /Text/ }).click()
      await page.waitForTimeout(900)
      await page.locator('.cm-content').click()
      await page.keyboard.press('Control+A')
      await page.keyboard.type('[out:json];node["amenity"="ice_cream"]({{bbox}});out geom;')
    })
    await page.waitForTimeout(900)

    const url = page.url()
    if (!url.includes('#q=')) {
      note('the query is not in the address bar, so closing the tab loses it')
      throw new Error('no permalink')
    }

    await page.goto('about:blank')
    await page.goto(url, { waitUntil: 'load' })
    await page.waitForTimeout(2500)

    const restored = await page.locator('.cm-content, .block__summary').allInnerTexts()
    if (!restored.join(' ').includes('ice_cream')) {
      note('reopening the address did not bring the query back')
      throw new Error('not restored')
    }
    note('the query came back from the address bar alone')
  },
})

await task({
  name: 'Do the whole first task with the keyboard only',
  floor: 12,
  why: 'Keyboard operation is the floor for accessibility and for power users.',
  async run({ page, act, note }) {
    await moveMap(page)

    // Scope to the viewport so there is a result table to reach at the end;
    // otherwise this measures the server's coverage, not the keyboard path.
    await page.getByRole('tab', { name: /Text/ }).click()
    await page.waitForTimeout(900)
    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+A')
    await page.keyboard.type('[out:json][timeout:25];node["amenity"="bench"]({{bbox}});out geom 50;')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(700)

    let reachedRun = false
    for (let i = 0; i < 40; i++) {
      await act('press Tab', () => page.keyboard.press('Tab'))
      const label = await page.evaluate(
        () => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent?.trim().slice(0, 20) ?? '',
      )
      if (/^Run$/.test(label)) {
        reachedRun = true
        note(`the Run button is ${i + 1} tab stops from the top`)
        break
      }
    }

    if (!reachedRun) {
      note('the Run button could not be reached with Tab within 40 stops')
      throw new Error('unreachable')
    }

    await page.keyboard.press('Enter')
    const got = await page
      .locator('.results__count')
      .waitFor({ timeout: 60000 })
      .then(() => true)
      .catch(() => false)
    if (!got) {
      note('pressing Enter on Run produced no result')
      throw new Error('no result')
    }

    // And can the results be read without a mouse, both the long way and via
    // the skip link that exists so nobody has to?
    let reachedTable = null
    for (let i = 0; i < 70; i++) {
      await page.keyboard.press('Tab')
      if (await page.evaluate(() => !!document.activeElement?.closest('.table'))) {
        reachedTable = i + 1
        break
      }
    }
    if (reachedTable === null) note('the result table cannot be reached by tabbing')
    else note(`the result table is ${reachedTable} further tab stops away`)

    await page.getByRole('link', { name: 'Skip to the results' }).focus()
    await page.keyboard.press('Enter')
    await page.waitForTimeout(300)
    const skipped = await page.evaluate(() => !!document.activeElement?.closest('.results'))
    note(skipped ? 'the skip link reaches the results in one keystroke' : 'the skip link does not work')
  },
})

await browser.close()

// ---------------------------------------------------------------------------

console.log('\n================ SUMMARY ================')
console.log('Task                                                  Steps  Floor  Time   Result')
for (const r of report) {
  const overhead = r.interactions > r.floor ? ` (+${r.interactions - r.floor})` : ''
  console.log(
    `${r.name.slice(0, 52).padEnd(53)} ${String(r.interactions).padStart(4)}${overhead.padEnd(6)} ` +
      `${String(r.floor).padStart(4)}  ${r.seconds.padStart(5)}s  ${r.outcome}`,
  )
}

const failed = report.filter((r) => r.outcome !== 'done')
const noisy = report.flatMap((r) => r.friction.filter((f) => !f.startsWith('result') && !f.startsWith('downloaded') && !f.startsWith('the query came back') && !f.startsWith('the result table is reachable') && !f.includes('suggestions offered') && !f.includes('tab stops') && !f.startsWith('the Near filter offers') && !f.startsWith('the app says')))

console.log(`\n${failed.length} task(s) failed, ${noisy.length} friction point(s) recorded`)
for (const r of report) {
  for (const f of r.friction) console.log(`   (${r.name.slice(0, 30)}) ${f}`)
}

if (failed.length) process.exitCode = 1
