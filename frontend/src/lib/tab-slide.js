// The motion of the tab bar (components/TabBar.jsx): where the bubble goes under a finger, and how a thing eases toward where it
// is going. Pure, so the feel of it is tested without a screen.

// How quickly the lit tab's pill and the bubble catch up with where they are going: the time, in ms, to cover about two
// thirds of what is left. The pill is the slower of the two: it settles in about a third of a second; the bubble follows the finger
// closely but never jumps.
export const PILL_TAU = 85
export const BUBBLE_TAU = 55
const BUBBLE_PAD = 6           // the lifted pill is a little wider than the tab it is over
const EDGE = 2                 // and never closer than this to the end of the bar

/** One step of easing toward a target: exponential, so it never overshoots, is quickest at the start and settles gently, and
 *  takes the same time to get there at 30 frames a second as at 120 (it depends on the time the frame took, not the frames). */
export function approach(current, target, dtMs, tau) {
  if (!(tau > 0)) return target
  const k = 1 - Math.exp(-Math.max(0, dtMs) / tau)
  return current + (target - current) * k
}
export const settled = (a, b, eps = 0.25) => Math.abs(a - b) < eps

/** The tab under `clientX` (the nearest when the finger is off the bar), and where the bubble belongs: centred on the finger, as
 *  wide as that tab plus a little, kept inside the bar. `boxes` are the tabs' rectangles, `bar` the bar's, both in client pixels;
 *  `inset` is the bar's border. Returns { idx, x, w } with x relative to the bar's inside edge. */
export function locateTab(boxes, clientX, bar, inset = 0) {
  if (!boxes || !boxes.length) return null
  let idx = 0, best = Infinity
  boxes.forEach((r, i) => {
    const d = clientX >= r.left && clientX <= r.right ? 0 : Math.abs(clientX - (r.left + r.right) / 2)
    if (d < best) { best = d; idx = i }
  })
  const w = boxes[idx].width + BUBBLE_PAD
  const inner = bar.width - inset * 2
  const x = Math.min(Math.max(clientX - bar.left - inset - w / 2, EDGE), Math.max(EDGE, inner - w - EDGE))
  return { idx, x, w }
}

/** Where the bubble settles on release: centred on the tab it was released over. */
export function settleOn(boxes, idx, bar, inset = 0) {
  const r = boxes[idx]
  return r ? locateTab(boxes, (r.left + r.right) / 2, bar, inset) : null
}
