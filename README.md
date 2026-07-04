# Mnemosyne

A personal photo organizer and genealogy tool powered by face recognition. It scans your photo
library, automatically detects and clusters faces, and lets you build a full family history —
complete with a family tree, events, documents, and GEDCOM interoperability.

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
- Biographical details: full name, birth/death date and place, occupation, notes
- Age calculation: "Lived N years" (deceased) or "N years old today" (living), using available year data
- Relations section: parents, children, siblings, spouses — sorted chronologically
- Duplicate relationship detection: warns before creating a relation that already exists
- Documents linked to this person (certificates, photographs, audio recordings, etc.)
- Sources section for citation tracking

**GEDCOM interoperability**
- **Import**: load a `.ged` file — persons, parent-child and spouse relations are imported
- **Export**: download the current genealogy as a standards-compliant `.ged` file

### Events
- Personal and family events: birth, death, marriage, emigration, military service, education, occupation, and more
- Associate any number of persons with each event
- Date, place, and description fields
- Chronological timeline view, grouped by event

### Documents
- Attach genealogical documents to persons: birth, death, and marriage certificates, passports,
  military records, land records, wills, letters, photographs, audio recordings
- Image preview (JPEG, PNG) and PDF link in the document viewer modal
- Each document shows its associated person with a one-click link to their profile
- Documents are searchable via the global search palette

### Global Search
- **Ctrl+K** (or **Cmd+K** on macOS) opens the search palette from anywhere in the app
- Searches across persons, events, and documents simultaneously
- Keyboard navigation: ↑ ↓ to move, Enter to open, Escape to close
- Clicking a document result opens the document viewer modal

### Relationship Path Finder
- Select any two persons and find the shortest relationship path between them
- Snake-layout chain display (up to 5 persons per row)
- Blood-relative vs. marriage-relative badge
- Available from the person profile panel

### Projects and Export
- Create, rename, and delete collections — including the currently active one
- **Export ZIP**: export the active collection (or only selected clusters) into a single ZIP (database + images); optionally without genealogy data
- **Import ZIP**: load a previously exported collection as a new project; image paths are rewritten automatically
- Custom collection name at export time

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

A separate project can be created for each workflow. Use the project switcher in the header
to switch between projects, create new ones, or delete existing ones.

Each project lives in its own directory (`projects/<id>/`) with its own SQLite database.
The schema version is stored in the database (`schema_version` table), so future updates
migrate existing data automatically.

Database files (`*.db`) and `config.json` are **not** tracked by git.

## Project structure

```
Image-Organizer/
├── backend/
│   ├── main.py              # FastAPI app, all REST API endpoints
│   ├── scanner.py           # Background, resumable file scanner
│   ├── clusterer.py         # DBSCAN + centroid-based clustering
│   ├── database.py          # SQLAlchemy models, SQLite, schema migration
│   ├── project_manager.py   # Multi-project management
│   ├── export_utils.py      # ZIP export/import logic
│   ├── gedcom_import.py     # GEDCOM .ged file importer
│   ├── gedcom_export.py     # GEDCOM .ged file exporter
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
│           ├── PersonPanel.tsx        # Person profile panel (details, relations, docs)
│           ├── RelationPathModal.tsx  # Shortest relationship path finder
│           ├── SearchPalette.tsx      # Global search palette (Ctrl+K)
│           ├── DocumentViewer.tsx     # Document preview modal
│           ├── GedcomImportModal.tsx  # GEDCOM import wizard
│           ├── StatisticsView.tsx     # Family statistics
│           ├── ProjectSwitcher.tsx
│           ├── ExportModal.tsx
│           ├── FolderPicker.tsx
│           ├── NameEditor.tsx
│           └── NoteEditor.tsx
├── requirements.txt
├── config.json              # ← gitignored (active project name)
└── projects/                # ← gitignored (databases, user data)
    └── <project-id>/
        ├── project.json
        └── photo_organizer.db
```
