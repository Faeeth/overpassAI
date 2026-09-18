/**
 * Accessibility audit.
 *
 * Two halves, because automation only catches a third of what matters:
 *
 *  - axe-core over the app in several states, against WCAG 2.1/2.2 AA
 *  - the manual checks a person would do: keyboard-only operation, focus
 *    visibility and order, target sizes, reflow at 320px, and 200% zoom
 *
 * Run against the dev server by default:
 *     node scripts/a11y.mjs
 *
 * Or a built site:
 *     SMOKE_BASE=http://127.0.0.1:4173/overpassAI/ node scripts/a11y.mjs
 */

import { chromium } from 'playwright'
import { AxeBuilder } from '@axe-core/playwright'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const BASE = process.env.SMOKE_BASE ?? 'http://127.0.0.1:5173/'
const ENDPOINT = process.env.SMOKE_ENDPOINT
const VIEW = process.env.SMOKE_VIEW

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']

const findings = []
const note = (severity, area, message, detail) =>
  findings.push({ severity, area, message, detail })

const browser = await chromium.launch()
// axe-core needs a page created from an explicit context, not the shorthand.
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()

if (ENDPOINT) {
  await page.addInitScript((endpointUrl) => {
    try {
      localStorage.setItem(
        'overpassai.ui.v1',
        JSON.stringify({ state: { endpointUrl }, version: 0 }),
      )
    } catch {
      /* storage unavailable */
    }
  }, ENDPOINT)
}

await page.goto(BASE, { waitUntil: 'load' })
await page.waitForTimeout(3000)

// ---------------------------------------------------------------------------
// axe-core
// ---------------------------------------------------------------------------

async function scan(label) {
  const results = await new AxeBuilder({ page })
    .withTags(TAGS)
    // The map canvas is a WebGL surface MapLibre owns; axe has nothing useful
    // to say about it, and its own controls are audited separately below.
    .exclude('.maplibregl-canvas-container')
    .analyze()

  console.log(`\n--- axe: ${label} ---`)
  if (!results.violations.length) {
    console.log('   no violations')
    return
  }

  for (const violation of results.violations) {
    const where = violation.nodes
      .slice(0, 3)
      .map((n) => n.target.join(' '))
      .join(' | ')
    console.log(`   [${violation.impact}] ${violation.id}: ${violation.help}`)
    console.log(`      ${violation.nodes.length} node(s): ${where}`)
    note(
      violation.impact === 'critical' || violation.impact === 'serious' ? 'high' : 'medium',
      label,
      `${violation.id}: ${violation.help}`,
      where,
    )
  }
}

console.log('=== 1. Automated audit across states ===')
await scan('initial, block view')

await page.getByRole('tab', { name: /Text/ }).click()
await page.waitForTimeout(800)
await scan('text view')

await page.getByRole('tab', { name: /Blocks/ }).click()
await page.waitForTimeout(400)

// Light theme: contrast is a different question in each.
await page.evaluate(() => {
  document.documentElement.dataset.theme = 'light'
})
await page.waitForTimeout(400)
await scan('light theme')
await page.evaluate(() => {
  document.documentElement.dataset.theme = 'dark'
})

await page.getByRole('button', { name: /Browse features/ }).click()
await page.waitForTimeout(600)
await scan('feature catalogue dialog')
await page.keyboard.press('Escape')
await page.waitForTimeout(300)

await page.getByRole('button', { name: 'Export' }).click()
await page.waitForTimeout(500)
await scan('export dialog')
await page.keyboard.press('Escape')
await page.waitForTimeout(300)

// Results, which is the densest part of the interface.
if (VIEW) {
  const [lat, lon, zoom] = VIEW.split(',').map(Number)
  await page.evaluate(
    ([latitude, longitude, level]) =>
      window.__mapForTests?.jumpTo({ center: [longitude, latitude], zoom: level }),
    [lat, lon, zoom],
  )
  await page.waitForTimeout(1200)
}
await page.getByRole('button', { name: 'Run', exact: true }).click()
await page.locator('.results__count').waitFor({ timeout: 60000 }).catch(() => {})
await page.waitForTimeout(2500)
await scan('with results')

// An error state, which is where wording and announcement matter most.
await page.getByRole('button', { name: 'Add a filter' }).first().click()
await page.waitForTimeout(250)
await page.getByRole('menuitem', { name: 'By id' }).click()
await page.waitForTimeout(300)
await page.getByRole('button', { name: 'Run', exact: true }).click()
await page.waitForTimeout(1000)
await scan('validation error state')

// ---------------------------------------------------------------------------
// Manual checks
// ---------------------------------------------------------------------------

console.log('\n=== 2. Keyboard only ===')
await page.reload({ waitUntil: 'load' })
await page.waitForTimeout(2500)

const tabStops = []
await page.keyboard.press('Tab')
for (let i = 0; i < 45; i++) {
  const stop = await page.evaluate(() => {
    const el = document.activeElement
    if (!el || el === document.body) return null
    const rect = el.getBoundingClientRect()
    const style = getComputedStyle(el)
    return {
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role'),
      name:
        el.getAttribute('aria-label') ??
        el.textContent?.trim().slice(0, 30) ??
        el.getAttribute('placeholder') ??
        '',
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      visible: rect.width > 0 && rect.height > 0,
      outline: style.outlineStyle !== 'none' && style.outlineWidth !== '0px',
    }
  })
  if (!stop) break
  tabStops.push(stop)
  await page.keyboard.press('Tab')
}

console.log(`   reached ${tabStops.length} focusable stops`)
const invisible = tabStops.filter((s) => !s.visible)
if (invisible.length) {
  note('high', 'keyboard', `${invisible.length} focus stop(s) are invisible`, JSON.stringify(invisible.slice(0, 3)))
  console.log(`   ! ${invisible.length} invisible stop(s)`)
}
const unnamed = tabStops.filter((s) => !s.name && s.tag !== 'input' && s.tag !== 'textarea')
if (unnamed.length) {
  note('high', 'keyboard', `${unnamed.length} focus stop(s) have no accessible name`, JSON.stringify(unnamed.slice(0, 5)))
  console.log(`   ! ${unnamed.length} unnamed stop(s): ${JSON.stringify(unnamed.slice(0, 5))}`)
}

console.log('\n=== 3. Target sizes (WCAG 2.2, 2.5.8: 24x24 minimum) ===')
const small = await page.evaluate(() => {
  const out = []
  for (const el of document.querySelectorAll('button, a[href], [role="button"], summary')) {
    const rect = el.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) continue
    if (rect.width >= 24 && rect.height >= 24) continue

    // WCAG 2.5.8 exempts a target whose size is set by the line height of the
    // text it sits in, which is what an attribution link is.
    const inline = getComputedStyle(el).display.startsWith('inline')
    if (inline && el.closest('p, li, .maplibregl-ctrl-attrib, figcaption')) continue
    out.push({
      name:
        el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 24) ?? el.className,
      className: typeof el.className === 'string' ? el.className.slice(0, 50) : '',
      size: `${Math.round(rect.width)}x${Math.round(rect.height)}`,
    })
  }
  return out
})
console.log(`   ${small.length} control(s) under 24x24`)
for (const entry of small.slice(0, 12)) {
  console.log(`      ${entry.size.padEnd(9)} ${entry.name} (${entry.className})`)
}
if (small.length) {
  note('medium', 'target size', `${small.length} control(s) smaller than 24x24 CSS pixels`, JSON.stringify(small.slice(0, 6)))
}

console.log('\n=== 4. Reflow at 320px (WCAG 1.4.10) ===')
await page.setViewportSize({ width: 320, height: 640 })
await page.waitForTimeout(1200)
const reflow = await page.evaluate(() => ({
  horizontalScroll: document.documentElement.scrollWidth > window.innerWidth + 2,
  scrollWidth: document.documentElement.scrollWidth,
  innerWidth: window.innerWidth,
  topbarVisible: !!document.querySelector('.topbar')?.getBoundingClientRect().height,
  panelReachable: !!document.querySelector('[data-narrow-only="true"]'),
}))
console.log(`   horizontal scroll: ${reflow.horizontalScroll} (${reflow.scrollWidth} vs ${reflow.innerWidth})`)
console.log(`   panel toggle present: ${reflow.panelReachable}`)
if (reflow.horizontalScroll) {
  note('high', 'reflow', 'The page scrolls horizontally at 320px wide', JSON.stringify(reflow))
}
if (!reflow.panelReachable) {
  note('high', 'reflow', 'No way to reach the query panel on a narrow screen')
}
await page.screenshot({ path: join(here, 'a11y-320.png') })

console.log('\n=== 5. Zoom to 200% (WCAG 1.4.4) ===')
await page.setViewportSize({ width: 1280, height: 800 })
await page.evaluate(() => {
  document.documentElement.style.fontSize = '32px'
})
await page.waitForTimeout(1000)
const zoomed = await page.evaluate(() => ({
  horizontalScroll: document.documentElement.scrollWidth > window.innerWidth + 2,
  runVisible: (() => {
    const run = [...document.querySelectorAll('button')].find((b) =>
      /^Run$/.test(b.textContent?.trim() ?? ''),
    )
    if (!run) return false
    const r = run.getBoundingClientRect()
    return r.top >= 0 && r.left >= 0 && r.right <= window.innerWidth
  })(),
}))
console.log(`   horizontal scroll at 200%: ${zoomed.horizontalScroll}`)
console.log(`   Run button still reachable: ${zoomed.runVisible}`)
if (zoomed.horizontalScroll) {
  note('medium', 'zoom', 'The page scrolls horizontally at 200% text size')
}
if (!zoomed.runVisible) {
  note('high', 'zoom', 'The Run button is off-screen at 200% text size')
}
await page.screenshot({ path: join(here, 'a11y-zoom200.png') })
await page.evaluate(() => {
  document.documentElement.style.fontSize = ''
})

console.log('\n=== 6. Landmarks and headings ===')
await page.setViewportSize({ width: 1440, height: 900 })
const structure = await page.evaluate(() => ({
  landmarks: [...document.querySelectorAll('header, nav, main, aside, footer, [role]')]
    .map((el) => el.getAttribute('role') ?? el.tagName.toLowerCase())
    .filter((r) => ['header', 'nav', 'main', 'aside', 'footer', 'banner', 'navigation', 'main', 'complementary', 'contentinfo', 'region', 'search'].includes(r)),
  headings: [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((h) => ({
    level: Number(h.tagName[1]),
    text: h.textContent?.trim().slice(0, 40),
  })),
  lang: document.documentElement.lang,
  title: document.title,
}))
console.log(`   lang="${structure.lang}", title="${structure.title}"`)
console.log(`   landmarks: ${JSON.stringify(structure.landmarks)}`)
console.log(`   headings: ${JSON.stringify(structure.headings)}`)

if (!structure.landmarks.includes('main')) {
  note('medium', 'structure', 'No <main> landmark, so screen reader users cannot skip to the content')
}
if (!structure.headings.some((h) => h.level === 1)) {
  note('medium', 'structure', 'No level-1 heading on the page')
}

console.log('\n=== 7. Live regions for status changes (WCAG 4.1.3) ===')
const live = await page.evaluate(() =>
  [...document.querySelectorAll('[aria-live], [role="status"], [role="alert"]')].map((el) => ({
    role: el.getAttribute('role'),
    live: el.getAttribute('aria-live'),
    className: typeof el.className === 'string' ? el.className.slice(0, 40) : '',
  })),
)
console.log(`   ${live.length} live region(s): ${JSON.stringify(live)}`)
const resultsAnnounced = await page.evaluate(() => {
  const results = document.querySelector('.results')
  if (!results) return false
  return !!results.closest('[aria-live]') || !!results.querySelector('[aria-live],[role="status"]')
})
console.log(`   result count announced: ${resultsAnnounced}`)
if (!resultsAnnounced) {
  note(
    'medium',
    'status',
    'The result count is not in a live region, so a screen reader user is not told a query finished',
  )
}

await browser.close()

// ---------------------------------------------------------------------------

console.log('\n================ FINDINGS ================')
if (!findings.length) {
  console.log('No accessibility findings.')
} else {
  const high = findings.filter((f) => f.severity === 'high')
  const medium = findings.filter((f) => f.severity === 'medium')
  console.log(`${high.length} high, ${medium.length} medium\n`)
  for (const f of [...high, ...medium]) {
    console.log(`[${f.severity}] (${f.area}) ${f.message}`)
    if (f.detail) console.log(`        ${f.detail.slice(0, 160)}`)
  }
  process.exitCode = 1
}
