import { useState, useSyncExternalStore } from 'react'
import { useStore } from '../store/useStore.js'
import { t, getLang, useLang } from '../lib/i18n.js'
import { music, TRACKS } from '../lib/music.js'
import Icon from './Icon.jsx'
import AmbientControls from './AmbientControls.jsx'
import { Switch } from './ui.jsx'

// The few words of this card, in the languages the app's other notices speak (English for the rest); the track controls
// reuse words the app already has in every language.
const COPY = {
  en: { settings: 'Workout sound settings', auto: 'Play music in a workout', tap: 'Tap to start the music', missing: 'Song not found' },
  id: { settings: 'Pengaturan suara latihan', auto: 'Putar musik saat latihan', tap: 'Ketuk untuk memulai musik', missing: 'Lagu tidak ditemukan' },
  'pt-BR': { settings: 'Configurações do som do treino', auto: 'Tocar música no treino', tap: 'Toque para iniciar a música', missing: 'Música não encontrada' },
}
const copy = () => { const l = getLang(); return COPY[l] || COPY[String(l).split('-')[0]] || COPY.en }

const useMusic = () => useSyncExternalStore(music.subscribe, () => music.state, () => music.state)

/* The workout's music, as small as it can be: one row with the song, previous / play / next, and a button for the workout
   sound's settings, which open under it. The songs are the app's own (lib/music.js); nothing here needs an account or a
   connection to anything but the app. Folded away it takes one line of the workout screen. */
export default function MusicPanel() {
  useLang()
  const m = useMusic()
  const auto = useStore(s => s.S.musicAuto !== false)
  const update = useStore(s => s.update)
  const [open, setOpen] = useState(false)
  const c = copy()
  const track = TRACKS[m.index] || TRACKS[0]

  return <div className="musicpanel mp" data-testid="music-panel">
    <div className="mp-row">
      <Icon name="speaker" className={'mp-i' + (m.playing ? ' on' : '')} />
      <div className="mp-t">
        <div className="mp-name">{t('Music')} {track.n}</div>
        <div className="mp-sub small muted">{m.error ? c.missing : m.blocked ? c.tap : (m.index + 1) + ' / ' + TRACKS.length}</div>
      </div>
      <button type="button" className="iconbtn mp-b" aria-label={t('Previous track')} onClick={() => music.prev()}>
        <Icon name="skipForward" style={{ transform: 'scaleX(-1)' }} />
      </button>
      <button type="button" className="iconbtn mp-b mp-play" aria-label={m.playing ? t('Pause') : t('Play')} onClick={() => music.toggle()}>
        <Icon name={m.playing ? 'pause' : 'play'} />
      </button>
      <button type="button" className="iconbtn mp-b" aria-label={t('Next track')} onClick={() => music.next()}>
        <Icon name="skipForward" />
      </button>
      <button type="button" className={'iconbtn mp-b' + (open ? ' on' : '')} aria-label={c.settings} aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <Icon name="gear" />
      </button>
    </div>
    {open && <div className="mp-set">
      <AmbientControls compact />
      <div className="mp-auto">
        <span>{c.auto}</span>
        <Switch checked={auto} aria-label={c.auto} onChange={v => update(s => { s.musicAuto = v })} />
      </div>
    </div>}
  </div>
}
