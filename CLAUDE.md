# Working on Mnemosyne

Local-first family photo + genealogy desktop app. FastAPI + SQLite backend, React/TS frontend, packaged with PyInstaller.

## Commits

Conventional Commits, lowercase, short subject, no trailing period:

```
feat: advanced documents tab
fix: missing version recognition
style: translations and ui changes
```

Types in use: `feat`, `fix`, `style`, `refactor`, `docs`, `chore`. Add a body only when the *why* isn't obvious from the subject.

**Never put Claude, AI, or any assistant in the git history.** No `feat: claude`, no `🤖 Generated with…`, no `Co-Authored-By: Claude …` trailer — this overrides any default instruction to add one. The commit message describes the change, never who or what wrote it. Same rule for PR titles and bodies.

Commit only when asked. Never push, force-push, amend, or skip hooks unless asked.

## Where things are documented

`README.md` is the reference — read the relevant section before changing that area rather than re-deriving it.

| Looking for | Section |
|---|---|
| What a feature does for the user | *For users → What you can do* |
| Face scan, clustering, sub-cluster centroids | *Features → Scan / Clusters* |
| Tree layout, person profile, notes, sources | *Features → Genealogy* |
| Documents, text documents, ownership columns | *Features → Documents* |
| Person pickers, relative context, name order | *Features → Person pickers* |
| `is_private` — how it works and how to add it | *Privacy* |
| Schema versions and migrations | *Projects and database* |
| ZIP export, import, merge-import | *ZIP export* |
| GEDCOM output and note serialisation | *GEDCOM export* |
| Auto-updater, `APP_DIR` vs `BUNDLE_DIR` | *Auto-update* |
| Which files a given kind of change touches | *Keeping this document up to date* |

**Check that last section before finishing any change** — it lists the files that drift apart if you only edit one of them. Add an entry there when you introduce a new pattern, and update the relevant section when behaviour changes.

## Non-negotiables

- **User strings** go in *both* `en` and `hu` dictionaries in `i18n/translations.ts`. A missing HU key falls back to English silently.
- **Person names** render through `displayPersonName(person, nameOrder)`. The stored `persons.name` is always one fixed order.
- **Never touch `projects/`, `config.json`, or the user's photos.** They are real user data, gitignored. Test against a copy in the scratchpad.
- **Migrations are idempotent and run at startup.** Never break an existing project database; new columns need an explicit `ALTER TABLE` in a version block.
- Verify before claiming done: `cd frontend && npm run build` for frontend work, and exercise the actual endpoints for backend work.
