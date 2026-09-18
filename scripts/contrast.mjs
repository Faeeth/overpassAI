/**
 * Measures the contrast of every text element actually rendered, in both
 * themes, and reports what fails WCAG AA.
 *
 * Reading the computed colours off the live page rather than the CSS tokens
 * is the point: a token can look fine in isolation and still fail once it
 * lands on a raised surface inside a dialog.
 */

import { chromium } from 'playwright'

const BASE = process.env.SMOKE_BASE ?? 'http://127.0.0.1:5173/'

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()

await page.goto(BASE, { waitUntil: 'load' })
await page.waitForTimeout(2500)

const MEASURE = () => {
  const parse = (colour) => {
    const m = /rgba?\(([^)]+)\)/.exec(colour)
    if (!m) return null
    const [r, g, b, a = '1'] = m[1].split(',').map((p) => parseFloat(p))
    return { r, g, b, a }
  }

  const channel = (value) => {
    const c = value / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }

  const luminance = ({ r, g, b }) =>
    0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)

  const ratio = (fg, bg) => {
    const a = luminance(fg)
    const b = luminance(bg)
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
  }

  /** Walks up until a non-transparent background is found. */
  const backgroundOf = (el) => {
    let node = el
    while (node && node !== document.documentElement) {
      const bg = parse(getComputedStyle(node).backgroundColor)
      if (bg && bg.a > 0.9) return bg
      node = node.parentElement
    }
    return { r: 255, g: 255, b: 255, a: 1 }
  }

  const results = []
  const seen = new Set()

  for (const el of document.querySelectorAll('*')) {
    const text = [...el.childNodes]
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent?.trim())
      .filter(Boolean)
      .join(' ')
    if (!text) continue

    const rect = el.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) continue

    const style = getComputedStyle(el)
    if (style.visibility === 'hidden' || style.opacity === '0') continue

    const fg = parse(style.color)
    if (!fg) continue

    const size = parseFloat(style.fontSize)
    const weight = Number(style.fontWeight) || 400
    // WCAG counts 18.66px bold or 24px as "large", which drops the bar to 3:1.
    const large = size >= 24 || (size >= 18.66 && weight >= 700)
    const required = large ? 3 : 4.5

    const value = ratio(fg, backgroundOf(el))
    const key = `${style.color}|${el.className}|${Math.round(size)}`
    if (seen.has(key)) continue
    seen.add(key)

    if (value < required) {
      results.push({
        selector:
          typeof el.className === 'string' && el.className
            ? `.${el.className.split(' ').filter(Boolean).join('.')}`
            : el.tagName.toLowerCase(),
        text: text.slice(0, 28),
        colour: style.color,
        size: Math.round(size),
        weight,
        ratio: Number(value.toFixed(2)),
        required,
      })
    }
  }

  return results.sort((a, b) => a.ratio - b.ratio)
}

for (const theme of ['dark', 'light']) {
  await page.evaluate((t) => {
    document.documentElement.dataset.theme = t
  }, theme)
  await page.waitForTimeout(500)

  // Open the catalogue too, since its faint mono text was flagged.
  const failures = await page.evaluate(MEASURE)

  console.log(`\n=== ${theme} theme: ${failures.length} text element(s) below AA ===`)
  for (const f of failures.slice(0, 20)) {
    console.log(
      `   ${String(f.ratio).padStart(5)} (needs ${f.required})  ${f.size}px/${f.weight}  ` +
        `${f.selector.slice(0, 44).padEnd(44)} ${JSON.stringify(f.text)}`,
    )
  }
}

// The syntax colours only exist once the editor is mounted.
await page.evaluate(() => {
  document.documentElement.dataset.theme = 'dark'
})
await page.getByRole('tab', { name: /Text/ }).click()
await page.waitForTimeout(1500)

for (const theme of ['dark', 'light']) {
  await page.evaluate((t) => {
    document.documentElement.dataset.theme = t
  }, theme)
  await page.waitForTimeout(400)
  const failures = await page.evaluate(MEASURE)
  const syntax = failures.filter((f) => f.selector.includes('cm') || f.selector.includes('ͼ'))
  console.log(`\n=== ${theme} theme, editor: ${syntax.length} token colour(s) below AA ===`)
  for (const f of syntax.slice(0, 12)) {
    console.log(`   ${String(f.ratio).padStart(5)}  ${f.colour.padEnd(20)} ${JSON.stringify(f.text)}`)
  }
}

await browser.close()
