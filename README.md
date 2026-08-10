# Mnemosyne

A private app that runs on your computer to organize family photos and build a family tree — complete with face recognition, documents, notes, and a fully interactive tree view.

No account, no cloud, no subscription. Everything stays on your machine — unless you switch on the optional AI assistant, which is off until you add your own API key.

---

# For users

## What is Mnemosyne?

Mnemosyne (pronounced *"m·neh-MO-zin"* — the *m* is lightly voiced, the stress falls on the second syllable) is a desktop application for families who want to keep their photos and genealogy in one place — privately, on their own computer.

You point it at a folder of photos, and it automatically finds and groups faces. You then name the people it found, connect them to your family tree, attach documents (birth certificates, letters, old photos), write notes, and build a complete family history.

**Out of the box, nothing is uploaded anywhere.** Your photos, names, dates and notes stay on your computer, and the app works entirely offline. The face recognition runs locally — nothing is sent away to identify anyone.

Two features can reach the internet, and both are yours to control:

| Feature | What leaves your computer | Default |
|---|---|---|
| **Update check** | A request to GitHub asking whether a newer version exists. No data about you or your family. | On — switch it off in Settings |
| **AI assistant** | Your question, plus the family data needed to answer it, goes to the AI provider you choose (Anthropic or OpenAI). | **Off** — it does nothing until you add your own API key |

The assistant is the only feature that sends your family data anywhere. It is opt-in, it can be switched off entirely in Settings, and anything you marked **private** stays hidden from it unless you explicitly allow it. Your API key is stored on your own computer and never leaves it.

---

## System requirements

| | |
|---|---|
| **Windows** | Windows 10 or newer (64-bit) |
| **macOS** | macOS 11 Big Sur or newer |

No Python, no Node.js, no technical setup needed — just download and run.

---

## Installation

1. Go to the [**Releases**](../../releases) page on GitHub
2. Download the file for your computer:
   - **Windows** → `Mnemosyne-windows.zip`
   - **Mac** → `Mnemosyne-mac.zip`
3. Unzip the downloaded file
4. **Windows**: open the unzipped folder and double-click `Mnemosyne.exe`
   **Mac**: open the unzipped folder, double-click `Mnemosyne.app`

> **Mac note:** On first launch macOS may say the app "cannot be opened because the developer cannot be verified." If that happens, right-click (or Control-click) the app and choose **Open** — then click Open again in the dialog that appears. You only need to do this once.

The app opens in your browser automatically (at `http://localhost:7842`). The browser tab is the user interface — don't close the terminal/icon that launched it.

---

## Getting started

When you open Mnemosyne for the first time, you'll see a mostly empty screen. Here's how to get going:

### Step 1 — Choose a folder to scan

1. Click the **Scan** tab at the top
2. Click **Choose folder** and select the folder where your photos are stored
3. Click **Start scan**

On the very first scan, the app downloads a face-recognition model (~300 MB). This is a one-time download — it won't happen again.

Scanning can take a while for large photo libraries. You can close and reopen the app at any time; it will continue from where it left off.

> **Tip:** Try to avoid duplicate or near-identical photos in your scan folder (e.g. burst shots, edited copies saved alongside originals). The face recognition engine treats each photo independently, so duplicates can create extra noise in the unclassified faces view and make grouping less accurate.

### Step 2 — Name the people

1. Click **Run clustering** (after scanning finishes) to group similar faces together
2. Go to the **Clusters** tab
3. You'll see groups of face thumbnails — each group represents one person
4. Click a group and type the person's name

### Step 3 — Build your family tree

1. Click the **Genealogy** tab
2. Click **Add person** to create a family member
3. Use the person panel on the right to fill in names, birth and death dates, and relationships (parents, children, spouses)
4. To connect a person to their face cluster from the photo library, use the **Link cluster** button in their profile

From here you can also attach documents, write notes with citations, and find the relationship path between any two people.

---

## What you can do

### Photos
- Browse and search all your scanned photos
- See which people appear in each photo
- Filter photos by person — useful for "show me all photos with Grandma"

### Family tree
- An interactive tree you can zoom and pan
- Click any person to see their full profile
- Control how many generations and cousins are shown
- Export the tree as a PNG image (screen or print quality)

### People profiles
- Full name, birth/death/christening/burial details
- Age is calculated automatically
- Parents, children, siblings, and spouses are listed with links
- Attach documents (PDFs, images, audio) directly to a person
- Write notes in plain text — they support **bold**, *italic*, headings, and lists
- Add footnote citations to your notes and link them to sources

### Documents
- Attach birth certificates, passports, letters, land records, wills, and more
- Documents can be linked to multiple people at once
- Preview images and PDFs right in the app
- Select multiple documents and download them as a ZIP

When you click **New**, Mnemosyne asks whether you want to upload a file you already have, or write a document right there.

**Writing a document in the app** is meant for the things that were never on paper — a family chronicle, a transcription of an old letter, notes from an afternoon of research:

- Write in **Markdown**: headings, **bold**, *italic*, lists, quotes. A Preview tab shows how it will look
- Type **@** to mention a person — the name becomes a link straight to their profile
- Use **Cite** to add a `[1]`-style reference to another document, an existing source, or any free text you type ("Grandma's account, 1998"). References are listed at the bottom of the document
- **Attach photos** from your library to illustrate the text

Text documents behave like any other document everywhere else: they can be linked to several people, filtered, searched, downloaded, and they travel with every export.

### Events
- Record family events: births, marriages, military service, emigration, and more
- Associate multiple people with each event
- See events on a chronological timeline

### Connections
- See who appears in photos together most often
- Interactive force-directed graph showing social connections within your family

### Privacy
Any item can be marked **private**. Private items are **never exported** — not in ZIP archives, not in GEDCOM files — regardless of all other export settings. The AI assistant cannot see them either, unless you explicitly allow it in its settings.

| What | How to mark |
|---|---|
| Photos | Select one or more photos → **Make private** in the selection toolbar |
| Face clusters | Padlock icon on the cluster card |
| Relations (parent/child/sibling/spouse) | Padlock icon next to the person chip |
| Documents | Padlock icon in the document row (hover to reveal) |
| Notes | Padlock icon in the note card header |
| Events | Padlock icon on the event card or in the event detail view |

Private items show an **amber padlock** so they are always visible. Public items show a gray padlock on hover. Click either to toggle.

Only you can restore a private item to public — there is no "auto-export private" setting.

### Language and name order
- The interface is available in **English** and **Hungarian**
- Switch anytime from **Settings** (gear icon, top right) → **Language**
- The choice is saved locally and persists across sessions
- The built-in document type names are translated too. If you rename a type yourself in **Manage types**, your own wording is kept in both languages
- **Name order** (Settings → given name first, or family name first) applies everywhere a person's name is shown — the tree, profiles, mentions, and the document lists and pickers. Searching works with either order, so "Anna Miklós" and "Miklós Anna" both find the same person

### Telling people apart
Four relatives can easily share a name. Wherever you pick a person from a list — linking a document, mentioning someone with **@**, assigning a face cluster — each entry shows their years and, underneath, their closest family: **♥** spouse, **↑** parents, **↓** children.

### Search
- Press **Ctrl+K** (Windows) or **Cmd+K** (Mac) to search everything at once — names, documents, notes — from anywhere in the app

### Relationship finder
- Select any two people and find the shortest path between them in the family tree
- Shows the chain of relationships step by step
- Line style encodes the relationship: an arrow always points at the **child** in a parent/child link, spouses are joined by a **double line**, siblings by a plain line
- Export the chain as a PNG image

### AI assistant (optional)

This is the one feature that sends your family data off your computer, so it is off until you decide otherwise.

- **Off until you turn it on.** It needs an API key — either [Anthropic](https://console.anthropic.com) or [OpenAI](https://platform.openai.com/api-keys) — stored on your own computer and never sent anywhere except to that provider. You can save both keys and switch between them
- **Switch it off any time** in Settings → *Enable assistant*. The floating button and the Ctrl+J shortcut disappear with it, and nothing is sent anywhere
- Click the sparkle button in the bottom-right corner (or press **Ctrl+J**) to open it beside whatever tab you are on — ask about your tree in plain language and the tree stays visible while it answers
- It can **only read** your data. It cannot create, edit or delete anything
- Every person and photo it mentions becomes a link — to the profile, or to the gallery filtered to exactly those pictures — so you can check any claim it makes
- You see each lookup it performs, and can expand any of them to read the raw result
- Anything you marked **private** stays hidden from it unless you explicitly allow it
- It knows who *you* are from the person the family tree opens on, so "my grandfather" means yours. Pin that person with the pin button on the genealogy tab
- Conversations are saved with the project and are **never included in any export**

---

## Updating

Mnemosyne can update itself automatically. Here's how:

1. When you open the app, it quietly checks if a new version is available (after about 5 seconds)
2. If an update is found, a small **colored dot** appears on the cloud icon in the top-right corner of the header
3. Click the cloud icon to open the update window
4. Click **Download update** and wait for it to finish (you can keep using the app while it downloads)
5. Click **Apply & Restart** — the app will close, update itself, and reopen

**Your family tree, photos, and settings are completely safe.** The update process copies your data to the new version before making any changes.

If you prefer to check for updates manually, go to **Settings** (gear icon, top right) → turn off **Auto-check on startup** → then click the cloud icon whenever you want to check.

---

## Your data

- **Your source photos are never modified.** Mnemosyne only reads them; it never moves, renames, or changes the original files.
- **By default, nothing leaves your computer.** The app works fully offline. Two features can reach the internet, both under your control:
  - the **update check** against GitHub (turn it off in Settings) — it sends no data about you;
  - the **AI assistant**, which is off until you add an API key. While it is on, your questions and the family data needed to answer them go to the provider you picked. Switch it off in Settings and the widget, the shortcut and the network traffic all go with it.
- All your data (family tree, notes, documents) is stored in a folder called `projects/` next to the app. You can back it up by simply copying that folder.

---

# For developers

## Features (technical detail)

### Scan
- Face detection and ArcFace embedding (insightface `buffalo_l` model)
- DBSCAN clustering with centroid-based person recognition across re-runs
- HEIC/HEIF support (iPhone photos)
- Resumable scanning — picks up where it left off after interruption
- EXIF metadata extraction (date, camera, resolution)

### Clusters
- Rename, merge, and delete clusters
- Assign unknown faces to existing or new clusters (with similarity suggestions)
- Link a cluster to a genealogy person (1 person : 1 cluster)
- Preview of the 4 most recent photos per cluster (sorted by EXIF date)
- Batch-delete clusters; empty clusters removed automatically after re-clustering (linked person preserved)
- Export selected clusters to a ZIP archive

### Sub-cluster centroid matching
For people whose photos span many years, a single average centroid drifts away from both young and old photos and causes new imports to create separate clusters instead of matching the existing person.

After each link, rename, or merge operation — and at the end of every `run_clustering` call — the app runs a secondary DBSCAN on all faces belonging to each named person (epsilon 0.30, minimum 5 faces per sub-cluster). The resulting per-age-range centroids are stored in the `person_subclusters` table. During the next clustering run, Phase 3 (centroid pre-assignment) compares each unclassified face against **all** sub-cluster centroids instead of a single averaged centroid, giving robust recall across decades of photos. Persons with fewer than 5 total faces fall back to the single-centroid approach.

### Connections
- Connection strength between people: **shared photos** count and **weighted** score (Σ 1/n for group photos)
- Force-directed graph view (interactive: zoom, pan, drag)
- Ranked list view sorted by strength
- Click a connection line to filter the Images tab to those two people's shared photos

### Genealogy

**Family tree**
- Interactive proband-centric tree with Reingold-Tilford layout and Ahnentafel ancestor positioning
- Ancestor depth and cousin-degree (lateral depth) controls
- Collapse/expand subtrees; collapsed nodes show a hidden-person count
- Shift+click any node to refocus the tree on that person
- **Pin a default proband** with the pin button in the bottom-right controls: the tree opens on that person instead of the first in the list. Stored server-side as `default_proband_id` in `projects/<id>/project.json` — it belongs to the project rather than to one browser profile, travels with `projects/` through an auto-update, and is what the AI assistant reads to know who "I" means. A value left in `localStorage` by an older build is migrated on first load. Precedence: in-session selection > pin > first person; a pin naming a deleted person falls back silently
- Export as PNG: 1× or 2× DPI, dark or light background, with or without face photos

**Person profile**
- Full name: title, given, middle, surname, nickname
- Birth/death/christening/burial: date and place (partial ISO dates supported)
- Age calculation: "Lived N years" or "N years old today"
- Additional biographical fields: occupation, education, religion, nationality, cause of death
- Relations section: parents, children, siblings, spouses — sorted chronologically
- Duplicate relationship detection

**Notes**
- Markdown (headings, bold, italic, strikethrough, lists, blockquotes, code)
- Footnote citations: `[n]` markers — source citations (links to a Source record) or custom-text citations (free-form)
- Auto-cleanup: deleting a `[n]` marker removes the corresponding citation record
- `@` mentions: type `@` for a person picker; inserts `@[Name](#pid-ID)` which renders as a clickable link
- Fully searchable via global search palette

**Sources**
- Fields: title, type, author, year, publisher, location, URL, description
- Linkable to a document or event
- Only sources with at least one citation (or linked to a document/event) appear in the citation picker
- An event's "use as source" control in `EventDetailView` is a real on/off toggle, not a one-shot button: it reflects `PersonEvent.source_id` (null when the event has no linked `Source`) and calls `POST /api/events/{id}/promote-to-source` to turn on — idempotent like the document version, reusing the existing `Source` via `Event.source` if one is already linked — or `DELETE /api/sources/{id}` to turn off, which cascades to any citations already made from it

**GEDCOM interoperability**
- **Import**: `.ged` file → persons (including occupation, education, religion, nationality, cause of death), relations, events, notes, sources, documents; preview wizard for merge/create/skip decisions per person
- **Export**: standards-compliant GEDCOM 5.5.1 with UTF-8 encoding; see [GEDCOM export](#gedcom-export) below

### Privacy

`is_private BOOLEAN NOT NULL DEFAULT 0` is present on six tables: `images`, `clusters`, `relations`, `documents`, `person_notes`, `events`. Added by the v4→v5 schema migration.

**Toggle endpoints** — all are `PATCH` and accept `{ is_private: bool }`:

| Resource | Endpoint |
|---|---|
| Image | `PATCH /api/images/{id}/privacy` |
| Cluster | `PATCH /api/clusters/{id}/privacy` |
| Relation | `PATCH /api/relations/{id}` (via general update, `is_private` field) |
| Document | `PATCH /api/documents/{id}` (via general update, `is_private` field) |
| Note | `PATCH /api/notes/{id}` (via general update, `is_private` field) |
| Event | `PATCH /api/events/{id}` (via general update, `is_private` field) |

**Export enforcement** is applied in three independent layers, so no single mistake exposes private data:

1. **ZIP export** (`export_utils.py` → `build_export_db`): after all other filters run, a privacy filter block deletes private rows from the in-memory copy of the DB before it is packed into the ZIP. Private images and their faces are removed; private clusters have their faces moved to the noise cluster (`label=-1`) and are then deleted; private relations, notes, events, and documents are deleted with their child rows.

2. **GEDCOM export** (`gedcom_export.py` → `build_gedcom_zip`): all six queries that could expose private data use `WHERE COALESCE(is_private,0)=0`. The `COALESCE` handles legacy databases that predate the v5 migration. Private event_person rows pointing to private events are silently skipped because the events are not in `events_by_id`.

3. **AI assistant tools** (`ai/tools.py` → `_priv_ok`): every tool drops private rows unless the user turned on `allow_private` in the assistant settings. Note `persons` has no `is_private` column — a person is never private, only their relations, notes, documents, events, clusters and images are, so filtering happens on those. The tree primer applies the same filter to relations, which means the private and non-private primers are different strings and therefore separate prompt-cache entries — correct, and free.

**Frontend**: amber padlock (always visible) when private, gray padlock (hover-only) when public. Implemented in `NoteEditor.tsx` (`NoteCard`), `PersonPanel.tsx` (`DocRow`, `RelRow`, spouse section), `EventsTab.tsx` (`EventCard`, `EventDetailView`), `ClustersTab.tsx` (`ClusterCard`), `ImagesTab.tsx` (bulk toolbar "Make private" button).

### Events
- Types: birth, death, marriage, emigration, military, education, occupation, religious, travel, award, and custom
- Any number of persons per event; date, place, description fields
- Chronological timeline view
- `EventPerson.event_face_id` carries a face cropped from the event's **own** photos, so chips show the person at the right age rather than their default portrait. Resolved in `_event_face_map()` (Face -> Cluster -> Person over the event's images, one query per event, earliest image wins) and attached in `_event_dict()`, which every event-returning endpoint funnels through. `null` when the person isn't recognised in any event photo - clients fall back to `thumbnail_face_id`

### Documents
- Types: birth/death/marriage certificates, passports, military records, land records, wills, letters, photographs, audio
- Type labels live in the `document_types` table, seeded in English by the v2→v3 migration, so they cannot be localised at the source. `frontend/src/docTypes.ts` translates them by their stable `key` via `docType.<key>` translation keys — but only while the stored label still equals the original seed, otherwise a user rename in the type manager would be silently ignored. User-created types are never remapped
- Image preview and PDF link in the document viewer modal
- Notes with citations and @ mentions attachable to documents
- Bulk selection and ZIP download; see [Document bulk download](#document-bulk-download)

**Two ownership columns, and why both exist.** `documents.person_id` is the original single owner; `document_persons` is the many-to-many junction every listing actually joins on. They must be kept in step by hand:

- `merge_persons` re-points `document_persons` rows at the target with `UPDATE OR IGNORE` (the plain `UPDATE` would collide when both people are linked to the same document), then deletes the leftovers. Without this the junction rows are FK-cascaded away with the source person and the document silently disappears from every listing while still existing in the table
- `delete_person` hands ownership of that person's documents to a co-linked person before deleting them, because `Person.documents` cascades `all, delete-orphan` and would otherwise destroy documents shared with others. Only when nobody else is linked is the document dropped — and then its file is unlinked from disk, which the ORM cascade does not do

**Text documents** (`documents.is_text = 1`, schema v6) are written in the app instead of uploaded. The Markdown body is stored as a `.md` file in `projects/<id>/documents/` under the usual UUID `stored_name`, so downloads, bulk ZIPs, project exports and GEDCOM media all handle them without special-casing. `filename` is a slug of the title and is re-derived whenever the title changes, so archives stay readable.

| Concern | Table / endpoint |
|---|---|
| Body | `GET` / `PUT /api/documents/{id}/text` → `{ content }` |
| Create | `POST /api/documents/text` — requires at least one `person_ids` entry |
| `[n]` references | `document_citations` · `POST /api/documents/{id}/citations`, `DELETE /api/document-citations/{id}` |
| Attached photos | `document_images` · `POST /api/documents/{id}/images`, `DELETE /api/documents/{id}/images/{image_id}` |

`document_citations` mirrors `note_citations` exactly (`source_id` NULL means a free-text citation carried in `custom_label`), so the same renderer and References panel work for both. Citing a document from the editor calls `promote-to-source` first, which is idempotent — citing the same document twice reuses one `Source`.

### Person pickers

`frontend/src/familyContext.tsx` is the single source for the close-relative context shown under a name in every picker: `useFamilyContext(persons, relations, nameOrder)` returns id → `{ spouses, parents, children, siblings }` with names already rendered in the configured order, and `<FamilyContextLines>` renders the ♥ / ↑ / ↓ / ~ lines (capped at two names each, siblings only when nothing closer exists). `components/PersonSelect.tsx` builds `PersonMultiSelect` and `PersonFilterCombobox` on top of it.

Document payloads carry the individual name parts (`_doc_person_dict` in `main.py`), not just the stored display name — `persons.name` is always composed by `_derive_display_name()` in one fixed order, so a client that only receives it cannot honour the name-order setting.

### Global Search
- **Ctrl+K** / **Cmd+K** — searches persons (name, nickname), events, documents, and note content simultaneously
- Keyboard navigation: ↑ ↓ to move, Enter to open, Escape to close

### Relationship Path Finder
- BFS shortest path between any two persons
- Snake-layout chain display (up to 5 persons per row)
- Edge rendering encodes direction: `parent` edges point forward, `child` edges point backward, so the arrowhead always lands on the child. Odd rows render `flex-row-reverse`, so the visual direction is XOR-ed against the row's RTL flag. Spouse edges draw as a double rule instead of an arrow. The PNG exporter mirrors this logic - change both or they drift apart
- Blood vs. marriage-relative badge, Lowest Common Ancestor annotation
- **Export as PNG** — see [Relationship path export](#relationship-path-export)

---

## AI assistant (implementation detail)

Lives in `backend/ai/`. Read-only, opt-in, and off until an API key is stored.

### Why not RAG

The genealogy data is small but **relational** — the value is in the edges, the dates and the counts. Chunking it into a vector index destroys exactly that: a family tree flattened into embeddings can no longer answer "how many grandchildren", "who lived longest", or "how are these two related". The scale confirms it — `SearchPalette.tsx` already loads every person, event, document and note into memory, and `RelationPathModal.tsx` runs BFS over the whole relation graph client-side.

So instead: **tool use over SQL**, plus a cached skeleton of the whole tree in the prompt. Free-text search is plain Python matching over the notes/documents/sources corpus; at this size an FTS5 index would be pure overhead, and Python gives accent-insensitive matching that SQLite's ASCII-only `LIKE` cannot (`_norm()` follows the NFD approach of `_make_id` in `project_manager.py`).

### Fat tools, and why lines of descent are walked server-side

The tools push computation *into* the tool rather than leaving it to the model. `get_ancestors` is the clearest case and exists because of a real failure mode: given names repeat constantly in a family tree, often between a father and his son. A model tracing a line by chaining `get_person` calls collapses two same-named people into one and silently drops a generation — a confident, wrong, and entirely plausible-looking answer.

So the walk happens in `_t_get_ancestors`, and the result carries ids and generation numbers the model cannot conflate. The primer additionally lists every duplicated name with its ids, and the system prompt forbids identifying anyone by name alone.

**Picking the next person up a paternal line uses the surname before `sex`.** `sex` is a single field that is easy to mis-enter, and an inverted value is a common defect in a hand-built tree, whereas a surname carrying from father to child is corroborated by every other record. When the two signals disagree the tool follows the surname and returns a note saying the `sex` value looks wrong, so a data defect surfaces as a data defect instead of a truncated ancestry. A lone parent is followed only when their sex is *unrecorded*; following one recorded as the opposite sex is how a paternal line silently becomes a maternal one.

### Both directions, and estimates from the data

`get_ancestors` has a counterpart, `get_descendants` — without it the assistant reported a dead end for a person who had no recorded parents but 49 descendants across six generations, because the only way down the tree was repeated `get_person` calls.

`estimate_life_period` answers "roughly when did this undated person live". It measures **the family's own** median parent-child birth gap rather than assuming a textbook 25–30 years — a branch can run to a materially longer rhythm, and the generic figure multiplied by a few generations can misplace a birth by a century. The sample is taken from the subject's own blood line where at least five dated pairs exist, and falls back to the project as a whole below that, reporting which was used.

Its anchors are found by two **one-directional** walks — pure ancestors, pure descendants. A single walk that may travel both ways drifts sideways through marriages (down to a shared child, back up to the other parent) and starts offering in-laws from unrelated branches as evidence: generationally correct, evidentially worthless.

### Photo-library use is a first-class case

Mnemosyne is also used purely to organise photographs and events, so the tool surface covers that too: `get_photo_stats` (totals per decade, who appears most, how much is unidentified), `find_photos` (by people together or individually, year range, faces nobody has named), and `find_shared_photos`. Every photo answer carries a `#people-…` gallery link, because the point is to act on the set — select, tag, export — not to read a list of ids.

### Guessable values must be discoverable

`event_type` is a stored vocabulary (`religious`, `custom`, …) that rarely matches the word a question uses — a filter of `confirmation` matched nothing, which the model reported as "the event was never recorded". Two mitigations: `build_vocabulary()` puts the project's actual `event_type` and `doc_type` values in the cached prefix, and `list_events` returns the available types in a `note` whenever a type filter matches nothing. The general rule for this tool layer: **an empty result must never be mistakable for an absent fact.**

For the same reason `get_person(include=['events'])` returns each event's attendees. Returning the event without them reads as "nobody was recorded", which is a different claim from "you didn't ask".

### Truncation must be visible

Every list-returning tool goes through `_capped()`, which returns `count`, the true `total`, and a `truncated` flag with an explicit warning. This exists because a silent cap produced a confidently wrong answer: asked how many photos contained two people, the model called `list_photos_of` for each, got 50 of 340 and 50 of 67, intersected the two truncated lists and reported 15. The real answer is 45.

A truncated list is indistinguishable from a complete one unless the tool says so — the same failure shape as an empty result reading as an absent fact. `find_shared_photos` then removes the need for that intersection altogether by computing it server-side.

### Who the assistant thinks you are

Nothing else in the prompt identifies the user, so a question like "who is my oldest ancestor" would otherwise be unanswerable. `build_asker_note()` resolves it from the project's stored `default_proband_id` — the same person the tree opens on — and states the id in the system prompt, at request time. It is never baked into prompt text, and with no proband set the model is told to ask rather than guess. The prompt also tells it to say who it took the asker to be, so a wrong pin surfaces immediately.

### Clickable references

Raw ids in an answer are dead ends — a user cannot click the number `299`. `markdown.ts` resolves four constructs, and the system prompt requires them:

| Written by the model | Renders as | Click goes to |
|---|---|---|
| `@[Name](#pid-42)` | `a.note-person-ref` | that person's profile |
| `[caption](#img-40)` | `a.note-image-ref` | that photo in the Images tab |
| `[caption](#people-3,6)` | `a.note-people-ref` | Images tab filtered to photos containing **all** of them |
| `[3]` | `a.note-ref` | the citation |

The gallery form reuses `navToImages`, which the Connections tab already uses and which sets `include_mode: 'and'` — so the link lands on exactly the set the assistant counted, ready to select and export. **Order matters in `markdown.ts`:** the citation rule matches `[digits]`, so the link forms must be consumed first or `[3](#img-7)` is eaten as citation 3.

### Read-only, three independent layers

| Layer | Where |
|---|---|
| `PRAGMA query_only=ON` on a dedicated connection pool — writes raise `SQLITE_READONLY` | `configure_readonly_engine` in `database.py`, `ProjectManager.get_readonly_db()` |
| Tools are the only data path; no model-written SQL is executed in any form | `ai/tools.py` |
| `Tool.mutates=True` is rejected at registration | `ToolRegistry.register` |

`query_only` is used rather than a `mode=ro` URI because the latter can fail outright on a WAL database needing recovery.

### The tree primer

`ai/primer.py` serialises the whole tree as one pipe-delimited line per person (`id | Surname/Given | sex | birth-death | parent ids | spouse ids`) — a few thousand tokens for a tree of a few hundred people. It sits behind the single `cache_control` breakpoint, so it is read back at ~0.1x cost.

**No cache-invalidation bookkeeping exists, deliberately.** The serialisation is deterministic (sorted by id, no timestamps), so unchanged data produces identical bytes and hits the cache, and changed data produces different bytes and correctly misses. Anything non-deterministic added here silently destroys the cache-hit rate — verify with `usage.cache_read_input_tokens`, which the orchestrator records per assistant message.

Names in the primer are written `Surname/Given` precisely because they are order-neutral; the system prompt tells the model which order to *render*. Tools return name parts for the same reason (see `_person_stub`) — `persons.name` is always composed in one fixed order by `_derive_display_name()`.

### Provider abstraction

`ai/provider.py` defines `LLMProvider` plus a neutral message shape and a `ProviderEvent` union. Two adapters implement it:

| Adapter | Serves | Notes |
|---|---|---|
| `AnthropicProvider` | Anthropic | `thinking: {type: "adaptive"}` + `output_config.effort`. Do **not** add `temperature`, `top_p` or `budget_tokens` — all three are rejected with a 400 on current models. Explicit `cache_control` breakpoint on the primer |
| `OpenAICompatProvider` | OpenAI today; OpenRouter / Ollama / LM Studio by setting `base_url` alone | Chat Completions API. Uses `max_completion_tokens`, and `stream_options.include_usage` (usage is otherwise absent from a streamed response) |

Nothing provider-specific may leak above the protocol. Three differences are absorbed inside `OpenAICompatProvider`: the system prompt becomes an ordinary message (and the `cache_control` markers are dropped — OpenAI caches long prefixes automatically), tools are wrapped in a `function` envelope, and **streamed tool arguments arrive as fragments that must be reassembled per `index`** before they parse as JSON. That last one is the part that breaks silently if reimplemented carelessly.

### Providers, keys and models

Keys and the selected model are stored **per provider** in the `ai` block of `config.json`:

```json
"ai": { "provider": "openai",
        "keys":   { "anthropic": "sk-ant-…", "openai": "sk-proj-…" },
        "models": { "anthropic": "claude-opus-5", "openai": "gpt-5.1" } }
```

so switching provider does not mean re-entering credentials. `_ai_block()` migrates the older single-key layout on read. `save_settings` applies `api_key`/`model` to the provider being set *in the same call*, so "switch to OpenAI and paste its key" works as one request.

### The model list is fetched, not hardcoded

`models.json` is **metadata, not a gate**. What a model *is* comes from the provider's own `/models` endpoint, so a model released after this build appears without a code or manifest change.

`GET /api/ai/models?provider=…` returns the merged list: curated entries first (keeping their labels, notes and prices), then everything else the account can use, with fallback capabilities. The live ids are cached in `config.json` under `ai.discovered` and refreshed automatically once a week (`CACHE_MAX_AGE_DAYS`), or on demand with `?refresh=true`.

Three rules keep the picker from ever going empty or stale:

- **A failed refresh never clears it.** The endpoint falls through to the cached list, or to the manifest, and reports the failure in an `error` field alongside the models.
- **Non-chat models are filtered out** by `is_chat_model()` — providers list embeddings, TTS, transcription and image models on the same endpoint. The substring list is deliberately conservative: showing one odd id is better than hiding a usable model.
- **The picker also accepts a typed model id**, so nothing is blocked even if discovery is unavailable. Combined with the `caps` fallback, an unknown id degrades to a conservative capability set rather than an error.

### Model manifest

`backend/ai/models.json` declares capabilities and pricing. **Code branches on `caps.*`, never on a model id** — adding a model is a manifest edit, not a code change, and an unknown model falls back to a conservative capability set rather than being blocked.

It is a **bundled** file, so it is read from `MNEMOSYNE_BUNDLE_DIR` (spec `datas` target `ai`), not `MNEMOSYNE_APP_DIR`. This is the same distinction that made `version.txt` report `dev` in every packaged build — see *Auto-update*.

### Why the API key lives in `config.json`

The updater copies only `projects/`, `config.json` and `models/` into the new version. A separate secrets file at the app-dir root would be silently wiped by every auto-update, so the key goes in the `ai` block of `config.json`. `ProjectManager._write_config` merges rather than replaces for the same reason — a project switch must not drop the block.

### Conversations

Stored in the project database (v7) so they survive restarts and stay with the project they are about. `build_export_db` deletes all three tables **unconditionally, before any other filter** — the export copies the whole database and only then filters, so the absence of an export toggle is not protection.

The deletion happens on the **copy**, never on the project. Exporting does not clear the user's own history — `_vacuum_copy` writes a separate file and every filter in `build_export_db` operates on that. Verified end to end: a project with conversations exports a ZIP whose database contains zero chat rows while the original keeps all of them. History is replayed to the model as **text only**; tool calls are persisted for the UI but not fed back, which keeps history compact and makes each turn re-read the database (correct when the user edits the tree between questions).

### Frontend

`AssistantPanel.tsx` sits beside `<main>` rather than over it, so the tree stays visible while the assistant answers. Streaming is a `fetch` + `ReadableStream` read (`api.ai.stream`), deliberately not react-query — it is a long-lived body read, not a cache entry. Thread and message lists are ordinary react-query.

Answers render through the existing `markdown.ts`: the system prompt requires `@[Name](#pid-ID)` mentions, which already become `a.note-person-ref` anchors, and the panel delegates clicks on them to `navToGenealogy` exactly as `NoteEditor.tsx` and `DocumentViewer.tsx` do. That is the feature's main defence against hallucination — every claim is one click from its source.

---

## Auto-update (implementation detail)

The updater module lives in `backend/updater.py`. It runs as a state machine:

```
idle → checking → up_to_date
                → dev_build          (version unknown, cannot compare)
                → update_available → downloading → ready → applying
any  → error
```

State is held in a module-level dict (`_state`) protected by a `threading.Lock`. All state transitions happen in daemon background threads.

**Version format**: `build-YYYYMMDD-N` where N is `github.run_number` (not zero-padded). Comparison uses `_parse_version()` which returns `(int(date), int(run_number))` tuples — necessary because `"9" > "14"` as strings.

**Platform behaviour**:

| Platform | ZIP structure | Updater script | Relaunch |
|---|---|---|---|
| Windows | Files at ZIP root (CI: `Compress-Archive -Path dist\Mnemosyne\*`) | `%TEMP%\mnemosyne_updater.bat` — `robocopy /E /IS /IT` | `start "" "%APP%\Mnemosyne.exe"` |
| macOS | `Mnemosyne.app/` at ZIP root | `/tmp/mnemosyne_updater.sh` — `mv`; falls back to `osascript` admin prompt if in `/Applications` | `open "$OLD"` + `xattr -cr` to clear quarantine |

**Two different directories — do not confuse them.** `launcher.py` exports both:

| Env var | Frozen value | Holds |
|---|---|---|
| `MNEMOSYNE_APP_DIR` | Windows: dir containing `Mnemosyne.exe` · macOS: `Mnemosyne.app/Contents/MacOS/` | User data (`projects/`, `config.json`) and the update target |
| `MNEMOSYNE_BUNDLE_DIR` | `sys._MEIPASS` — under PyInstaller 6 onedir this is `<exe dir>/_internal/` | Everything from the spec's `datas`, including `version.txt` |

`get_current_version()` must therefore read `version.txt` from the **bundle** dir first, not the app dir. Spec `datas` with target `'.'` land in `_internal/`, one level *below* `MNEMOSYNE_APP_DIR`. Reading only the app dir silently yields `'dev'` in every packaged build — which, combined with the `dev` guard below, made released apps report themselves as permanently up to date. The file is read with `utf-8-sig` so a BOM from a PowerShell 5.1 `Out-File -Encoding utf8` step cannot corrupt the tag.

The app exits via `os._exit(0)` (not `sys.exit`) one second after launching the updater script, to guarantee the process terminates even if FastAPI shutdown hooks are slow.

**Unversioned builds**: when `current_version == 'dev'` the tag cannot be compared, so `_do_check()` reports status `dev_build` rather than `up_to_date` — claiming "up to date" here hides real updates. The UI surfaces it as its own state with a link to the release page. `apply_update()` still raises `RuntimeError` when `IS_FROZEN` is false.

---

## Prerequisites

| Tool | Version |
|---|---|
| Python | 3.11+ |
| Node.js | 18+ |

> **Windows:** building `insightface` may require the [Visual C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) ("Desktop development with C++" workload).

---

## Running from source

```bash
git clone <repo-url>
cd Image-Organizer
```

### Python backend

```bash
python -m venv .venv

# Activate
.venv\Scripts\activate          # Windows
source .venv/bin/activate       # macOS / Linux

pip install -r requirements.txt
```

### Frontend

```bash
cd frontend
npm install
cd ..
```

### Start

**Terminal 1 — backend:**
```bash
.venv\Scripts\activate          # Windows
source .venv/bin/activate       # macOS / Linux

python -m uvicorn backend.main:app --reload --port 8000
```

**Terminal 2 — frontend:**
```bash
cd frontend
npm run dev
```

Open: **http://localhost:5173**

---

## Project structure

```
Image-Organizer/
├── backend/
│   ├── main.py              # FastAPI app, all REST API endpoints
│   ├── scanner.py           # Background, resumable file scanner
│   ├── clusterer.py         # DBSCAN + centroid-based clustering
│   ├── database.py          # SQLite schema, SQLAlchemy models, startup migrations
│   ├── schemas.py           # Pydantic request/response models
│   ├── project_manager.py   # Multi-project management
│   ├── updater.py           # Auto-update state machine + platform scripts
│   ├── export_utils.py      # ZIP export/import pipeline
│   ├── gedcom_import.py     # GEDCOM .ged importer
│   ├── gedcom_export.py     # GEDCOM 5.5.1 exporter
│   └── image_utils.py       # HEIC conversion, thumbnail cropping
├── frontend/
│   └── src/
│       ├── App.tsx                    # Tab navigation, global search, cross-tab routing
│       ├── api.ts                     # Typed API client
│       ├── types.ts                   # TypeScript interfaces
│       ├── SettingsContext.tsx        # Global settings (name order, language, auto-update toggle)
│       ├── docTypes.ts                # Built-in document type keys + translated labels
│       ├── familyContext.tsx          # Close-relative lookup + lines shown in person pickers
│       ├── markdown.ts                # Shared Markdown renderer (@ mentions, [n] citations)
│       ├── i18n/
│       │   └── translations.ts        # EN/HU translation strings (flat dot-notation keys)
│       └── components/
│           ├── ScanTab.tsx
│           ├── ClustersTab.tsx
│           ├── ConnectionsTab.tsx
│           ├── ImagesTab.tsx
│           ├── EventsTab.tsx
│           ├── EventTimeline.tsx
│           ├── FamilyTreeTab.tsx
│           ├── TreeView.tsx           # Interactive family tree (layout + pan/zoom)
│           ├── TreeExportModal.tsx    # PNG export
│           ├── PersonPanel.tsx        # Person profile (details, relations, docs, notes)
│           ├── NoteEditor.tsx         # Markdown notes + citations + @ mentions
│           ├── RelationPathModal.tsx  # Relationship path finder + PNG export
│           ├── ExportModal.tsx        # ZIP export settings
│           ├── SearchPalette.tsx      # Global search (Ctrl+K)
│           ├── DocumentsTab.tsx       # Document list, filters, upload / create chooser
│           ├── DocumentViewer.tsx     # Document preview modal (renders Markdown bodies)
│           ├── TextDocumentEditor.tsx # In-app Markdown documents + citations + photos
│           ├── PersonSelect.tsx       # Shared person pickers (multi-select, filter combobox)
│           ├── GedcomImportModal.tsx  # GEDCOM import wizard
│           ├── UpdateBanner.tsx       # Auto-update icon + modal
│           ├── StatisticsView.tsx
│           ├── ProjectSwitcher.tsx
│           ├── FolderPicker.tsx
│           └── NameEditor.tsx
├── version.txt              # Written by CI before build; "dev" in local checkouts
├── mnemosyne.spec           # PyInstaller build spec
├── requirements.txt
├── config.json              # ← gitignored (active project name)
└── projects/                # ← gitignored (databases, user data)
    └── <project-id>/
        ├── project.json
        ├── photo_organizer.db
        └── documents/
```

---

## Projects and database

Each project has its own directory (`projects/<id>/`) with its own SQLite database. The schema version is stored in `schema_version` table; migrations run at startup and are idempotent.

| Version | Adds |
|---|---|
| v1→v2 | `sources.event_id` |
| v2→v3 | `document_types`, `document_persons` (multi-person documents) |
| v3→v4 | `person_subclusters` |
| v4→v5 | `is_private` on six tables |
| v5→v6 | `documents.is_text`, `document_citations`, `document_images` (in-app text documents) |
| v6→v7 | `chat_threads`, `chat_messages`, `chat_tool_calls` (AI assistant conversations) |

`Base.metadata.create_all()` runs before the migration block, so new *tables* appear on their own; a new *column* on an existing table still needs an explicit `ALTER TABLE` in the version block.

Database files (`*.db`) and `config.json` are not tracked by git.

---

## Relationship path export

The relationship path modal includes an **Export PNG** button. It renders the snake-layout chain to an offscreen Canvas at 2× DPI and downloads it as `relationship_<nameA>_<nameB>.png`.

- Dark (`#09090b`) background; 120 px card slots, 72 px connectors
- Each card: circular avatar (photo or initials), full name, birth–death years
- Highlight rings: violet for endpoints, rose for LCA, blue for marriage-bridge persons
- Edge labels on horizontal and vertical connectors (solid = blood, dashed = marriage)

Entirely client-side (Canvas 2D API); images are pre-loaded before drawing.

---

## Document bulk download

`POST /api/documents/bulk-download` — accepts `{ ids: number[], include_notes: boolean }`, returns `application/zip`.

The ZIP contains the original files (collisions renamed `<name> (2).<ext>`) and an optional `_index.txt` plain-text manifest with titles, types, years, linked persons, descriptions, and full note text with citations.

Text documents appear as their `.md` file. Their body references (`document_citations`) and attached-photo count are listed in the manifest under the document itself — those live on the document, not on a note, so they need their own block.

---

## ZIP export

A ZIP archive packages the database and all referenced media into a portable, self-contained file that can be imported on any machine.

**Contents**

| Entry | Description |
|---|---|
| `project.json` | Project name and metadata |
| `project.db` | SQLite database |
| `images/<id>_<filename>` | Included photos |
| `documents/<stored_name>` | Referenced document files |

**Export pipeline**

1. `VACUUM INTO` creates a WAL-free copy of the source database
2. **Person/cluster filter** (mutually exclusive): person list, cluster list, or full project
3. **Content toggles**: notes, sources, events, documents, images, faceless images — each independently removable
4. **Privacy filter** (always applied, cannot be disabled): removes all rows where `is_private=1` across images, clusters, relations, documents, notes, and events; private cluster faces are moved to the noise cluster before the cluster is deleted

Anywhere documents or images are deleted from the export copy, `_delete_document_children()` clears the matching `document_citations` / `document_images` rows first. The export DB is written with the plain `sqlite3` module, where `PRAGMA foreign_keys` is **off**, so nothing cascades for you — dropped documents would otherwise leave dangling children behind in the shipped database.
5. **Path rewrite**: image paths updated to `images/<id>_<filename>` (absolute → relative)
6. Pack with DEFLATE compression, streamed to the response

**Streaming gotcha (Windows)**: the archive is written into a pipe, and `os.fdopen(pipe_fd, 'wb')` on Windows returns a file object whose `seekable()` answers `True` while `tell()` only reports the buffer offset. `zipfile` trusts that and writes central-directory offsets computed from the wrong position, producing an archive whose EOCD points near the start of the file — it downloads at full size but no tool can open it. `export_utils.py` wraps the pipe in `NonSeekableWriter`, which hides `seek`/`tell` so `zipfile` takes its streaming path with data descriptors. Any new streaming ZIP endpoint must use the same wrapper.

**Import pipeline**

1. All member paths validated against project directory (Zip Slip protection)
2. Extracted to `projects/<new_id>/`
3. `project.db` → `photo_organizer.db`
4. Image paths rewritten back to absolute

**Merge import** (`POST /api/import/merge/preview` → `/confirm`, `merge_import.py`) is the other direction: it folds a ZIP into the *active* project with a per-person create/merge/skip decision. Unlike the pipeline above it does not copy the database — it re-inserts row by row and remaps every foreign key, so **each table has to be handled explicitly or its data is silently dropped**. Columns are read through `_safe_rows()` and guarded with `_has_column()`, because an incoming ZIP may have been exported by an older schema.

Documents carry `is_text` (without it a chronicle arrives as an opaque file), `document_citations` (remapped through `src_id_remap`, `source_id NULL` kept for free-text labels), and `document_images` (remapped through `img_id_remap`; a merge import only brings in images belonging to named clusters, so a link whose photo stayed behind is skipped).

**Callers**

| Caller | Scope |
|---|---|
| Project switcher | Full project |
| Clusters tab | Selected cluster IDs |
| Family tree tab | Selected subtree (`person_ids`) |

---

## GEDCOM export

Produces a ZIP with `family.ged` (GEDCOM 5.5.1, UTF-8, CRLF) and a `media/` folder.

**INDI records** — `NAME` with `/surname/`; `GIVN`, `SURN`, `NICK`, `NPFX`; vital events (`BIRT`, `CHR`, `DEAT`, `BURI`) with `DATE` and `PLAC`; `DEAT > CAUS` (cause of death); `OCCU`; `EDUC`; `RELI`; `NATI`; `NOTE`; `EVEN` (one per event); `OBJE` (documents + photos); `FAMS`/`FAMC`

**FAM records** — `HUSB`/`WIFE` (sex-aware); `CHIL`; `MARR` and `DIV` with date and place

**SOUR records** — `TITL`, `AUTH`, `PUBL`, `NOTE`, `WWW`

**Note serialisation** — Markdown stripped to plain text before writing to `NOTE` records:

| Input | Output |
|---|---|
| `@[Name](#pid-42)` | `Name` |
| `[text](url)` | `text` |
| `## Heading` | `Heading` |
| `**bold**`, `*italic*`, `~~strike~~` | plain text |
| `` `code` `` | `code` |
| `> quote` | `quote` |
| `- list item` | `list item` |
| `[1]`, `[2]` (citation markers) | removed; appended as a list at end of note |

**Photo modes**: `none`, `primary` (one thumbnail per person), `all` (every photo the person appears in)

---

## Security

- The server binds exclusively to `127.0.0.1` — not reachable from the network
- CORS restricted to `http://localhost` and `http://127.0.0.1`
- ZIP imports are path-validated (Zip Slip protection)
- **Outbound connections — exactly two, and neither sends family data by default:**

  | | Sends | Default | Off switch |
  |---|---|---|---|
  | GitHub update check | Version query only, nothing about the user | **On** | Settings → auto-check |
  | AI assistant | Questions plus the tree data needed to answer them | **Off** — inert without an API key | Settings → *Enable assistant* (`ai.enabled` in `config.json`) |

  The assistant is the only path by which project data leaves the machine. Disabling it hides the widget and the Ctrl+J shortcut and stops the traffic; it does not discard the stored key or model.
- The API key lives in `config.json`, per provider. It is write-only over HTTP: `GET /api/ai/settings` returns it masked (`sk-ant-api…9f2a`), and no other endpoint returns it at all
- Private records are withheld from the assistant unless `allow_private` is set — a third enforcement layer alongside ZIP and GEDCOM export (see *Privacy*)

---

## Keeping this document up to date

- **New content toggle (ZIP)** → add row to *ZIP export* content table; update `build_export_db` in `export_utils.py`, endpoint in `main.py`, `api.ts`, `ExportModal.tsx`, and all three callers
- **New content toggle (GEDCOM)** → update *GEDCOM export*; update `build_gedcom_zip` in `gedcom_export.py` and endpoint in `main.py`
- **New note syntax** → update *Note serialisation* table; add entry to `_MD_PATTERNS` in `gedcom_export.py`
- **New user-visible string** → add the key to **both** dictionaries in `i18n/translations.ts`. The EN and HU key sets must match exactly; a missing HU key silently falls back to English and is easy to miss
- **New built-in document type** → add it to the migration seed in `database.py`, to `SEED_LABELS` in `docTypes.ts` (with the exact seeded English label), and add a `docType.<key>` entry to both dictionaries
- **New file bundled into the build** → add it to `datas` in `mnemosyne.spec` **and** read it via `MNEMOSYNE_BUNDLE_DIR`, not `MNEMOSYNE_APP_DIR` — see *Auto-update* for why the two are not interchangeable
- **New streaming ZIP endpoint** → wrap the pipe in `NonSeekableWriter` (see *ZIP export*), otherwise the archive is silently corrupt on Windows
- **New data table with `person_id` FK** → update `_delete_persons` in `export_utils.py` with an explicit `DELETE FROM <table> WHERE person_id IN (...)` line before the `DELETE FROM persons` line. If the table has `ON DELETE CASCADE` (like `person_subclusters`) the cascade would handle it automatically, but being explicit is the established pattern here
- **New data table with `document_id` FK** → add it to `_delete_document_children()` in `export_utils.py` (FKs are off in the export copy, so nothing cascades), include it in `_doc_dict` in `main.py`, and carry it through `read_zip_db` + `execute_merge` in `merge_import.py` — a merge import copies nothing it is not told about
- **New person picker anywhere in the UI** → build it on `useFamilyContext` + `<FamilyContextLines>` from `familyContext.tsx`, or on `PersonMultiSelect` / `PersonFilterCombobox` from `components/PersonSelect.tsx`. Rolling a fourth hand-written relative lookup is how the pickers drifted apart last time
- **Any UI that shows a person's name** → render it through `displayPersonName(person, nameOrder)`. The stored `persons.name` is always composed in one fixed order by `_derive_display_name()`, so printing it directly ignores the user's setting. If the payload is a stub rather than a full person, give the stub its name parts server-side (see `_doc_person_dict`)
- **Schema change to `note_citations`** → add idempotent migration in `database.py` using the `PRAGMA table_info` + table-recreate pattern
- **New AI assistant tool** → register it in `build_registry()` in `ai/tools.py` with `mutates=False` (the registry rejects anything else); apply the `_priv_ok` privacy filter; return name *parts* rather than `persons.name`; add a `chat.tool.<name>` label to **both** dictionaries in `i18n/translations.ts`. Prefer one fat tool over several thin ones — push the computation into the tool, as `get_relationship_path` does with the BFS and `get_ancestors` does with the line walk. Two rules learned the hard way: an empty result must carry enough context that it cannot be read as an absent fact, and anything the model would otherwise have to *guess* (a stored enum value) belongs either in the tool's error path or in `build_vocabulary()`
- **New chat table** → add an unconditional `DELETE FROM <table>` to the chat block at the top of `build_export_db` in `export_utils.py`, children first. The export copies the whole database and then filters, so a table you forget here is silently exported — this is the one mistake in this area with a real privacy cost
- **New model** → usually *nothing to do*: the list is fetched from the provider and new ids appear on the next refresh. Add an entry to `backend/ai/models.json` only to give it a friendly label, a note or a price (omit `pricing` rather than guessing — a missing block just hides the cost estimate, a wrong one misinforms). Never add a model-id branch in code; if you want one, the missing thing belongs in `caps`
- **New non-chat model type appearing in the picker** → add a substring to `_NON_CHAT_MARKERS` in `ai/config.py`. Keep it conservative — over-filtering silently hides usable models, which is the worse failure
- **Change to family tree node size or card content** → edit `frontend/src/treeGeometry.ts`, never a component. `TreeView` computes node positions from those constants and `TreeExportModal` draws cards at those positions; a second copy makes the exported PNG place correctly-sized cards wrongly, or wrongly-sized cards correctly. Adding a line to the card also means re-checking the four-line budget documented there
- **New provider** → add an entry to `providers` in `models.json`, and either reuse `OpenAICompatProvider` with a `base_url` (correct for anything OpenAI-compatible) or add an adapter implementing `LLMProvider`. Wire it into `build_provider` and `discover_models` in `ai/provider.py`. Nothing above the protocol should need to change; if it does, the abstraction has sprung a leak
- **New bundled AI data file** → spec `datas` **and** read it via `MNEMOSYNE_BUNDLE_DIR` in `ai/config.py`, never `MNEMOSYNE_APP_DIR`
- **New `is_private` on a table** → (1) add `ALTER TABLE … ADD COLUMN is_private BOOLEAN NOT NULL DEFAULT 0` to the v4→v5 migration block in `database.py`; (2) include `is_private` in the relevant `_xxx_dict` serialiser in `main.py`; (3) add the privacy-filter DELETE block for that table inside `build_export_db` in `export_utils.py`; (4) add `WHERE COALESCE(is_private,0)=0` to the relevant query in `build_gedcom_zip` in `gedcom_export.py` if applicable; (5) add `togglePrivacy` call to `api.ts`; (6) update the TypeScript interface in `types.ts`; (7) add the padlock button to the relevant component
