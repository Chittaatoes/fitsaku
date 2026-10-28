// The iOS home-screen app (an iPhone or iPad running the page standalone).
//
// Where the page runs like this the popups lock the page with overflow:hidden instead of pinning the body
// (components/Modals.jsx): pinned, iOS shrank the layout viewport by the status bar's height, which cut every sheet
// short of the screen's bottom. index.css keys the sheet's bottom spacing off the attribute set here.
export function isAppleStandalone(win = window) {
  try {
    const nav = win.navigator
    const apple = /iPhone|iPad|iPod/.test(nav.userAgent || '') || (/Macintosh/.test(nav.userAgent || '') && (nav.maxTouchPoints || 0) > 1)
    return apple && (nav.standalone === true || !!win.matchMedia?.('(display-mode: standalone)').matches)
  } catch { return false }
}

/** Marks <html data-ios-standalone> once, at boot, when the page runs as the iOS home-screen app. */
export function markIosStandalone(win = window) {
  if (isAppleStandalone(win)) win.document.documentElement.setAttribute('data-ios-standalone', '')
}
