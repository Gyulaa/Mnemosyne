/**
 * Markdown rendering for note, document and assistant bodies.
 *
 * Four app-specific constructs are resolved before the Markdown parse:
 *   @[Name](#pid-12)     — a person mention, becomes a clickable ref
 *   [caption](#img-40)   — one photo, opens it in the Images tab
 *   [caption](#people-3,6) — the Images tab filtered to those people (AND)
 *   [3]                  — a citation marker, becomes a superscript ref
 * All render as anchors with a known class, so a click handler on the
 * container can turn them into navigation.
 *
 * Order matters: the citation rule matches `[digits]`, so the link forms must
 * be consumed first or `[3](#img-7)` would be eaten as citation 3.
 */
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import type { NoteCitation } from './types'

marked.setOptions({ breaks: true, gfm: true })

const MENTION_RE = /@\[([^\]]+)\]\(#pid-(\d+)\)/g

/**
 * `@[Name](#pid-12)` → `Name`.
 *
 * A document title stores mention markup like any other mentionable text, but
 * plenty of places need it as flat text: a filename, an `alt`, a `title`
 * attribute, a sort key, a GEDCOM record. Those call this — never the raw
 * string, or the reader sees the brackets.
 */
export function plainMentions(text: string): string {
  return text.replace(MENTION_RE, (_, name) => name)
}

/**
 * Markdown down to readable flat text, for a single clamped line — a table
 * cell, a card excerpt, a search result.
 *
 * `renderMarkdown` would be wrong there: a one-line excerpt has no room for
 * headings, lists or superscript refs, and clamping rendered HTML mid-tag
 * looks broken. But printing the raw string is worse, since the reader then
 * sees `**` and `@[…](#pid-4)` instead of the words.
 */
export function plainMarkdown(text: string): string {
  return plainMentions(text)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')   // [label](url) → label
    .replace(/`([^`]*)`/g, '$1')               // inline code
    .replace(/^#{1,6}\s+/gm, '')               // headings
    .replace(/^[>\-*+]\s+/gm, '')              // quotes and list markers
    .replace(/\*{1,3}|~~|_{2,3}/g, '')         // emphasis marks
    .replace(/\[\d+\]/g, '')                   // citation markers
    .replace(/\s+/g, ' ')                      // collapse the newlines away
    .trim()
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * A one-line title with its `@` mentions as clickable person refs.
 *
 * Deliberately *not* a Markdown parse: a title is a single plain line, so
 * running it through `marked` would wrap it in a `<p>` and reinterpret any
 * stray `*` or `_` in a real name as emphasis. Only the mention form is
 * resolved; everything else is escaped and left alone. The anchors carry the
 * same `note-person-ref` class as in a body, so one click handler serves both.
 */
export function renderTitleMentions(text: string): string {
  const html = escapeHtml(text).replace(MENTION_RE, (_, name, id) =>
    `<a href="#person-ref-${id}" class="note-person-ref">@${name}</a>`
  )
  return DOMPurify.sanitize(html, { ADD_ATTR: ['href', 'class'] })
}

export function renderMarkdown(content: string, citations: NoteCitation[]): string {
  let processed = content.replace(/@\[([^\]]+)\]\(#pid-(\d+)\)/g, (_, name, id) =>
    `<a href="#person-ref-${id}" class="note-person-ref">@${name}</a>`
  )
  processed = processed.replace(/\[([^\]]+)\]\(#img-(\d+)\)/g, (_, label, id) =>
    `<a href="#image-ref-${id}" class="note-image-ref">${label}</a>`
  )
  processed = processed.replace(/\[([^\]]+)\]\(#people-([\d,]+)\)/g, (_, label, ids) =>
    `<a href="#people-ref-${ids.replace(/[^\d,]/g, '')}" class="note-people-ref">${label}</a>`
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
