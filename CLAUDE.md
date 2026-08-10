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

**Solo project — work on `main`.** Only one person develops this right now, so commit straight to `main`; no feature branches unless asked for one.

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
- **Never write real project data into the repository — not in code, not in tests, not in comments, not in docs, not in commit messages.** The databases hold living people: family members, friends, their names, birth dates, places, photographs and private notes. Reading them to debug is fine; *committing* anything derived from them is a permanent leak into a repo that may be public, and gitignoring `projects/` does nothing about a name pasted into a docstring.
  - No real names — not as an illustration, not in an example payload, not in a fixture, not in a comment showing name order.
  - No real statistics either. A sentence like "this tree has N repeated names", "N people have an inverted `sex` value", or "the median generation gap here is N years (n=M)" describes one identifiable family, and a few such sentences together describe it well. Give the shape of the problem, never the measured numbers.
  - Explain the *mechanism*, not the case that revealed it: "given names repeat within a family, sometimes between a father and his son" says everything the reader needs and identifies nobody.
  - When an example is genuinely needed, invent one — obviously fictional names, round numbers.
  - This applies to findings too. Report a data defect you spotted **in the conversation**, where the user can act on it; never in a file.
- **Migrations are idempotent and run at startup.** Never break an existing project database; new columns need an explicit `ALTER TABLE` in a version block.
- Verify before claiming done: `cd frontend && npm run build` for frontend work, and exercise the actual endpoints for backend work.
