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
| REST API | `backend/main.py` (~160 endpoints, one flat module) | Endpoints are grouped by resource in file order. New ones go next to their siblings — no new routers |
| Serialisation | `_person_dict`, `_doc_dict`, `_event_dict`, … in `main.py` | Every response funnels through one of these. Add a field there, never ad-hoc inside an endpoint |
| Schema | `backend/database.py` | SQLAlchemy models + `schema_version` + idempotent startup migrations (currently v17) |
| Projects | `backend/project_manager.py` | One SQLite DB per project; `get_db()` read-write, `get_readonly_db()` for the assistant |
| Long jobs | `backend/scanner.py`, `backend/updater.py`, `backend/maintenance.py` | Daemon threads + a module-level state dict behind a lock, polled over HTTP |
| Pipelines | `export_utils.py`, `merge_import.py`, `gedcom_*.py` | Copy-then-filter; the filters are hand-maintained and forgetting one leaks data |
| Assistant | `backend/ai/` | Read-only tool use over SQL, opt-in, off without an API key |
| Document reading | `ai/doc_reader.py`, `transcriber.py` | Scans → transcripts → a triage report. Its own opt-in, its own model, its own page budget. One document can also be read on its own from the viewer and from the edit modal (`DocumentReadButton.tsx` in both) — same `read_file`, but the text is appended to the document's description rather than stored as a transcript |
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
- **Migrations:** new *tables* appear via `create_all()`; new *columns* need an explicit `ALTER TABLE` in a version block, guarded so a re-run is a no-op (`PRAGMA table_info` pattern). *Changing* an existing column — dropping a `NOT NULL`, changing a type — has no `ALTER` at all in SQLite and needs the table-rebuild dance instead: `_drop_document_owner_not_null` in `database.py` is the worked example, and the README explains which parts of it are load-bearing. **Where a rebuild helper can decline** — no table yet, a stored DDL it does not recognise — guard the block on the *column* rather than on the version, as the v16→v17 block does. A version bump sitting beside a helper that quietly did nothing records success anyway, and a version-only check never looks at that database again.
- **Deletes are hand-maintained.** ORM cascades do not cover the export copy, the merge importer, or files on disk. The export copy is a raw `sqlite3` connection with foreign keys **on** and a schema whose FKs disagree — some cascade, some set null, some declare nothing — so children go first, through `_delete_documents()` / `_delete_document_children()` / `_delete_relation_citations()` rather than a hand-written order at the call site. When you add a table with a `person_id` or `document_id` FK, the README checklist names every place that must learn about it.
- **Copy-then-filter is the export model.** `build_export_db` copies the whole database and then deletes what must not ship. A table you forget is exported, not omitted — this is where mistakes have a privacy cost.
- **Long work runs in a daemon thread** with progress in a lock-protected dict and a `GET .../status` endpoint the UI polls. Reuse that shape rather than blocking a request.

## Practical advice — frontend

- **All URLs live in `api.ts`.** Components call `api.x.y()`; a `fetch` in a component is a smell (the two deliberate exceptions are the streaming assistant read and browser-driven downloads).
- **react-query keys are `['name', id]` arrays.** After a mutation, invalidate *every* key that shows the changed thing — the list, the detail, and the counts. A stale sibling list is the most common bug in this codebase.
- **Tabs talk through `App.tsx`.** Cross-tab jumps are the `navTo*` callbacks passed down as props (`navToImages`, `navToGenealogy`, `navToEvent`, …) plus a `navTarget` the child consumes. There is no global store; don't add one for a single jump.
- **Components are big on purpose.** Keep new UI inside the tab that owns it and lift only what a second caller genuinely needs. What is already shared: pickers (`PersonSelect.tsx`), relative context lines (`familyContext.tsx`), `@` mentions and one-line mention fields (`mentions.tsx`), document **and event** descriptions (`DescriptionField.tsx`, parameterised by owner), tree geometry (`treeGeometry.ts`), Markdown rendering (`markdown.ts`), caret popups (`caretPopup.ts`), connections-graph layout (`graphLayout.ts`).
- **Prefer the field that already exists to a new one beside it.** Text produced *about* a document belongs in its description, not in a field of its own: the description is already editable with mentions and citations, already searched, already exported, and `ai/tools.py`'s `_doc_dict` hands the assistant the whole of it with every document it lists. A parallel field buys nothing and creates two things that must be kept in step — the same failure as the second copy below, one layer down. `DocumentReadButton.tsx` is the worked example: the vision reading is appended to the description, and `transcript_pages` stays the batch reader's alone.
- **The second copy is the bug.** When the same interaction exists on two screens, extract it *then* — not later. Every inconsistency the user has had to report here (a mention list showing relatives on one screen and bare names on another, a rich description editor on one screen and a plain textarea on another) was a near-copy that drifted, and each was cheaper to prevent than to reconcile. If a screen needs the same thing shaped slightly differently, parameterise the difference instead of forking the component.
- **Layout maths is the exception to "keep it in the tab".** `treeGeometry.ts` and `graphLayout.ts` have one caller each and still live outside their component, because a pure function taking data and returning coordinates can be *run and measured* — against a copy of a real project, outside the browser — and in a repo with no test suite that is the only way to check a layout beyond looking at it. If you write one, keep it free of React and of `api.ts` imports so it can be imported by a plain Node script.
- **A text field whose values repeat is `VocabInput`, not an `<input>` or a `datalist`.** Occupation, religion, nationality, education, cause of death and title already are; which columns count is a registry (`FIELD_SOURCES` in `backend/field_values.py`), and the frontend never names a column. `SuggestInput` is the **one** dropdown implementation — `PlaceInput` and `VocabInput` are wrappers that supply options and row decoration and nothing else. Do not register names or event titles: a name field is not a vocabulary, and offering existing people while a new person is being typed invites picking the wrong one.
- **A place field is `PlaceInput`, never a bare `<input>`.** It offers what the project already uses, so the same village stops accumulating a spelling per typist. The comma levels (`house number, settlement, region, country`) are split **server-side** in `backend/places.py` and arrive already divided — never parse a place string in a component, and never add a place column without adding it to `PLACE_COLUMNS`.
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
- **If an answer names something, opening it must not destroy the answer.** Batch questions started in component state; every answer names pages, and clicking one unmounted the panel and lost the conversation. Anything whose output invites navigation keeps its state where the navigation cannot reach it — here, on the batch (`transcript_questions`).
- **A question about working state is scoped to that state.** Batch questions (`answer_about_batch`, `POST .../batches/{id}/ask`) reach one batch's transcripts plus the project's read-only tools, and are asked from the reading screen. Do not put un-imported transcripts into the assistant's always-on corpus: the export deletes them, so a folder the user may discard would otherwise colour every unrelated answer. Both callers share `_run_agent` — add a third caller there, never by copying the loop.
- **Reading a file is not a chat tool.** Transcribing a scan happens once, out of band, and is stored as text (`transcript_pages`); the assistant then reads the *transcript* through the paths it already has. Putting the image in the conversation instead would mean widening the provider seam's text-only message shape in both adapters and re-sending the page on every turn.
- **A new payload type needs its own consent, not a new mode of an existing one.** `document_ai` is a third `config.json` block beside `ai` and `web_research` because sending photographs of documents is a different disclosure from sending a tree summary — with its own toggle, its own model choice, its own budget in `try_consume_doc_page`, and its own disclosure in `AssistantSetup.tsx`.
- **Ranking and matching stay in Python.** `_match_page` in `transcriber.py` scores pages against the tree in code and the model is told not to revise the marks — the same reason `get_ancestors` walks the line server-side. A name match whose year falls outside the person's lifespan is *demoted with a note*, never dropped: a same-name collision is information.
- **A tool with an external network dependency** (`ai/web_tools.py`'s `search_web`/`read_web_page`) is a second, independent opt-in from the assistant itself — its own `config.json` block, its own consent disclosure in `AssistantSetup.tsx`, its own quota enforced inside the handler (never as a prompt instruction alone), and its tool *definitions* withheld from the model entirely when off. Don't fold a network-dependent tool into `tools.py`'s always-on `REGISTRY`.

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
- Latin registers decline names, so a faithful transcript returns `Stephani`, not `Stephanus` — and the tree holds `István` anyway. The prompt asks for the nominative and does not reliably get it (the first real run returned one name nominative and two genitive off the same page); the matching therefore expands both sides in code, in `_given_variants` in `transcriber.py`. Case endings are undone on **given names only** — a Hungarian surname ending in `-i` is a place-name suffix, and stripping it wrecks the name.
- On a reasoning model the thinking is charged against the **same** output ceiling as the answer, so a budget sized for the answer returns an empty string with `finish_reason: "length"` — a failure that arrives looking like a success. `doc_reader.MAX_OUTPUT_TOKENS` is deliberately an order of magnitude above the transcript size, and both adapters turn a cut-off empty answer into an explicit error rather than reporting nothing.
- **A provider quirk is learned from the refusal, not declared in a manifest.** Some reasoning models reject `reasoning_effort` on `/v1/chat/completions` when the request *also* carries function tools — it breaks the batch report and not transcription, and no capability flag describes it because the model does support both separately. `OpenAICompatProvider` sends the request, believes the 400, retries with `reasoning_effort="none"` — **set, not removed**: dropping it returns the same 400, because these models do not default to no reasoning — and remembers the id in `_NO_EFFORT_WITH_TOOLS` for the process. Do not put the id in `models.json`. Read what the error asks for; it names the value it wants.
- **Never write a model list into a file.** `models.json` holds providers, family-level capability rules and prices — no model ids beyond `default_model` and the price table. The picker asks the provider. A curated "best model" list is wrong the day the next one ships and then argues with the live list beside it; the same goes for any `note` that ranks rather than describes.
- **Perception jobs go to the document reader, text jobs to the assistant** (`_text_job_settings`). Reading handwriting and writing prose are chosen for different reasons and the user configures them separately.
- **Markdown escapes what it thinks is code, including your injected anchors.** A line indented four spaces past its surroundings becomes `<pre><code>`, so a model that over-indented one continuation line produced person references rendering as literal `<a href=…>` text. Indented code blocks are switched off in `markdown.ts`; fenced blocks still work. Never assume HTML injected before a Markdown parse survives it.
- **An age in a record is evidence; a lifespan is barely any.** `_age_check` turns a stated age plus the entry's year into an implied birth year and compares it with the recorded one — agreement dates the match, a large gap rules it out, and a gap of two or three years settles **nothing**, because register ages are approximate. Do the arithmetic in Python and hand the model the answer; never ask a prompt to do sums it will do differently each run.
- **The index is not the document.** A precomputed table of names and dates is for *finding*; anything writing about a record must be given the record. Excerpting transcripts to 400 characters produced a report that was accurate about names and blind to what the entries said — and where a corpus is too large to send whole, give the model a tool to open a page (`read_page`) rather than a smaller slice of it.
- **A page is not a record.** A register page holds many entries; anything that pairs two people on a page must first establish they are in the *same* entry, or it invents relationships out of unrelated lines. The boundary is read from the **transcript** (`_entry_blocks` cuts on the register's own line numbering, `_place` puts a person in an entry when both parts of their name are written inside it) — not from a number the extraction supplies, which exists only for pages read after the question was added and can be checked against nothing. `_corroborating_relation` refuses to pair across entries and refuses entirely where either person cannot be placed. An entry is also the unit a match is *dated* against: a page spanning eight years lends all eight to everyone on it.
- **The extraction is an index of the page, not the page.** It stays for the two things it alone can do — assembling a name out of a ruled table's separate columns, and saying which role a name plays — and is not the source of anything else. Names are also swept out of the transcript directly, and the row handed to the report carries no `kind`/`date`/`place`/person list: beside a full transcript an index reads as a summary of it, and where the two disagree the short definite one wins.
- **No amount of name agreement is evidence of identity.** Surnames repeat across a village, given names within a family. In `transcriber.py` the top relevance rung is reachable only through `_corroborating_relation` — two names in roles that assert a relationship the tree already records. Dates can only ever get a page to the middle rung.
- **Don't spend money on a side effect.** The batch report is a paid call and runs only when the user presses the button; the free matching pass runs after every transcription because it is what they need in order to decide whether the paid one is worth it.
- **Absence of evidence is not evidence.** A name match with no date to check it against is a *candidate*, never a find — scoring "nothing contradicts this" as agreement is what put an 1860s record under an identification of a man born in 1920. The same bug twice over: `_page_years` also had to stop trusting the extraction's empty `date` field and read the transcript.
- **Where a model must not re-rank, hand it groups, not a sortable field.** `_capped_rows` returns a dict keyed by evidence level because a flat list with a `relevance` column got silently re-sorted.
- **A prompt instruction is not a mechanism.** Where correctness depends on a shape, normalise or enforce it in code and let the prompt merely help. This is the same rule as `try_consume_doc_page` for quota and `_match_page` for ranking; it applies to output shape too.
- `transcript_pages.document_id` is `ON DELETE SET NULL`, and `Document.transcript` is a `viewonly` relationship, so deleting a document leaves the transcript alive and the page importable again. Making that relationship writable, or the FK a cascade, silently destroys work the user may have corrected by hand.
- **The `ON DELETE CASCADE` in `database.py`'s `CREATE TABLE IF NOT EXISTS` block is not what the database has.** `init_db_schema` runs `create_all()` *first*, so tables that also exist as models (`events`, `event_persons`, `event_images`) are built from the models — which declare no `ondelete` — and the `IF NOT EXISTS` statements below never fire. Read the real schema with `PRAGMA foreign_key_list(<table>)` on a copy before trusting a cascade. Raw SQL deleting an event therefore has to clear `event_images` by hand, and because these cleanups run *after* the request's main `commit()`, the constraint failure arrives as a 500 on a delete that already happened — it reads as "deleting is broken", not as "cleanup is broken".
- **A project database is three files, and copying one of them lies.** The DBs run in WAL mode, so recent writes — including a migration that just ran — live in `photo_organizer.db-wal` until a checkpoint folds them in. Copying only `photo_organizer.db` to the scratchpad therefore hands you a *stale* schema, and every `PRAGMA` you then run describes a database that no longer exists. This reads exactly like a migration that failed: the version is current, the column is not. Copy `photo_organizer.db*` — all three — or open the original read-write so SQLite reads the WAL.
- **A generated script is read back in the platform's encoding, not the one you wrote it in.** `cmd.exe` parses a `.bat` in the console **OEM** code page (cp852 on a Hungarian Windows) while Python's `write_text` produces UTF-8. An install path with one accented character therefore turned the updater's `%APP%` into a *different, non-existent* directory — and robocopy does not object to that, it **creates** it, copies the new build in, exits 3 and reports success. Pass variable text to a generated script as **arguments** (they go through `CreateProcessW` as Unicode) and keep the file itself pure ASCII. This applies to any file a platform tool reads back, not only batch files.
- **A tool's default retry policy can turn a failure into a hang.** `robocopy`'s built-in defaults are `/R:1000000 /W:30` — one locked file and it retries for weeks rather than failing. Always set `/R` and `/W`, and always read the exit code (`< 8` success, `>= 8` at least one file not copied). The same instinct applies elsewhere: check what a CLI does when it *cannot* do the job, not only what it prints when it can.
- **An operation that cannot report back needs a breadcrumb, not optimism.** The updater script runs after the process that launched it is gone, so nothing it does can reach `_state`. It writes `result.txt`, the *next* start reads it (`check_install_result`), and a mismatch surfaces as `install_failed` in the UI. Without that, a failed update is indistinguishable from never having tried: the app restarts on the old version, finds the same release, and offers it again forever while the user re-downloads 160 MB each round. Any fire-and-forget step that outlives the process needs the same shape.
- **Don't wait a fixed number of seconds for another process to die — wait for its pid.** The updater slept 3 s while the app exited after 1 s; two seconds of margin on a machine with a virus scanner is not a margin. And when a copy replaces files a running process holds, a partial copy is the dangerous outcome: `_internal/version.txt` is written *last*, so the stamp the app reads can never say "installed" while the binary is still the old one.
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
| Place names, autocomplete, the place hierarchy | *Features → Places* |
| A field that should suggest earlier values | *Features → Suggesting what the project already uses* |
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
- [ ] A new table that is working state (not project content) is deleted in `build_export_db` by default; any way to keep it is an explicit flag defaulting to off (`include_scans` is the one)
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
