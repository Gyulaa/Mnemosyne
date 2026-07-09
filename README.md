# Mnemosyne

A personal photo organizer and genealogy tool powered by face recognition. It scans your photo
library, automatically detects and clusters faces, and lets you build a full family history —
complete with a family tree, events, documents, notes, and GEDCOM interoperability.

## Features

### Scan
- Face detection and ArcFace embedding (insightface `buffalo_l` model)
- DBSCAN clustering with centroid-based person recognition across re-runs
- HEIC/HEIF support (iPhone photos)
- Resumable scanning — picks up where it left off after interruption
- EXIF metadata extraction (date, camera, resolution)

### Clusters
- Rename, merge, and delete clusters
- Assign unknown faces to existing or new clusters (with similarity suggestions)
- Link a cluster to a person in the genealogy
- Preview of the 4 most recent photos per cluster (sorted by EXIF date)
- Photos and faces in reverse chronological order
- Select multiple clusters and batch-delete them
- Empty clusters are automatically removed after re-clustering (linked person is preserved)
- Sticky filter/search toolbar
- Export selected clusters to a ZIP archive

### Connections
- Connection strength between people, with two metrics:
  - **Shared photos**: how many images two people appear in together
  - **Weighted**: small group photos carry more weight (`Σ 1/n`)
- Force-directed graph view (interactive: zoom, pan, drag)
- Ranked list view: strongest connections sorted in order
- Filter by person, adjustable minimum shared-photo threshold
- Click a graph node or ranked row to navigate to that cluster
- Click a connection line to filter the Images tab to the two people's shared photos

### Images
- Browse photos in list and grid view
- Filter by status, people, and filename
- AND/OR filter mode for multiple people
- Clickable person badges in the preview modal → navigates to that cluster
- Delete images from the database (source files are never touched)

### Genealogy

The genealogy module is the heart of the application.

**Family tree view**
- Interactive proband-centric tree with Reingold-Tilford layout and Ahnentafel ancestor positioning
- Ancestor depth and cousin-degree controls (how many generations and lateral relatives to show)
- Collapse/expand subtrees with a click — collapsed nodes show a hidden-person count
- Shift+click on any node to refocus the tree on that person
- Zoom, pan, Reset View button
- Link face clusters to persons (1 person = 1 cluster)
- **Export as PNG** — settings: 1× (screen) or 2× (print quality), dark or light background, with or without embedded face photos

**Person profile panel**
- Biographical details: full name (title, given, middle, surname, nickname), birth/death/christening/burial date and place, occupation
- Age calculation: "Lived N years" (deceased) or "N years old today" (living), using available year data
- Relations section: parents, children, siblings, spouses — sorted chronologically
- Duplicate relationship detection: warns before creating a relation that already exists
- Documents linked to this person (certificates, photographs, audio recordings, etc.)
- Sources section for citation tracking

**Notes**
- Each person can have any number of structured notes with an optional title
- Notes are written in Markdown — headings (`##`), **bold**, *italic*, ~~strikethrough~~, lists, blockquotes, inline code
- **Footnote citations** — the Cite button inserts a `[n]` marker at the cursor; two citation types are supported:
  - *Source citation*: links to an existing Source record from the database; citation marker renders as a clickable superscript that navigates to the linked document or event
  - *Custom-text citation*: free-form text (e.g. "Oral interview, grandmother, 1998") stored independently of the sources table; displayed in the References panel with an amber label
  - Auto-cleanup: if a `[n]` marker is deleted from the text, the corresponding citation is automatically removed from the references panel
- **@ mentions** — type `@` anywhere in a note to get a person picker; selecting a person inserts `@[Name](#pid-ID)` which renders as a clickable link (navigates to that person's panel); the `@` popup shows biographical data and close family (spouse, parents, children) for the highlighted match
- Notes are fully searchable via the global search palette (title and content)

**Sources**
- Each source record holds: title, type, author, year, publisher, location, URL, description
- Sources can be linked to a document or event in the application
- Only sources that are actively used (have at least one citation, or are linked to a document or event) appear in the note citation picker

**GEDCOM interoperability**
- **Import**: load a `.ged` file — persons, parent-child and spouse relations, events, notes, sources, and documents are imported; a preview wizard lets you choose whether to merge each incoming person with an existing record or create a new one
- **Export**: download the current genealogy as a standards-compliant `.ged` file (see [GEDCOM export](#gedcom-export) for details)

### Events
- Personal and family events: birth, death, marriage, emigration, military service, education, occupation, and more
- Associate any number of persons with each event
- Date, place, and description fields
- Chronological timeline view, grouped by event

### Documents
- Attach genealogical documents to persons: birth, death, and marriage certificates, passports, military records, land records, wills, letters, photographs, audio recordings
- Image preview (JPEG, PNG) and PDF link in the document viewer modal
- Each document shows its associated person with a one-click link to their profile
- Documents are searchable via the global search palette
- **Table view** with columns: thumbnail/icon, title, type, year, linked persons, and per-row actions
- **Filter bar**: text search, type dropdown, searchable person combobox (shows birth/death year and occupation to distinguish persons with identical names)
- **Notes**: notes with citations and @person mentions can be attached to documents, editable directly in the viewer modal
- **Bulk selection and ZIP download**: see [Document bulk download](#document-bulk-download) below

### Global Search
- **Ctrl+K** (or **Cmd+K** on macOS) opens the search palette from anywhere in the app
- Searches across persons (name, first name, last name, **nickname**), events, documents, and **note titles and content** simultaneously
- Up to 3 matching notes shown, clicking navigates to the person's Notes tab
- Keyboard navigation: ↑ ↓ to move, Enter to open, Escape to close

### Relationship Path Finder
- Select any two persons and find the shortest relationship path between them
- Snake-layout chain display (up to 5 persons per row)
- Blood-relative vs. marriage-relative badge, Lowest Common Ancestor (LCA) annotation
- Available from the person profile panel
- **Export as PNG** — exports the displayed chain as a high-resolution image; see [Relationship path export](#relationship-path-export) below

---

## Projects and Export

### Projects
- Create, rename, and delete collections — including the currently active one
- Use the project switcher in the header to switch between projects
- Each project lives in its own directory (`projects/<id>/`) with its own SQLite database

### Relationship path export

The relationship path modal includes an **Export PNG** button in its footer. Clicking it renders the currently displayed snake-layout chain to an offscreen Canvas and downloads it as `relationship_<nameA>_<nameB>.png`.

**What the image contains**

- Dark (#09090b) background at 2× pixel density (crisp on HiDPI screens)
- Header with both person names
- Full snake-layout chain — same row/column structure as the modal, scaled up for legibility (120 px card slots, 72 px connectors)
- Each card shows: circular avatar (photo or initials), full name truncated with ellipsis if needed, birth–death years
- Highlight rings: violet for endpoints, rose for the Lowest Common Ancestor, blue for marriage-bridge persons
- Edge labels on horizontal connectors (solid line for blood, dashed for marriage) and vertical turn connectors between rows
- Footer with blood-vs-marriage badge, step count, and LCA name (when applicable)

The function is entirely client-side (Canvas 2D API); avatar images are pre-loaded before drawing so they appear in the export.

### Document bulk download

Individual documents can be downloaded from the Documents tab as a ZIP archive without exporting the entire project database.

**How to use**

1. Open the **Documents** tab.
2. Click the checkbox that appears on hover at the left of any row to select it. The header checkbox selects or deselects all currently visible (filtered) rows.
3. A floating action bar appears at the bottom of the tab showing the count of selected documents.
4. Toggle **Include notes** (on by default) to control whether a `_index.txt` manifest is added to the archive.
5. Click **Download ZIP** — the browser downloads `documents.zip`.

**Archive contents**

| Path | Description |
|------|-------------|
| `<filename>` | The original document file (e.g. `birth_cert.pdf`). If two selected documents share the same filename the second is renamed to `<name> (2).<ext>`. |
| `_index.txt` | Plain-text manifest listing each document's title, type, year, linked persons, description, and the full text of all attached notes with source citations. Included only when *Include notes* is enabled. |

**`_index.txt` format example**

```
Documents Export
================
Exported: 2026-07-09
Files: 3

[1] Nyelvvizsga
    ─────────────────────────
    Document | 2024
    File:    anglob2.jpg
    Persons: Miklós Gyula
    Description: language exam

    Notes:
    ▸ Exam note
      Passed B2 English. See Miklós Gyula for more context.
      Sources:
        [1] Parish register 1872 — p. 14

[2] Birth Certificate
    ...
```

Person mention syntax (`@[Name](#pid-ID)`) and Markdown links are automatically stripped to plain text in the index file.

**Backend endpoint**

`POST /api/documents/bulk-download` — accepts `{ ids: number[], include_notes: boolean }`, streams back a `application/zip` response.

---

### ZIP export

A ZIP archive packages the database and all referenced media into a single self-contained file that can be imported on any machine.

**What goes into the ZIP**

| Entry | Description |
|---|---|
| `project.json` | Project name and metadata |
| `project.db` | SQLite database (schema + all data) |
| `images/<id>_<filename>` | Every included photo, one file per image |
| `documents/<stored_name>` | Every document file still referenced in the exported DB |

Image paths in the database are rewritten from absolute to relative (`images/<id>_<filename>`) during export. On import they are rewritten back to absolute paths in the new project directory.

**Export pipeline — step by step**

1. **Copy**: `VACUUM INTO` creates a byte-perfect, WAL-free copy of the source database. This captures the full schema including all columns (such as `note_citations.custom_label`).

2. **Person/cluster filter** (three mutually exclusive modes):
   - *Person list* (`person_ids`): keeps only the specified persons and cluster images linked to them; all other persons, clusters, and images are removed.
   - *Cluster list* (`cluster_ids`): keeps only those clusters and the images they contain; faces from unselected named clusters are moved to the noise cluster (embeddings preserved for re-clustering). If genealogy is included, only persons linked to the remaining clusters are kept.
   - *Full project*: no filtering by person or cluster.

3. **Content toggles** (applied after person/cluster filtering, independent of each other):

   | Toggle | What is removed when OFF |
   |---|---|
   | Include genealogy | All persons, relations, and all genealogy content (master toggle) |
   | Include images | All images and face records |
   | Include faceless images | Images that have no detected face (i.e. only face-containing photos are kept) |
   | Include notes | `person_notes` and `note_citations` (both source-linked and custom-label) |
   | Include sources | `citations`, `sources`, and `note_citations` where `source_id IS NOT NULL`; custom-label citations (`source_id IS NULL`) are **preserved** |
   | Include events | `events`, `event_persons`, `event_images` |
   | Include documents | `documents`, `document_persons` |

   When events are included, events that lost all participants during person filtering are automatically cleaned up (orphaned events are removed).

4. **Path rewrite**: each remaining image's path is updated in the DB to `images/<id>_<filename>`.

5. **Pack**: the filtered DB, rewritten images, and referenced documents are written into a ZIP with DEFLATE compression.

**Import pipeline**

1. All member paths in the ZIP are validated against the project directory (protection against Zip Slip attacks).
2. The archive is extracted into a new project directory under `projects/<new_id>/`.
3. `project.db` is renamed to `photo_organizer.db`.
4. Image paths are rewritten from relative back to absolute (prefixed with the new project directory).
5. The project appears as inactive in the project switcher; activate it to start using it.

**Callers of the ZIP export**

Three UI surfaces trigger a ZIP export, each passing a different scope:

| Caller | Scope |
|---|---|
| Project switcher | Full project (no cluster or person filter) |
| Clusters tab | Selected cluster IDs only |
| Family tree tab | Selected subtree (`person_ids` derived from the tree selection) |

All three callers pass the same set of content toggles (notes, sources, events, documents, images, faceless).

---

### GEDCOM export

Produces a ZIP containing `family.ged` (GEDCOM 5.5.1, UTF-8, CRLF line endings) and a `media/` folder with photos and documents.

**INDI records** (one per person)
- `NAME` with `/surname/` convention; `GIVN`, `SURN`, `NICK`, `NPFX` sub-tags
- `SEX` — explicit value, or inferred from FAM roles (HUSB → M, WIFE → F) when not set
- Vital events: `BIRT`, `CHR`, `DEAT`, `BURI` — each with `DATE` and `PLAC` if available; partial ISO dates (`YYYY-MM`) are converted to GEDCOM month abbreviations
- `OCCU` if set
- `NOTE` — from both the legacy plain-text notes field and structured notes (see below)
- `EVEN` — one per event the person participated in, with `TYPE`, `DATE`, `PLAC`, `NOTE`
- `OBJE` — one per document and one per photo (depending on photo mode)
- `FAMS` / `FAMC` — links to FAM records

**FAM records**
- `HUSB` / `WIFE` (sex-aware assignment; defaults to A=HUSB, B=WIFE)
- `CHIL` for each child
- `MARR` with `DATE` and `PLAC` if available
- `DIV` with `DATE` and `PLAC` if available

**SOUR records** — one per source, with `TITL`, `AUTH`, `PUBL` (publisher + year + location), `NOTE` (description), `WWW` (URL)

**Note serialisation**
Notes are converted from Markdown to plain text before being written to GEDCOM `NOTE` records (multiline text uses `CONT` continuation lines). The following transformations are applied in order:

| Input | Output |
|---|---|
| `@[Kovács János](#pid-42)` | `Kovács János` (@ and link removed, name preserved) |
| `[text](url)` | `text` |
| `## Heading` | `Heading` (hash prefix removed) |
| `**bold**`, `*italic*`, `~~strike~~` | plain text (markers stripped) |
| `` `code` `` | `code` |
| `> quote` | `quote` (chevron removed) |
| `- list item` | `list item` (bullet removed) |
| `[1]`, `[2]` (citation markers) | removed from text body |

After stripping, inline citation references are appended as a semicolon-separated list at the end of the note text:
- Source citations: `[1] Parish register of Győr, detail`
- Custom-text citations: `[2] Oral interview, grandmother, 1998`

Both citation types are included.

**Photo modes** (selectable at export time)

| Mode | Behaviour |
|---|---|
| `none` | No photos exported |
| `primary` | One thumbnail face photo per person (from `thumbnail_face_id`) |
| `all` | Every photo in which the person appears (cluster-based) |

**Content toggles** — `include_notes`, `include_sources`, `include_events`, `include_documents` work the same way as in ZIP export, controlling which data is written to the GEDCOM file.

---

## Security

- The server binds **exclusively to `127.0.0.1`** (localhost) — not reachable from the network
- CORS is restricted to `http://localhost` and `http://127.0.0.1` origins only
- Imported ZIP archives are path-validated (protection against Zip Slip attacks)
- The application **never sends any data** to any external server; it works entirely offline

---

## Prerequisites

| Tool    | Minimum version |
|---------|----------------|
| Python  | 3.11+          |
| Node.js | 18+            |

> **Windows:** building `insightface` may require the
> [Visual C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
> ("Desktop development with C++" workload).

## Installation

```bash
git clone <repo-url>
cd Image-Organizer
```

### 1. Python backend

```bash
python -m venv .venv

# Activate
.venv\Scripts\activate          # Windows
source .venv/bin/activate       # macOS / Linux

pip install -r requirements.txt
```

### 2. Frontend

```bash
cd frontend
npm install
cd ..
```

## Running

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

Then open: **http://localhost:5173**

## First run

1. On the **Scan** tab, select the folder containing your photos
2. Click **Start scan** — on the first run, insightface downloads the `buffalo_l` model (~300 MB, one-time only)
3. After scanning, click **Run clustering**
4. On the **Clusters** tab, name the people
5. On the **Genealogy** tab, build the family tree and link people to their clusters

> The application **never modifies** your source photos — it only reads them.

## Projects and database

Each project lives in its own directory (`projects/<id>/`) with its own SQLite database.
The schema version is stored in the database (`schema_version` table), so future updates
migrate existing data automatically. Migrations run at startup and are idempotent.

Database files (`*.db`) and `config.json` are **not** tracked by git.

## Project structure

```
Image-Organizer/
├── backend/
│   ├── main.py              # FastAPI app, all REST API endpoints
│   ├── scanner.py           # Background, resumable file scanner
│   ├── clusterer.py         # DBSCAN + centroid-based clustering
│   ├── database.py          # SQLAlchemy models, SQLite schema, startup migrations
│   ├── schemas.py           # Pydantic request/response models
│   ├── project_manager.py   # Multi-project management
│   ├── export_utils.py      # ZIP export/import pipeline (build_export_db, create_project_zip, import_project_zip)
│   ├── gedcom_import.py     # GEDCOM .ged file importer
│   ├── gedcom_export.py     # GEDCOM 5.5.1 exporter (build_gedcom_zip)
│   ├── image_utils.py       # Image loading, HEIC conversion, thumbnail cropping
│   └── schemas.py           # Pydantic request/response models
├── frontend/
│   └── src/
│       ├── App.tsx                    # Tab navigation, global search, cross-tab routing
│       ├── api.ts                     # Typed API client (all backend calls)
│       ├── types.ts                   # TypeScript interfaces
│       └── components/
│           ├── ScanTab.tsx
│           ├── ClustersTab.tsx
│           ├── ConnectionsTab.tsx
│           ├── ImagesTab.tsx
│           ├── EventsTab.tsx          # Events tab + event CRUD
│           ├── EventTimeline.tsx      # Chronological event timeline
│           ├── FamilyTreeTab.tsx      # Genealogy tab shell
│           ├── TreeView.tsx           # Interactive family tree (layout + pan/zoom)
│           ├── TreeExportModal.tsx    # PNG export (resolution, theme, photos)
│           ├── PersonPanel.tsx        # Person profile panel (details, relations, docs, notes)
│           ├── NoteEditor.tsx         # Note editor + NoteCard display (Markdown, citations, @ mentions)
│           ├── ExportModal.tsx        # ZIP export settings panel (content toggles)
│           ├── RelationPathModal.tsx  # Shortest relationship path finder
│           ├── SearchPalette.tsx      # Global search palette (Ctrl+K)
│           ├── DocumentViewer.tsx     # Document preview modal
│           ├── GedcomImportModal.tsx  # GEDCOM import wizard
│           ├── StatisticsView.tsx     # Family statistics
│           ├── ProjectSwitcher.tsx
│           ├── FolderPicker.tsx
│           └── NameEditor.tsx
├── requirements.txt
├── config.json              # ← gitignored (active project name)
└── projects/                # ← gitignored (databases, user data)
    └── <project-id>/
        ├── project.json
        ├── photo_organizer.db
        └── documents/       # uploaded genealogical documents
```

---

## Keeping this document up to date

When adding or changing export behaviour, update the relevant section above:

- **New content toggle** (ZIP) → add a row to the *Content toggles* table in [ZIP export](#zip-export); update `build_export_db` in `export_utils.py`, the endpoint in `main.py`, `api.ts`, `ExportModal.tsx`, and all three callers (`ProjectSwitcher`, `ClustersTab`, `FamilyTreeTab`).
- **New content toggle** (GEDCOM) → add to the *Content toggles* note in [GEDCOM export](#gedcom-export); update `build_gedcom_zip` in `gedcom_export.py` and the endpoint in `main.py`.
- **New note field or syntax** → update *Note serialisation* table in [GEDCOM export](#gedcom-export) and add the corresponding entry to `_MD_PATTERNS` in `gedcom_export.py`; update *Notes* in [Person profile panel](#person-profile-panel).
- **New data table** → update `_delete_persons` in `export_utils.py` if the table has a `person_id` foreign key, so it is correctly cleaned up during person filtering.
- **Schema change to `note_citations`** → because SQLite does not support `ALTER COLUMN`, add an idempotent migration block in `database.py` using the `PRAGMA table_info` + table-recreate pattern already used for the `custom_label` column.
