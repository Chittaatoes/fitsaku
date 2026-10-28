// An on-screen readout of what the browser reports about the viewport, for diagnosing layout problems on a phone
// where there is no developer console (the strip under popups in the iOS home-screen app). Off unless switched on:
// tap the version line in Settings > About five times (and again five times to switch it off). It shows the build
// that is actually running, so "is the new version in?" has an answer, and numbers that can be read off a screenshot.
import { useEffect, useState } from 'react'

const KEY = 'fs_vpdebug'
export const debugOn = () => { try { return localStorage.getItem(KEY) === '1' } catch { return false } }
export function toggleDebug() {
  const on = !debugOn()
  try { localStorage.setItem(KEY, on ? '1' : '0') } catch { /* private mode */ }
  window.dispatchEvent(new Event('fs-vpdebug'))
  return on
}

const px = n => (Number.isFinite(n) ? Math.round(n * 10) / 10 : '?')

function read() {
  const d = document, w = window
  const probe = d.createElement('div')
  probe.style.cssText = 'position:fixed;left:-99px;top:0;width:1px;visibility:hidden;pointer-events:none'
  d.body.appendChild(probe)
  const h = unit => { probe.style.height = unit; return probe.offsetHeight }
  const pad = side => { probe.style.height = '0'; probe.style.paddingTop = probe.style.paddingBottom = '0'; probe.style['padding' + side] = `env(safe-area-inset-${side.toLowerCase()})`; return parseFloat(getComputedStyle(probe)['padding' + side]) || 0 }
  const m = {
    inner: `${w.innerWidth}x${w.innerHeight}`,
    screen: `${w.screen.width}x${w.screen.height}`,
    visual: w.visualViewport ? `${px(w.visualViewport.height)} @${px(w.visualViewport.offsetTop)}` : 'n/a',
    vh: h('100vh'), dvh: h('100dvh'), lvh: h('100lvh'), svh: h('100svh'),
    safeTop: pad('Top'), safeBottom: pad('Bottom'),
  }
  probe.remove()
  const rect = sel => { const e = d.querySelector(sel); if (!e) return '-'; const r = e.getBoundingClientRect(); return `${px(r.top)}..${px(r.bottom)}` }
  m.standalone = String(w.navigator.standalone === true || !!w.matchMedia?.('(display-mode: standalone)').matches)
  m.modalRoot = rect('#modal-root.open')
  m.sheet = rect('#modal-root .sheet')
  m.body = d.body.style.position === 'fixed' ? 'pinned' : d.body.style.overflow === 'hidden' ? 'locked (overflow)' : 'free'
  return m
}

export default function ViewportDebug() {
  const [on, setOn] = useState(debugOn)
  const [m, setM] = useState(null)
  useEffect(() => {
    const sync = () => setOn(debugOn())
    window.addEventListener('fs-vpdebug', sync)
    return () => window.removeEventListener('fs-vpdebug', sync)
  }, [])
  useEffect(() => {
    if (!on) return
    const tick = () => setM(read())
    tick()
    const id = setInterval(tick, 700)
    return () => clearInterval(id)
  }, [on])
  if (!on || !m) return null
  const build = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'dev'
  const lines = [`build ${build}`, `inner ${m.inner}  screen ${m.screen}`, `visual ${m.visual}`, `vh ${m.vh} dvh ${m.dvh} lvh ${m.lvh} svh ${m.svh}`,
    `safe top ${m.safeTop} bottom ${m.safeBottom}`, `standalone ${m.standalone}`, `body ${m.body}`, `modal ${m.modalRoot}`, `sheet ${m.sheet}`]
  return <pre aria-hidden="true" style={{ position: 'fixed', left: 4, top: 'calc(var(--sat) + 2px)', zIndex: 99999, margin: 0, padding: '4px 6px', borderRadius: 6,
    background: 'rgba(0,0,0,.78)', color: '#7CFFB2', font: '10px/1.35 ui-monospace,Menlo,monospace', pointerEvents: 'none', whiteSpace: 'pre' }}>{lines.join('\n')}</pre>
}
