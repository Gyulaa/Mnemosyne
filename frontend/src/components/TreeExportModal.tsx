import { useState, useCallback } from 'react'
import type { PersonFull } from '../types'
import { api } from '../api'
import { useSettings, displayPersonName, displayInitials, useT } from '../SettingsContext'
import type { NameOrder } from '../SettingsContext'
import { useBackdropClose } from '../modalBackdrop'

import { NW, NH } from '../treeGeometry'

interface ExportNode { id: number; person: PersonFull; x: number; y: number }
interface ExportEdge {
  key: string
  type: 'spouse' | 'couple-stem' | 'couple-bar' | 'child-drop' | 'child-single'
  x1: number; y1: number; x2: number; y2: number
}

type Theme = 'dark' | 'light'
type Scale = 1 | 2

const DARK = {
  bg: '#09090b', cardFill: '#27272a', cardStroke: '#3f3f46',
  probandFill: '#1e1b4b', probandStroke: '#7c3aed',
  avatarFill: '#3f3f46', avatarText: '#a1a1aa',
  nameFill: '#f4f4f5', dateFill: '#71717a',
  edgeStroke: '#52525b', spouseStroke: '#7c3aed', star: '#fbbf24',
}
const LIGHT = {
  bg: '#f1f5f9', cardFill: '#ffffff', cardStroke: '#d4d4d8',
  probandFill: '#ede9fe', probandStroke: '#7c3aed',
  avatarFill: '#e4e4e7', avatarText: '#52525b',
  nameFill: '#18181b', dateFill: '#71717a',
  edgeStroke: '#a1a1aa', spouseStroke: '#7c3aed', star: '#d97706',
}

function xe(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

async function toDataUri(url: string): Promise<string | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const blob = await res.blob()
    return await new Promise<string>((ok, fail) => {
      const r = new FileReader()
      r.onload = () => ok(r.result as string)
      r.onerror = fail
      r.readAsDataURL(blob)
    })
  } catch { return null }
}

// Cache so we only fetch once per session
let _fontStyleCache: string | null = null

async function loadFontsForExport(): Promise<string> {
  if (_fontStyleCache !== null) return _fontStyleCache
  try {
    const css = await fetch(
      'https://fonts.googleapis.com/css2?family=Geist:wght@400;600&display=swap'
    ).then(r => r.text())

    // Replace every url(...) in the CSS with an embedded base64 data URI
    const urlRegex = /url\(['"]?([^'")\s]+)['"]?\)/g
    const matches = [...css.matchAll(urlRegex)]
    const pairs = await Promise.all(
      matches.map(async m => ({ orig: m[0], uri: await toDataUri(m[1]) }))
    )
    let embedded = css
    for (const { orig, uri } of pairs) {
      if (uri) embedded = embedded.split(orig).join(`url(${uri})`)
    }
    _fontStyleCache = embedded
    return embedded
  } catch {
    _fontStyleCache = ''
    return ''
  }
}

function buildSvg(
  nodes: ExportNode[], edges: ExportEdge[],
  minX: number, minY: number, canvasW: number, canvasH: number,
  probandId: number | null, theme: Theme, uris: Map<number, string>,
  nameOrder: NameOrder,
  fontStyle: string,
): string {
  const C = theme === 'dark' ? DARK : LIGHT
  const out: string[] = []

  out.push(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${canvasW}" height="${canvasH}" viewBox="0 0 ${canvasW} ${canvasH}">`)
  out.push('<defs>')
  if (fontStyle) out.push(`<style>${fontStyle}</style>`)
  for (const n of nodes) {
    const cx = n.x - minX, cy = n.y - minY
    const avx = cx - NW / 2 + 30
    out.push(`<clipPath id="av${n.id}"><circle cx="${avx}" cy="${cy}" r="20"/></clipPath>`)
    out.push(`<clipPath id="tx${n.id}"><rect x="${cx - NW / 2 + 60}" y="${cy - NH / 2}" width="${NW - 62}" height="${NH}"/></clipPath>`)
  }
  out.push('</defs>')

  out.push(`<rect width="${canvasW}" height="${canvasH}" fill="${C.bg}"/>`)

  for (const e of edges) {
    if (e.type === 'spouse') {
      out.push(`<line x1="${e.x1}" y1="${e.y1}" x2="${e.x2}" y2="${e.y2}" stroke="${C.spouseStroke}" stroke-width="2" stroke-dasharray="5 3" opacity="0.65"/>`)
    } else if (e.type === 'child-single') {
      const my = (e.y1 + e.y2) / 2
      out.push(`<path d="M ${e.x1} ${e.y1} C ${e.x1} ${my},${e.x2} ${my},${e.x2} ${e.y2}" stroke="${C.edgeStroke}" stroke-width="1.5" fill="none"/>`)
    } else {
      out.push(`<line x1="${e.x1}" y1="${e.y1}" x2="${e.x2}" y2="${e.y2}" stroke="${C.edgeStroke}" stroke-width="1.5"/>`)
    }
  }

  for (const n of nodes) {
    const cx = n.x - minX, cy = n.y - minY
    const lx = cx - NW / 2, ty = cy - NH / 2
    const proband = n.id === probandId
    const p = n.person
    const initials = displayInitials(p)
    const span = p.birth_year ? (p.death_year ? `${p.birth_year}–${p.death_year}` : `* ${p.birth_year}`) : null
    const avx = lx + 30, tx = lx + 60
    const uri = uris.get(n.id)

    out.push('<g>')
    out.push(`<rect x="${lx}" y="${ty}" width="${NW}" height="${NH}" rx="10" fill="${proband ? C.probandFill : C.cardFill}" stroke="${proband ? C.probandStroke : C.cardStroke}" stroke-width="${proband ? 2 : 1}"/>`)

    if (uri) {
      out.push(`<image href="${uri}" x="${avx - 20}" y="${cy - 20}" width="40" height="40" clip-path="url(#av${n.id})" preserveAspectRatio="xMidYMid slice"/>`)
    } else {
      out.push(`<circle cx="${avx}" cy="${cy}" r="20" fill="${C.avatarFill}"/>`)
      out.push(`<text x="${avx}" y="${cy + 5}" text-anchor="middle" fill="${C.avatarText}" font-size="12" font-weight="700" font-family="Geist,system-ui,sans-serif">${xe(initials)}</text>`)
    }

    // Split display name into 2 lines if it has multiple words
    const displayName = displayPersonName(p, nameOrder)
    const words = displayName.trim().split(/\s+/).filter(Boolean)
    const mid = Math.ceil(words.length / 2)
    const line1 = words.slice(0, mid).join(' ')
    const line2 = words.length > 1 ? words.slice(mid).join(' ') : null
    const twoLines = line2 !== null && line2.length > 0
    const hasNick = !!p.nickname
    const nfs = twoLines ? '10' : '11.5'

    // Baseline y-positions — NH=82, card center=cy, top=cy-41, bottom=cy+41
    let ny1: number, ny2: number | null, nickY: number | null, dy: number | null
    if (twoLines && span && hasNick)       { ny1 = cy-17; ny2 = cy-4;  nickY = cy+9;  dy = cy+22 }
    else if (twoLines && span)             { ny1 = cy-11; ny2 = cy+2;  nickY = null;  dy = cy+15 }
    else if (twoLines && hasNick)          { ny1 = cy-13; ny2 = cy;    nickY = cy+14; dy = null  }
    else if (twoLines)                     { ny1 = cy-5;  ny2 = cy+8;  nickY = null;  dy = null  }
    else if (span && hasNick)              { ny1 = cy-11; ny2 = null;  nickY = cy+2;  dy = cy+16 }
    else if (span)                         { ny1 = cy-5;  ny2 = null;  nickY = null;  dy = cy+9  }
    else if (hasNick)                      { ny1 = cy-5;  ny2 = null;  nickY = cy+8;  dy = null  }
    else                                   { ny1 = cy+4;  ny2 = null;  nickY = null;  dy = null  }

    out.push(`<g clip-path="url(#tx${n.id})">`)
    out.push(`<text x="${tx}" y="${ny1}" fill="${C.nameFill}" font-size="${nfs}" font-weight="600" font-family="Geist,system-ui,sans-serif">${xe(line1)}</text>`)
    if (twoLines && ny2 !== null) {
      out.push(`<text x="${tx}" y="${ny2}" fill="${C.nameFill}" font-size="${nfs}" font-weight="600" font-family="Geist,system-ui,sans-serif">${xe(line2!)}</text>`)
    }
    if (nickY !== null && p.nickname) {
      out.push(`<text x="${tx}" y="${nickY}" fill="${C.dateFill}" font-size="9" font-style="italic" font-family="Geist,system-ui,sans-serif">„${xe(p.nickname)}"</text>`)
    }
    if (dy !== null) {
      out.push(`<text x="${tx}" y="${dy}" fill="${C.dateFill}" font-size="9.5" font-family="Geist,system-ui,sans-serif">${xe(span!)}</text>`)
    }
    out.push('</g>')

    if (proband) {
      out.push(`<text x="${lx + NW - 7}" y="${ty + 13}" fill="${C.star}" font-size="10" text-anchor="middle">★</text>`)
    }
    out.push('</g>')
  }

  out.push('</svg>')
  return out.join('\n')
}

async function svgToPng(svgStr: string, w: number, h: number, scale: number): Promise<Blob> {
  const blob = new Blob([svgStr], { type: 'image/svg+xml' })
  const url = URL.createObjectURL(blob)
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(w * scale)
      canvas.height = Math.round(h * scale)
      const ctx = canvas.getContext('2d')!
      ctx.scale(scale, scale)
      ctx.drawImage(img, 0, 0)
      canvas.toBlob(b => {
        URL.revokeObjectURL(url)
        b ? resolve(b) : reject(new Error('toBlob returned null'))
      }, 'image/png')
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('SVG render failed')) }
    img.src = url
  })
}

interface Props {
  nodes: ExportNode[]
  edges: ExportEdge[]
  minX: number; minY: number
  canvasW: number; canvasH: number
  probandId: number | null
  onClose: () => void
}

export default function TreeExportModal({ nodes, edges, minX, minY, canvasW, canvasH, probandId, onClose }: Props) {
  const { nameOrder } = useSettings()
  const t = useT()
  const backdrop = useBackdropClose(onClose)
  const [scale,  setScale]  = useState<Scale>(2)
  const [theme,  setTheme]  = useState<Theme>('dark')
  const [photos, setPhotos] = useState(true)
  const [busy,   setBusy]   = useState(false)
  const [err,    setErr]    = useState<string | null>(null)

  const outW = Math.round(canvasW * scale)
  const outH = Math.round(canvasH * scale)

  const run = useCallback(async () => {
    setBusy(true); setErr(null)
    try {
      const [fontStyle, uris] = await Promise.all([
        loadFontsForExport(),
        (async () => {
          const m = new Map<number, string>()
          if (photos) {
            await Promise.all(nodes.map(async n => {
              if (!n.person.thumbnail_face_id) return
              const uri = await toDataUri(api.faceThumbnailUrl(n.person.thumbnail_face_id, 96))
              if (uri) m.set(n.id, uri)
            }))
          }
          return m
        })(),
      ])
      const svg = buildSvg(nodes, edges, minX, minY, canvasW, canvasH, probandId, theme, uris, nameOrder, fontStyle)
      const png = await svgToPng(svg, canvasW, canvasH, scale)
      const url = URL.createObjectURL(png)
      const a = document.createElement('a')
      a.href = url; a.download = `family-tree-${theme}.png`; a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Export failed')
    } finally {
      setBusy(false)
    }
  }, [nodes, edges, minX, minY, canvasW, canvasH, probandId, theme, scale, photos, nameOrder])

  return (
    <div
      className="fixed inset-0 z-[500] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      {...backdrop}
    >
      <div
        className="bg-zinc-900 border border-zinc-700/80 rounded-2xl shadow-2xl overflow-hidden"
        style={{ width: 400, maxWidth: '92vw' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-zinc-800">
          <div>
            <p className="text-xs text-zinc-500 uppercase tracking-widest font-semibold mb-1">{t('treeExport.family')}</p>
            <h2 className="text-sm font-semibold text-zinc-100">{t('treeExport.heading')}</h2>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-zinc-800 hover:bg-zinc-700 flex items-center justify-center text-zinc-400 hover:text-white transition-colors shrink-0">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" d="M6 6l12 12M6 18L18 6"/>
            </svg>
          </button>
        </div>

        <div className="px-5 py-5 space-y-5">
          {/* Resolution */}
          <div>
            <p className="text-xs text-zinc-500 uppercase tracking-wider font-semibold mb-2.5">{t('treeExport.resolution')}</p>
            <div className="flex gap-2">
              {([1, 2] as Scale[]).map(s => (
                <button key={s} onClick={() => setScale(s)}
                  className={[
                    'flex-1 py-2 rounded-lg border text-xs font-medium transition-colors',
                    scale === s
                      ? 'bg-violet-600/20 border-violet-500/60 text-violet-300'
                      : 'bg-zinc-800/50 border-zinc-700 text-zinc-400 hover:border-zinc-600 hover:text-zinc-300',
                  ].join(' ')}>
                  {s === 1 ? t('treeExport.res1x') : t('treeExport.res2x')}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-zinc-600 tabular-nums">{outW.toLocaleString()} × {outH.toLocaleString()} px</p>
          </div>

          {/* Background */}
          <div>
            <p className="text-xs text-zinc-500 uppercase tracking-wider font-semibold mb-2.5">{t('treeExport.background')}</p>
            <div className="flex gap-2">
              {(['dark', 'light'] as Theme[]).map(thm => (
                <button key={thm} onClick={() => setTheme(thm)}
                  className={[
                    'flex-1 py-2 rounded-lg border text-xs font-medium transition-colors flex items-center justify-center gap-2',
                    theme === thm
                      ? 'bg-violet-600/20 border-violet-500/60 text-violet-300'
                      : 'bg-zinc-800/50 border-zinc-700 text-zinc-400 hover:border-zinc-600 hover:text-zinc-300',
                  ].join(' ')}>
                  <span className={`w-3 h-3 rounded-sm border shrink-0 ${thm === 'dark' ? 'bg-zinc-950 border-zinc-600' : 'bg-white border-zinc-300'}`}/>
                  {thm === 'dark' ? t('treeExport.dark') : t('treeExport.light')}
                </button>
              ))}
            </div>
          </div>

          {/* Photos toggle */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-zinc-300">{t('treeExport.includeFaces')}</p>
              <p className="text-xs text-zinc-600 mt-0.5">{t('treeExport.includeFacesDesc')}</p>
            </div>
            <button onClick={() => setPhotos(v => !v)}
              className={['relative w-9 h-5 rounded-full transition-colors shrink-0', photos ? 'bg-violet-600' : 'bg-zinc-700'].join(' ')}>
              <span className={['absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform', photos ? 'translate-x-4' : ''].join(' ')}/>
            </button>
          </div>

          {err && (
            <p className="text-xs text-red-400 bg-red-950/50 border border-red-900/50 rounded-lg px-3 py-2">{err}</p>
          )}
        </div>

        <div className="px-5 pb-5">
          <button onClick={run} disabled={busy}
            className="w-full h-10 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2">
            {busy ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
                </svg>
                {t('treeExport.generating')}
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
                </svg>
                {t('treeExport.download')}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
