/**
 * The icon set, drawn inline rather than pulled from a library.
 *
 * Every glyph is a 24x24 stroked path on the same grid and weight, so they sit
 * together without the mismatched optical sizes you get from mixing packs. The
 * whole set costs less than an icon font request.
 */

export type IconName =
  | 'run'
  | 'stop'
  | 'plus'
  | 'trash'
  | 'copy'
  | 'grip'
  | 'close'
  | 'chevron-down'
  | 'chevron-right'
  | 'chevron-up'
  | 'sun'
  | 'moon'
  | 'share'
  | 'download'
  | 'upload'
  | 'folder'
  | 'settings'
  | 'search'
  | 'eye'
  | 'eye-off'
  | 'blocks'
  | 'code'
  | 'target'
  | 'layers'
  | 'user'
  | 'check'
  | 'alert'
  | 'info'
  | 'external'
  | 'menu'
  | 'zoom-in'
  | 'zoom-out'
  | 'pin'

const PATHS: Record<IconName, string> = {
  run: 'M7 4.5v15l12-7.5z',
  stop: 'M6 6h12v12H6z',
  plus: 'M12 5v14M5 12h14',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  grip: 'M9 6h.01M9 12h.01M9 18h.01M15 6h.01M15 12h.01M15 18h.01',
  close: 'M6 6l12 12M18 6L6 18',
  'chevron-down': 'M6 9l6 6 6-6',
  'chevron-right': 'M9 6l6 6-6 6',
  'chevron-up': 'M6 15l6-6 6 6',
  sun: 'M12 17a5 5 0 100-10 5 5 0 000 10zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M20 14.5A8.5 8.5 0 019.5 4a8.5 8.5 0 1010.5 10.5z',
  share: 'M4 12v7a1 1 0 001 1h14a1 1 0 001-1v-7M12 15V3M8 7l4-4 4 4',
  download: 'M4 15v4a1 1 0 001 1h14a1 1 0 001-1v-4M12 3v12M8 11l4 4 4-4',
  upload: 'M4 15v4a1 1 0 001 1h14a1 1 0 001-1v-4M12 15V3M8 7l4-4 4 4',
  folder: 'M3 7a1 1 0 011-1h5l2 2h9a1 1 0 011 1v9a1 1 0 01-1 1H4a1 1 0 01-1-1z',
  settings:
    'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-2.7 1.1v.3a2 2 0 11-4 0v-.2a1.6 1.6 0 00-2.8-1.1l-.1.1a2 2 0 11-2.8-2.8l.1-.1A1.6 1.6 0 003.7 15a2 2 0 01-2-2 2 2 0 012-2 1.6 1.6 0 001.1-2.7l-.1-.1a2 2 0 112.8-2.8l.1.1A1.6 1.6 0 009 4.6a2 2 0 014 0 1.6 1.6 0 002.7 1.1l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 001.1 2.7 2 2 0 010 4 1.6 1.6 0 00-1.2.8z',
  search: 'M11 18a7 7 0 100-14 7 7 0 000 14zM20 20l-4-4',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7zM12 15a3 3 0 100-6 3 3 0 000 6z',
  'eye-off': 'M4 4l16 16M10 6a10 10 0 0112 6 15 15 0 01-3 3.6M6.7 7.7A15 15 0 002 12s3.6 7 10 7a10 10 0 004-.8M9.9 9.9a3 3 0 004.2 4.2',
  blocks: 'M4 5h16M4 5v5h16V5M4 14h9M4 14v5h9v-5',
  code: 'M9 7l-5 5 5 5M15 7l5 5-5 5',
  target: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 16a4 4 0 100-8 4 4 0 000 8zM12 3v3M12 18v3M3 12h3M18 12h3',
  layers: 'M12 3l9 5-9 5-9-5 9-5zM3 14l9 5 9-5M3 11l9 5 9-5',
  user: 'M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z',
  check: 'M5 13l4 4L19 7',
  alert: 'M12 9v5M12 18h.01M10.3 3.9L2.5 17a2 2 0 001.7 3h15.6a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z',
  info: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 16v-5M12 8h.01',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5',
  menu: 'M4 7h16M4 12h16M4 17h16',
  'zoom-in': 'M5 12h14M12 5v14',
  'zoom-out': 'M5 12h14',
  pin: 'M12 21s7-6.6 7-11a7 7 0 10-14 0c0 4.4 7 11 7 11zM12 12a2.5 2.5 0 100-5 2.5 2.5 0 000 5z',
}

/** Icons whose shape reads better filled than stroked. */
const FILLED = new Set<IconName>(['run', 'stop'])

interface IconProps {
  name: IconName
  size?: number
  className?: string
}

export function Icon({ name, size = 15, className }: IconProps) {
  const filled = FILLED.has(name)

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  )
}

/** The app mark: a survey benchmark, which is what a query result is. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 2.5l8.5 5v9L12 21.5 3.5 16.5v-9z" />
      <circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none" />
    </svg>
  )
}
