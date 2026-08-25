# Mnemosyne

A private app that runs on your computer to organize family photos and build a family tree — complete with face recognition, documents, notes, and a fully interactive tree view.

No account, no cloud, no subscription. Everything stays on your machine — unless you switch on the optional AI assistant, which is off until you add your own API key.

> **Working on the code?** Start at [Orientation](#orientation) — it maps a task to the sections that describe it and the files that implement it. Working rules, verification and conventions live in [`CLAUDE.md`](CLAUDE.md).

---

# For users

## What is Mnemosyne?

Mnemosyne (pronounced *"m·neh-MO-zin"* — the *m* is lightly voiced, the stress falls on the second syllable) is a desktop application for families who want to keep their photos and genealogy in one place — privately, on their own computer.

You point it at a folder of photos, and it automatically finds and groups faces. You then name the people it found, connect them to your family tree, attach documents (birth certificates, letters, old photos), write notes, and build a complete family history.

**Out of the box, nothing is uploaded anywhere.** Your photos, names, dates and notes stay on your computer, and the app works entirely offline. The face recognition runs locally — nothing is sent away to identify anyone.

Three features can reach the internet, and all three are yours to control:

| Feature | What leaves your computer | Default |
|---|---|---|
| **Update check** | A request to GitHub asking whether a newer version exists. No data about you or your family. | On — switch it off in Settings |
| **AI assistant** | Your question, plus the family data needed to answer it, goes to the AI provider you choose (Anthropic or OpenAI). | **Off** — it does nothing until you add your own API key |
| **Web research** | The names, places and years in a query go to a search provider (Tavily) — separate from the AI provider above — when the assistant looks for corroborating historical records online. | **Off** — needs its own API key, on top of the assistant's |

The assistant and web research are the only features that send your family data anywhere, and each is its own switch to its own destination. Both are opt-in, both can be switched off entirely in Settings, and anything you marked **private** stays hidden from the assistant unless you explicitly allow it. Both API keys are stored on your own computer and never leave it except to the provider they're for.

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

The app opens in your browser automatically (on a free local port it picks at startup). The browser tab is the user interface — don't close the terminal/icon that launched it.

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
- A Statistics view shows names, places, decades and how complete your data is — click any bar, percentage or "longest lived" entry to jump straight to the matching people, so a gap like "20% have no birth year" becomes a list you can work through

### People profiles
- Full name, birth/death/christening/burial details
- Age is calculated automatically
- Parents, children, siblings, and spouses are listed with links
- Next to a spouse: the marriage year and place, the divorce year and place, and the sources they come from — recorded once and shown on both people's profiles
- When you add a child, you can say which spouse the child is also from — or that they are not from a spouse at all. The child then appears on both parents' profiles, so you never have to add the same child twice. If someone has children from more than one marriage, the list shows them grouped by the other parent
- Attach documents (PDFs, images, audio) directly to a person
- Write notes in plain text — they support **bold**, *italic*, headings, and lists
- Add footnote citations to your notes and link them to sources

### Documents
- Attach birth certificates, passports, letters, land records, wills, and more
- Documents can be linked to multiple people at once — or to nobody, if you don't want to decide yet
- Preview images and PDFs right in the app
- Select multiple documents and download them as a ZIP

When you click **New**, Mnemosyne asks whether you want to upload a file you already have, or write a document right there.

**Writing a document in the app** is meant for the things that were never on paper — a family chronicle, a transcription of an old letter, notes from an afternoon of research:

- Write in **Markdown**: headings, **bold**, *italic*, lists, quotes. A Preview tab shows how it will look
- Type **@** to mention a person — the name becomes a link straight to their profile, and that person is added to the document's linked people on the right. Remove one with the picker if you didn't want it; deleting the mention from the text leaves the link alone
- Use **Cite** to add a `[1]`-style reference to another document, an existing source, or any free text you type ("Grandma's account, 1998"). References are listed at the bottom of the document
- **Attach photos** from your library to illustrate the text

**Linking people is optional.** Nothing stops you from saving a document with nobody attached — start writing, and let the links build up as you mention people. A document that belongs to no one still shows up in the list, in search and in a full backup; it is left out only where it has nowhere to go: a GEDCOM file, and an export narrowed to a particular family group.

Text documents behave like any other document everywhere else: they can be linked to several people, filtered, searched, downloaded, and they travel with every export.

### Reading scanned records (optional)

Old parish registers are hard going: the hand is unfamiliar, the language is often Latin or German, and a folder from an archive can hold hundreds of pages of which only a few concern your family. **Read scans**, on the Documents tab, is for exactly that pile.

- Point it at a folder. The files **stay where they are** — nothing is copied into your project yet
- Every page is read: you get the text **as written**, and the details pulled out of it — what kind of entry it is, its date, and everyone named in it with their role (child, father, mother, godparents, witnesses)
- When the last page is done, the whole batch is reported on in one go: which entries match people already in your tree, which are worth a look, what the folder covers as a whole, and which pages failed to read
- Pages are marked so you can jump straight to the ones that matter, and only those get imported into Documents as real documents
- **The reading is a reading, not a certified copy.** A word that could not be made out is marked `[?]`, and one the model is unsure of is marked `word[?]`. You can correct any transcript by hand, and your correction is kept — nothing overwrites it
- Once a page is imported, the assistant can read its transcript like any other document, and it turns up in search

This is **off until you switch it on**, in the assistant's settings. It sends the scans themselves to the AI provider you chose, which is more than the assistant sends when you just ask it a question — so it is a separate decision, with its own monthly limit on how many pages may be read.

### Events
- Record family events: births, marriages, military service, emigration, and more
- Associate multiple people with each event
- See events on a chronological timeline
- Write the description in the same rich editor documents use: formatting, `@` to name a person, and numbered source references. Typing `@` and picking someone also adds them to the event, and their name becomes a link to their page — in the title too

### Connections
- See who appears in photos together most often
- An interactive graph of who appears with whom. It is arranged to be read, not just displayed:
  - People who **hold the network together** — the ones who link otherwise separate circles — are drawn into the middle and ringed in amber. This is not simply "who is in the most photos": someone who appears rarely but is the only link between two families still lands in the centre, which is exactly the person worth noticing
  - **Separate groups are drawn apart**, each in its own frame with its own middle, instead of being pushed into one pile
  - Thicker, brighter lines mean a stronger connection. Hover a person to isolate their links, drag anyone to rearrange, and **Reset view** puts the computed arrangement back
- A ranked list view, if you would rather read the numbers than the picture

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

This is the feature that sends your family data off your computer, so it is off until you decide otherwise.

- **Off until you turn it on.** It needs an API key — either [Anthropic](https://console.anthropic.com) or [OpenAI](https://platform.openai.com/api-keys) — stored on your own computer and never sent anywhere except to that provider. You can save both keys and switch between them
- **Switch it off any time** in Settings → *Enable assistant*. The floating button and the Ctrl+J shortcut disappear with it, and nothing is sent anywhere
- Click the sparkle button in the bottom-right corner (or press **Ctrl+J**) to open it beside whatever tab you are on — ask about your tree in plain language and the tree stays visible while it answers
- It can **only read** your data. It cannot create, edit or delete anything
- Every person and photo it mentions becomes a link — to the profile, or to the gallery filtered to exactly those pictures — so you can check any claim it makes
- You see each lookup it performs, and can expand any of them to read the raw result
- Anything you marked **private** stays hidden from it unless you explicitly allow it
- It knows who *you* are from the person the family tree opens on, so "my grandfather" means yours. Pin that person with the pin button on the genealogy tab
- Conversations are saved with the project and are **never included in any export**
- Choose how it writes above the message box: **Structured** for concise, scannable answers, or **Storyteller** for a family history told as flowing prose. The choice is remembered on this device and applies to your next message
- Type **@** to reference a person or **#** to reference a document while asking a question — the same pickers as elsewhere in the app. This tells the assistant exactly who or what you mean, which matters most for a given name that repeats in the family
- **Web research is a separate, second off-switch** in the same Settings screen. Turned on, the assistant can search the web and read pages — including PDFs — for historical records that might corroborate what your tree already says, and tells you plainly when something looks like a match rather than editing anything itself. It needs its own [Tavily](https://tavily.com) API key, has its own daily search limit you set, and is off by default because it sends the names, places and years in your question to that search provider, not only to the AI provider you already chose

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
- **By default, nothing leaves your computer.** The app works fully offline. Three features can reach the internet, all under your control:
  - the **update check** against GitHub (turn it off in Settings) — it sends no data about you;
  - the **AI assistant**, which is off until you add an API key. While it is on, your questions and the family data needed to answer them go to the provider you picked. Switch it off in Settings and the widget, the shortcut and the network traffic all go with it.
  - **web research**, a separate off switch in the assistant's own settings. While on, a query's names, places and years go to the search provider you configured — its own API key, its own daily limit, independent of the assistant's provider.
- All your data (family tree, notes, documents) is stored in a folder called `projects/` next to the app. You can back it up by simply copying that folder.

---

# For developers

## Orientation

*Start here — this section exists so a task can begin with a map instead of a search. It is written to be equally useful to a person new to the code and to an AI agent gathering context.*

Mnemosyne is one FastAPI process serving a React single-page app and one SQLite database per project. Faces are detected and clustered locally, the clusters are linked to genealogy persons, and everything else — documents, events, notes, sources, exports — hangs off those persons. Nothing leaves the machine except an optional update check and the opt-in AI assistant.

**At a glance**

| | |
|---|---|
| Backend | FastAPI, ~160 REST endpoints in one module (`backend/main.py`), SQLAlchemy over SQLite |
| Frontend | React 19 + TypeScript + Vite, Tailwind v4, react-query; one large component per tab in `frontend/src/components/` |
| Data | one project directory per family archive: `projects/<id>/` with its own DB, documents and `project.json` |
| Schema | version stamped in the DB, idempotent migrations at startup (currently v19) |
| Packaging | PyInstaller onedir; `launcher.py` starts uvicorn on a free local port and opens the browser |
| CI | `.github/workflows/build.yml` — a push to `main` builds and publishes the Windows and macOS bundles |
| Tests | none; changes are verified by exercising the real endpoint or screen |
| Working rules | [`CLAUDE.md`](CLAUDE.md) — commits, verification, conventions, data-handling rules |

**Start here for a task**

| If the task is about | Read | Then open |
|---|---|---|
| Scanning photos, face detection, clustering | [Scan](#scan), [Clusters](#clusters), [Sub-cluster centroid matching](#sub-cluster-centroid-matching) | `backend/scanner.py`, `backend/clusterer.py`, `ScanTab.tsx`, `ClustersTab.tsx` |
| Photos deleted outside the app, gallery going stale | [Gallery maintenance](#gallery-maintenance) | `backend/maintenance.py`, `main.py` (`activate_project`, startup event), `ProjectSwitcher.tsx` |
| The family tree — layout, controls, PNG export | [Genealogy](#genealogy) | `frontend/src/treeGeometry.ts`, `TreeView.tsx`, `FamilyTreeTab.tsx`, `TreeExportModal.tsx` |
| Person profile, relations, notes, sources | [Genealogy](#genealogy) | `PersonPanel.tsx`, `NoteEditor.tsx`, `_person_dict` / `_note_dict` in `main.py` |
| Documents, in-app text documents, citations | [Documents and text documents](#documents-and-text-documents) | `DocumentsTab.tsx`, `TextDocumentEditor.tsx`, `DocumentViewer.tsx`, `_doc_dict` in `main.py` |
| Events and the timeline | [Events and event faces](#events-and-event-faces) | `EventsTab.tsx`, `EventTimeline.tsx`, `_event_dict` in `main.py`, `DescriptionField.tsx` + `mentions.tsx` for the description and title |
| Any person picker, or names shown under a name | [Person pickers](#person-pickers) | `familyContext.tsx`, `components/PersonSelect.tsx` |
| Marking things private, or a new privacy-bearing table | [Privacy enforcement](#privacy-enforcement) | `database.py`, `export_utils.py`, `gedcom_export.py`, `ai/tools.py` |
| A schema change or a new column | [Projects and database](#projects-and-database) | `database.py`, `project_manager.py`, `types.ts` |
| ZIP export, project import, merge import | [ZIP export](#zip-export) | `export_utils.py`, `merge_import.py`, `ExportModal.tsx`, `MergeModal.tsx` |
| Sharing a branch with a relative | [Collaboration and share profiles](#collaboration-and-share-profiles) | `backend/share_filter.py`, `ShareModal.tsx`, share endpoints in `main.py`, `_redact_persons` in `export_utils.py` |
| A record that must survive a round trip between databases | [Cross-database identity](#cross-database-identity) | `database.py` (`STABLE_ID_TABLES`), `ensure_stable_ids` in `export_utils.py`, `merge_import.py` |
| GEDCOM in or out | [GEDCOM export](#gedcom-export) | `gedcom_export.py`, `gedcom_import.py`, `GedcomImportModal.tsx` |
| The AI assistant — tools, prompt, providers, models | [AI assistant (implementation detail)](#ai-assistant-implementation-detail) | `backend/ai/`, `AssistantPanel.tsx`, `AssistantSetup.tsx` |
| Reading scanned documents, triaging a folder of records | [Reading scanned documents](#reading-scanned-documents) | `ai/doc_reader.py`, `transcriber.py`, `ScanReadModal.tsx`, transcript endpoints in `main.py` |
| Connections between people from shared photos | [Connections graph](#connections-graph) | `ConnectionsTab.tsx`, `graphLayout.ts`, connection endpoints in `main.py` |
| Place names, autocomplete, the place hierarchy | [Places](#places) | `backend/places.py`, `components/PlaceInput.tsx`, `frontend/src/placeKey.ts` |
| A field that should offer what was typed before | [Suggesting what the project already uses](#suggesting-what-the-project-already-uses) | `backend/field_values.py`, `components/SuggestInput.tsx`, `components/VocabInput.tsx` |
| Global search, or the relationship finder | [Global Search](#global-search), [Relationship Path Finder](#relationship-path-finder) | `SearchPalette.tsx`, `RelationPathModal.tsx` |
| Updating, packaging, bundled files | [Auto-update](#auto-update-implementation-detail) | `updater.py`, `launcher.py`, `mnemosyne.spec`, `main.py` (`/api/update/*` + the startup `check_install_result()`), `UpdateBanner.tsx`, `types.ts` (`UpdateStatus`) |
| A user-visible string, a date, a language issue | [Keeping this document up to date](#keeping-this-document-up-to-date) | `i18n/translations.ts`, `SettingsContext.tsx` |
| What a feature is *supposed* to do for the user | [What you can do](#what-you-can-do) | — |
| Where a file lives at all | [Project structure](#project-structure) | — |

**How to read this document.** It is long, and reading it end to end is not the intended use. Sections are self-contained: pick the rows above that match the task, read those sections, then open the files they name. Each section describes the mechanism *and* the reason behind it — most of them exist because a simpler implementation failed in a specific way, and that failure is documented so it is not repeated.

**Before finishing any change**, walk [Keeping this document up to date](#keeping-this-document-up-to-date). It is a trigger → files checklist for the changes whose parts live in several places at once, and it is the fastest way to catch the half-finished version of a change.

---

## Features (technical detail)

### Scan
- Face detection and ArcFace embedding (insightface `buffalo_l` model)
- DBSCAN clustering with centroid-based person recognition across re-runs
- HEIC/HEIF support (iPhone photos)
- Resumable scanning — picks up where it left off after interruption
- EXIF metadata extraction (date, camera, resolution)

### Gallery maintenance
Photos can disappear from disk without the app knowing — moved, deleted in the OS, a drive unmounted. Without this, the broken thumbnail sits in the gallery until the user notices and deletes the entry by hand, faces and all.

`scanner.py` already prunes this during a full scan (`_run`, Phase 1) — but only for files under the root just scanned, since that's the only part of the collection it walked. `maintenance.py` runs the equivalent check across *every* image in the project — no directory walk, just a disk-existence check per known path — so it can run automatically without the user pointing a scan at anything.

It runs once per project activation, as a background daemon thread (`GET /api/maintenance/status` is polled briefly by `ProjectSwitcher.tsx`), from two call sites:
- `main.py`'s `startup` event, when `project_manager` loads the project that was active at last shutdown — this is the "app just opened" case, and it never goes through `activate_project` because `ProjectManager.__init__` activates that project directly.
- `activate_project`, on every explicit project switch.

`activate_project` also blocks switching while either a scan or a maintenance pass is running, for the same reason project switching already blocks on a running scan: switching disposes the SQLAlchemy engine so Windows releases the file handle, and a background write racing that disposal is the failure mode to avoid.

A removed image takes its faces with it, and `_purge_empty_named_clusters`'s query (mirrored in `maintenance.py`) removes any named cluster (`label >= 0`) left with no faces at all — a linked person is kept regardless, exactly like every other place that empties a cluster. Sub-cluster centroids for an affected person are **not** recomputed here; they refresh at the next `run_clustering` call, same as after deleting an image or batch-deleting faces from the Clusters tab. New photos are not detected this way — that still needs an explicit scan.

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

### Connections graph
- Connection strength between people: **shared photos** count and **weighted** score (Σ 1/n for group photos)
- Interactive graph view (zoom, pan, drag) and a ranked list view sorted by strength
- Click a connection line to filter the Images tab to those two people's shared photos

**The layout lives in `frontend/src/graphLayout.ts`** — pure geometry, no React, in its own module for the same reason `treeGeometry.ts` is: it is the arithmetic that decides where everything goes, and it is worth checking on its own.

A photo graph is genuinely dense. People who appear together appear together a lot, so the edge count runs several times the node count and the graph is nowhere near a tree. The original layout ran one force simulation over every node with a single gravity well at the centre of the canvas, and at that density it produced one hairball: separate groups were pulled into the same heap, and the few people actually holding the network together were buried inside it. The current layout is built around the three questions the picture should answer.

**Who holds it together → betweenness decides the radius.** `betweenness()` is Brandes' algorithm on the unweighted graph: how often someone lies on the shortest path between two other people. That is the measure that finds the person joining two friend groups *even when they appear in far fewer photos than anyone inside either group* — degree alone ranks that person as marginal. The score sets each node's target distance from its group's middle, so connectors are drawn into the centre and the periphery is pushed out. Anyone at or above `CONNECTOR_CUTOFF` gets the amber ring and a legend entry.

The radius is a **blend of betweenness and degree**, not betweenness alone, and the blend is not cosmetic: in a near-complete graph — everyone photographed with everyone — nobody lies on anyone else's shortest path, every betweenness is zero, and a pure-betweenness radius would flatten the whole group onto one ring. Degree keeps that case readable, and a dense blob genuinely has no bridge to point at, so the amber ring correctly disappears rather than picking someone arbitrary.

**How many separate groups → components are laid out and packed separately.** Each connected component gets its own force run around its own origin, and `packGroups()` then places them as discs so no two overlap. Nothing shares a gravity well, which is what the old single-well version got wrong. Betweenness is normalised *within* each component, so a small group still has its own middle instead of being rim-only because a larger group out-scores it. Groups are framed and labelled only when there is more than one — a frame around the only group is ink that says nothing.

The packing spiral is **stretched sideways** (`PACK_ASPECT`). On a round spiral a single small offshoot parked above the main group made the drawing taller than wide, and fitting that into a landscape pane halved the scale of everything — one satellite decided the zoom for the whole picture.

**Who stands next to whom → springs plus a hard collision pass.** Forces alone leave discs overlapping at this density, and an overlapping disc means an unreadable name.

Two properties worth preserving:

- **It is deterministic.** Nothing is randomly seeded — the seed is a golden-angle spiral ordered by centrality — so the same data always draws the same picture instead of reshuffling on every visit. This is also what makes the layout checkable outside the browser.
- **It runs synchronously in a `useMemo`, not as an animation.** Watching a hairball wobble into place was part of what made the old view feel chaotic. Every pass is O(k²) and blocks paint, so the iteration count and the number of collision passes step down as the group grows; a large group is a blob whose exact settling nobody can read anyway, while a frozen tab is noticed at once.

The view opens **fitted** rather than at 1:1, because the graph deliberately spreads wider than the canvas. The fit is measured off the computed layout rather than off the live dragged positions — those are React state, and on a data change the fitting effect runs before the new positions have landed, so reading them fits the view to the *previous* graph.

### Genealogy

**Family tree**
- Interactive proband-centric tree with Reingold-Tilford layout and Ahnentafel ancestor positioning
- Ancestor depth and cousin-degree (lateral depth) controls
- Collapse/expand subtrees; collapsed nodes show a hidden-person count
- Shift+click any node to refocus the tree on that person
- **Pin a default proband** with the pin button in the bottom-right controls: the tree opens on that person instead of the first in the list. Stored server-side as `default_proband_id` in `projects/<id>/project.json` — it belongs to the project rather than to one browser profile, travels with `projects/` through an auto-update, and is what the AI assistant reads to know who "I" means. A value left in `localStorage` by an older build is migrated on first load. Precedence: in-session selection > pin > first person; a pin naming a deleted person falls back silently
- Export as PNG: 1× or 2× DPI, dark or light background, with or without face photos

**Statistics**
- A second view next to the tree (`tree.viewStats` toggle in `FamilyTreeTab.tsx`), computed client-side from the same `persons`/`relations` the tree already has — no separate endpoint, and it respects the active family-group filter
- Every bar, stat card and completeness row in `StatisticsView.tsx` is clickable: it hands `FamilyTreeTab` a set of person ids plus a label, which switches to the tree view, opens the sidebar, and isolates that set — a `personFilter` that composes with the existing search box, shown as a dismissible chip above the person list. "Longest lived" rows skip the filter and jump straight to that one person's profile
- `StatisticsView.tsx` splits `occupation` by the same three separators as `field_values.py` for a different job — see [Suggesting what the project already uses](#suggesting-what-the-project-already-uses)

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
- `@` mentions: type `@` for a person picker; inserts `@[Name](#pid-ID)`, which renders as the person's name alone in brand purple — the `@` is how a mention is typed, not how it is read
- A note title is optional, and the card renders **no header row at all** when there is none, so the text starts at the top. The row used to render unconditionally, which cost an untitled note a title's height of empty space above its first line — most visible on document notes, where titles are usually left blank. With no header row to carry it, the edited-at date moves below the text, where it costs nothing
- Fully searchable via global search palette

**Sources**
- Fields: title, type, author, year, publisher, location, URL, description
- Linkable to a document or event
- Only sources with at least one citation (or linked to a document/event) appear in the citation picker
- An event's "use as source" control in `EventDetailView` is a real on/off toggle, not a one-shot button: it reflects `PersonEvent.source_id` (null when the event has no linked `Source`) and calls `POST /api/events/{id}/promote-to-source` to turn on — idempotent like the document version, reusing the existing `Source` via `Event.source` if one is already linked — or `DELETE /api/sources/{id}` to turn off, which cascades to any citations already made from it

**Every document can back a fact, without being promoted first.** `CitationsInline` in `PersonPanel.tsx` — the "Cite source" pill under a person's birth, death, occupation, christening, burial and marriage facts — offers two tabs: the source library, and **all documents**. Picking a document calls `promote-to-source` and cites the resulting `Source` in one step. This matters because the library only ever contained what somebody had already promoted from a text-document editor, so a freshly scanned certificate was invisible to the one screen that most wants to cite it: the fact it proves. Promotion is idempotent, so citing the same document from several facts still yields a single `Source`. Both tabs are searchable lists rather than a `<select>`, since a project accumulates far more of either than a dropdown can be read at.

**A marriage is a fact of the marriage, not of either spouse.** Year, place, divorce year/place and a *Cite source* pill live on the spouse row in `PersonPanel.tsx` — the row that names the husband or wife — and expand under the chip that was clicked. The citation is stored with `citations.relation_id` set (schema v15), and `list_citations` in `main.py` unions a person's own citations with those of every relation they are part of, so `GET /api/persons/{id}/citations` returns the same marriage sources to **both** spouses. Hanging it off one person instead — which is what encoding the relation id into the `fact` string (`marriage_<id>`) did before v15 — meant a source entered on one screen read as a missing source on the other, and a merge import copied the id across verbatim onto whatever local relation happened to carry that number.

**A child belongs to a couple, and the couple is two rows.** A child carries one `parent` relation per parent and nothing in the schema names the pair, so "which marriage is this child from?" is only answerable by reading the child's *other* `parent` row. The add-child picker in `PersonPanel.tsx` therefore asks the question at the moment the child is added — `CoParentChoice` lists this person's spouses above the search box — and writes both relations in one action. With exactly one spouse that spouse is preselected, so the ordinary case costs no extra click and the child appears on both parents' pages; before this, the same child had to be added a second time from the spouse's own panel, and usually was not. Picking *nobody* is a real answer — a child from a partner who is not in the tree — which is why it is a row of its own rather than the absence of a selection. `create_relation` caps a child at two parents, so the co-parent is dropped with a warning when the picked child already has another parent recorded, rather than sent as a third row the server would refuse. The children list reads the same information back out: `RelRow` groups by co-parent as soon as the children do not all share one, and stays a flat row when they do.

`relation_id` is a plain FK with no cascade behind it, so every path that removes a relation removes its citations first: `delete_relation` and `delete_person` in `main.py`, the duplicate-marriage branch of `merge_persons` (which re-points them at the surviving row rather than dropping them), `_delete_relation_citations` in `export_utils.py`, and `execute_rollback` in `gedcom_import.py`. The order is load-bearing in the export copy, where foreign keys are **on** and every relations delete sits inside a bare `except: pass` — delete the marriage first and the constraint fails, the exception is swallowed, and a marriage the user marked private stays in the ZIP.

**GEDCOM interoperability**
- **Import**: `.ged` file → persons (including occupation, education, religion, nationality, cause of death), relations, events, notes, sources, documents; preview wizard for merge/create/skip decisions per person
- **Export**: standards-compliant GEDCOM 5.5.1 with UTF-8 encoding; see [GEDCOM export](#gedcom-export) below

### Privacy enforcement

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

**`is_private` is not the sharing mechanism.** It answers "may this ever leave this machine, for anybody?" — one boolean, applied to every export equally. "May *this recipient* see this?" is a different question with a different answer per recipient, and it is answered by a [share profile](#collaboration-and-share-profiles) instead. The two compose: the privacy filter still runs last on a profile's archive, so a private record stays behind no matter what the rules selected.

**Frontend**: amber padlock (always visible) when private, gray padlock (hover-only) when public. Implemented in `NoteEditor.tsx` (`NoteCard`), `PersonPanel.tsx` (`DocRow`, `RelRow`, spouse section), `EventsTab.tsx` (`EventCard`, `EventDetailView`), `ClustersTab.tsx` (`ClusterCard`), `ImagesTab.tsx` (bulk toolbar "Make private" button).

### Events and event faces
- Types: birth, death, marriage, emigration, military, education, occupation, religious, travel, award, and custom
- Any number of persons per event; date, place, description fields
- Chronological timeline view
- Title and description take `@` mentions, and the description is Markdown with `[n]` citations — the same editor a document description gets; see *Rich event descriptions* below
- `EventPerson.event_face_id` carries a face cropped from the event's **own** photos, so chips show the person at the right age rather than their default portrait. Resolved in `_event_face_map()` (Face -> Cluster -> Person over the event's images, one query per event, earliest image wins) and attached in `_event_dict()`, which every event-returning endpoint funnels through. `null` when the person isn't recognised in any event photo - clients fall back to `thumbnail_face_id`

**Rich event descriptions.** An event's `title` and `description` hold the same markup a document's do: `@[Name](#pid-N)` mentions in both, and Markdown plus `[n]` citations in the description. The editing surface is the *same component* — `DescriptionField` (`components/DescriptionField.tsx`) for the description, `MentionInput` (`frontend/src/mentions.tsx`) for the title — parameterised by an owner (`{ kind: 'document' | 'event', id }`) rather than forked, because an events tab with a plain textarea beside a documents tab with a rich one is precisely the drift that produced the second copy last time. The owner decides which endpoints the two exported helpers call: `persistDescriptionCitations()` writes the citation diff, `linkMentionedPersons()` writes the links.

Both editors that write an event use it: the event editor (`EventEditor` in `EventTimeline.tsx`, shared by the genealogy timeline, the Events tab and the Images tab) and the Events tab's detail page. In the editor the event may not exist yet — a new event has no id until Save — so citations are held optimistically with negative ids and flushed once `POST /api/events` returns, exactly as the document upload modal does; `owner.id` is `null` until then.

**A mention links the person to the event**, as `participant`. This is the same one-way rule the rest of the app uses: naming somebody in the title or the description adds them, and deleting the mention later does not remove them — the participant list's own ✕ is how a link is removed. `primary` is never assigned this way; being written about is not being the subject of the event.

`event_description_citations` (schema v18) mirrors `document_description_citations` row for row, and like it declares no `ON DELETE` action, so **every raw-SQL path that deletes an event must delete its citation rows first** — `delete_person` in `main.py`, `_delete_events` in `export_utils.py`, `execute_rollback` in `gedcom_import.py`. `_delete_events` exists for exactly this reason: three places in the export deleted events by hand, and each had to know the full child list.

**A stored event title is not display text**, for the same reason a document title is not: it holds mention markup. `renderTitleMentions()` where a mention should be clickable (the detail page heading, the timeline row, the event card), `plainMentions()` everywhere flat (breadcrumbs, the ZIP filename, a generated source title, the search haystack, the Images-tab picker), and `renderMarkdown(description, description_citations)` into a `note-content` (detail page) or `note-preview` (timeline row) container. Server-side the pair is `_plain_mentions()` / `_plain_markdown()` in `main.py`, and `_strip_markdown()` in `gedcom_export.py` for the GEDCOM `TYPE` and `NOTE` lines.

`PATCH /api/events/{id}` reads its body with `exclude_unset`, not `exclude_none`: a field sent as `null` is a field the user cleared. Under `exclude_none` clearing a title, a place or a description was dropped server-side and the save silently changed nothing.

**Photo strips are capped, and the caps live in one place.** An event can hold a whole afternoon's reel, and rendering every thumbnail turned a single event into a wall that pushed the rest of a person's life off the screen. `ROW_PHOTO_LIMIT` and `EDITOR_PHOTO_LIMIT` at the top of `EventTimeline.tsx` are the two limits; nothing else should hardcode a number. They differ in kind, not just in value:

- The **timeline row** (`ManualEventRow`, the person's life in the genealogy panel) cuts to `ROW_PHOTO_LIMIT` and ends with a plain `+N` marker. It is a glance at what the event holds, and the Events tab is one click away for the whole set, so the cut is not expandable
- The **editor** (`EventEditor`, shared by the genealogy timeline, the Events tab and the Images tab) cuts to `EDITOR_PHOTO_LIMIT` behind a button that expands and collapses. It has to be reversible: each thumbnail carries the ✕ that detaches that photo, so a photo hidden behind a permanent cut would be impossible to remove

**`create_all()` wins over the migration block, so events cascade nothing.** `init_db_schema` calls `Base.metadata.create_all()` *first* and only then runs the `CREATE TABLE IF NOT EXISTS … ON DELETE CASCADE` statements, so for `events`, `event_persons` and `event_images` those statements are dead code: the live tables are the ones SQLAlchemy built from the models, and the models declare no `ondelete`. `PRAGMA foreign_keys` is on for every project connection, so **raw SQL that deletes an event must delete its `event_images` rows first** or the statement fails the constraint — and a failed statement takes the whole delete with it, so one participant-less event holding photos was enough to make *every* person deletion return a 500. The ORM path (`delete_event`) is safe on its own, since `Event.event_images` carries `cascade="all, delete-orphan"`; the raw-SQL paths are `delete_person` in `main.py`, `execute_rollback` in `gedcom_import.py` and `build_export_db` in `export_utils.py`, and all three delete the links before the event.

**Cleaning up empty events is scoped to the person being deleted.** An event with no participants is legal — one created from the Events tab holds a title, a date and photos on its own — so `delete_person` collects the event ids the person was linked to *before* dropping their `event_persons` rows, and afterwards deletes only those of them that nobody else is left in. A blanket "delete every event without a participant" runs on every person deletion and takes hand-made photo events with it; it looked harmless only because the missing `event_images` delete above made it fail before it could do anything.

The event's own detail page in `EventsTab.tsx` is deliberately **not** capped — showing the whole set is what that page is for, and it is where the preview modal and the ZIP export hang off.

### Documents and text documents
- Types: birth/death/marriage certificates, passports, military records, land records, wills, letters, photographs, audio, video
- Type labels live in the `document_types` table, seeded in English by the v2→v3 migration, so they cannot be localised at the source. `frontend/src/docTypes.ts` translates them by their stable `key` via `docType.<key>` translation keys — but only while the stored label still equals the original seed, otherwise a user rename in the type manager would be silently ignored. User-created types are never remapped
- Image, PDF, audio and video preview, and a full-screen zoomable carousel for a document's photos or its own multiple files, in the document viewer modal
- Notes with citations and @ mentions attachable to documents
- Bulk selection, matching the Images tab's floating selection toolbar, with bulk delete and ZIP download; see [Document bulk download](#document-bulk-download)
- The Documents tab list can be sorted (recently added, title, or the document's own date) and the upload flow accepts several files at once, all landing on one document record — see *Multi-file documents, sorting and dates* below
- A document's description takes Markdown, `@` mentions and `[n]` citations — the same editor when creating a document, when editing it, and in the carousel's side panel, so a letter's transcript can be formatted and sourced beside the scan itself — see *Rich descriptions* below
- People can be named in a document's title too by typing `@`; they render as clickable links, are linked to the document, and give the AI assistant something better than a filename to read
- Any document can be cited as the source of a person's birth, death, occupation or marriage directly from their profile, without adding it to the source library first

**Multi-file documents, sorting and dates.** Several files picked in one upload action — every page of a scanned letter, front and back of a certificate — become **one document**, not one document each: `POST /api/documents/upload` takes `files: list[UploadFile]`, the first stays the row's own `stored_name`/`filename`/`mime_type` exactly as a single-file upload always has, and the rest are inserted into `document_files` (schema v10, `document_id` FK, `ON DELETE CASCADE`). A shared `title` and the rest of the metadata apply to the one resulting document, which is why the upload form's title field is never disabled by file count — one record, one title, same as it has always been. `GET /api/documents/{id}/files/{file_id}` serves an extra file the same way `GET /api/documents/{id}/file` serves the primary one; `DELETE .../files/{file_id}` removes a single mis-added page without touching the rest of the document, and `DELETE /api/documents/{id}/file` removes the **primary** one. That last one never empties the primary slot: `documents.stored_name` is `NOT NULL` and every reader of a document — the viewer, the ZIP export, the bulk download, the GEDCOM media — assumes the row's own file is on disk, so the first `document_files` page is promoted into `stored_name`/`filename`/`mime_type` and its own row is deleted. A document whose primary file is its **only** file is therefore refused (400) rather than left fileless, since removing that is deleting the document and that has its own button; a text document is refused too, because its "file" is the Markdown body itself. `POST /api/documents/bulk-delete` (`{document_ids}`) mirrors `POST /api/images/bulk-delete` and cleans up every selected document's primary file *and* its `document_files` bytes on disk before deleting the rows.

The document viewer's carousel is generic (`MediaCarousel` in `DocumentViewer.tsx`) rather than photo-only: it renders whichever of the primary file, `document_files` and — for text documents — `document_images` are present, showing images inline and a filename-plus-open-link card for anything else (a PDF page mixed in with photos, say). Clicking the primary preview or the "Open" button always opens it for an image — even a document with a single photo benefits from zoom and the description panel — while a non-image primary only opens it when there is more than one file to browse; a single PDF/audio/video still opens directly, since there is nothing to browse and no zoom applies.

Two things beyond browsing between files: **zoom** works on whichever image is current, and a **collapsible description panel** docked to the screen's right edge shows the document's own `description`, scrollable if long, so a scanned letter and its typed transcript can be read side by side instead of switching views.

**Zoom grows the image before it crops into it.** Scroll wheel, `+`/`-`/double-click or the on-screen buttons drive one `1×`–`4×` number, but that number is spent in two phases (the constants are at the top of `DocumentViewer.tsx`). Up to `BOX_GROW_MAX_ZOOM` it widens the image's own box from its resting cap (`FIT_MAX_W_VW`/`FIT_MAX_H_VH`) toward a larger one (`GROWN_MAX_W_VW`/`GROWN_MAX_H_VH`), so the picture visibly gets *bigger* on screen; only past that does the remainder become a CSS `scale()` that crops into detail, with drag-to-pan enabled. Zooming that only ever cropped inside a fixed frame was the original implementation and it read as broken — the thing a user asks for first is a bigger picture, not a tighter crop. Two traps live here. The grown cap must be propagated to the **outer column's** `maxHeight` as well (`calc(<cap>vh + 56px)` for the counter row): flexbox squeezes on the main axis, so leaving the outer cap at a fixed `92vh` silently shrinks the image back down to make room for its sibling and no growth is ever visible. And the wheel listener must be attached natively in an effect — React registers `wheel` as passive, so `preventDefault()` on the synthetic event is ignored and the page scrolls behind the viewer.

The description panel is deliberately *not* laid out next to the image — it is `position: absolute` against the viewport, sized and placed independently of whatever the image's own dimensions happen to be, which is what keeps it pinned to the edge instead of drifting with a narrow or a wide photo. Its width is **drag-resizable** from its left edge between `SIDEBAR_MIN_W` and `SIDEBAR_MAX_W` and persisted in `localStorage` under `mnemosyne_docDescWidth`, using the same drag mechanic as the assistant panel's `startResize` — a reader who has set a comfortable transcript width should not have to set it again per document. The collapse toggle is a small bubble tab (`rounded-l-full`) attached to the panel rather than a full-height bar, because a tall vertical bar sitting beside the tall vertical prev/next arrows was read as a third paging control; its chevron points toward the edge while open (this is the "collapse that way" direction) and back toward the image once collapsed. Because the panel occupies real screen width, the close button and the next-page arrow both shift left to clear it — precisely as far as the toggle button plus a gap (`railReserved`), since those two share the same vertical center as the toggle and would otherwise sit on top of it.

**The media centres against the panel, not the screen.** The overlay is `justify-center` across the whole viewport, so a media column left to itself sits at `W / 2` and the panel then covers part of it — the wider the transcript, the further off-centre the scan looks. Giving that column `marginRight: railReserved` moves its centre to `(W - rail) / 2`, the middle of what the reader can actually see, so dragging the panel wider slides the image left rather than hiding it. The eased `margin-right` transition is suppressed while the panel is being drag-resized (`sidebarResizing`), or the image visibly trails the pointer; it stays on for the collapse toggle, where the animation is the point. Open/collapsed state itself is not remembered: the panel starts expanded whenever a description exists, since that is the case it exists for.

The cite picker inside the description editor drops **leftward** (`absolute right-0`). This is not cosmetic: the panel is docked to the right edge by design, so a dropdown anchored `left-0` extends straight off the viewport and its far tab becomes unclickable. Anything that opens a popover inside this panel has the same constraint.

**Rich descriptions.** A document's `description` is not plain text: it renders as Markdown, may `@`-mention people, and may carry `[n]` citations, so a transcript can be formatted, its people named and its provenance recorded in the one field that every document type already has. Rendering goes through `renderMarkdown(description, description_citations)` into a `note-content` container everywhere the description is shown in full.

The editing surface is `DescriptionField` (`components/DescriptionField.tsx`) — toolbar, `@` autocomplete and cite picker — and every screen that edits a description uses it: the carousel's side panel behind a pencil icon, the document edit modal, the upload modal, and — through the same component with `owner.kind === 'event'` — the two event editors (see *Events and event faces*). The upload modal edits a description *before the document exists*, which is why `owner.id` is `number | null`: with no id the cite picker still works (promotion needs the id of the document being **cited**, not the one being written) and citations stay optimistic until the caller flushes them with the id `upload` returns. It is deliberately **controlled and save-less**, because those screens save differently: in the panel the description is the only thing being edited and gets its own Save, while in the modal it is one field among several under the modal's single Save. A component that saved itself could only have served the first, which is exactly how the modal ended up with a plain textarea while the panel had the rich one. Persisting is therefore the caller's job, through the two helpers the same module exports: `persistDescriptionCitations(owner, before, after)` and `linkMentionedPersons(owner, before, after)` — the `owner` is what decides whether they write to the document endpoints or the event ones. Use the second only where links are not already written as they happen — the edit modal's person picker persists each toggle immediately, so it calls the first alone.

The citations live in their own table, `document_description_citations` (schema v11), rather than reusing `document_citations`: that one is scoped to the Markdown *body* of an in-app text document, whereas **every** document has a description, so folding both into one table would have meant a discriminator column and a body/description ambiguity in every query that reads it. Both are exported, merged and deleted through the same paths — see the document-child checklist below.

Mentioning a person **links** them to the document (the same one-way rule the rest of the app uses: removing the mention later does not unlink them), which is why saving a description also issues `POST /api/documents/{id}/persons/{person_id}` for each newly mentioned person, and why the save invalidates both the document list and every affected person's key.

**Mentioning people in a title.** A document's title can name people too, so the assistant reads "letter from ⟨person⟩ to ⟨person⟩" rather than an opaque filename. Typing `@` in the title field (`TitleField` in `DocumentsTab.tsx`) opens the same inline mention picker as every other text field, and stores the same `@[Name](#pid-N)` markup a body would. A title is a text field like any other; both a separate `@` *button* and a bare-name insertion were attempts to make it special, and both were wrong. Storing the real reference is what makes the mention survive a rename, render as a link, and tell the assistant who the document is about.

**A stored title is therefore not display text.** It reaches the reader three different ways, and picking the wrong one shows them `@[…](#pid-4)`:

| Where | How |
|---|---|
| The viewer header and the Documents-tab row | `renderTitleMentions()` — mentions become `a.note-person-ref`, everything else is escaped |
| Anywhere flat: search haystacks, sort keys, `alt`/`title` attributes, cite pickers, modal subheaders | `plainMentions()` |
| A description quoted into one clamped line (a row excerpt, a search result) | `plainMarkdown()` — the full syntax, not just mentions |

A rendered mention shows **the name alone, in brand purple** — no `@` sigil. The `@` is a way of typing a mention, not a way of reading one: it belongs in the editor, where the raw `@[Name](#pid-N)` is visible anyway. In finished prose it is noise on top of a colour that already says "this is a person". `a.note-person-ref` is styled unscoped in `index.css` precisely because a mention now also appears outside a rendered body, in a one-line title that is not a `note-content` block.

`renderTitleMentions` deliberately does **not** run `marked`: a title is one line, so a Markdown parse would wrap it in a `<p>` and read a `*` inside a real name as emphasis. Only the mention form is resolved. Where a title link sits inside something else clickable — the Documents-tab row opens the document — the handler must `stopPropagation`, or one click does both.

Server-side the same split applies, via `_plain_mentions()` and `_plain_markdown()` in `main.py`: the on-disk filename (`_slug_filename`), the generated source title in `promote-to-source`, the bulk-download manifest and GEDCOM's `TITL` (through `_strip_markdown` in `gedcom_export.py`) all take the flat form. The project ZIP is the exception and keeps the raw markup, because it is a round-trippable copy that merge-import reads back. `_plain_markdown` keeps `[n]` citation markers on purpose — the manifest lists the sources they point at directly underneath.

**Selection UI is shared, not duplicated.** The Documents tab's floating bulk toolbar (`DocumentsTab.tsx`) is styled and positioned identically to the Images tab's (`fixed bottom-6 left-1/2 -translate-x-1/2`, the same pill chrome) — deliberately, so a user who has learned one has learned the other. Only the action set differs (documents have no privacy toggle or add-to-event action; the ZIP-notes checkbox is unique to documents). Match this pattern for the next tab that grows bulk actions rather than inventing a new bar shape.

`documents.date` (schema v9) is a partial ISO date — `YYYY`, `YYYY-MM` or `YYYY-MM-DD` — alongside the pre-existing `documents.year`, mirroring `events.date`/`events.year`. `year` stays in sync automatically: `upload_document`, `create_text_document` and `update_document` all derive it from `date` server-side when `date` is given and `year` is not, so every listing and sort that already reads `year` (`GET /api/documents`'s `ORDER BY year`, the Documents-tab table column) keeps working unchanged. The year/month/day picker itself is `DatePartPicker`, exported from `EventTimeline.tsx` and reused as-is rather than rebuilt — see the checklist entry below.

**Two ownership columns, and why both exist.** `documents.person_id` is the original single owner; `document_persons` is the many-to-many junction every listing actually joins on. They must be kept in step by hand:

- `merge_persons` re-points `document_persons` rows at the target with `UPDATE OR IGNORE` (the plain `UPDATE` would collide when both people are linked to the same document), then deletes the leftovers. Without this the junction rows are FK-cascaded away with the source person and the document silently disappears from every listing while still existing in the table
- `delete_person` hands ownership of that person's documents to a co-linked person before deleting them, because `Person.documents` cascades `all, delete-orphan` and would otherwise destroy documents shared with others. Only when nobody else is linked is the document dropped — and then its file is unlinked from disk, which the ORM cascade does not do
- `link_person_to_document` fills a NULL `person_id` with the person being linked, and `unlink_person_from_document` hands the column to whoever is still linked — or clears it when the last link goes. A `person_id` left pointing at somebody no longer in the junction is not cosmetic: `delete_person` cascades on that column, so a stale owner takes the document down with them

**Removing a document from a person is not deleting the document.** The X on a document row in `PersonPanel.tsx`'s Documents tab calls `DELETE /api/documents/{id}/persons/{person_id}`: the person loses the document, and the document keeps its file, its other person links, its citations and its place in the project — belonging to nobody if that was the last link, which is a valid state. Re-attaching it is the same row's *+ Link* button, so the action is undoable. Deleting a document outright is a **Documents-tab** action only, because that is the one screen that shows every person a document is attached to, so the consequence is visible before the click. This split exists because the person panel's X was wired to the delete endpoint and a user removing a document from one person's page lost it from the whole project; a row that offers both destructive and local removal behind one icon will be read as the local one.

**A document may belong to no one** (schema v8, `documents.person_id` NULL and no `document_persons` row). Genealogy is not the only reason to write something down — a chronicle or a research memo often exists before anyone in it has a record, and forcing a link at save time makes the user invent one. Both creation paths accept an empty person set: `POST /api/documents/upload` with an empty `person_ids`, and `POST /api/documents/text` with an empty list. Such a document belongs to the *project*, which decides how each pipeline treats it:

| Pipeline | Treatment |
|---|---|
| Listings, search, bulk download | Included; the person column simply reads empty |
| Full project ZIP export | Included — the project is what is being exported |
| ZIP export scoped to a person or cluster selection | **Excluded.** `_delete_persons` in `export_utils.py` deletes documents by owner, and `person_id IN (…)` is never true of NULL, so the unowned ones need their own DELETE — without it a project-level chronicle rides along in an export of one family group |
| GEDCOM export | Excluded. A GEDCOM hangs documents off an `INDI`; exporting the file with no record referencing it would put unreferenced media in the ZIP |
| Merge import | Included. It has no person decision to follow, so it comes across on its own and names itself in the rollback data — nothing else would remove it on an undo |

**Text documents** (`documents.is_text = 1`, schema v6) are written in the app instead of uploaded. The Markdown body is stored as a `.md` file in `projects/<id>/documents/` under the usual UUID `stored_name`, so downloads, bulk ZIPs, project exports and GEDCOM media all handle them without special-casing. `filename` is a slug of the title and is re-derived whenever the title changes, so archives stay readable.

| Concern | Table / endpoint |
|---|---|
| Body | `GET` / `PUT /api/documents/{id}/text` → `{ content }` |
| Create | `POST /api/documents/text` — `person_ids` may be empty |
| `[n]` references | `document_citations` · `POST /api/documents/{id}/citations`, `DELETE /api/document-citations/{id}` |
| Attached photos | `document_images` · `POST /api/documents/{id}/images`, `DELETE /api/documents/{id}/images/{image_id}` |

**An `@` mention also links the person.** Picking someone from the mention list in `TextDocumentEditor.tsx` inserts the `@[name](#pid-…)` link *and* adds them to the linked-person set in the sidebar, because naming somebody in the body and linking them to the document are the same statement — requiring both by hand meant the sidebar was reliably out of date. The coupling is deliberately one-way: deleting the mention from the text leaves the link in place, and the picker's own toggle is how a link is removed. Combined with an empty person set being valid, this is the intended flow — write first, and the links accumulate as people are named. The same rule and the same one-way coupling apply to the description editor and the title mention button described under *Documents and text documents*.

`document_citations` mirrors `note_citations` exactly (`source_id` NULL means a free-text citation carried in `custom_label`), so the same renderer and References panel work for both. Citing a document from the editor calls `promote-to-source` first, which is idempotent — citing the same document twice reuses one `Source`.

### Person pickers

**A list of people never shows only names.** This is a hard rule, not a preference. Given names repeat heavily inside a family — several living people can share one, and a name often passes from a parent to a child — so a list of bare names is not merely terse, it is *unusable*: there is no way to tell which of the identical entries is the right one. Every surface that lists people to choose from therefore shows, under the name, the years/place line (`personLifeSummary`) and the close relatives (`<FamilyContextLines>`). That includes the mention popups, not just the pickers, and it applies to every row rather than only the highlighted one — you have to compare rows to choose between them, so context that appears only on the active row is context that arrives too late.

`frontend/src/familyContext.tsx` is the single source for that context: `useFamilyContext(persons, relations, nameOrder)` returns id → `{ spouses, parents, children, siblings }` with names already rendered in the configured order, and `<FamilyContextLines>` renders the ♥ / ↑ / ↓ / ~ lines (capped at two names each, siblings only when nothing closer exists). `components/PersonSelect.tsx` builds `PersonMultiSelect` and `PersonFilterCombobox` on top of it; `frontend/src/mentions.tsx` builds the `@` mention list on top of it.

Document payloads carry the individual name parts (`_doc_person_dict` in `main.py`), not just the stored display name — `persons.name` is always composed by `_derive_display_name()` in one fixed order, so a client that only receives it cannot honour the name-order setting.

**`@` mentions are one implementation**, in `frontend/src/mentions.tsx`. `useAtMention(onPick)` owns the whole behaviour — open/closed state, the query, the keyboard cursor, the caret anchor and the rendered list — and hands back `sync()` (call it from the field's `onChange`), `handleKeyDown()` (returns true when it consumed the key) and a ready-to-render `popup`. The caller supplies only what an accepted mention *writes*, because that genuinely differs: a Markdown body gets `@[name](#pid-N)`, a plain-text title gets the bare name.

This module exists because the three fields that have mentions once carried three near-copies of the same code, and they drifted — one grew the relative lines, another kept name-only rows, and the rule above quietly stopped holding in the newest one. Anything that would have been a fourth copy goes here instead.

### Places

A place is one free-text column per fact — `persons.birth_place`,
`persons.christening_place`, `persons.death_place`, `persons.burial_place`,
`relations.marriage_place`, `relations.divorce_place`, `events.place`. Those seven
columns are enumerated once, in `PLACE_COLUMNS` in `backend/places.py`, and nothing
else in the codebase lists them: a new place column added to the model has to be
added there or it stays out of the suggestions.

**The text is a hierarchy, written finest-first and separated by commas** — the same
convention the GEDCOM exporter already emits as `PLAC`:

```
"Fő utca 12, Példafalva, Somogy, Magyarország"
  │            │           │        │
  detail    settlement   region  country
```

The finest level is where a street and a house number go. That is a records
concern rather than a tidiness one: the same house number in two parish entries is
the same family home, and a house number swallowed into the settlement name turns
every address into a separate place. Reading it this way needed **no schema change**
— the columns still hold exactly what was typed.

**The split happens once, in `backend/places.py`, and never in the browser.**
`GET /api/places` returns rows that are already divided into `detail` /
`settlement` / `region` / `country`, plus `canonical` (everything but the detail)
and `key` (the folded string). The frontend filters and ranks that array and does
not parse a place, for the same reason `treeGeometry.ts` owns card sizes alone: two
heuristics for "is this a house number" would drift, and the drift would be
invisible until a map pin landed in the wrong village.

`place_parts()` treats a leading level as a detail when it contains a digit or ends
in a street word (`utca`, `út`, `tér`, `köz`, `street`, …). The word list is
deliberately short — over-eager matching demotes a settlement to a house number,
which costs the place its identity, while a missed detail merely leaves a house
number in the label. One case has no comma at all and is handled separately: a
register writes `Példafalva 47. sz.`, so a trailing house number is cut off the
settlement it was written onto.

**`GET /api/places` returns two kinds of row in one list.** Every distinct full
string as written, with how many facts use it (spellings that differ only in comma
spacing are merged and the most common one represents them); and a settlement-level
row, flagged `is_settlement`, for each settlement that is *only* ever written with
an address in front of it — so somebody who wants the village alone does not have
to delete a stranger's house number first. The whole list comes back with no `q`
parameter, because a family project holds at most a few hundred distinct places and
a list the client already has filters as fast as the user types.

**It is deliberately not privacy-filtered.** `is_private` governs what leaves the
machine, not what its owner sees in their own project, so a private event's place is
a suggestion like any other.

**Every place field in the UI is `components/PlaceInput.tsx`**, never a bare
`<input>`: the four on the person's details form, the two on the spouse row, and the
one in `EventEditor` — which is shared by three tabs, so that single field covers
all of them. `PlaceInput` is a thin wrapper over `SuggestInput` (see
*Suggesting what the project already uses*) that adds the settlement-only rows and
nothing else. After any mutation that writes a place, `['places']` is invalidated
alongside the resource's own keys.

`frontend/src/placeKey.ts` holds the one client-side helper — folding a *typed
query*, or a raw column value being looked up among the returned rows. It is a
plain module with no React and no `api.ts` import so it can be run from a Node
script and checked against `fold(normalize_raw(…))` in `backend/places.py`; the two
have to agree exactly, and Hungarian `ő`/`ű` decompose differently from plain
acutes, which is precisely the sort of disagreement nothing on screen would show.

### Suggesting what the project already uses

Places were the first field to offer back what had already been typed, but the
problem is not specific to them. A handful of columns hold a **vocabulary** — a
few values that repeat across the whole family — and typing one of those out
again is pure cost, while typing it slightly differently the second time is worse
than cost: it silently splits one group into two everywhere the field is counted,
grouped or searched, and no later cleanup fixes that retroactively.

**One implementation, in `components/SuggestInput.tsx`.** It owns the input, the
dropdown, the keyboard cursor, the blur rules and the matching. Two wrappers
supply options and row decoration and nothing else:

| Wrapper | Options from | What it adds |
|---|---|---|
| `PlaceInput.tsx` | `GET /api/places` | settlement-only rows (see [Places](#places)) |
| `VocabInput.tsx` | `GET /api/field-values`, by field name | list-term rows, and an optional `seed` of values offered before the project has any of its own |

The extraction happened when the second wrapper was written rather than after —
three hand-rolled copies is what made the `@` mention lists disagree with each
other, and reconciling them cost more than sharing would have.

**Which columns are a vocabulary is decided in `backend/field_values.py`**, in
`FIELD_SOURCES`. Currently `persons.occupation` (a list column), `religion`,
`nationality`, `education`, `cause_of_death` and `title`. Adding a row there is
the whole backend change; the frontend never names a column, it passes the
registry key to `VocabInput`.

**Names are deliberately not registered, and neither are event titles.** A
surname repeats far more often than a religion does, but a name field is not a
vocabulary: offering existing people's names while somebody types a *new* person's
name invites picking the wrong one, and choosing an existing person is what the
person pickers are for. Event titles are descriptions rather than terms — in
practice almost every one is distinct, so a suggestion list is noise.

**A list column offers its terms as well as its whole values.** `occupation` can
hold several trades separated by `,`, `;` or `/`; each term comes back as its own
row flagged `is_part`, so somebody with one trade can take a single term out of
another person's pair without editing it down by hand. A term identical to a whole
value is not repeated. `StatisticsView.tsx` splits the same column with the same
three separators for a different job — counting terms, not suggesting them — so
those two rules are alike on purpose and should change together.

**Spellings are grouped, and one of them represents the group.**
`dominant_spelling()` in `backend/places.py` picks it, and both the place list and
the field-value list use it: most used wins, a tie goes to the quieter
capitalisation (`Kadar` over `KADAR`) and then to alphabetical order. Breaking the
tie by dictionary order instead would make the suggestion list reshuffle whenever
an unrelated row was added.

**Both lists are fetched whole and filtered in the browser** — no `q` parameter.
Together they are a few kilobytes, and a field that only becomes visible when a
form is opened would otherwise fetch on first focus, which is the one moment the
suggestion needs to already be there. Matching is accent- and case-insensitive
anywhere in the string, through `foldPlace()` in `frontend/src/placeKey.ts`.
Neither list is privacy-filtered: `is_private` governs what leaves the machine,
not what its owner sees in their own project.

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

### Web research

`ai/web_tools.py` is a **second, independent tool registry** (`WEB_REGISTRY`), never merged into `tools.py`'s always-on `REGISTRY`. Every tool in `tools.py` reads the local, already-consented-to project database; `search_web` and `read_web_page` send a query to a third-party search engine (Tavily) and fetch pages from the open internet — a materially different disclosure that needs its own opt-in, its own API key, and its own daily quota, all stored in `config.json`'s `web_research` block, separate from the `ai` block the assistant itself uses. `orchestrator.py` includes `WEB_REGISTRY`'s definitions only when that block is enabled and holds a key — a user who never turned it on never sees the tools exist, and no prompt tokens are spent explaining a capability that would just refuse.

The split mirrors the project's own document tools: `search_text` finds, `get_document` reads one in full; here `search_web` finds candidate pages (title, URL, snippet only) and `read_web_page` reads exactly one. The system prompt requires the second call before reporting what a source says — a snippet is not the document.

**PDF and page reading is done in-house, not left to the search vendor.** Tavily's documented API surface says nothing about PDF support one way or the other, so depending on it would mean depending on an unverified behaviour for the one requirement that matters most here. `read_web_page` fetches the URL itself and extracts text with `pypdf` (PDF) or `BeautifulSoup(..., "html.parser")` (HTML) — both pure-Python, chosen specifically so PyInstaller needs no special handling for them (`PyMuPDF`/`lxml` would add compiled binaries and, for `PyMuPDF`, an AGPL licence question neither is worth taking on here).

**`pypdf` extracts a PDF's embedded text layer only — it does no OCR.** A scan published with no OCR pass comes back with nothing to read. In practice this rarely matters: serious digitisation efforts (archive.org, FamilySearch, library and society scanning programs) run OCR before publishing specifically so the result is searchable. `read_web_page` detects a PDF that comes back near-empty and returns a distinct note ("looks like a scanned image with no OCR text layer") rather than an empty string — the same "an empty result must not read as an absent fact" discipline the rest of this file already lives by, extended to a source the project has no control over.

**The daily quota is enforced in the tool handler, not the prompt.** `try_consume_web_quota()` in `ai/config.py` does a check-and-increment against `config.json` before the outbound request even happens — the same "don't trust one mechanism alone" reasoning behind the read-only guarantee's three independent layers. A model asked nicely to be economical still might not be; a quota checked in code cannot be talked past.

**Toggling web research on or off changes the cached prompt prefix**, exactly as `style`/`lang`/`name_order` already do (see "Response style" above) — `orchestrator.py` builds the tool list conditionally, and the tool-definitions block sits ahead of the system prompt in the same cached prefix. This is an accepted, existing trade-off, not a new one: flipping a per-turn input costs one full-price prompt instead of a cached one.

### Guessable values must be discoverable

`event_type` is a stored vocabulary (`religious`, `custom`, …) that rarely matches the word a question uses — a filter of `confirmation` matched nothing, which the model reported as "the event was never recorded". Two mitigations: `build_inventory()` puts the project's actual `event_type` and `doc_type` values in the cached prefix, and `list_events` returns the available types in a `note` whenever a type filter matches nothing. The general rule for this tool layer: **an empty result must never be mistakable for an absent fact.**

For the same reason `get_person(include=['events'])` returns each event's attendees. Returning the event without them reads as "nobody was recorded", which is a different claim from "you didn't ask".

### Reaching the prose

Structured fields are only half of a family history; the other half is written in notes, in-app documents and event descriptions. That half was reachable only by keyword — `search_text` needed a `query`, and `list_documents` returned titles with no way to open one. A model that has to guess search terms misses, and a miss reads as "nothing was written". So:

- **`search_text` with no `query` lists the whole corpus** — every note, document, document note, event description and source with its owner, its length and its opening line. Knowing what exists is a different question from whether a word appears, and it needed its own answer. The per-kind totals are computed before the cap, so a listing cut short cannot make a whole kind look absent.
- **`get_document` opens one document in full**, with its notes, its people and its source. `list_documents` gives titles, and a title is exactly enough to invent a summary from.
- **`get_person` returns the text, not a pointer to it** — notes, document bodies, the legacy `persons.notes` field, a photo count with its gallery link, and cited sources, in one call. It also returns `missing_fields`, because `_person_full` drops empty keys and the caller otherwise cannot tell an unrecorded field from one it did not ask for.
- **Uploaded files say they cannot be read.** `_doc_dict` carries `readable`, and a scan or a recording comes back with an explicit note not to characterise its contents. Otherwise a document titled "1908 register entry" gets summarised as if it had been read.

### Response style: structured vs. narrative

The system prompt's `## Style` section carries a `{style_block}` placeholder (`SYSTEM_INSTRUCTIONS` in `ai/primer.py`) filled from `STYLE_BLOCKS["structured" | "narrative"]`. The two variants are **not** one shared instruction plus a modifier — the narrative block never mentions headings or bullet points, and the structured block never mentions prose or connective narration. Each request pays for one style's worth of formatting instructions, not both, which matters because the model would otherwise burn tokens reconciling instructions it has no use for.

Both variants end with a one-line reminder that only the *shape* of the prose changes — every anti-invention rule elsewhere in the prompt (no guessed places, occupations, period colour) applies identically to both, so a warmer narrative voice is not licence for a richer guess.

**Sourcing has to survive without breaking the story.** The first narrative version still marked every family legend with "you wrote in your notes that..." — technically correct (notes *are* user-authored) but it reads as the app footnoting itself mid-story, because it names the reader as the archive's author instead of just telling the story to them. The narrative block now asks for the same distinction — recorded fact vs. remembered tradition — voiced the way an oral historian would ("family lore has it that...", "the story goes...") rather than as a disclaimer stapled onto the sentence. The underlying rule (never let inference or legend read as a plain fact) is unchanged; only *where the hedge lives* moved from a tag to the sentence's own wording. The inference-marking rule that used to be a separate, style-independent bullet in `SYSTEM_INSTRUCTIONS` moved into `STYLE_BLOCKS` for exactly this reason — how an inference should be marked is itself a style question, structured mode tags it, narrative mode has to weave it in.

`style` flows exactly like `lang` and `name_order` already did: `ChatSendRequest` (`schemas.py`) → `run_turn` (`ai/orchestrator.py`) → `build_system_blocks` (`ai/primer.py`), sent fresh with every turn rather than stored on the thread or the project. The frontend toggle in `AssistantPanel.tsx` is local component state persisted to `localStorage` (`mnemosyne_chatStyle`) — a per-device preference, not a per-conversation or per-project one, matching how `nameOrder` and `lang` are stored in `SettingsContext.tsx`.

**Changing it busts the prompt cache.** `build_system_blocks` puts the `cache_control` breakpoint on the second content block, which caches everything before it in the same prefix — so the instructions block (which now embeds `style_block`) is part of what gets cached. This was already true of `lang` and `name_order`; a style toggle a user flips mid-conversation costs one full-price prompt instead of a cached one, which is an acceptable and existing trade-off, not a new one.

### Absence, speculation, and undated people

Three rules in the system prompt, each from an answer that was wrong in a way the user had to catch:

- **Never report an absence you did not check.** "No documents are attached" is a factual claim about the project. The `material` marks make it checkable, so the prompt requires it to be checked.
- **Never invent context.** No guessed places, occupations, class or period colour — and explicitly, *a hedge does not license a guess*: "probably the capital (?)" is still an assertion about a real family that someone now has to disprove. Where a field is empty the answer is that it is empty.
- **A line ends where the parents end, not where the dates end.** The earliest generations of a hand-built tree are usually the undated ones — copied from a register, remembered by a relative. Reporting the oldest *dated* person as the oldest known ancestor drops exactly those. `get_ancestors` walks parent links and ignores dates entirely, and now returns `undated_in_chain` so the answer can name them as undated rather than omit them.

### Truncation must be visible

Every list-returning tool goes through `_capped()`, which returns `count`, the true `total`, and a `truncated` flag with an explicit warning. This exists because a silent cap produced a confidently wrong answer: asked how many photos contained two people, the model called `list_photos_of` for each, got 50 of 340 and 50 of 67, intersected the two truncated lists and reported 15. The real answer is 45.

A truncated list is indistinguishable from a complete one unless the tool says so — the same failure shape as an empty result reading as an absent fact. `find_shared_photos` then removes the need for that intersection altogether by computing it server-side.

### Who the assistant thinks you are

Nothing else in the prompt identifies the user, so a question like "who is my oldest ancestor" would otherwise be unanswerable. `build_asker_note()` resolves it from the project's stored `default_proband_id` — the same person the tree opens on — and states the id in the system prompt, at request time. It is never baked into prompt text, and with no proband set the model is told to ask rather than guess. The prompt also tells it to say who it took the asker to be, so a wrong pin surfaces immediately.

### Today's date, and calendar questions

Nothing in the prompt used to state the current date at all, so "who has a birthday this week" was unanswerable in principle — not a missing tool, a missing fact. The model had no "this week" to compare anything against, and reached for whatever tools looked date-adjacent (`get_person`, `search_text`) rather than admitting it had no way to know. `build_today_note()` states today's date, read from the server's own clock (this is a local desktop app, so that is the user's clock too), in the same per-request block as the asker note.

Stating the date is necessary but not sufficient — the actual comparison (does this person's month-and-day fall in the next N days, wrapping correctly across a year boundary) is exactly the kind of arithmetic the rest of this section already distrusts a model to do by hand over dozens of people. So `get_upcoming_anniversaries` does it server-side: it reads `persons.birth_date` / `death_date` directly, because the tree skeleton only carries whole years and cannot answer this at all, and only a full `YYYY-MM-DD` date carries a day to compare. Deceased people are included deliberately — a death date removes nobody's birthday, it just changes how the answer should phrase it (the tool marks `deceased` per result so the model can say "would have turned" rather than "turns").

### Clickable references

Raw ids in an answer are dead ends — a user cannot click the number `299`. `markdown.ts` resolves five constructs, and the system prompt requires them:

| Written by the model | Renders as | Click goes to |
|---|---|---|
| `@[Name](#pid-42)` | `a.note-person-ref` | that person's profile |
| `[caption](#img-40)` | `a.note-image-ref` | that photo in the Images tab |
| `[caption](#people-3,6)` | `a.note-people-ref` | Images tab filtered to photos containing **all** of them |
| `[Title](#doc-7)` | `a.note-document-ref` | that document in the Documents tab |
| `[3]` | `a.note-ref` | the citation |

The gallery form reuses `navToImages`, which the Connections tab already uses and which sets `include_mode: 'and'` — so the link lands on exactly the set the assistant counted, ready to select and export. The document form reuses `navToDocument`, the same cross-tab jump `FamilyTreeTab` already uses to open a document from a person's profile. **Order matters in `markdown.ts`:** the citation rule matches `[digits]`, so the link forms must be consumed first or `[3](#img-7)` is eaten as citation 3.

### The user can reference people and documents too

The composer isn't one-directional. `AssistantPanel.tsx` wires the textarea to two pickers: `@` opens the existing person mention list from `mentions.tsx` (`useAtMention`, unmodified — its three other callers are untouched), writing the identical `@[Name](#pid-ID)` form the model itself uses. `#` opens a document picker over `[Title](#doc-ID)`.

**The document picker is deliberately local to `AssistantPanel.tsx`, not a new shared module.** `mentions.tsx` exists because the *same* person-mention behaviour had drifted into three near-copies; a document picker has no second caller yet and a different row shape (no family-context lines), so lifting it into a shared file now would be exactly the premature abstraction that page warns against. If a second caller ever needs it, extract then — see `useDocMention` and `getDocMentionContext` in `AssistantPanel.tsx`.

**Telling the two triggers apart needs more than "which character comes last".** Resolving a `@` mention leaves `@[Name](#pid-ID)` in the text — and that inserted text itself contains a `#`. A naive `#`-detector re-reading the field right after would see that `#` and mistake the tail of a just-resolved person mention for a document query being typed. Two things prevent it: `getDocMentionContext` treats a `)` right after the `#` as proof the reference is already resolved (mirroring how `getAtMentionContext` treats a `[` right after `@` the same way), and the composer's `onChange` additionally compares the two triggers' positions and only opens whichever sits closer to the caret, closing the other.

**The reference survives into the model's context as plain text** — chat history is replayed as text only (see *Conversations* below) — so the system prompt says explicitly that a `@[Name](#pid-ID)` or `[Title](#doc-ID)` in the *user's own* message identifies exactly who or what they mean, to be resolved by id rather than by re-searching the name or title.

**The user's own sent message renders through `renderMarkdown()` too**, not as escaped plain text — otherwise a composed reference would show its raw bracket syntax back at the user instead of the clickable chip they just picked. This is also why a person or document mentioned in a past question stays clickable when scrolling back through a conversation.

### Read-only, three independent layers

| Layer | Where |
|---|---|
| `PRAGMA query_only=ON` on a dedicated connection pool — writes raise `SQLITE_READONLY` | `configure_readonly_engine` in `database.py`, `ProjectManager.get_readonly_db()` |
| Tools are the only data path; no model-written SQL is executed in any form | `ai/tools.py` |
| `Tool.mutates=True` is rejected at registration | `ToolRegistry.register` |

`query_only` is used rather than a `mode=ro` URI because the latter can fail outright on a WAL database needing recovery.

### The tree primer

`ai/primer.py` serialises the whole tree as one pipe-delimited line per person (`id | Surname/Given | sex | birth-death | parent ids | spouse ids | material`) — a few thousand tokens for a tree of a few hundred people. It sits behind the single `cache_control` breakpoint, so it is read back at ~0.1x cost.

**The index that looks like an answer.** A skeleton of names, years and edges is enough to compose a fluent paragraph about a family without calling a single tool — and that paragraph then implicitly asserts that nothing else was ever recorded, because nothing else is in the skeleton. This happened: a question about a family's history was answered from the primer alone, ending in a list of what "is not recorded" — while notes, documents and events on exactly those people sat untouched, and the paternal line ran two generations further than the answer went.

Three things address it, and they are one mechanism, not three. `_content_marks` appends a `material` field to every line — `b3 n2 d1 e4 p14`, the count of filled biographical fields, notes, documents, events and photographs behind that id. `build_inventory()` states the project's totals above the skeleton. And the primer's own header says what the table is not. Together they mean the model can *see* the difference between a person nobody has researched and a person whose page is full, which is the difference it was previously guessing at. The marks are counts of sorted queries, so byte-stability survives; they respect the privacy filter, as the relations already did.

The general rule this is an instance of: **the model cannot suspect an absence it has no way to detect.** Instructions do not fix that — only putting the shape of the data in front of it does.

**No cache-invalidation bookkeeping exists, deliberately.** The serialisation is deterministic (sorted by id, no timestamps), so unchanged data produces identical bytes and hits the cache, and changed data produces different bytes and correctly misses. Anything non-deterministic added here silently destroys the cache-hit rate — verify with `usage.cache_read_input_tokens`, which the orchestrator records per assistant message.

Names in the primer are written `Surname/Given` precisely because they are order-neutral; the system prompt tells the model which order to *render*. Tools return name parts for the same reason (see `_person_stub`) — `persons.name` is always composed in one fixed order by `_derive_display_name()`.

### Provider abstraction

`ai/provider.py` defines `LLMProvider` plus a neutral message shape and a `ProviderEvent` union. Two adapters implement it:

| Adapter | Serves | Notes |
|---|---|---|
| `AnthropicProvider` | Anthropic | `thinking: {type: "adaptive"}` + `output_config.effort`. Do **not** add `temperature`, `top_p` or `budget_tokens` — all three are rejected with a 400 on current models. Explicit `cache_control` breakpoint on the primer |
| `OpenAICompatProvider` | OpenAI today; OpenRouter / Ollama / LM Studio by setting `base_url` alone | Chat Completions API. Uses `max_completion_tokens`, and `stream_options.include_usage` (usage is otherwise absent from a streamed response) |

Nothing provider-specific may leak above the protocol. Three differences are absorbed inside `OpenAICompatProvider`: the system prompt becomes an ordinary message (and the `cache_control` markers are dropped — OpenAI caches long prefixes automatically), tools are wrapped in a `function` envelope, and **streamed tool arguments arrive as fragments that must be reassembled per `index`** before they parse as JSON. That last one is the part that breaks silently if reimplemented carelessly.

**Reasoning depth is capability-gated, not id-gated — same rule as everything else in the model manifest.** `OpenAICompatProvider` sends `reasoning_effort` only when `model_caps(model)["reasoning"]` is true (set on the gpt-5 family in `models.json`); a non-reasoning model rejects the field outright with a 400, and an unknown model defaults to `false` in `UNKNOWN_MODEL_CAPS` for exactly that reason — silently *not* asking for more depth is a safe degradation, silently asking a model that doesn't support it is a broken turn. `AnthropicProvider` has run at `effort: "high"` since it was written; `OpenAICompatProvider` gained the equivalent default for the same reason both exist — a research-shaped question (piecing together a lineage, judging whether a web page's names line up with the tree) benefits from more deliberation than this app is otherwise latency-sensitive about, and the shallower default depth was a real, observed cause of the assistant proposing a research plan instead of running it.

**Depth and tools can be mutually exclusive, and only the provider knows when.** Some reasoning models refuse `reasoning_effort` on `/v1/chat/completions` *when the same request also carries function tools*, and say so in a 400 naming both. That hits the batch report — an agent loop with tools — while leaving transcription, which has none, working. It cannot be answered by a capability flag: the model reasons, and it takes tools; it is the **pair** that the endpoint rejects, and which ids do that changes with every release.

So it is learned rather than declared. The request goes out as normal; if the refusal names `reasoning_effort` and tools, the field is set to `"none"` and the request is sent again, and the model id goes into `_NO_EFFORT_WITH_TOOLS` so later turns skip the failed round trip. Nothing is written to `models.json` — this is the same rule as *never write a model list into a file*, applied to a quirk instead of a name.

**Set to `"none"`, not removed.** Dropping the field was the first fix and the same 400 came straight back: these models do not default to no reasoning, so an absent field is not the same as `none`. The error text says which of the two it wants, and it is worth reading rather than inferring.

The cost is real but small where it lands. The report is explicitly a shallow job — the judgement happened in `_match_page`, and the write-up runs at `medium` for that reason — so no depth is close to free there. The **assistant** is the opposite, and on such a model it loses the deliberation that stops it proposing a research plan instead of running it. The way to keep both is OpenAI's `/v1/responses` endpoint, which takes tools and reasoning together; that is a second request/response shape inside `OpenAICompatProvider`, not a config change.

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

### Assistant frontend

`AssistantPanel.tsx` sits beside `<main>` rather than over it, so the tree stays visible while the assistant answers. Streaming is a `fetch` + `ReadableStream` read (`api.ai.stream`), deliberately not react-query — it is a long-lived body read, not a cache entry. Thread and message lists are ordinary react-query.

Answers render through the existing `markdown.ts`: the system prompt requires `@[Name](#pid-ID)` mentions, which already become `a.note-person-ref` anchors, and the panel delegates clicks on them to `navToGenealogy` exactly as `NoteEditor.tsx` and `DocumentViewer.tsx` do. That is the feature's main defence against hallucination — every claim is one click from its source.

---

## Reading scanned documents

Lives in `backend/ai/doc_reader.py` (one page), `backend/transcriber.py` (the batch job) and `frontend/src/components/ScanReadModal.tsx`. Off until switched on, and a separate switch from the assistant's own.

### The shape of the problem

A folder of parish-register photographs arrives with two hundred pages in it, of which perhaps four concern this family. Importing all two hundred to find those four is the work being removed, so **nothing is copied into the project until the user picks a page.** A batch points at a folder still sitting on disk; `transcript_pages.source_path` holds the absolute path, and `document_id` stays NULL until the page is promoted to a Document.

### Transcribe once, store text, and every existing path picks it up

The expensive call happens **once per page, not once per question.** The transcript is stored as text on the page row, and a page that has been imported carries `document_id` — which is all `_doc_dict` in `ai/tools.py` needs to flip `readable` to true, `get_document` needs to return the transcript as the body, and `search_text` / `list_written_material` need to include it in the corpus. Nothing re-reads the image.

The alternative — a chat tool that opens a scan mid-conversation — was rejected twice over. It would mean widening the provider seam's neutral message shape (text only today) to carry image blocks in both adapters, and it would re-send a multi-megabyte page on every turn that touched it.

Because the transcript is text, it also flows into the ZIP's Markdown, GEDCOM notes and the primer's `material` counts with no further work. That is the whole argument for the design.

### Three phases, and why the third waits

`transcriber.py` runs one daemon thread with the `scanner.py` shape — lock-protected state dict, `GET /api/transcripts/status` polled by the UI:

1. **transcribe** — one provider call per pending page, committed as it goes, so a crash costs one page rather than the batch.
2. **match** — pure Python. Every extracted name is compared against the tree and each page gets a `relevance` mark.
3. **report** — the finished table goes to the model, which only writes it up.

**Phase 3 starts on its own the moment no page is left unread**, because that is what the batch is for: point at the folder, walk away, come back to a report saying which handful of entries are worth importing. A stopped run does neither 2 nor 3 and leaves the batch resumable — a report over a partly-read folder is worse than no report, since it reads as a statement about the whole folder.

### The matching is code, not a model

`_match_page` in `transcriber.py` scores each page against the tree in Python, and the model is explicitly told not to revise the marks. This is the same reasoning that put the ancestor walk in `ai/tools.py`: given names repeat inside a family, sometimes between a father and his son, and a model ranking two hundred pages against a tree it can only see in summary conflates people confidently.

The rule that earns its keep: a **name** match whose year sits outside the matched person's recorded lifespan is demoted with a note saying why, rather than dropped silently. A page from the right family and the wrong century is exactly what a same-name collision looks like, and it is information, not noise. A page where no full name matched at all still gets surfaced if a family surname appears anywhere in its transcript — a thin extraction must not read as an irrelevant page.

### The prompt keeps the transcript and the data apart

One call returns three sections behind `<<<MARKER>>>` lines: the document's language, a count of the entries on the page, and a **verbatim** transcript, followed by a JSON extraction. The transcript is asked to keep **one entry per line, opening with the number the register prints beside it**, and that is not a formatting preference: it is where `_entry_blocks` reads the record boundaries from, and a record that runs over several printed lines is still one line here. There is deliberately no modern-language rendering: it was a second round of tokens to paraphrase the evidence into something less exact than the evidence, and both the reader and the report work from the original. Markers rather than a provider-native structured-output mode, for two reasons: the parse is identical on both adapters, and an answer that runs long still yields a usable transcript instead of unparseable JSON — the transcript is the part worth salvaging.

Two rules in that prompt exist because of how these records actually read:

- **The transcript keeps the page's own wording; the JSON should not.** Latin registers decline names — a page reading `filius Stephani Nagyfalvi` records a man named `Stephanus Nagyfalvi`. The transcript must keep `Stephani`, because it is evidence; the JSON wants the nominative, because an inflected name matches nothing. The prompt asks for it, and **nothing depends on getting it** — see the next section.
- **Uncertainty survives into storage.** `[?]` marks a word that could not be read, `word[?]` a reading that is not certain, and those marks are carried into the JSON as well. `_doc_dict`'s note then tells the assistant what they mean, so a guess is never quoted back as what the register says.

### The report is an agent loop; the reading is not

`read_file` is one shot with no tools — a page is a page, and nothing about the project changes how it should be transcribed. `write_batch_report` is the opposite: the matching pass says *which* tree people a page touched, but whether that is worth acting on depends on what is already recorded about them, which only the project can answer. So the report runs the assistant's own read-only `REGISTRY` in a small loop (`REPORT_MAX_ITERATIONS`, deliberately low — it is writing up a table it already has, not researching a family).

The calls it makes are stored on `transcript_batches.analysis_steps` and shown beside the report, for the same reason `chat_tool_calls` exists: in genealogy the lookups are what make an answer checkable instead of merely fluent. Results are stored as a **preview** plus a length, because a few full tool results would dwarf the report they justify.

It runs on the `query_only` pool (`get_readonly_db`), not the job's writable session. The read-only guarantee has three independent layers and a caller being trusted is not a reason to drop one.

### Reading a document that is already in the project

The batch reader answers "which of these two hundred pages matter". The other
half of the problem is a scan the user has already filed and now wants the text
of, and that is `POST /api/documents/{id}/transcribe`, offered by
`DocumentReadButton.tsx` on both screens a document is worked on from: under the
description field in `EditDocModal`, and in the viewer's metadata column.

It reuses `doc_reader.read_file` unchanged: one page, one shot, no tools. What
is worth understanding is where the result goes — **appended to the document's
description**, not stored as a reading of its own.

**Why there is no transcript field here.** A second field holding the text would
have to be edited, searched, rendered, exported and reasoned about separately
from the description, and the two would start disagreeing the moment either was
touched. The description already goes everywhere the text needs to go: it takes
Markdown, `@` mentions and citations through `DescriptionField`, `search_text`
includes it, an export carries it, and `ai/tools.py`'s `_doc_dict` hands the
assistant the **whole** description with every document it lists — so a reading
that lands there is available without even a `get_document` call.

Four details are load-bearing:

- **Appended, never substituted.** What somebody wrote about a document is
  theirs. `appendReading()` in `DocumentReadButton.tsx` and the endpoint apply
  the same rule — one blank line between what was there and what was read — so a
  locally edited draft and a server-written description cannot come out spaced
  differently.
- **Markdown renders with `breaks: true`,** so the verbatim line structure
  survives into the rendered description. That matters: in a register the line
  breaks are where the entry boundaries are.
- **It is saved before the response returns,** even though `EditDocModal` may be
  holding an unsaved draft — the call spent a page of the month's budget and a
  cancelled modal must not throw that away. The endpoint therefore returns the
  raw `text` alongside the updated document, and the modal appends *that* to its
  own draft rather than overwriting it with the server's copy.
- **A failed or empty read writes nothing** and returns 502. An empty append
  would spend the budget and leave a blank line behind.

The endpoint is the only thing here that touches `transcript_pages`: it no
longer does. Those rows belong to the batch reader alone, which is where
`readable`, `transcribed` and `get_document`'s transcript body still come from.

### Which provider does which job

Three settings, and the split is perception versus prose:

| Job | Provider | Why |
|---|---|---|
| Reading a scan | the **document reader**'s | Old handwriting is where providers differ most, so it is chosen for that alone |
| Writing the batch report | the **assistant**'s | Prose over an already-extracted table |

`_text_job_settings()` is the single place that decides, falling back to the reader when the assistant has no key so neither job simply stops. Measured on one real register page, the two providers differed by more than 5x in output tokens for the same reading — that gap is why the reader is configured separately at all.

### Reading part of a folder

`start` takes `page_ids`. Named pages are read **whatever state they are in** — that is what "read this one again" means — and the unnamed rest are left alone. A report can be asked for from one readable page onwards, and `_batch_coverage` puts the read/unread counts in the prompt with an instruction to open with them. Useful early beats correct-but-unavailable, but only if the partiality is impossible to miss.

### A background job that cannot be restarted is broken

`transcriber` holds one global "a batch is being read" flag, and for a while nothing reconciled it against the thread it described. A worker that died — a crash before its `finally`, or a process the reloader replaced under a daemon thread — left the flag set, and the only cure was restarting the app. The user saw `A batch is already being read` and no way forward.

Three things fix it, and they are all the same idea: **never trust a flag over the thing it describes.**

- `start_batch` and `get_status` both check `_thread.is_alive()` and clear a flag the worker has outlived. `get_status` doing it too matters: otherwise the UI keeps the buttons disabled for a run that no longer exists.
- Every outbound call is bounded — `PAGE_TIMEOUT_SECONDS` per page, `REPORT_TIMEOUT_SECONDS` for the whole report. The SDKs default to a ten-minute timeout retried twice, so one hung call could hold the flag for half an hour.
- The report's agent loop checks `should_stop` between rounds. An HTTP request in flight cannot be taken back, but a user who pressed stop should not wait through seven more rounds of tool use.

**And the job has to look alive.** The transcription phase reports pages done; the analysis has nothing to report between rounds, so it looked identical to a hang — which is how a slow report gets reported as a bug. `phase_seconds` is in the status payload for that reason alone.

The report also runs at `medium` effort, not `high`. It is writing up a table that has already been decided, and at high effort a folder of two dozen transcripts took minutes; at medium the same report took 102 seconds. Effort belongs where the reasoning is, and the reasoning here happened in `_match_page`.

### The report reads the records, not a summary of them

The report is handed each page's **whole transcript**, and this is the single most important thing about it. An earlier version sent a 400-character excerpt per page, which on a dense register page was 14% of the entry — and the model then wrote its assessment of the folder from an opening paragraph. It was not wrong about the names, because the names come from the matching pass; it was blind to everything a record actually says: the roles, the relationships between the people named, the marginalia, what the entry is even for. Given the full text of one page it went from listing three names to quoting the entries and correctly widening their date range from 1868 to 1868–1881, which the excerpt had cut off.

The lesson generalises: **the index is not the document.** The name-and-date table exists so nothing has to be found by reading; it is not a substitute for reading.

Budgeting is by characters (`REPORT_TEXT_BUDGET`), spent strongest-group-first, because a folder can be arbitrarily large and what should survive intact is what the report is mostly about. Input tokens are the cheap half and these models hold hundreds of thousands of them, so a whole folder usually fits.

**Anything trimmed stays reachable.** `build_batch_registry` gives the report two tools over the batch's own transcripts — `read_page` opens one in full, `search_pages` finds a word across all of them and with no query lists every page. Same two shapes as `get_document` / `search_text`, for the same reason: a page that can only be reached by guessing is a page that gets reported as containing nothing. A trimmed page is marked `transcript_truncated` and the prompt requires `read_page` before it may be described.

They are a **second registry**, built per batch and living only for the length of one report, rather than entries in `tools.py`'s always-on `REGISTRY` — they are scoped to a batch that most of the app knows nothing about.

### A name match is a pointer; a relationship is a finding

`_match_page` scores four levels, and the ladder is deliberately stingy:

| | earns it |
|---|---|
| `corroborated` | **two** people on the page matched by full name, in roles that assert a relationship — a father and his child, a bride and groom, two siblings — and the tree already records that same relationship between them |
| `candidates` | one full name matched and a year on the page falls inside that person's lifespan |
| `weak` | a full name matched but nothing dates it — no usable year on the page, or none recorded for the person |
| `unrelated` | only the surname matched, or the dates contradict the match |

The top rung is the important one and it took two corrections to find. The first version scored a bare name match as a find. The second required the dates to agree as well — better, but on a real folder it still marked four pages of a village register "worth importing" on the strength of a name and a plausible century, and a user reading that list was being told that coincidences were discoveries. Re-cut against a real batch of 28 pages, the marks went from `4 / 16 / 5 / 3` to `1 / 4 / 16 / 7`. Scoping the pairing to one entry — and each match to its own entry's year — then took the top rung to empty on that folder, because the single page that had reached it was the false pair described below.

That is the distinction the ladder now encodes. **A surname repeats across a village and a given name repeats within a family, so no amount of name agreement is evidence of identity** — but two names in the right roles, connected the same way in both the record and the tree, is something a coincidence of naming cannot produce. `_corroborating_relation` only counts full-name matches with no date conflict, and returns a sentence naming the relationship that agreed, which the write-up is required to quote as its reason.

**A pair only counts inside one entry.** A register page is not one record — one real page carried nine marriages — and the first version of `_corroborating_relation` paired any groom with any bride anywhere on the page. It duly found a groom from the ninth marriage and a bride from the fifth who are indeed spouses in the tree, and marked the page a certain match. Two unrelated lines, manufactured into the strongest signal the system has.

The first attempt at a fix asked the *extraction* for an entry number per person. That was the wrong place to ask: it is an index of the page written by the same model, it is not there at all for pages read before the question was added, and it cannot be checked against anything. The boundary now comes from the transcript. `_entry_blocks` cuts the text on the register's own numbering — one numbered line opens a record, an unnumbered line continues the one above it, and the column headings before the first number are not a record — and `_place` puts a person in an entry when both parts of their name are written inside it.

Three properties make that the right source. It works on **every page already read**, because the numbering was transcribed the first time round. It is **checkable**: the user can see the numbered lines beside the scan. And it **refuses cleanly** — a name whose parts appear in three entries places the person in none of them, a page that does not divide places nobody, and `_corroborating_relation` pairs only two people it can place in the *same* entry. On the real folder that turned the one "certain match" into none, which is the honest answer: the groom of the ninth entry and the bride of the fifth are still there, still spouses in the tree, and still not a couple on that page.

A page that does not divide is treated as one record in exactly one case: the extraction itself says the page holds a single entry. Everything else gets no pairing, because the safe answer to "are these two the same record?" is no.

**The entry is also the date.** A page spanning eight years used to lend all eight to every person on it, so almost anyone could be made to "fit" one of them. `_Entry` carries the years written inside its own lines, and a person placed in an entry is scored against that entry's year — the page's full span is the fallback for people who could not be placed.

The reason leads `relevance_note` and is never trimmed. One name on a page can collide with a dozen namesakes, and a note that is a wall of "predates the recorded birth" buries the one line saying why the page matters — which is the line the note is read for.

**An age dates a person; a lifespan barely does.** "A year on this page falls somewhere inside their recorded life" is nearly free — most pages in a family's own parish will pass it. An age written in the entry is different in kind: 23 in an 1876 record puts the birth at about 1853, which is a fact about that person reached without reference to their name, and it can be compared with a recorded birth year directly. `_age_check` does the arithmetic in Python and hands the result to the write-up rather than asking a model to do sums.

Three outcomes, and the middle one is the point. Within a year, the two **agree** and the match is dated on evidence a coincidence of naming cannot supply. Beyond `AGE_SLACK_YEARS`, they **conflict** and the match is ruled out however well the name fits. In between is **unclear**, because a register's ages are approximate — rounded, remembered, guessed by the clerk — and a two-year gap is a reason to say nothing rather than a refutation. Ruling a match out on that gap was the first version's behaviour and it discarded a true match on a real page.

The age is only checked against the year of the entry the person was *placed* in, or against a page that carries one year in total. A page spanning eight years has no single year to subtract from.

**Absence of evidence is not evidence, and the year has to come from the record.** An earlier ladder scored "no date to check" as "no objection", which put an 1860s disciplinary record under *worth importing* against a man born decades later. The other half of that same bug was where the year came from: `_page_years` read only the extraction's `date` field, so a page whose transcript plainly said 1868 came through as undated because the model had left the field null — an absent field read as an absent fact. It now scans the transcript for years as well.

**The write-up cannot re-sort the groups.** `_capped_rows` hands the model a dict keyed by evidence level rather than one list with a `relevance` field, because when it got the flat list it moved pages between sections to suit its own reading. The prompt then requires the evidence to be stated in the same sentence as the claim: `@[…](#pid-7)` stays, so the reader can click through and check who is meant, but "matches the name of X, though nothing else places him there" and "belongs to X" are different sentences and only one of them is honest about a namesake.

### The extraction is an index of the page, not the page

The per-page extraction — `kind`, `date`, `place`, and a list of people with roles — was originally the whole basis of both the matching and the report. It is a genuinely useful thing and it is not going away, but it had drifted into standing *for* the page, and two failures came out of that.

**It was the only place names were looked for.** A page whose extraction stopped short was scored as though the missing lines were not there. `_match_page` now takes names from two sources and treats them the same once it has them: the extraction, and the transcript itself. The transcript sweep matters on prose entries, where a name is simply written out; the extraction matters on ruled registers, where a person's surname and given name sit in different columns with the rest of the row between them and **no substring search can ever join them up**. That is the one job it keeps outright, along with the roles — reading a layout and saying "this name is the groom" is what it is good at, and reading the words does not tell you.

**It was describing the page to the report.** The row handed to the report model used to carry the extraction's `kind`, its single `date`, its `place` and its first twelve people, sitting beside the full transcript as if it summarised it. On a page holding a dozen dated entries and four times that many names, that is not a summary but a contradiction — and where the two disagreed the model believed the short definite one over the long messy one, and where the index was silent it wrote that the page was silent. The row now carries only what the transcript cannot supply: the marks this code computed, the years it read, and the tree ids a name in the text has no way to carry. Everything about what the page *says* comes from `transcript`.

This is the same rule as *the index is not the document*, one level up: an index may sit next to the thing it indexes, but it must never be shaped like a description of it.

### Indented prose is a code block, and a code block escapes the links

A report is Markdown written by a model, and `renderMarkdown` injects its anchors *before* the Markdown parse. Markdown turns any line indented four spaces past its surroundings into `<pre><code>`, and everything inside a code block is escaped — so one over-indented continuation line rendered a page's person references as visible `<a href="#person-ref-31" …>` text nobody could click, while the same report re-run rendered correctly. The output depended on whitespace nobody chose.

Indented code blocks are therefore switched off for every body this app renders (`marked.use({ tokenizer: { code: () => undefined } })` in `markdown.ts`). Nothing here wants one — not a note, not a document description, not a transcript imported into one, not an assistant answer — and fenced blocks still work, so the deliberate case is untouched and only the accidental one is gone. This is the same shape as `_link_page_names`: where the rendering depends on something the model is not choosing deliberately, take the choice away from it.

### Two things the prompt was asked for and did not do

Both were fixed the same way — by doing them in code instead.

**Phrasing the finding.** The corroboration was handed over as data (`kind: "spouses"`, two roles, two people) with an instruction to put it in the answer's language. What came back was a Hungarian sentence with an English rendering quoted inside it, because English is what the field values look like. `_corroboration_sentence` now composes it server-side, where the language, the name order and the ids are all already known, and the prompt only has to reproduce what it is given.

**Linking the pages.** The prompt asked for `[DSCF1720.JPG](#page-23)` and got plain filenames. `_link_page_names` rewrites them afterwards: the filename-to-id map is known and the substitution is unambiguous, so there is nothing to ask for. The prompt now says the opposite — write the filename plainly, it will be linked.

`#page-N` joins the reference forms `markdown.ts` resolves, styled as `a.note-page-ref`; only the scan-reading screen intercepts it, and it is inert markup anywhere else.

### Asking about a batch

The report answers a fixed question — *which of these pages is worth importing*. Everything else a reader wants to know about a folder they are looking at ("does any entry name a witness called X", "what does the third entry on that page actually say", "which years does this book cover") had no way to be asked. `POST /api/transcripts/batches/{id}/ask` is that way.

It is the **same agent loop as the report**, extracted into `_run_agent` the moment there were two callers rather than after they drifted — the loop owns four things that are easy to get subtly different: which registry a tool name dispatches to, that a failing tool becomes a result instead of ending the run, that the stop flag is read between rounds and not mid-call, and that every call is recorded. What differs is the system prompt and the first message.

**Scoped to the batch, deliberately.** The obvious alternative — let the main assistant see these transcripts — is wrong: an un-imported page is *working state*, which is why `build_export_db` deletes it and the merge importer skips it. Folding a folder the user has not decided to keep into the assistant's always-on corpus would change the answer to every unrelated question about the family. So the question is asked where the folder is being read, and it reaches that batch's pages plus the ordinary read-only project tools — which is what lets it tell a new record from one the tree already holds.

No new consent: this sends transcript text to the provider already chosen for text work, exactly as the report does. It is not a new *kind* of payload the way a photograph of a document is, so it does not need the third `config.json` block that `document_ai` needed.

**The conversation is stored on the batch** (`transcript_questions`, schema v16). It began in component state, on the reasoning that a batch is a working screen and nothing would need to survive closing it. That was wrong in the most ordinary way possible: the answers name pages, the first thing anyone does with an answer is open a page it recommended, and opening one unmounted the panel — taking the conversation with it, along with the reason they had opened the page. A feature whose output cannot be acted on without destroying it is not finished.

Storing it costs the three things every table here costs, all of which the checklist names: a migration, an unconditional `DELETE` in `build_export_db` (it is working state — half of it is questions typed while deciding), and a cascade so deleting a batch takes its conversation. It also removes a hazard rather than adding one: the follow-up context is now read back server-side, so it cannot depend on which screen happens to be open and the loop's own internal message shapes are not reachable from anything that can post. `ASK_HISTORY_TURNS` still bounds how much of it travels.

**Three views, not two.** The detail column shows the report, the conversation, or a page, chosen by a tab strip — the questions used to sit beneath the report, in a sliver of space, which is the other half of why following a link was destructive.

A tab alone is not discoverable: it is a label on a panel nobody has opened, and the first user of this feature said plainly they would not have found it. So there are three ways in, each at a different moment — a **button in the batch toolbar** where the actions are already looked for, the **tab** itself (icon and accent, so it reads as an action rather than a heading), and a **panel at the end of the report**, which is the moment a question actually forms. All three carry the count of questions already asked, so a conversation in progress is visible from anywhere on the screen. The tool steps under each answer name what was actually read (`stepSubject` turns `page_id=29` into the filename that is on screen two columns to the left), because the entire reason for showing the steps is to let a reader tell research from assertion, and an id does not.

The answer runs on the request rather than in the job thread. It is one question with a handful of tool calls, there is nothing to poll or resume, and keeping it out of the job means a question can be asked while pages are still being transcribed. The prefix carries `_batch_inventory` — how many pages the folder holds, how many have been read, how many failed, the span of years — for the same reason the assistant's primer carries totals: a model that cannot see an absence writes fluently around it, and three read pages out of twenty-eight would otherwise be described as the folder.

### Matching is free; the report is not

Phase 2 runs after **any** amount of transcription: it is arithmetic over data already on disk, it costs nothing, and it puts the marks on the page list. Phase 3 does not run on its own at all.

A folder is read in several sittings — a few pages, a correction, a retry of what failed — and a report fired after each of those is a paid call producing a document about a batch that is about to change again. The marks are what tells the user whether a report is worth asking for, and they are on screen by the time the question arises. `POST .../rematch` re-scores a batch inline on the request, with no thread and no model, for the case that actually recurs: the tree gained a person, or a transcript was corrected by hand.

### A short transcript has to announce itself

"Transcribe every line" is an instruction, and a page of four ruled-off entries is exactly where a model stops after the first one and returns something that *looks* finished. So the prompt asks for one more thing before the transcript: `<<<ENTRIES>>>`, a count of the blocks on the page, made before transcribing.

`parse_response` then compares that count against the blank-line-separated blocks actually written and stores the result as `coverage` inside the extraction JSON — no new column, since the extraction is already free-form. `_page_incomplete` in `main.py` lifts it onto the page payload and the list badges it.

This is the same rule as everywhere else in this repo: the instruction may help, but the thing that makes it safe is that a shortfall is **visible**. A partial transcript nobody flags is worse than a failed page, because a failed page announces itself.

**A short transcript is not automatically a wrong one.** A decorative title page is twenty words of calligraphy and transcribes to a couple of hundred characters; a dense register page of four entries runs to fifteen hundred. Judging the reader by length alone misdiagnoses both — which is why the count comes from the model's own reading of the page's structure rather than from a character threshold.

### Providers differ most on handwriting, which is why the reader has its own

The document reader carries its own provider *and* model, separate from the assistant's, and `write_batch_report` deliberately uses the **assistant's** provider instead. The two jobs reward different things: reading a two-hundred-year-old hand is a perception task where providers differ enormously, while writing up an already-extracted table is prose the user already chose a provider for. Measured on one real register page, one provider spent ~7.5k reasoning tokens and returned a partial reading where another returned a complete one for ~2.6k output tokens — that gap is the reason the setting exists.

### Names are normalised in code, not in the prompt

Asking the model for the nominative works often and not always: the first real run returned `Josephus` for the child and `Stephani`/`Mariae` for the parents, off the same page. A prompt instruction is not a mechanism, and this one is ignored often enough to matter — so the normalisation lives in `_given_variants` in `transcriber.py`, where it runs the same way every time.

Two transformations, both **additive** — a variant is an extra key to match on, never a replacement, so a name the rules do not understand is left exactly as it was:

- **Latin case endings are undone.** `-ae → -a`, `-i → -us`, `-is → -es`, and the accusative/ablative forms, longest ending first so `-is` is tried before `-i`. Applied to **given names only**: Hungarian surnames ending in `-i` are a place-name suffix and stripping it would wreck them.
- **Latin and vernacular given names are treated as the same name.** The tree holds `István` because that is what the family calls him; the register says `Stephani` because that is what the sentence needed. `_LATIN_HU` maps the forms that actually recur in Hungarian registers, and is read in both directions so neither side has to be canonical. It is deliberately short — every wrong pair in it is a false match, and rare names buy little.

Both sides of the comparison go through the same expansion, so the match works whichever way round the two spellings fall.

### The output budget has to cover the thinking

A transcript of one page is one or two thousand tokens, so a ceiling sized for the answer looks generous — and is wrong. On a reasoning model the thinking is charged against the **same** ceiling: a real register photograph measured ~7.5k reasoning tokens before the first character of output. At a ceiling of 8k the model spent the entire budget thinking, and the call returned `finish_reason: "length"` with an empty string in it.

That is the worst shape a failure can take here, because it arrives as a *success*. Reported as "the model returned nothing", it reads as an unreadable page and sends the user to re-scan a file that was fine. So two things changed together: `MAX_OUTPUT_TOKENS` is an order of magnitude above the answer size (clamped to the model's own `max_output`), and both adapters check for an empty answer that was **cut off** and return an error saying so — `finish_reason == "length"` on the OpenAI side, `stop_reason == "max_tokens"` on Anthropic's.

Effort is a second lever, and `build_provider` takes it as a parameter for this reason. Reading a page is not a reasoning task; `READ_EFFORT` is `medium`, where the assistant's own turns run at `high`. High effort here mostly buys thinking tokens, which cost money and, on a tight ceiling, crowd out the answer.

### The transcript is editable, and an edit is never overwritten

`PATCH /api/transcripts/pages/{id}` stores a hand-corrected transcript and sets `edited`. A corrected transcript is worth more than a perfect model, because the person correcting it is the one who knows the family's names. Re-running the report (`POST .../analyse`) re-matches and re-writes over the corrected text without paying to read any page again — which is also the right thing to do after adding people to the tree.

### Consent, budget, and what actually goes out

`document_ai` in `config.json` is a third sibling of `ai` and `web_research`, off by default. Enabling it sends **the scans themselves** — a photograph of a page, with whatever is written on it, including what nobody has read yet. That is a materially larger disclosure than the tree summary the assistant sends, so it is its own switch with its own disclosure in `AssistantSetup.tsx`.

It has **no key of its own**: the same provider account is already configured, so it reuses the `ai` block's key. It does have its own **model** choice, because reading two-hundred-year-old handwriting and reasoning over a family tree reward different models, and being able to point them at different models is the only way to find out which reads a given hand best.

The **monthly page budget** is check-and-incremented in `try_consume_doc_page()` before each outbound request — never in the prompt. Same reasoning as `try_consume_web_quota`: a batch told to be economical is still a loop, and a loop with a bug reads a thousand pages.

### PDFs

A PDF is checked for an embedded text layer first (`pypdf`, already a dependency for `read_web_page`). A layer over `MIN_TEXT_LAYER_CHARS` is used as-is: free, deterministic, and no quota consumed. Below that the PDF is treated as a scan and sent to the model.

Anthropic takes the PDF as a native `document` block and renders the pages itself, which is why **this app needs no PDF renderer in the bundle** — `PyMuPDF` would add a compiled binary and an AGPL question for exactly this one job. The OpenAI-compatible adapter sends images only and **refuses a PDF explicitly**, naming the two ways out. A guessed wire format would have failed per page, mid-batch, as a 400 for the user to decode.

### What the tables are, and what they are not

`transcript_batches` / `transcript_pages` / `transcript_questions` are **working state**, not project content: a page row holds an absolute path into a folder on this machine and the full text of a document that may never be imported at all. So `build_export_db` deletes all three by default, alongside the chat tables — copy-then-filter means a table nobody deletes is a table that ships. `merge_import.py` enumerates its tables by hand and therefore does not merge them, which is correct: the paths belong to the source machine.

**`include_scans` is the deliberate exception**, and it is off unless asked for. Carrying a half-triaged folder of registers to another machine is a real thing to want — the transcripts, the marks, the report and the questions are hours of work — but it only works if the *photographs* travel too, and they are the largest thing this archive can hold. So it is a checkbox on the whole-project export, labelled with the batch and page count so the size is not a surprise, and offered nowhere else: a batch is not divisible by cluster or by person, so on a subset export it would quietly widen what "these people only" means.

The mechanism is the one `images.path` already uses. `_stage_scan_files` runs **on the exported copy, before the database is written into the archive** — the streaming builder writes `project.db` first, so a rewrite afterwards would miss the stream — copying each page's file in as `scans/<page id>_<filename>` and rewriting `source_path` to that relative name. `_restore_scan_paths` turns it back into an absolute path at import, and only for rows whose file actually arrived: an archive exported without the scans has no such rows, and a page whose file had already gone on the source machine keeps its original path rather than being given a fabricated one that resolves to nothing here.

**Importing a page copies the transcript into `documents.description`.** It did not, originally, on the reasoning that one transcript should have one home and the document could read it back through `document_id`. That is true of the *assistant's* serialiser in `ai/tools.py` and of nothing else: the REST `_doc_dict` carries no transcript, so an imported page arrived in the Documents tab as a picture of handwriting with nothing readable attached — not searchable, not quotable, not editable. The description is the field a person reads, searches and corrects, so that is where the text goes. A caller sending its own `description` still wins; the page keeps its copy, and the two can drift if a transcript is corrected afterwards, which is the accepted cost.

`transcript_pages.document_id` is `ON DELETE SET NULL`, not CASCADE. Deleting an imported document returns its page to being an un-imported candidate with its transcript intact — the reading survives the document, which is the point of storing it separately.

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

**A local build carries a CI tag, not its own identity.** `build_win.bat` stamps `version.txt` from `git describe --tags --abbrev=0`, and the tags in this repo are the release tags CI creates. So an app built locally claims to be whichever release was last tagged, regardless of what is actually in the working tree — and the updater will happily offer to "update" it to a newer release, replacing a hand-built app with a CI one. That is usually what you want, but it means the version in the UI is a statement about the last tag, not about the code that is running. Bear it in mind before concluding from a version string that a build is old.

**Platform behaviour**:

| Platform | ZIP structure | Updater script | Relaunch |
|---|---|---|---|
| Windows | Files at ZIP root (CI: `Compress-Archive -Path dist\Mnemosyne\*`) | `%TEMP%\mnemosyne_updater.bat` — `robocopy /E /IS /IT /R:2 /W:2`, merged into the existing folder | `start "" "%APP%\Mnemosyne.exe"` |
| macOS | `Mnemosyne.app/` at ZIP root | `/tmp/mnemosyne_updater.sh` — `mv`; falls back to `osascript` admin prompt if in `/Applications` | `open "$OLD"` + `xattr -cr` to clear quarantine |

**The scripts take their paths as arguments, never baked into the file.** A script file is read back in the *platform's* encoding, and on Windows that is not the one Python wrote: `cmd.exe` parses a `.bat` in the console OEM code page (cp852 on a Hungarian install) while `write_text` produced UTF-8. One accented character anywhere in the install path — `…\Programozás\Mnemosyne` — therefore turned `%APP%` into a different, non-existent directory; robocopy then **created** it, copied the new build into it, exited 3 (success), and the batch restarted the untouched old app. The app came back on the old version, found the same release again, and offered the same update forever. Arguments go through `CreateProcessW` as Unicode and survive intact, so the script files stay pure ASCII (`encoding='ascii'` is asserted at write time by the codec itself). The same applies to any future script the app generates.

**Windows merges, macOS replaces.** `robocopy` without `/PURGE` never touches destination-only files, so `projects/`, `config.json` and `models/` in the app folder survive a Windows update untouched — they are `/XD`/`/XF`-excluded as a belt, not copied out to the temp dir and back. On macOS the whole `.app` is `mv`-ed, so there the user data genuinely has to be carried into the new bundle first. Do not "simplify" the two into one shape.

**Two robocopy details are load-bearing.** Its built-in retry defaults are `/R:1000000 /W:30`, so a single file it cannot open — the old process still running, a scanner holding the freshly extracted DLLs — makes it retry for weeks instead of failing; `/R:2 /W:2` bounds it. And exit codes below 8 mean success while 8 and above mean at least one file was not copied: nothing used to read that, so a completely failed replace still ended with the batch cheerfully restarting the old app.

**The version stamp is written last.** `_internal/version.txt` is excluded from the main pass and copied separately only after it succeeds. robocopy walks the root first, so it can fail on the locked `Mnemosyne.exe` and *still* reach `_internal` on the same run — which would leave the old binary in place stamped with the new version, a worse failure than the loop because the app then reports itself up to date. With the stamp written last, the version the app reads always means "this build is fully installed".

**Waiting for the old process is a PID check, not a sleep.** The script polls `tasklist` / `kill -0` for the app's own pid (up to 60 s) before copying. A fixed sleep raced the `os._exit(0)` that follows one second later, and losing that race means robocopy meets a process that still holds every DLL it loaded.

**Two different directories — do not confuse them.** `launcher.py` exports both:

| Env var | Frozen value | Holds |
|---|---|---|
| `MNEMOSYNE_APP_DIR` | Windows: dir containing `Mnemosyne.exe` · macOS: `Mnemosyne.app/Contents/MacOS/` | User data (`projects/`, `config.json`) and the update target |
| `MNEMOSYNE_BUNDLE_DIR` | `sys._MEIPASS` — under PyInstaller 6 onedir this is `<exe dir>/_internal/` | Everything from the spec's `datas`, including `version.txt` |

`get_current_version()` must therefore read `version.txt` from the **bundle** dir first, not the app dir. Spec `datas` with target `'.'` land in `_internal/`, one level *below* `MNEMOSYNE_APP_DIR`. Reading only the app dir silently yields `'dev'` in every packaged build — which, combined with the `dev` guard below, made released apps report themselves as permanently up to date. The file is read with `utf-8-sig` so a BOM from a PowerShell 5.1 `Out-File -Encoding utf8` step cannot corrupt the tag.

The app exits via `os._exit(0)` (not `sys.exit`) one second after launching the updater script, to guarantee the process terminates even if FastAPI shutdown hooks are slow.

**Unversioned builds**: when `current_version == 'dev'` the tag cannot be compared, so `_do_check()` reports status `dev_build` rather than `up_to_date` — claiming "up to date" here hides real updates. The UI surfaces it as its own state with a link to the release page. `apply_update()` still raises `RuntimeError` when `IS_FROZEN` is false.

### Verifying that the update landed

The updater script runs after the process that started it is gone, so nothing it does can be reported through `_state`. It leaves a breadcrumb instead, and the *next* process reads it:

| File | Written by | Holds |
|---|---|---|
| `%TEMP%\mnemosyne_update\attempt.json` | `_write_attempt()` before the exit | which version this restart is supposed to come back as |
| `%TEMP%\mnemosyne_update\result.txt` | the updater script | `robocopy=<code>` · `replace=ok\|fail` · `stamp=fail` |
| `%TEMP%\mnemosyne_update.log` | the updater script | the full transcript; the UI shows its *path* when an install fails, so the user has something to send back |

`check_install_result()` runs once at startup (called from `main.py` right after the `updater` import) and compares the recorded expectation with `get_current_version()` **and** with the script's own verdict — a version match alone is not proof, which is why `_copy_ok()` exists. A mismatch sets `install_failed` in the state dict; `UpdateBanner.tsx` shows it as a red block in the modal and a red dot on the header icon, and it is never cleared by a later check.

This is the part that matters most. Every individual failure above is recoverable; what made the bug intolerable was that a failed install is otherwise **indistinguishable from never having tried** — the app restarts on the old version, the next check finds the same release, and the user repeats a 160 MB download forever with nothing anywhere saying it did not work.

`apply_update()` also has to fail loudly: it wraps extraction and script launch, and on any exception sets `status='error'` before re-raising, because the UI has already been switched to `applying` and would otherwise spin on a spinner for a restart that is never coming.

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
│   ├── maintenance.py       # Background prune of images whose files vanished from disk
│   ├── clusterer.py         # DBSCAN + centroid-based clustering
│   ├── database.py          # SQLite schema, SQLAlchemy models, startup migrations
│   ├── schemas.py           # Pydantic request/response models
│   ├── project_manager.py   # Multi-project management
│   ├── updater.py           # Auto-update state machine + platform scripts
│   ├── export_utils.py      # ZIP export/import pipeline
│   ├── field_values.py      # Registry of small-vocabulary columns + their used values
│   ├── places.py            # Place hierarchy parser + project-wide place usage
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
│       ├── graphLayout.ts             # Connections graph layout (components, betweenness, packing)
│       ├── placeKey.ts                # Place folding key, kept in step with backend/places.py
│       ├── caretPopup.ts              # Caret coordinates in a textarea + viewport-safe popup placement
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
│           ├── PlaceInput.tsx         # Shared place field with suggestions from the project
│           ├── SuggestInput.tsx       # The one text-field-with-suggestions implementation
│           ├── VocabInput.tsx         # Vocabulary field (occupation, religion, …) on SuggestInput
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
| v7→v8 | `documents.person_id` becomes nullable (documents that belong to no one) |
| v8→v9 | `documents.date` — a partial date alongside the existing `documents.year` |
| v9→v10 | `document_files` — extra files on a document beyond its primary one, from a multi-file upload |
| v10→v11 | `document_description_citations` — `[n]` references inside any document's `description` |
| v11→v12 | `transcript_batches`, `transcript_pages` (reading scanned documents) |
| v12→v13 | `transcript_batches.analysis_steps` — the tool calls the batch report made |
| v13→v14 | `transcript_pages.corroboration` — the relationship a page and the tree agree on |
| v14→v15 | `citations.relation_id` — a marriage's sources belong to the marriage rather than to one spouse |
| v15→v16 | `transcript_questions` — the conversation about a batch of scans |
| v16→v17 | `transcript_pages.batch_id` becomes nullable. Nothing writes NULL any more — per-document readings go into the description instead — but the relaxation stays: undoing it in SQLite means another table rebuild, for nothing, and would leave new projects with a stricter column than existing ones |
| v18→v19 | `stable_id` on `persons`, `relations`, `documents`, `events`, `sources`, `person_notes` (`images` already had it), plus the `share_profiles` table. The backfill is guarded on the *data* rather than the version, so it runs every startup and costs one indexed count per table once everything is filled in — see [Cross-database identity](#cross-database-identity) |
| v17→v18 | `event_description_citations` — `[n]` references inside an event's `description`, the event-side twin of `document_description_citations` |

`Base.metadata.create_all()` runs before the migration block, so new *tables* appear on their own; a new *column* on an existing table still needs an explicit `ALTER TABLE` in the version block.

**Relaxing a constraint needs a table rebuild.** SQLite has no `ALTER COLUMN`, so v7→v8 goes through `_drop_document_owner_not_null()` in `database.py`: create a copy of the table with the constraint gone, copy the rows, drop the original, rename, recreate the indexes. Two things in there are load-bearing and easy to get wrong:

- **Foreign keys must be off for the swap.** `document_persons.document_id` is `ON DELETE CASCADE`, so dropping the old `documents` table with them on deletes every person↔document link in the project rather than just the table. `PRAGMA foreign_keys` is also *silently ignored inside a transaction*, which is why the rebuild runs on the raw DBAPI connection with nothing open on it rather than through the SQLAlchemy `Connection` the rest of the block uses.
- **The new DDL is derived from the stored one**, not written out in the migration. A hardcoded column list would silently drop any column added to the model after the migration was written.

The block is idempotent the usual way: it reads `PRAGMA table_info(documents)` and returns immediately when `person_id` is already nullable.

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

A document's extra files (`document_files`, from a multi-file upload) are included alongside its primary one, sharing the same collision-renaming pool so a page named the same as another document's file still gets its own archive name. The manifest lists them on an `Also:` line under the document.

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
| `share.json` | Present only in a share-profile export: who sent it, under which profile, and what is inside |

**Export pipeline**

1. `VACUUM INTO` creates a WAL-free copy of the source database
2. **Person/cluster filter** (mutually exclusive): person list, cluster list, or full project
3. **Content toggles**: notes, sources, events, documents, images, faceless images — each independently removable
4. **Privacy filter** (always applied, cannot be disabled): removes all rows where `is_private=1` across images, clusters, relations, documents, notes, and events; private cluster faces are moved to the noise cluster before the cluster is deleted

Two things happen outside that numbered order. `ensure_stable_ids()` runs first of all, against the **source** database — see [Cross-database identity](#cross-database-identity). And `redact_person_ids`, when a share profile supplies one, is applied immediately after the person filter so everything downstream sees the emptied rows; the same list is subtracted from the cluster derivation in step 2, because blanking a person's columns after their photographs are already in the archive redacts nothing. See [Collaboration and share profiles](#collaboration-and-share-profiles).

Every document delete goes through `_delete_documents()`, which clears `document_note_citations` → `document_notes`, then `_delete_document_children()`'s `document_citations` / `document_images` / `document_files` / `document_description_citations`, then `document_persons`, and only then the document row. It is one helper rather than a sequence repeated at each call site because the export connection runs with **`PRAGMA foreign_keys=ON`** and the child tables disagree about what that means: `document_persons`, `document_images` and `document_files` cascade, `sources` and `transcript_pages` set null, and the notes and citation tables declare no action at all. A document carrying a note therefore cannot be deleted until the note is gone — the failed statement aborts the export rather than leaving a dangling row, so an ordering mistake here is a 500, not a silent leak. Images are the same shape via `_delete_images()`. The packer collects the files to zip by reading `stored_name` back out of the already-filtered export DB (`documents` **and** `document_files`, unioned), so a document dropped here never gets its bytes packed either.

**A narrowed export does not orphan a shared document.** Before deleting anybody, `_delete_persons()` hands each document owned by a departing person over to a co-linked person who is staying — `documents.person_id` is only the original owner, while `document_persons` is what every listing joins on, so the document is on the kept person's page and must stay in their export. This is the same rule `delete_person` in `main.py` follows when a person is deleted outright. Only a document that nobody in the selection is linked to is deleted.
5. **Path rewrite**: image paths updated to `images/<id>_<filename>` (absolute → relative)
6. Pack with DEFLATE compression, streamed to the response

**Streaming gotcha (Windows)**: the archive is written into a pipe, and `os.fdopen(pipe_fd, 'wb')` on Windows returns a file object whose `seekable()` answers `True` while `tell()` only reports the buffer offset. `zipfile` trusts that and writes central-directory offsets computed from the wrong position, producing an archive whose EOCD points near the start of the file — it downloads at full size but no tool can open it. `export_utils.py` wraps the pipe in `NonSeekableWriter`, which hides `seek`/`tell` so `zipfile` takes its streaming path with data descriptors. Any new streaming ZIP endpoint must use the same wrapper.

**Import pipeline**

1. All member paths validated against project directory (Zip Slip protection)
2. Extracted to `projects/<new_id>/`
3. `project.db` → `photo_organizer.db`
4. Image paths rewritten back to absolute

**Merge import** (`POST /api/import/merge/preview` → `/confirm`, `merge_import.py`) is the other direction: it folds a ZIP into the *active* project with a per-person create/merge/skip decision. Unlike the pipeline above it does not copy the database — it re-inserts row by row and remaps every foreign key, so **each table has to be handled explicitly or its data is silently dropped**. Columns are read through `_safe_rows()` and guarded with `_has_column()`, because an incoming ZIP may have been exported by an older schema.

Documents carry `is_text` (without it a chronicle arrives as an opaque file), `document_citations` and `document_description_citations` (both remapped through `src_id_remap`, `source_id NULL` kept for free-text labels), and `document_images` (remapped through `img_id_remap`; a merge import only brings in images belonging to named clusters, so a link whose photo stayed behind is skipped).

**Callers**

| Caller | Scope |
|---|---|
| Project switcher | Full project |
| Clusters tab | Selected cluster IDs |
| Family tree tab | Selected subtree (`person_ids`) |

---

## Collaboration and share profiles

Sending part of the archive to a relative used to mean marking records private one at a time and exporting what survived. That does not reach a second recipient: `is_private` is a property of a *record*, but "who may see this" is a relation between a record and a person, and one boolean cannot hold several of them. The selection was also nowhere — re-sending an updated copy meant reconstructing it from memory.

A **share profile** is a saved, re-runnable answer to *what does this relative get?* It holds the rules that pick the people, what to do about the ones who may still be alive, and which content travels. Exporting it is one click, and it gives the same answer next month.

### The selection is described, not clicked

`backend/share_filter.py` evaluates a rule set over nothing but the `persons` and `relations` rows. It imports no FastAPI and no SQLAlchemy, so it can be run from a throwaway script against a copy of a real project and its answer *checked* — the same reason `treeGeometry.ts` and `graphLayout.ts` live outside their components, and the only way to know a selection is right before an archive built from it is in somebody else's hands.

```json
{
  "include": [{"rule": "common_line_with", "person_id": 42}],
  "exclude": [{"rule": "descendants_of", "person_id": 7, "content": ["documents"]}],
  "closure": {"spouses": true, "parents_of_included": false}
}
```

`include` rules are unioned, `exclude` takes things back out, and the closure options run last.

| Rule | Selects |
|---|---|
| `everyone` | the whole project |
| `persons` | an explicit `ids` list |
| `only_person` | exactly the one person named, and nobody else |
| `surname` | everyone whose `last_name` matches, accent- and case-insensitively |
| `family_group_of` | the connected component — the server-side twin of `computeGroups` in `FamilyTreeTab.tsx` |
| `ancestors_of` | up the `parent` edges, optionally capped at `max_generations` |
| `descendants_of` | down them, same cap |
| `relatives_of` | breadth-first over *every* relation edge, capped at `max_steps` |
| `common_line_with` | the branch two people share — see below |
| `documents`, `events` | named records rather than people — see below |

Walks are breadth-first so the recorded distance is the *shortest* one. Where two lines reconverge — cousins who married — a depth-first walk can record somebody as further away than they are, and a generation cap would then cut them out of a branch they belong to.

**`common_line_with` is the rule this feature exists for.** It answers *give me the part of the tree that is ours together*: take both people's ancestors, intersect them, keep only the **most recent** of the shared ones (an ancestor of another common ancestor adds nothing — their descendants are a superset), and return every descendant of those. Everything above them is deliberately left out: those generations are one side's own line, not common ground, and dragging them in brings every unrelated branch hanging off the older generation with them. Choosing that branch by hand means deciding, person by person, whether a distant cousin is on the shared side of the family — and the tree already knows.

The other end of the comparison defaults to the project's `default_proband_id`.

**Each rule carries its own subject, and a profile has no separate "who is this for?".** It briefly had one, and it was wrong twice over: the archive's recipient is already named by the rule that selects them, so the field asked the same question a second time, and two fields that can disagree about one answer is a worse shape than one field that cannot. A rule that needs a person and names none selects nobody — visible immediately, because the preview then reports zero. The profile's *name* is what identifies who it is for.

**Closure options** run after the exclusions and never override one:

- `spouses` (on by default) — a couple split down the middle leaves the recipient a parent with no partner and a marriage that names nobody
- `parents_of_included` (off) — one generation of parents, so nobody appears to have come from nowhere. Off because it reaches outside the branch that was asked for

A person named in an `exclude` rule is never dragged back in by a closure.

**An empty or absent `include` selects nobody**, not everybody. A half-written profile should produce an obviously empty archive rather than the whole family sent to whoever it was half-addressed to.

That distinction has to survive the whole way down, and it nearly did not. `build_export_db` treats `person_ids=None` as *no person filter* and an **empty list** as *a filter that keeps nobody*; it used to test `len(person_ids) > 0` and so read both as "export everything". The share endpoint refuses an empty selection before it gets there, but a single caller-side check is thin cover for shipping an entire family archive to the wrong person. `api.ts`'s `exportUrl` sends `person_ids=` explicitly for the same reason, and the endpoint's query parameter defaults to `None` rather than `""` so an absent parameter and an empty one stay distinguishable — with a `""` default they are the same string, and the family tree tab's *only deceased* tick on a family where nobody has a recorded death would have exported the whole project.

### Leaving something out is one question, not two

An `exclude` row names people **and what of theirs is left out**:

```json
{"rule": "descendants_of", "person_id": 7, "content": ["documents", "images"]}
```

`content` may hold `persons` — remove them from the tree entirely — or any of `documents`, `images`, `notes`, `events`, which keep the person and hold back that material. The list is `EXCLUDABLE_KINDS` in `share_filter.py`; `PERSONS_KIND` is the odd one out and the others are `CONTENT_KINDS`.

These were two separate sections at first, *who is taken back out* above *whose material is held back*, and that was a worse shape for a reason worth keeping: they are the same question asked with different force, so the user had to decide which section a row belonged in before they could write it, and a row in the wrong one did something they did not mean. Merged, the row says who, and then how much — and ticking `persons` visibly subsumes the rest.

The distinction the checkboxes now carry is real and load-bearing: **removing people cuts the line running through them**, so a branch reachable only via someone excluded is severed from the rest, while holding back their documents leaves the tree whole. That is why `persons` is the default tick on a new row (the strongest reading, to be softened) and why the other boxes are shown ticked and disabled while it is on.

`_excluded_ids` reads the rows whose kinds include `persons`; `resolve_content_strips` reads the same rows for everything else and returns `{kind: person ids}`. `_share_resolve` narrows each set to people the selection actually contains, because a rule may well name somebody who was never included and counting them would report a reduction that is not happening.

Two shapes are read but never written: an `exclude` row with **no `content` key at all** means `["persons"]`, which is what an exclusion meant before the merge; and `rules.strip`, the short-lived separate list, is still folded in by `_exclusion_rules`. Both exist so a profile saved against the older shape keeps meaning what its author meant. An explicit empty `content` is different — that is an unfinished row, and it leaves out nothing.

**Holding material back and redaction are the same work underneath.** `_strip_notes`, `_strip_events`, `_strip_photos` and `_strip_documents` in `export_utils.py` are the primitives; `apply_content_strips` dispatches through `_STRIP_HANDLERS`, and `_redact_persons` is all four plus the person's own columns. They were one function first, and splitting them was not a tidy-up: two features that delete from the same tables need one list of those tables, or a table added to one and forgotten in the other becomes a leak.

Three details carry over from redaction because they are properties of the data, not of the feature:

- **A shared document stays with whoever keeps it.** `_strip_documents` hands a document owned by an excluded person over to a co-linked person who is keeping theirs, before deleting anything, exactly as `_delete_persons` does. `documents.person_id` records who uploaded it; `document_persons` is what every listing joins on.
- **Photographs are decided by the cluster derivation**, so `strip_content["images"]` joins `redact_person_ids` in being subtracted from it. `_strip_photos` only unlinks the cluster from the person, which is what keeps a photo travelling for somebody else's sake from arriving labelled with theirs.
- **Events are unlinked, not deleted.** `_strip_events` clears `event_persons`, and the orphan sweep later in `build_export_db` removes whatever is left with no participants — an event other people are still in is theirs and stays.

### Naming a record instead of a person

Everything above reaches documents and events *through* the people who own them, which is the right default and cannot express two ordinary requests: keep this one document out, and bring this one along even though its owner is not in the archive. `documents` and `events` (`RECORD_RULES` in `share_filter.py`) take an `ids` list and select rows rather than people:

```json
{"rule": "documents", "ids": [3, 7, 9]}
```

They work in both lists. In `exclude` the records are dropped; in `include` they are carried past the person filter — the only way to send a document the *project* owns rather than a person, since a person-scoped export drops those. `_rule_ids` returns an empty set for them explicitly, so their `ids` are never mistaken for person ids by the fallthrough.

**The include side is exempt from the person filter and from nothing else.** A record marked `is_private`, or of a kind the profile switched off, does not come back because somebody ticked it — naming a record says *this one belongs here despite whose it is*, not *ignore the rules*. `_keep_clause` in `export_utils.py` builds the exemption and the outright drops run after the content strips, before the privacy filter.

One consequence needs handling rather than documenting away: **a kept document outlives its owner.** `_delete_persons` hands it to a co-linked person who is staying if there is one, and otherwise nulls `documents.person_id` before deleting the person — without that the delete fails the foreign key, because the archive is keeping a row that points at somebody it is removing. It arrives as a document of the project, which is what an archive holding a document without its owner actually has.

Ids are the sender's own row ids. That is exactly right while the export runs — it is a filtered copy of their database — and meaningless afterwards, which is why they stay in the profile and never travel in `share.json`.

### Which photographs, as opposed to which people

`options.photo_kinship` scopes the picture set separately from the person set:

```json
{"person_id": 42, "max_degree": 4, "include_spouses": true}
```

A branch selection is about the *tree*, and a photo library is not — the two want different widths. Everyone in an ancestral line belongs in the tree that goes to a relative; a photograph of somebody four generations sideways is a stranger's family album to them. So an image travels when somebody within `max_degree` of the named person appears in it.

**The degree is the ordinary genealogical one**: the shortest path over parent and child links. Parent 1, sibling 2, grandparent 2, aunt or uncle 3, first cousin 4, first cousin once removed 5, second cousin 6. `Tree.kinship_degrees` walks `Tree.blood`, which holds parent and child edges only — **marriages are not steps**, because counting one would put a spouse's entire family nearer than one's own cousins. `include_spouses` then gives each relative's husband or wife *that relative's own degree* without walking on from them: a cousin's wife is as near as the cousin for deciding whose pictures belong together; her siblings are not.

The picker offers the degree by the relationship it reaches (*first cousins*, not *4*) — nobody chooses a bare number, and the number is meaningless without the example.

**Narrowing the photos must not cost anybody their name.** These are two questions, and conflating them is the trap: `build_export_db` derives *which images survive* from `photo_person_ids`, but keeps the clusters of the whole selection, so a photo that does arrive still recognises everyone on it. Deriving both from the narrowed set would deliver photographs with half the family unlabelled.

`resolve_photo_people` returns `None` when the profile does not narrow the photos, which is deliberately distinct from "a scope that happens to match everybody" — the caller uses it to skip the narrowing entirely rather than passing an id list that means the same thing more slowly.

### Living people are a profile setting, not a record flag

`options.living_policy` is `include`, `exclude` or `redact` (the default).

Who counts as living is decided by `is_living()`, and the obvious rule is wrong: treating *any* missing death date as "still alive" also hides everyone born two centuries ago whose death nobody wrote down — which in a genealogy is most of the tree, and precisely the part a relative asked for. A recorded death or burial settles it; otherwise the birth (or christening) year must be within `lifespan_years` (default 100) of today. Somebody with no dates at all is treated as living, because an unknown person wrongly shared cannot be unshared while one wrongly held back is a question the recipient can ask.

**Redaction keeps the person and removes the biography.** Deleting a living person from a shared branch is the obvious move and the wrong one: they are usually the link between the generation the recipient knows and the one they are researching, and removing them leaves two halves of a family with nothing joining them. So `_redact_persons()` in `export_utils.py` keeps the row and both its `relations` while emptying `_REDACTED_COLUMNS` and deleting their notes, citations, event participation, sub-clusters and documents. Name parts and `sex` stay — a chain of blanks is not a tree anybody can read, and a profile that cannot share even that should exclude instead.

Two details are load-bearing:

- **Photographs are handled where the clusters are chosen, not at redaction time.** `build_export_db` derives `family_cluster_ids` from `person_ids` **minus** `redact_person_ids`; blanking columns after their cluster has already pulled every picture of them into the archive redacts nothing. Faces of theirs in a photo that travels for somebody else's sake land in the noise cluster, unnamed.
- **`_redact_persons` resolves its `where_clause` to a literal id list first.** Unlike the delete helpers beside it, it *updates* the rows it selects, so a clause naming a column it is about to blank would match a shrinking set as the statement ran.

Redaction runs immediately after the person filter, so everything downstream sees the emptied rows — the events block drops any event it left without participants, and the content toggles apply to what remains.

### Endpoints

| Endpoint | |
|---|---|
| `GET/POST /api/share-profiles` | list, create |
| `PATCH/DELETE /api/share-profiles/{id}` | update, remove |
| `POST /api/share-profiles/preview` | resolve a rule set **that need not be saved** (rules and living policy travel in the body), so the editor can answer while it is being typed |
| `GET /api/share-profiles/{id}/export` | resolve and hand the person set to the same `stream_project_zip` every other export uses |

The preview's counts describe the archive *after* redaction. A preview that promised a hundred documents and shipped twenty would be worse than no preview, so `_share_counts` scopes documents, events, notes and photos to `selected − redacted`. The client never computes a person set of its own, which is why the preview and the archive cannot disagree.

`last_exported_at` is stamped when the archive is *asked for* rather than when the last byte leaves: the stream outlives the request, and a download the user cancelled still tells them what they last sent.

### `share_profiles` never travels

It is working state, and the one table here whose leak would be a disclosure about **third parties** — it records who else this archive is shared with, and on what terms. `build_export_db` deletes it unconditionally next to the chat tables. An export toggle would be a way to get that wrong.

### The archive says what it is

A share-profile export writes `share.json` beside `project.json`: profile name, sender, export timestamp, a per-export `export_id`, the rules used, the living policy, how many people arrived redacted, how many had each kind of material held back (`stripped`), and the table counts. `merge_import.read_zip_db` reads it back into `share_manifest`, `POST /api/import/merge/preview` returns it as `share`, and `MergeModal.tsx` renders it above the review list.

Without it a project ZIP arriving by email says nothing about itself — a filename, and an offer to fold in a few hundred strangers. Its absence is not an error: a plain project export has none, and neither does anything made before share profiles existed.

### The UI

`components/ShareModal.tsx` — a profile list and a rule editor, reached from the family tree tab's toolbar and from the project switcher's export row. Person fields are `PersonFilterCombobox` from `PersonSelect.tsx`, so every row carries its life summary and relatives; its `emptyLabel` prop exists because "nobody chosen" means *choose somebody* here rather than the filter's *everybody*.

**The panel stops the click bubble itself** (`onClick={e => e.stopPropagation()}` on the inner div), like every other modal here. `useBackdropClose` closes on any click whose mousedown and click share a target and does **not** check that the target is the backdrop, so a panel that forgets this closes on its own buttons — which reads as the app throwing you back to whatever tab was underneath.

The preview is debounced rather than sitting behind a button: **a selection nobody previewed is a selection nobody checked.** *Show this selection on the tree* hands the resolved ids to `FamilyTreeTab`'s `applySharePreview`, which clears the family-group filter (a shared branch can reach across one) and reuses the same `personFilter` chip the statistics view already feeds.

---

## Cross-database identity

`stable_id` is a UUID on every table whose rows travel between databases: `persons`, `relations`, `documents`, `events`, `sources`, `person_notes` and `images` (which had it first). The list is `STABLE_ID_TABLES` in `database.py`, and it is the single place that enumerates them.

A local integer id means nothing in somebody else's project. Without a shared identity a merge has to *guess* which local row an incoming one is — which is what the name/birth-year/context heuristic in `merge_import.py` does for people, and what it could not do at all for a document: before v19 the document branch of `execute_merge` was a bare `INSERT`, so every re-import of the same archive wrote a second copy of every file to disk and a second row pointing at it, forever.

**Identity is settled in the source, before the copy is taken.** `ensure_stable_ids()` runs at the top of `build_export_db`, against `source_db_path`. An id invented in the export copy is thrown away with it, so the same person would leave under a different identity on every send and the recipient would see a stranger each time. `images.stable_id` was backfilled that way and had exactly this bug.

**The backfill's guard is the data, not the stored version.** `_backfill_stable_ids()` runs on every startup and matches zero rows once everything is filled in. A row inserted by a raw-SQL path that does not write a `stable_id` — `gedcom_import.py` is the case — would otherwise stay anonymous forever, because a version-only check never looks at that database again. The uuid is generated per row in Python: a single SQL expression evaluated once for a whole `UPDATE` would give every row the *same* id, which is worse than none.

**On merge, identity is checked before every heuristic.** `build_merge_preview` opens with a Pass 0 that claims every incoming person whose `stable_id` matches a local one, at `confidence: 'exact'`, `match_source: 'stable_id'`. Those matches are marked `confirmed` outright rather than scored — the context validation would happily reject a correct match because the recipient reshaped the family around it — and the existing people they claimed are withheld from `_suggest_match` via `skip_ids`, so a name coincidence cannot outrank a known identity.

`execute_merge` then checks `_find_by_stable_id` before each section's own dedup, since it is the only one of them that is not a guess. Documents have **no** heuristic fallback on purpose: two scans of the same certificate are legitimately two documents, and only a shared identity says otherwise.

**A created row carries the incoming id**, via `_claim_stable_id` — that is the whole point, so the *next* exchange in either direction recognises it. A fresh uuid is minted only when the archive predates v19, or when the id is already taken locally by a row the user chose not to merge with: they have said these are different people, and two rows answering to one identity would make every later match ambiguous.

Reused rows are recorded in `doc_id_remap` so their citations and person links still resolve, and tracked in `reused_doc_inc_ids` so their extra files are not written a second time.

---

## GEDCOM export

Produces a ZIP with `family.ged` (GEDCOM 5.5.1, UTF-8, CRLF) and a `media/` folder.

**INDI records** — `NAME` with `/surname/`; `GIVN`, `SURN`, `NICK`, `NPFX`; vital events (`BIRT`, `CHR`, `DEAT`, `BURI`) with `DATE` and `PLAC`; `DEAT > CAUS` (cause of death); `OCCU`; `EDUC`; `RELI`; `NATI`; `NOTE`; `EVEN` (one per event); `OBJE` (documents + photos — a multi-file document's extra files each get their own `OBJE`, numbered in the `TITL`); `FAMS`/`FAMC`

**FAM records** — `HUSB`/`WIFE` (sex-aware); `CHIL`; `MARR` and `DIV` with date and place; `MARR > SOUR` pointing at the marriage's cited sources, with `PAGE` for the citation detail. A marriage known only from a source and carrying no date or place still gets a `MARR Y` to hang its `SOUR` on — that is how 5.5.1 asserts an event whose detail is unknown. Person-level facts (`BIRT`, `DEAT`, …) do **not** yet carry their citations

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
- **Outbound connections — exactly three, and none sends family data by default:**

  | | Sends | Default | Off switch |
  |---|---|---|---|
  | GitHub update check | Version query only, nothing about the user | **On** | Settings → auto-check |
  | AI assistant | Questions plus the tree data needed to answer them | **Off** — inert without an API key | Settings → *Enable assistant* (`ai.enabled` in `config.json`) |
  | Web research | The names, places and years in a query, to the search provider (not the AI provider above) | **Off** — inert without its own API key | Settings → assistant setup, web research section (`web_research.enabled` in `config.json`) |
  | Document reading | The scan itself — a photograph of a page, with everything written on it — to the AI provider | **Off** | Settings → assistant setup, document reading section (`document_ai.enabled` in `config.json`) |

  These three are the only paths by which project data leaves the machine, and they are separate switches to separate destinations. Document reading is the largest of them by volume — a scan carries whatever is on the page, including what nobody has read yet — which is why it is its own switch and not a mode of the assistant's. Disabling any of them hides its part of the UI and stops its traffic; none discards its stored key.
- Document reading has no key of its own: it reuses the provider key already stored in the `ai` block, and stores only its own toggle, model choice and monthly page budget in `document_ai`
- Both API keys live in `config.json` — the AI provider key per provider, the web-research key in its own `web_research` block. Both are write-only over HTTP: `GET /api/ai/settings` and `GET /api/ai/web-settings` return them masked (`sk-ant-api…9f2a`), and no other endpoint returns either at all
- Private records are withheld from the assistant unless `allow_private` is set — a third enforcement layer alongside ZIP and GEDCOM export (see *Privacy*)

---

## Keeping this document up to date

Each entry below is **trigger → the files that must change together**. They exist because these changes have parts in several places at once, and a change that edits only one part compiles, runs, and is wrong. Read the entries matching your change before you start, and again before you call it done.

- **New content toggle (ZIP)** → add row to *ZIP export* content table; update `build_export_db` in `export_utils.py`, endpoint in `main.py`, `api.ts`, `ExportModal.tsx`, and all three callers
- **New content toggle (GEDCOM)** → update *GEDCOM export*; update `build_gedcom_zip` in `gedcom_export.py` and endpoint in `main.py`
- **New note syntax** → update *Note serialisation* table; add entry to `_MD_PATTERNS` in `gedcom_export.py`
- **New user-visible string** → add the key to **both** dictionaries in `i18n/translations.ts`. The EN and HU key sets must match exactly; a missing HU key silently falls back to English and is easy to miss. Render it through `useT()` — a component that never calls `t()` is the failure mode to look for, since a hardcoded literal is invisible to the key-parity check
- **Any UI that shows a date or a month name** → take the locale from `useDateLocale()` and format through `formatPartialDate()` / `monthNames()` in `SettingsContext.tsx`. Never pass a literal `'hu-HU'` / `'en-GB'` to `toLocale*`, and never keep a local `MONTHS_EN` array: both pin the output to one language regardless of the user's setting, and Intl is what gets the part *order* right (`1950. március 12.` vs `12 March 1950`). Module-level helpers take `locale` as a parameter rather than reading it themselves
- **New built-in document type** → add it to the migration seed in `database.py`, to `SEED_LABELS` in `docTypes.ts` (with the exact seeded English label), and add a `docType.<key>` entry to both dictionaries
- **New file bundled into the build** → add it to `datas` in `mnemosyne.spec` **and** read it via `MNEMOSYNE_BUNDLE_DIR`, not `MNEMOSYNE_APP_DIR` — see *Auto-update* for why the two are not interchangeable
- **Change to the update scripts in `updater.py`** → the script text is only half of it. Keep the paths as script *arguments* (never interpolated into the file, which is read back in the platform's own encoding), keep the file pure ASCII, keep `robocopy`'s retries bounded and its exit code read, keep `_internal/version.txt` copied last, and make sure whatever new way the update can fail ends up in `result.txt` so `check_install_result()` and `_copy_ok()` can see it. A new failure state that reaches the user needs `install_failed` in `updater.py`, the `UpdateStatus` interface in `types.ts`, the red block in `UpdateBanner.tsx`, and its keys in **both** dictionaries. See *Auto-update → Verifying that the update landed* — an update path that can fail silently is the one bug in this repo that costs the user a 160 MB download every time they retry
- **Any generated script or file a platform tool reads back** (a `.bat` for `cmd.exe`, an `.sh`, an `.ini`) → decide its encoding deliberately. Python writes UTF-8; `cmd.exe` reads a batch file in the console **OEM** code page. Pass variable text as arguments and keep the file itself ASCII rather than hoping the two agree
- **New streaming ZIP endpoint** → wrap the pipe in `NonSeekableWriter` (see *ZIP export*), otherwise the archive is silently corrupt on Windows
- **New UI that removes a shared object from one person's page** (a document row, a linked cluster, anything a second person can also be attached to) → call the *unlink* endpoint, never the delete one — for documents that is `DELETE /api/documents/{id}/persons/{person_id}` via `api.documents.unlinkPerson()`. A person's page shows one person's view of something shared, so an X there means "not on this page"; wiring it to the delete endpoint destroys the object for everybody else too, with nothing on screen to warn the user. Deleting outright belongs on the tab that lists every owner. Invalidate both `['person-docs', personId]` and `['docs-all']` afterwards
- **New data table with `person_id` FK** → update `_delete_persons` in `export_utils.py` with an explicit `DELETE FROM <table> WHERE person_id IN (...)` line before the `DELETE FROM persons` line. If the table has `ON DELETE CASCADE` (like `person_subclusters`) the cascade would handle it automatically, but being explicit is the established pattern here
- **New data table with `document_id` FK** → add it to `_delete_document_children()` in `export_utils.py`, which `_delete_documents()` calls before dropping the document row — the export connection has foreign keys **on**, so a table whose FK declares no `ON DELETE` action does not dangle, it refuses the delete and fails the export outright. Include it in `_doc_dict` in `main.py`, and carry it through `read_zip_db` + `execute_merge` in `merge_import.py` — a merge import copies nothing it is not told about
- **New data table with an `event_id` FK** → add it to `_delete_events()` in `export_utils.py` (the single place the export deletes events), to the orphaned-event cleanup in `delete_person` (`main.py`) and to **both** event-deleting branches of `execute_rollback` (`gedcom_import.py`) — the FKs on these tables declare no `ON DELETE` action and foreign keys are on, so a forgotten child does not dangle, it refuses the delete. Include it in `_event_dict` in `main.py` and in `PersonEvent` in `types.ts`, and carry it through `read_zip_db` + `execute_merge` in `merge_import.py`, remapping both the event id and any `source_id`
- **New document-child table that owns files on disk** (`document_files` is the example — most document-child tables, like `document_citations`, own no files and skip this) → beyond the plain `document_id` FK checklist above: (1) delete its rows' bytes from `documents/` on document delete (`delete_document` in `main.py`) and on row-level delete (its own `DELETE .../{file_id}` endpoint); (2) add its `stored_name`s to the `doc_stored_names` query in **both** copies of the project-ZIP packer in `export_utils.py` (`build_project_zip` and the streamed `stream_project_zip`); (3) add it to the bulk-download ZIP in `bulk_download_documents` in `main.py`, including its own deduplicated archive names; (4) copy its files across in `execute_merge` (`merge_import.py`) inside the same `with zipfile.ZipFile(...)` block the primary files use, and clean up its bytes in `execute_rollback` (`gedcom_import.py`) alongside the primary file, in both the per-person and per-document rollback branches; (5) decide whether `gedcom_export.py` should emit it as additional `OBJE` records — it does for `document_files`, one per extra file, named so they still resolve inside the packed media ZIP
- **New surface that renders note or document Markdown** → render through `renderMarkdown()` and put one of two classes on the container: `note-content` for a body being read, `note-preview` for the clamped excerpt on a card. Both live in `index.css` and share every colour and size but deliberately not their vertical rhythm, so pick one rather than hand-rolling a third set of margins. The spacing is load-bearing, not decoration: `breaks: true` in `markdown.ts` already turns a single newline into a `<br>`, so the paragraph margin is the *only* thing that distinguishes a blank line the writer typed from a plain line break — at the tight teaser value the two are indistinguishable and paragraphed prose renders as one block
- **Any UI that lists people to pick from** (a picker, a mention popup, a search result list) → put `personLifeSummary()` and `<FamilyContextLines>` under every name, on every row, from `familyContext.tsx`. Names repeat within a family, so a name-only row cannot be chosen between — see *Person pickers*. A row that shows its context only when highlighted does not satisfy this
- **New field that needs `@` mentions** → for a one-line field use `MentionInput` from `frontend/src/mentions.tsx` (a document title and an event title are the two callers); for anything else use `useAtMention()` from the same module and render the `popup` it returns, supplying only the text an accepted mention inserts. Do not re-roll the trigger, the caret anchoring or the list — three hand-rolled copies is what made the mention lists disagree with each other in the first place
- **New place that shows a document or event title or description** → never print the stored string. Event titles and descriptions hold the same markup document ones do, so the same three helpers apply. Pick from the table in *Documents and text documents*: `renderTitleMentions()` where mentions should be clickable, `plainMentions()` for a flat title, `plainMarkdown()` for a description squeezed into one line — all in `frontend/src/markdown.ts`, with `_plain_mentions()` / `_plain_markdown()` as the server-side pair in `main.py`. Both fields hold mention markup, so the raw value shows the reader `@[…](#pid-4)`. Search haystacks and sort keys count as display here: matching or ordering on the raw string means a query has to contain `](#pid-`
- **New editor that writes a description** (a document's or an event's) → use `DescriptionField` from `components/DescriptionField.tsx` with the right `owner` (`{ kind: 'document' | 'event', id }`) and persist with the `persistDescriptionCitations()` / `linkMentionedPersons()` helpers beside it. Pass `id: null` while the record does not exist yet and flush the citations once it does. A new *kind* of owner is a new branch in those two helpers and a new endpoint pair, never a second editor: every screen that edits a description already shares this one, and a plain textarea for the same field is how the modal and the panel ended up with different capabilities. Citations are saved as a **diff** — delete removed, add new — never replaced wholesale, since `marker` is the id the rendered `[n]` text points at
- **New card with an optional heading** → render the heading's row only when the heading exists, rather than letting an empty row hold the space. Anything else in that row (a date, a badge) moves somewhere it costs nothing when the heading is absent. `NoteCard` in `NoteEditor.tsx` is the worked example
- **New popover opened inside the carousel's description panel** → drop it leftward (`absolute right-0`). The panel is docked to the viewport's right edge, so a `left-0` dropdown runs off-screen and its far end becomes unclickable — this shipped once in the cite picker
- **New popup anchored to a text field's caret** (a slash menu, or anything that is not an `@` mention — those go through `mentions.tsx`) → take the position from `caretAnchor()` and `useCaretPopup()` in `frontend/src/caretPopup.ts`, which handle a `<textarea>` and a single-line `<input>` alike (an input never wraps, so its mirror is measured unconstrained and its caret's "line" is the field itself). Pinning the popup to the field's own rect and pushing it upwards is what sent the mention list off the top of the screen in the document editor, where the textarea starts high in the viewport
- **New UI that adds a child** (a `parent` relation written from a person's page) → ask which spouse the child also belongs to and write **both** rows, the way the add-child picker in `PersonPanel.tsx` does. A couple is not stored anywhere — it *is* the child's two `parent` rows — so a screen that writes only one leaves the other parent's page wrong and the user adding the same child a second time from the spouse. Preselect the spouse when there is exactly one, keep "no co-parent" as an explicit choice rather than the default, and check the two-parents-per-child cap client-side: the server refuses the third row with a 400 that arrives as a raw error
- **A text field whose values repeat across the project** (an occupation, a religion, anything with a small vocabulary) → add a `FieldSource` to `FIELD_SOURCES` in `backend/field_values.py` and render the field with `VocabInput` passing that registry key; invalidate `['field-values']` in the mutation that writes it. Do **not** build a second suggestion dropdown — `SuggestInput` is the one implementation, and a wrapper supplies options and row decoration only. Names and event titles do not belong in the registry; see *Suggesting what the project already uses* for why
- **New field that holds a place** → use `PlaceInput` from `components/PlaceInput.tsx` rather than an `<input>`, add the column to `PLACE_COLUMNS` in `backend/places.py` (nothing else enumerates them, so a column missing there is a place the suggestions and the statistics cannot see), and invalidate `['places']` in the mutation that writes it alongside the resource's own keys. Never split a place string in the browser — the levels arrive already split, and a second heuristic for what a house number is drifts silently. See *Places*
- **New person picker anywhere in the UI** → build it on `useFamilyContext` + `<FamilyContextLines>` from `familyContext.tsx`, or on `PersonMultiSelect` / `PersonFilterCombobox` from `components/PersonSelect.tsx`. Rolling a fourth hand-written relative lookup is how the pickers drifted apart last time
- **New year/month/day date input anywhere in the UI** → use `DatePartPicker`, exported from `EventTimeline.tsx` (year field, then a month `<select>` once a year is entered, then a day `<select>` once a month is entered). It produces the same partial-ISO string (`YYYY` | `YYYY-MM` | `YYYY-MM-DD`) that `formatPartialDate()` reads, so a value it writes is a value every other date display already knows how to render
- **New dismissible banner or other "I've seen this" UI state** → persist it, in `localStorage` for a per-device preference. `App.tsx` mounts each tab behind a ternary, so a tab is fully **unmounted** when you navigate away and plain `useState` is back to its initial value the moment you come back — a dismiss that only sets component state looks like it works and reappears a click later. Where the thing being dismissed is a *count* that can grow (the Scan tab's duplicate banner), store the count that was dismissed rather than a boolean, so the banner returns when there is genuinely something new to see
- **New tab that grows bulk selection actions** → match the Images tab's floating toolbar exactly: `fixed bottom-6 left-1/2 -translate-x-1/2 z-50` pill, `bg-zinc-900/90 backdrop-blur-xl border border-zinc-700/60 rounded-2xl shadow-2xl`, count label + divider + action buttons + a trailing "Clear". `DocumentsTab.tsx` copies this chrome verbatim for its own action set (download, delete) rather than reusing the images bar's markup directly, since the two tabs' actions never overlap — but a new one drifting to a full-width inline bar or a different position is the thing to catch in review
- **Any UI that shows a person's name** → render it through `displayPersonName(person, nameOrder)`. The stored `persons.name` is always composed in one fixed order by `_derive_display_name()`, so printing it directly ignores the user's setting. If the payload is a stub rather than a full person, give the stub its name parts server-side (see `_doc_person_dict`)
- **Schema change to `note_citations`** → add idempotent migration in `database.py` using the `PRAGMA table_info` + table-recreate pattern
- **Relaxing or changing a column constraint (not adding a column)** → SQLite has no `ALTER COLUMN`, so follow `_drop_document_owner_not_null()` in `database.py`: guard on `PRAGMA table_info` for idempotency, derive the new DDL from `sqlite_master` instead of hardcoding a column list, and run it on the **raw DBAPI connection with no transaction open** — `PRAGMA foreign_keys=OFF` is silently ignored inside one, and with FKs on the `DROP TABLE` fires every child table's `ON DELETE CASCADE`. Verify by running the backend twice against a *copy* of a real project DB and comparing child-table row counts before and after
- **A row shape that can now be NULL where it never was** (an owner column, a parent link) → the copy-then-filter export is the place it leaks: `x IN (SELECT …)` is never true of NULL, so a row the old filter caught now passes straight through into `build_export_db`'s output. Add the explicit `IS NULL` case to `_delete_persons` in `export_utils.py`, decide what `gedcom_export.py` and `merge_import.py` should do with it, and open the produced ZIP to check — the endpoint returns 200 either way
- **New per-turn prompt parameter** (like `lang`, `name_order`, `style`) → add the field to `ChatSendRequest` in `schemas.py`, thread it through `run_turn` in `ai/orchestrator.py` into `build_system_blocks` in `ai/primer.py`, and send it from `AssistantPanel.tsx` on every `api.ai.stream()` call (update the body type in `api.ts` too). These are per-device request values, not stored on the thread or the project — and because the instructions block sits inside the cached prefix (see *Response style*), changing one mid-conversation costs a full-price prompt rather than a cached one; that is expected, not a bug
- **A new way to produce text about a document** → append it to `documents.description` rather than giving it a field. The description is already edited, searched, exported, and handed to the assistant in full by `ai/tools.py`'s `_doc_dict`; a parallel field means two things to keep in step and nothing gained. Files: `main.py` (the endpoint), `DocumentReadButton.tsx` (`appendReading`, shared by both callers), `EditDocModal` + `DocumentViewer`. `transcript_pages` is the batch reader's, and stays that way
- **New AI assistant tool** → register it in `build_registry()` in `ai/tools.py` with `mutates=False` (the registry rejects anything else); apply the `_priv_ok` privacy filter; return name *parts* rather than `persons.name`; add a `chat.tool.<name>` label to **both** dictionaries in `i18n/translations.ts`. Prefer one fat tool over several thin ones — push the computation into the tool, as `get_relationship_path` does with the BFS and `get_ancestors` does with the line walk. Two rules learned the hard way: an empty result must carry enough context that it cannot be read as an absent fact, and anything the model would otherwise have to *guess* — a stored enum value, or whether any material exists at all — belongs in the tool's error path, in `build_inventory()`, or in the skeleton's `material` marks (`_content_marks` in `ai/primer.py`), never in an instruction telling the model to remember to check
- **New table holding prose** (notes, descriptions, bodies — anything a person writes) → it must reach the assistant in three places or it is invisible to every answer: the search loop and the listing in `_t_search_text` / `_t_list_written_material`, the counts in `build_inventory()`, and — if it hangs off a person — the `material` marks in `_content_marks` (`ai/primer.py`). Prose the assistant cannot see is prose it will report as never having been written.
- **New AI tool with an external network dependency** (anything beyond a local SQLite read) → beyond the plain "New AI assistant tool" entry above: register it in its own registry (`ai/web_tools.py`'s `WEB_REGISTRY` is the worked example), never `tools.py`'s always-on `REGISTRY`; gate both its tool *definitions* and its handler on its own `config.json` block's enabled+key state (`orchestrator.py`'s `web_ready` check); give it its own consent/privacy disclosure in `AssistantSetup.tsx`. Folding it into the existing `allow_private` toggle is wrong — that toggle answers a different question (visibility of the user's own private data, not whether anything leaves the machine to a new third party)
- **New AI tool with its own usage quota** → enforce the check-and-increment inside the tool handler itself (`ai/config.py`'s `try_consume_web_quota` is the worked example), never as a system-prompt instruction alone. The trigger for needing this: any tool whose real-world cost scales with how often the model decides to call it — which an ambient, non-button-gated tool always does, since nothing stops the model reaching for it more than intended
- **New table holding working state rather than project content** (a chat thread, a transcript batch — anything about files or conversations rather than about the family) → add an unconditional `DELETE FROM <table>` next to the chat/transcript blocks at the top of `build_export_db` in `export_utils.py`, children first. The merge importer enumerates its tables by hand, so a new one is correctly *not* merged by default — but say so in a comment rather than leaving the next reader to wonder whether it was forgotten
- **New chat table** → add an unconditional `DELETE FROM <table>` to the chat block at the top of `build_export_db` in `export_utils.py`, children first. The export copies the whole database and then filters, so a table you forget here is silently exported — this is the one mistake in this area with a real privacy cost
- **New model** → usually *nothing to do*: the list is fetched from the provider and new ids appear on the next refresh. Add an entry to `backend/ai/models.json` only to give it a friendly label, a note or a price (omit `pricing` rather than guessing — a missing block just hides the cost estimate, a wrong one misinforms). Never add a model-id branch in code; if you want one, the missing thing belongs in `caps`. **Never let `caps` refuse an id the manifest does not know**: `UNKNOWN_MODEL_CAPS` is conservative (`vision: false`), so a gate written as `if not caps['vision']` turns away every model released after the build. Ask `model_known()` first and let an unknown id be tried — `doc_reader.read_file` is the worked example
- **New non-chat model type appearing in the picker** → add a substring to `_NON_CHAT_MARKERS` in `ai/config.py`. Keep it conservative — over-filtering silently hides usable models, which is the worse failure
- **Change to family tree node size or card content** → edit `frontend/src/treeGeometry.ts`, never a component. `TreeView` computes node positions from those constants and `TreeExportModal` draws cards at those positions; a second copy makes the exported PNG place correctly-sized cards wrongly, or wrongly-sized cards correctly. Adding a line to the card also means re-checking the four-line budget documented there
- **New capability that sends a new *kind* of data to the provider** (not a new destination — a new payload: files, images, audio) → it needs its own `config.json` block, its own toggle defaulting to off, its own disclosure in `AssistantSetup.tsx`, and its own budget enforced in code (`try_consume_doc_page` in `ai/config.py` is the worked example). `document_ai` is the pattern. Reusing the assistant's `enabled` flag is wrong for the same reason `allow_private` was wrong for web research: the user consented to a summary of their tree being sent, not to photographs of their documents
- **New method on the provider seam** (anything beyond `stream_turn`) → implement it on **every** adapter in `ai/provider.py`, and where an adapter genuinely cannot do the job, return a `ProviderError` naming the way out rather than guessing a wire format. `analyze_files` is the worked example: Anthropic takes a PDF as a native `document` block, the OpenAI-compatible adapter takes images only and refuses a PDF explicitly. A guessed shape fails per item, mid-batch, as a 400 the user has to decode
- **A model list anywhere** → there isn't one, and adding one is the mistake. `models.json` holds no models: the picker asks the provider what the key can use, labels and descriptions come from the provider where it gives them (Gemini gives prose, Anthropic a display name, OpenAI neither), capabilities come from **family-level** rules (`^gpt-[5-9]`, `^gemini-`) so a point release inherits them, and price is the one hand-kept table because no provider exposes pricing. If you find yourself writing a model id into a file, ask whether a family rule would do instead
- **New provider** → first ask whether it speaks OpenAI's Chat Completions API at an address of its own. If it does, it needs **no adapter**: give the `providers` entry in `models.json` a `base_url` and add the id to the tuples in `build_provider` / `discover_models`. Google Gemini is the worked example — one manifest entry, no new dependency, no new code path. `base_url` is resolved per provider by `provider_base_url()` in `ai/config.py` (a user override in `ai.base_urls[<provider>]`, else the manifest's), because a URL entered for a local endpoint must not be sent to a hosted one. Otherwise add an entry to `providers` in `models.json`, and either reuse `OpenAICompatProvider` with a `base_url` (correct for anything OpenAI-compatible) or add an adapter implementing `LLMProvider`. Wire it into `build_provider` and `discover_models` in `ai/provider.py`. Nothing above the protocol should need to change; if it does, the abstraction has sprung a leak
- **New bundled AI data file** → spec `datas` **and** read it via `MNEMOSYNE_BUNDLE_DIR` in `ai/config.py`, never `MNEMOSYNE_APP_DIR`
- **Anything that claims two people found on one page are connected** → the boundary comes from `_entry_blocks` in `transcriber.py`, never from a field the model filled in. A register page holds many records, and a pairing made across two of them invents a relationship out of unrelated lines. Place each person with `_place` (both name parts written inside one entry, unambiguously), pair only within a single entry, and refuse where the page does not divide. The same rule applies to dates: score a placed person against **their entry's** year, not the page's span
- **Jumping to a row that was just created** (an overlay hands control back to the table underneath: importing a scan, creating from a modal) → two things, and the first is the one that gets forgotten: **close the overlay**, or the jump looks like it did nothing because the modal is still covering the target. Then wait for the *row*, not for a timeout — the list was invalidated, not refetched, so a `setTimeout` races the network. Keep a pending id in state and let an effect keyed on the list scroll to it when it appears (`openImportedDoc` in `DocumentsTab.tsx` is the worked example)
- **Raw SQL that deletes an `events` row** (or any row a second table points at without an ORM cascade) → delete the children first — `event_images` **and** `event_description_citations` before `events` — and scope the sweep to the events you actually orphaned. The `ON DELETE CASCADE` in `database.py`'s `CREATE TABLE IF NOT EXISTS` block is not what the database has: `create_all()` ran first and built those tables from the models, which declare no `ondelete`. Foreign keys are on, so the constraint failure aborts the statement — and since these cleanups run *after* the main `commit()`, the row is already gone when the request 500s, which is what makes it read as "the delete half-worked". The paths are `delete_person` in `main.py`, `execute_rollback` in `gedcom_import.py` (both its branches), and `_delete_events` in `export_utils.py`, which every event delete in the export goes through so the child list is written once
- **New column with an FK into `relations`** (or into any table whose rows the export copy deletes) → delete the child rows **before** the parent in every path that removes a relation: `delete_relation`, `delete_person` and `merge_persons` in `main.py`, `_delete_relation_citations` in `export_utils.py` (called ahead of both the person-subset delete and the `is_private=1` delete), and `execute_rollback` in `gedcom_import.py`. Carry the column through `read_zip_db` + `execute_merge` in `merge_import.py` as a **remapped** id — an incoming relation id means nothing locally — and read it with the `_has_column` guard so an older ZIP does not lose the whole table. Getting the delete order wrong is silent rather than loud: foreign keys are on in the export copy and its relation deletes sit in `try: … except: pass`, so the failed constraint is swallowed and the row survives into the ZIP
- **A new kind of file travelling in the project ZIP** → three places, and the third is the one that bites: copy it under its own prefix in **both** `create_project_zip` and `stream_project_zip`, rewrite the absolute path stored in the DB to the archive-relative one *before* `project.db` is written (the streaming builder writes the database first), and add the inverse rewrite to `import_project_zip`. `_stage_scan_files` / `_restore_scan_paths` are the worked pair. Anything large enough to matter also needs an opt-in flag threaded through `build_export_db` → both ZIP builders → the endpoint → `ExportModal`, defaulting to off
- **New table whose rows travel between databases** (project content, as opposed to working state) → give it a `stable_id`: add the model column with `default=_new_stable_id`, add the table name to `STABLE_ID_TABLES` in `database.py` (the ALTER, the index and both backfills read that tuple, so nothing else enumerates them), carry the column through `read_zip_db` behind the `_sid()` guard in `merge_import.py`, check `_find_by_stable_id` before that section's own dedup, and write `_claim_stable_id` on insert. Without it the row cannot survive a round trip: the merge has to guess which local row it is, and for anything without a name to match on it cannot guess at all. See [Cross-database identity](#cross-database-identity)
- **New selection rule for share profiles** → add it to `RULES` and `_rule_ids` in `backend/share_filter.py`, to `RULE_FIELDS` and `RULE_ORDER` in `ShareModal.tsx`, to the `ShareRule` union in `types.ts`, to the rules table in *Collaboration and share profiles*, and add `share.rule.<name>` to **both** dictionaries. The rule names are stored inside every profile's `rules_json`, so renaming one silently empties every profile that used it
- **New rule that selects records rather than people** → add it to `RULES` **and** `RECORD_RULES` in `backend/share_filter.py`, return an empty set for it in `_rule_ids` (or its `ids` are read as person ids by the fallthrough), handle it in `resolve_record_ids`, act on it in `build_export_db` — exemption via `_keep_clause` for the include side, an outright delete before the privacy filter for the exclude side — and check what happens to a row it *keeps* whose owner is deleted: a surviving foreign key into `persons` fails the person delete outright. On the front end it needs a `RULE_FIELDS` entry naming its record kind, a place in `RULE_ORDER`, a branch in `useRecordOptions`, and its `share.rule.<name>` label in **both** dictionaries
- **New way to decide which images travel** → it belongs in the cluster derivation at the top of `build_export_db`, next to `photo_person_ids` and `no_photos`, **not** in `_strip_photos`. The two do different jobs: the derivation decides which images survive at all, `_strip_photos` decides who is still named on the survivors. Wiring a photo filter into the second gives the user fewer *names*, not fewer *pictures*
- **New kind of material a share profile can hold back** → add it to `CONTENT_KINDS` in `backend/share_filter.py` (which `EXCLUDABLE_KINDS` extends), write its `_strip_*` helper in `export_utils.py` and register it in `_STRIP_HANDLERS`, add it to `CONTENT_KINDS` in `ShareModal.tsx` and to `ShareContentKind` in `types.ts`, give it a `share.content.<kind>` label in **both** dictionaries, and count it in `_share_counts`' `bearers()` call for that kind. A kind added to the rule vocabulary but not to `_STRIP_HANDLERS` is accepted by the editor, shown in the preview, and then silently ignored by the export — the worst of the three outcomes, because the user is told it worked
- **New column on `persons` that is biographical rather than structural** → add it to `_REDACTED_COLUMNS` in `export_utils.py`. A column missed there survives redaction, which is the one place in this feature where a mistake sends a living person's details to somebody who was told they would not get them
- **New `is_private` on a table** → (1) add `ALTER TABLE … ADD COLUMN is_private BOOLEAN NOT NULL DEFAULT 0` to the v4→v5 migration block in `database.py`; (2) include `is_private` in the relevant `_xxx_dict` serialiser in `main.py`; (3) add the privacy-filter DELETE block for that table inside `build_export_db` in `export_utils.py`; (4) add `WHERE COALESCE(is_private,0)=0` to the relevant query in `build_gedcom_zip` in `gedcom_export.py` if applicable; (5) add `togglePrivacy` call to `api.ts`; (6) update the TypeScript interface in `types.ts`; (7) add the padlock button to the relevant component

### Maintaining the documentation itself

This file and `CLAUDE.md` are read at the start of the next task, so a change that leaves them stale costs more than it saved. They divide the work:

| Kind of knowledge | Goes in |
|---|---|
| What a feature does for the user | this file → *For users* |
| How a subsystem works, and *why* it is built that way | this file → the section for that area |
| Which files must change together | this file → the checklist above |
| How to work in this repo — workflow, verification, conventions, traps | `CLAUDE.md` |
| Rules that override an AI assistant's default behaviour | `CLAUDE.md` → *Non-negotiables* |

Rules for keeping them usable:

- **A new subsystem needs three things**, not one: its own section here, a row in [Orientation](#orientation) → *Start here for a task* naming the section and the files, and — if it introduces a pattern that spans files — an entry in the checklist above. A subsystem that only the code knows about is one the next task re-derives from scratch.
- **Headings are anchors.** The routing table and `CLAUDE.md` link to them by name, so renaming a heading means updating both. Keep developer-side headings distinct from the user-side ones (*Privacy enforcement* vs *Privacy*, *Connections graph* vs *Connections*) — duplicate headings collide as anchors and are ambiguous to grep.
- **Correct in place.** When behaviour changes, rewrite the sentence that is now wrong instead of appending a newer one. Neither document is a changelog; git history is.
- **Delete together with the feature** — section, routing row and checklist entry in the same change. A stale entry is worse than a missing one, because it is read as current.
- **Sections stay self-contained.** Anyone arriving from the routing table reads that section alone; cross-reference by link rather than assuming the reader came from above.
- **Explain the mechanism, and invent any example.** Real names, real dates and real measured statistics from a project database must never appear in this file — see *Non-negotiables* in `CLAUDE.md`. "Given names repeat within a family, sometimes between a father and his son" documents the problem completely and identifies nobody.
- **Facts that go stale quietly**, worth a glance whenever you are editing nearby: the schema-version table, the *Project structure* tree, port and endpoint claims, and the file lists in the checklist above.
