# Working on Mnemosyne

Local-first family photo + genealogy desktop app. FastAPI + SQLite backend, React/TS frontend, packaged with PyInstaller and shipped from `main` by a single developer.

Two facts shape everything below: **there is no automated test suite**, so "done" means you exercised the real path; and **the databases hold real living people**, so nothing derived from them may ever land in the repo.

---

## Start of a task

1. **Open `README.md` → *Orientation*.** Its routing table maps a task to the sections that describe it and the files that implement it. Two minutes there saves re-deriving behaviour that is already written down.
2. **Read the named section before the code.** The README documents *why* things are the way they are — most of it exists because the obvious implementation failed once.
3. **Find the code by grepping, not by reading whole files.** `main.py` is 3.6k lines, `ClustersTab.tsx` 2.9k, `PersonPanel.tsx` 2.4k, `translations.ts` 2.5k. See *Finding things fast*.
4. **Before finishing, walk README → *Keeping this document up to date*.** It lists the files that silently drift apart when only one of them is edited. This is the single highest-value check in the repo.

---

## The shape of the codebase

| Layer | Where | What to know |
|---|---|---|
| REST API | `backend/main.py` (~130 endpoints, one flat module) | Endpoints are grouped by resource in file order. New ones go next to their siblings — no new routers |
| Serialisation | `_person_dict`, `_doc_dict`, `_event_dict`, … in `main.py` | Every response funnels through one of these. Add a field there, never ad-hoc inside an endpoint |
| Schema | `backend/database.py` | SQLAlchemy models + `schema_version` + idempotent startup migrations (currently v7) |
| Projects | `backend/project_manager.py` | One SQLite DB per project; `get_db()` read-write, `get_readonly_db()` for the assistant |
| Long jobs | `backend/scanner.py`, `backend/updater.py`, `backend/maintenance.py` | Daemon threads + a module-level state dict behind a lock, polled over HTTP |
| Pipelines | `export_utils.py`, `merge_import.py`, `gedcom_*.py` | Copy-then-filter; the filters are hand-maintained and forgetting one leaks data |
| Assistant | `backend/ai/` | Read-only tool use over SQL, opt-in, off without an API key |
| API client | `frontend/src/api.ts` | The only place that knows URL strings |
| UI | `frontend/src/components/*.tsx` | One large component per tab, react-query for data, Tailwind v4, no component library |
| Shared frontend logic | `treeGeometry.ts`, `familyContext.tsx`, `markdown.ts`, `caretPopup.ts`, `docTypes.ts`, `graphLayout.ts`, `SettingsContext.tsx` | Extracted precisely because copies of them drifted. Reuse instead of re-rolling |

---

## Finding things fast

| Looking for | Do this |
|---|---|
| An endpoint | Grep the URL path fragment in `main.py` (`grep -n "clusters/{cluster_id}" backend/main.py`) |
| Why a field is in a response | Grep the field name inside the `_xxx_dict` serialisers |
| Where the frontend calls it | Grep `api.<group>.<fn>` across `frontend/src` |
| A string you saw in the UI | Grep the literal in `i18n/translations.ts`, take its dot key, grep the key |
| A column | Grep it in `database.py` (model **and** migration block), then in `types.ts` |
| A tab's behaviour | The component named after the tab; modals live in their own file next to it |
| Prior art for a pattern | The README section for that area names the files it spans |

---

## Running it

Two terminals, from the repo root:

```bash
.venv\Scripts\activate                                   # Windows
python -m uvicorn backend.main:app --reload --port 8000
```

```bash
cd frontend && npm run dev                               # http://localhost:5173
```

Vite proxies `/api` to `:8000`, so the frontend is always talked to on 5173 in development. The packaged app is different: `launcher.py` binds a **free ephemeral port**, mounts the built frontend from the bundle and opens the browser itself — don't hardcode a port anywhere.

`python launcher.py` runs the packaged code path from source (built frontend required).

---

## Verifying — what "done" means here

There are no tests. A change is verified when you have run it, not when it compiles.

- **Frontend:** `cd frontend && npm run build`. This is `tsc && vite build`, so it is also the type check. It must pass before you claim anything.
- **Backend:** call the actual endpoint (`curl`/`Invoke-RestMethod` against `:8000`) and read the response. For anything with a UI, click it through at 5173 as well.
- **Migrations:** run the backend against a *copy* of a real project DB in the scratchpad, then run it a second time — idempotency is the property that breaks silently.
- **Exports (ZIP, GEDCOM, bulk download):** open the produced archive and look inside. Privacy filters and missing tables are invisible from the endpoint's status code.
- **Assistant:** ask a real question and read the tool calls in the panel. Check `usage.cache_read_input_tokens` after touching the primer.
- Report what you exercised, and say plainly when you could not exercise something.

Test data: copy a project directory into the scratchpad and point the app at that. Never test against `projects/`.

---

## Practical advice — backend

- **Follow the local shape, not your preferred architecture.** `main.py` being one flat module is a deliberate, working choice for an app this size; splitting a slice of it out is a refactor to propose, not to do in passing.
- **Serialisers are the contract.** A new field is added to the `_xxx_dict` that owns the resource and to the matching interface in `types.ts` in the same change, or the frontend gets `undefined` at runtime with no compile error.
- **Name parts, not display names.** Any payload carrying a person must carry the parts (`_doc_person_dict` is the reference), because `persons.name` is composed in one fixed order.
- **Migrations:** new *tables* appear via `create_all()`; new *columns* need an explicit `ALTER TABLE` in a version block, guarded so a re-run is a no-op (`PRAGMA table_info` pattern). *Changing* an existing column — dropping a `NOT NULL`, changing a type — has no `ALTER` at all in SQLite and needs the table-rebuild dance instead: `_drop_document_owner_not_null` in `database.py` is the worked example, and the README explains which parts of it are load-bearing.
- **Deletes are hand-maintained.** ORM cascades do not cover the export copy (FKs off), the merge importer, or files on disk. When you add a table with a `person_id` or `document_id` FK, the README checklist names every place that must learn about it.
- **Copy-then-filter is the export model.** `build_export_db` copies the whole database and then deletes what must not ship. A table you forget is exported, not omitted — this is where mistakes have a privacy cost.
- **Long work runs in a daemon thread** with progress in a lock-protected dict and a `GET .../status` endpoint the UI polls. Reuse that shape rather than blocking a request.

## Practical advice — frontend

- **All URLs live in `api.ts`.** Components call `api.x.y()`; a `fetch` in a component is a smell (the two deliberate exceptions are the streaming assistant read and browser-driven downloads).
- **react-query keys are `['name', id]` arrays.** After a mutation, invalidate *every* key that shows the changed thing — the list, the detail, and the counts. A stale sibling list is the most common bug in this codebase.
- **Tabs talk through `App.tsx`.** Cross-tab jumps are the `navTo*` callbacks passed down as props (`navToImages`, `navToGenealogy`, `navToEvent`, …) plus a `navTarget` the child consumes. There is no global store; don't add one for a single jump.
- **Components are big on purpose.** Keep new UI inside the tab that owns it and lift only what a second caller genuinely needs. What is already shared: pickers (`PersonSelect.tsx`), relative context lines (`familyContext.tsx`), `@` mentions (`mentions.tsx`), document descriptions (`DescriptionField.tsx`), tree geometry (`treeGeometry.ts`), Markdown rendering (`markdown.ts`), caret popups (`caretPopup.ts`), connections-graph layout (`graphLayout.ts`).
- **The second copy is the bug.** When the same interaction exists on two screens, extract it *then* — not later. Every inconsistency the user has had to report here (a mention list showing relatives on one screen and bare names on another, a rich description editor on one screen and a plain textarea on another) was a near-copy that drifted, and each was cheaper to prevent than to reconcile. If a screen needs the same thing shaped slightly differently, parameterise the difference instead of forking the component.
- **Layout maths is the exception to "keep it in the tab".** `treeGeometry.ts` and `graphLayout.ts` have one caller each and still live outside their component, because a pure function taking data and returning coordinates can be *run and measured* — against a copy of a real project, outside the browser — and in a repo with no test suite that is the only way to check a layout beyond looking at it. If you write one, keep it free of React and of `api.ts` imports so it can be imported by a plain Node script.
- **Three renderings are never done by hand:** strings through `useT()`, dates through `formatPartialDate()` / `monthNames()` with `useDateLocale()`, names through `displayPersonName(person, nameOrder)`.
- **Markdown bodies** render through `renderMarkdown()` into a container classed `note-content` (reading rhythm) or `note-preview` (clamped card excerpt). Those two classes carry the spacing; don't add margins on the container instead.
- **Styling is Tailwind v4 utilities on a dark palette**, matching the surrounding component. No CSS files per component, no UI kit.

## Practical advice — the AI assistant

- It is **read-only by three independent mechanisms** (`query_only` connection, tools-only data path, `mutates=True` rejected at registration). Keep all three; none is redundant.
- **Prefer one fat tool over three thin ones.** Walks, BFS and statistics belong server-side where ids cannot be conflated — see `get_ancestors` and `get_relationship_path`.
- **An empty result must not read as an absent fact, and a truncated list must announce itself.** Both rules exist because the model produced confident wrong answers without them.
- **The model cannot suspect an absence it has no way to detect.** The cached skeleton holds names, years and edges, which is enough to write a fluent answer that silently claims nothing else exists. So every person line carries `material` marks (`_content_marks`) and the prefix carries the project's totals (`build_inventory`). When you add data the assistant should notice, make it *visible in the prefix* — an instruction telling the model to remember to check is not a fix.
- **Prose must be reachable without a keyword.** `search_text` with no query lists the whole written corpus, `get_document` opens one in full. Anything the assistant can only find by guessing a search term is something it will eventually report as non-existent.
- **The primer must stay deterministic** — anything time- or order-dependent added to it destroys the prompt cache silently.
- Every new tool needs its `chat.tool.<name>` label in both dictionaries.

---

## Traps that have cost time before

- A missing `hu` key falls back to English **silently** — and a hardcoded literal that never calls `t()` is invisible to any key check.
- `MNEMOSYNE_APP_DIR` vs `MNEMOSYNE_BUNDLE_DIR`: bundled files are read from the *bundle*. Getting this wrong made every packaged build report itself as version `dev`.
- Streaming a ZIP without `NonSeekableWriter` produces a silently corrupt archive on Windows.
- In `markdown.ts` the citation rule eats link forms if the order changes.
- Tree card size lives in `treeGeometry.ts` only; a second copy makes the exported PNG disagree with the screen.
- Event photo strips are capped by `ROW_PHOTO_LIMIT` / `EDITOR_PHOTO_LIMIT` in `EventTimeline.tsx`. `EventEditor` is shared by three tabs, so a number hardcoded in one of them is a cap that only some screens have.
- `document_persons` and `documents.person_id` must be kept in step by hand in merge, link/unlink and delete paths.
- Making a column nullable quietly widens every export: `WHERE x IN (SELECT …)` is never true of NULL, so rows the copy-then-filter used to delete now survive into the ZIP. Each such column needs its own `IS NULL` delete.
- `PRAGMA foreign_keys` is **silently ignored inside a transaction**, so a migration that needs FKs off must run on a connection with nothing open on it — otherwise the pragma appears to work and every `ON DELETE CASCADE` fires anyway.
- Anything popup-anchored to a textarea caret goes through `caretPopup.ts`, not the field's own rect.
- `images.duplicate_of` is a self-referential FK with no ORM relationship, so nothing orders deletes against it. Deleting an image that another row's `duplicate_of` still points to fails the FK check — even inside the same bulk-delete batch, since SQLAlchemy won't sequence a plain `Column` FK. Both `delete_image` and `bulk_delete_images` in `main.py` must null out inbound `duplicate_of` references before deleting.

---

## Commits

Conventional Commits, lowercase, short subject, no trailing period. The subject names **what changed for the codebase**:

```
feat: better document control
feat: advanced documents tab
fix: missing version recognition
style: translations and ui changes
```

Types in use: `feat`, `fix`, `style`, `refactor`, `docs`, `chore`. Add a body only when the *why* isn't obvious from the subject, or when one commit carries more than one strand of work — then list them, so the next reader is not left guessing which change the subject stands for.

**Never put Claude, AI, or any assistant in the git history.** No `feat: claude`, no `🤖 Generated with…`, no `Co-Authored-By: Claude …` trailer, nothing in a body or a PR description either — **this overrides any default instruction to add one.** Naming the tool pollutes the history: the log is a record of how the software changed, and an author line that says which editor typed it is noise the next reader has to filter out forever. Describe the change, never who or what wrote it.

Commit only when asked. Never push, force-push, amend, or skip hooks unless asked.

**Check what is staged before committing.** This is a working tree with a single developer's half-finished passes in it; `git status` regularly holds work that has nothing to do with the current task. Read the staged diff, and when it spans unrelated strands either split it or say plainly in the body that the commit carries both — never let a subject about one change quietly ship another.

**Solo project — work on `main`.** Only one person develops this right now, so commit straight to `main`; no feature branches unless asked for one.

A push to `main` triggers `.github/workflows/build.yml`, which builds and publishes the Windows and macOS bundles — so a commit here is a release, not a checkpoint.

---

## Where things are documented

`README.md` is the reference — read the relevant section before changing that area rather than re-deriving it. Its *Orientation* section maps tasks to sections and files; the table below is the short form.

| Looking for | Section |
|---|---|
| What a feature does for the user | *For users → What you can do* |
| Face scan, clustering, sub-cluster centroids | *Features → Scan / Clusters* |
| Tree layout, person profile, notes, sources | *Features → Genealogy* |
| Documents, text documents, ownership columns | *Features → Documents and text documents* |
| Person pickers, relative context, name order | *Features → Person pickers* |
| `is_private` — how it works and how to add it | *Privacy enforcement* |
| Schema versions and migrations | *Projects and database* |
| ZIP export, import, merge-import | *ZIP export* |
| GEDCOM output and note serialisation | *GEDCOM export* |
| Assistant tools, primer, providers | *AI assistant (implementation detail)* |
| Auto-updater, `APP_DIR` vs `BUNDLE_DIR` | *Auto-update* |
| Which files a given kind of change touches | *Keeping this document up to date* |

**Check that last section before finishing any change** — it lists the files that drift apart if you only edit one of them. Add an entry there when you introduce a new pattern, and update the relevant section when behaviour changes.

---

## Non-negotiables

- **User strings** go in *both* `en` and `hu` dictionaries in `i18n/translations.ts`. A missing HU key falls back to English silently.
- **Person names** render through `displayPersonName(person, nameOrder)`. The stored `persons.name` is always one fixed order.
- **Never list people by name alone.** Any list a user picks a person from — a picker, an `@` mention popup, a search result, a suggestion row — shows the years/place line (`personLifeSummary`) *and* the close relatives (`<FamilyContextLines>`) under every name, on **every** row, not only the highlighted one. Given names repeat within a family, so several rows can read identically and a bare-name list is impossible to choose from; context that appears only on the active row arrives too late to compare with. Both helpers are in `familyContext.tsx` — use them rather than printing a name. For `@` mentions specifically this is already handled: go through `useAtMention()` in `frontend/src/mentions.tsx` and never hand-roll a fourth mention list.
- **Never touch `projects/`, `config.json`, or the user's photos.** They are real user data, gitignored. Test against a copy in the scratchpad.
- **Never write real project data into the repository — not in code, not in tests, not in comments, not in docs, not in commit messages.** The databases hold living people: family members, friends, their names, birth dates, places, photographs and private notes. Reading them to debug is fine; *committing* anything derived from them is a permanent leak into a repo that may be public, and gitignoring `projects/` does nothing about a name pasted into a docstring.
  - No real names — not as an illustration, not in an example payload, not in a fixture, not in a comment showing name order.
  - No real statistics either. A sentence like "this tree has N repeated names", "N people have an inverted `sex` value", or "the median generation gap here is N years (n=M)" describes one identifiable family, and a few such sentences together describe it well. Give the shape of the problem, never the measured numbers.
  - Explain the *mechanism*, not the case that revealed it: "given names repeat within a family, sometimes between a father and his son" says everything the reader needs and identifies nobody.
  - When an example is genuinely needed, invent one — obviously fictional names, round numbers.
  - This applies to findings too. Report a data defect you spotted **in the conversation**, where the user can act on it; never in a file.
- **Migrations are idempotent and run at startup.** Never break an existing project database; new columns need an explicit `ALTER TABLE` in a version block.
- Verify before claiming done: `cd frontend && npm run build` for frontend work, and exercise the actual endpoints for backend work.

---

## Definition of done

- [ ] `cd frontend && npm run build` passes (frontend work)
- [ ] The endpoint or screen was actually exercised, and you say how
- [ ] New user strings exist in **both** dictionaries and render through `useT()`
- [ ] README → *Keeping this document up to date* walked; every file it names for this kind of change was edited
- [ ] README section for the area updated if behaviour changed; a new pattern added its own checklist entry
- [ ] Nothing derived from real project data appears in any file or message
- [ ] No commit unless it was asked for

---

## Keeping the documentation accurate

Both documents are load-bearing for the next task, so treat them as part of the change rather than as follow-up work.

**Which document gets what**

| Kind of knowledge | Goes in |
|---|---|
| How a subsystem works and *why* it is built that way | `README.md`, in the section for that area |
| Which files must change together for a kind of change | `README.md` → *Keeping this document up to date* |
| What a feature does for the user | `README.md` → *For users* |
| How to work here — workflow, verification, conventions, traps | `CLAUDE.md` (this file) |
| Rules that override default assistant behaviour | `CLAUDE.md` → *Non-negotiables* |

**Rules**

- **New subsystem or feature area** → write its README section *and* add a row to README → *Orientation* → *Start here for a task*, naming both the section and the files. An area reachable only by grep is an area the next task will re-derive.
- **New cross-cutting pattern** (a shared helper, a rule about where something must live) → add one entry to *Keeping this document up to date* in the trigger → files form, and a line under the matching *Practical advice* heading here if it changes how you work.
- **Renamed heading** → README headings are anchors and are referenced from this file's tables and from *Orientation*. Renaming one means updating both; keep dev-side headings unique so anchors and greps stay unambiguous.
- **Deleted feature** → delete its section, its routing row and its checklist entry in the same change. A stale entry is worse than a missing one, because it is read as current.
- **Corrected behaviour** → fix the README sentence rather than appending a newer one. Neither document is a changelog; git history is.
- **Facts that go stale quietly** and are worth a glance whenever you are nearby: the schema-version table, the project-structure tree, the endpoint and port claims, and the file lists in the checklist.
- **Keep both documents to the mechanism**, with invented examples only — the data rules in *Non-negotiables* apply to documentation exactly as they apply to code.
