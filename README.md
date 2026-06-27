# Mnemosyne

A personal photo organizer powered by face recognition. It scans your photo library,
automatically detects and clusters faces, and lets you assign names to people —
all data persists across re-clustering runs.

## Features

### Scan
- Face detection and ArcFace embedding (insightface `buffalo_l` model)
- DBSCAN clustering with centroid-based person recognition
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
- Empty clusters (zero faces) are automatically removed after re-clustering and face assignment (the linked person is preserved in the genealogy)
- Sticky filter/search toolbar — stays visible while scrolling
- Export selected clusters to a ZIP archive (see below)

### Connections
- Connection strength between people shown with two metrics:
  - **Shared photos**: how many images two people appear in together
  - **Weighted**: small group photos carry more weight (`Σ 1/n`)
- Force-directed graph view (interactive: zoom, pan, drag)
- Ranked list view: strongest connections sorted in order
- Filter by person, adjustable minimum shared-photo threshold
- Click a graph node or ranked row to navigate to that cluster's page
- Click a connection line to filter the Images tab to the two people's shared photos

### Images
- Browse photos in list and grid view
- Filter by status, people, and filename
- AND/OR filter mode for multiple people
- Clickable person badges under faces in the preview modal → navigates to that cluster
- Delete images from the database (source files are never touched)

### Genealogy
- Interactive family tree editor
- Add, edit, and delete people
- Relationship types: parent–child, spouse, sibling
- Reingold-Tilford layout with Ahnentafel ancestor positioning, proband-centric view
- Ancestor depth and cousin-degree sliders (control how many generations and lateral relatives are shown)
- Zoom, pan, Reset View button
- Link clusters to people (1 person = 1 cluster)

### Projects and Export
- Create, rename, and delete collections — including the currently active one
- **Export ZIP**: export the active collection — or only selected clusters — into a single ZIP (database + images); optionally without genealogy data
- **Import ZIP**: load a previously exported collection as a new project; image paths are rewritten automatically
- Custom collection name can be set at export time

## Security

- The server binds **exclusively to `127.0.0.1`** (localhost) — it is not reachable from the local network, Wi-Fi, or the internet
- CORS is restricted to `http://localhost` and `http://127.0.0.1` origins only
- Imported ZIP archives are path-validated (protection against Zip Slip attacks)
- The application **never sends any data** to any external server; it works entirely offline

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

A separate project can be created for each workflow. Use the project switcher in the
header to switch between projects, create new ones, or delete existing ones.

Each project lives in its own directory (`projects/<id>/`) with its own SQLite database.
The schema version is stored in the database (`schema_version` table), so future updates
migrate existing data automatically.

Database files (`*.db`) and `config.json` are **not** tracked by git.

## Project structure

```
Image-Organizer/
├── backend/
│   ├── main.py              # FastAPI app, REST API endpoints
│   ├── scanner.py           # Background, resumable file scanner
│   ├── clusterer.py         # DBSCAN + centroid-based clustering
│   ├── database.py          # SQLAlchemy models, SQLite, schema migration
│   ├── project_manager.py   # Multi-project management
│   ├── export_utils.py      # ZIP export/import logic
│   ├── image_utils.py       # Image loading, HEIC conversion, thumbnail cropping
│   └── schemas.py           # Pydantic request/response models
├── frontend/
│   └── src/
│       ├── App.tsx           # Tab navigation, cross-tab navigation logic
│       ├── api.ts            # All API calls in one place
│       ├── types.ts          # TypeScript interfaces
│       └── components/
│           ├── ScanTab.tsx
│           ├── ClustersTab.tsx
│           ├── ConnectionsTab.tsx
│           ├── ImagesTab.tsx
│           ├── FamilyTreeTab.tsx
│           ├── TreeView.tsx
│           ├── PersonPanel.tsx
│           ├── ProjectSwitcher.tsx
│           ├── ExportModal.tsx
│           └── FolderPicker.tsx
├── requirements.txt
├── config.json              # ← gitignored (active project name)
└── projects/                # ← gitignored (databases, user data)
    └── <project-id>/
        ├── project.json
        └── photo_organizer.db
```
