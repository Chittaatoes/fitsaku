// @vitest-environment happy-dom
// The statistics page is the Progress page now: its old address leads there, query and all, and History's way back lands on
// the same page the Progress tab shows.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import fs from 'node:fs'
import path from 'node:path'
import { StatsRedirect } from './App.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const Where = () => { const l = useLocation(); return <div id="at">{l.pathname + l.search}</div> }
let host, root
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove() })

const go = at => act(() => root.render(
  <MemoryRouter initialEntries={[at]}>
    <Routes><Route path="/stats" element={<StatsRedirect />} /><Route path="/progress" element={<Where />} /></Routes>
  </MemoryRouter>))

describe('/stats', () => {
  it('leads to /progress', () => {
    go('/stats')
    expect(host.querySelector('#at').textContent).toBe('/progress')
  })
  it('with its query: the weekly volume link from Plan still lands on the weekly volume', () => {
    go('/stats?focus=weekly-volume')
    expect(host.querySelector('#at').textContent).toBe('/progress?focus=weekly-volume')
  })
})

describe('where the pages go back to', () => {
  const read = f => fs.readFileSync(path.resolve(__dirname, f), 'utf8')
  it('History, Structural balance and the progress photos go back to /progress, not to a second statistics page', () => {
    for (const f of ['views/History.jsx', 'views/StructuralBalance.jsx', 'views/ProgressPhotos.jsx']) {
      expect(read(f)).toContain(`data-back="/progress" onClick={() => nav('/progress')}`)
      expect(read(f)).not.toContain(`nav('/stats')`)
    }
  })
  it('the router has one page for progress, rendering the statistics, and no other', () => {
    const app = read('App.jsx')
    expect(app).toMatch(/path="\/progress" element=\{<Stats \/>\}/)
    expect(app).toMatch(/path="\/stats" element=\{<StatsRedirect \/>\}/)
    expect(app).not.toMatch(/views\/Progress\.jsx/)
    expect(fs.existsSync(path.resolve(__dirname, 'views/Progress.jsx'))).toBe(false)
  })
})
