/**
 * Markdown rendering for note and document bodies.
 *
 * Two app-specific constructs are resolved before the Markdown parse:
 *   @[Name](#pid-12)  — a person mention, becomes a clickable ref
 *   [3]               — a citation marker, becomes a superscript ref
 * Both render as anchors with a known class, so a click handler on the
 * container can turn them into navigation.
 */
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import type { NoteCitation } from './types'

marked.setOptions({ breaks: true, gfm: true })

export function renderMarkdown(content: string, citations: NoteCitation[]): string {
  let processed = content.replace(/@\[([^\]]+)\]\(#pid-(\d+)\)/g, (_, name, id) =>
    `<a href="#person-ref-${id}" class="note-person-ref">@${name}</a>`
  )
  processed = processed.replace(/\[(\d+)\]/g, (_, n) => {
    const nc = citations.find(c => c.marker === parseInt(n))
    if (!nc) return `[${n}]`
    const label = nc.custom_label ?? nc.source_title ?? `Source ${n}`
    return `<sup><a href="#note-ref-${nc.id}" class="note-ref" title="${label.replace(/"/g, '&quot;')}">[${n}]</a></sup>`
  })
  const html = marked.parse(processed) as string
  return DOMPurify.sanitize(html, { ADD_ATTR: ['title', 'href', 'class'] })
}
