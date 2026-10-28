// The strip under a popup in the iOS home-screen app.
//
// There, `window.innerHeight` (and with it the layout viewport that `position:fixed` boxes and the viewport units
// use) can come out shorter than the screen by about the height of the status bar, so a sheet or dialog anchored to
// the bottom of the layout viewport stops that far above the bottom edge and the page background shows below it.
// The gap is measured here (the screen's long side minus innerHeight, portrait, standalone iOS only) and published
// as --vgap, which the popup layers extend by (index.css #modal-root, .sheet, .center). A keyboard (innerHeight falls
// by hundreds of pixels), a desktop, a browser tab or a landscape phone measure 0 and nothing changes.
const MIN_GAP = 8
const MAX_GAP = 100

/** The iOS home-screen app (an iPhone or iPad running the page standalone). */
export function isAppleStandalone(win = window) {
  try {
    const nav = win.navigator
    const apple = /iPhone|iPad|iPod/.test(nav.userAgent || '') || (/Macintosh/.test(nav.userAgent || '') && (nav.maxTouchPoints || 0) > 1)
    return apple && (nav.standalone === true || !!win.matchMedia?.('(display-mode: standalone)').matches)
  } catch { return false }
}

export function measureGap(win = window) {
  try {
    const nav = win.navigator
    const apple = /iPhone|iPad|iPod/.test(nav.userAgent || '') || (/Macintosh/.test(nav.userAgent || '') && (nav.maxTouchPoints || 0) > 1)
    const standalone = nav.standalone === true || !!win.matchMedia?.('(display-mode: standalone)').matches
    if (!apple || !standalone) return 0
    const w = win.innerWidth
    // the shortest of the heights the browser reports: some iOS versions shorten only one of them
    const hs = [win.innerHeight, win.visualViewport?.height, win.document?.documentElement?.clientHeight].filter(n => n > 0)
    const h = Math.min(...hs)
    if (!(h > w)) return 0                                       // landscape: not measured
    const s = win.screen || {}
    const full = Math.max(s.height || 0, s.width || 0)
    const gap = Math.round(full - h)
    return gap >= MIN_GAP && gap <= MAX_GAP ? gap : 0
  } catch { return 0 }
}

export function applyViewportGap(win = window) {
  const gap = measureGap(win)
  const root = win.document.documentElement
  // index.css draws bottom sheets solid there, so the fill under one (the strip below the layout viewport) matches it
  if (isAppleStandalone(win)) root.setAttribute('data-ios-standalone', '')
  const cur = root.style.getPropertyValue('--vgap')
  const next = gap + 'px'
  if (cur !== next) root.style.setProperty('--vgap', next)
  return gap
}

/** Keeps --vgap current. Returns the function that stops it. */
export function installViewportGap(win = window) {
  const run = () => applyViewportGap(win)
  run()
  const ev = ['resize', 'orientationchange', 'pageshow']
  ev.forEach(e => win.addEventListener(e, run))
  win.visualViewport?.addEventListener('resize', run)
  const t = win.setTimeout(run, 400)                             // the standalone window settles a moment after launch
  return () => {
    ev.forEach(e => win.removeEventListener(e, run))
    win.visualViewport?.removeEventListener('resize', run)
    win.clearTimeout(t)
  }
}
