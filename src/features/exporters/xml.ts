/**
 * Escapes text for inclusion in an XML document.
 *
 * Written as a scan rather than a chain of regexes because of the control
 * characters: C0 codes other than tab, newline and carriage return are illegal
 * anywhere in XML 1.0, even as numeric character references, so they have to be
 * dropped rather than escaped. OSM tag values occasionally carry them.
 */
export function escapeXml(value: string): string {
  let out = ''

  for (const char of value) {
    const code = char.codePointAt(0) ?? 0

    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) continue

    switch (char) {
      case '&':
        out += '&amp;'
        break
      case '<':
        out += '&lt;'
        break
      case '>':
        out += '&gt;'
        break
      case '"':
        out += '&quot;'
        break
      case "'":
        out += '&apos;'
        break
      default:
        out += char
    }
  }

  return out
}
