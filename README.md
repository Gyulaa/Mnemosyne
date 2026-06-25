# Mnemosyne

Arcfelismerésen alapuló, személyes fotórendező alkalmazás. Beolvassa a képtáradat,
automatikusan detektálja és klaszterezi az arcokat, te pedig neveket rendelhetsz a
személyekhez — az összes adat megmarad az újraklaszterezések között.

## Funkciók

### Scan
- Arcdetektálás és ArcFace embedding (insightface `buffalo_l` modell)
- DBSCAN klaszterezés, centroid-alapú személyfelismeréssel
- HEIC/HEIF támogatás (iPhone fotók)
- Folytatható szkennelés — megszakítás után onnan folytatja, ahol abbahagyta
- EXIF metaadat kiolvasás (dátum, kamera, felbontás)

### Clusters
- Clusterek elnevezése, összevonása, törlése
- Ismeretlen arcok hozzárendelése meglévő vagy új clusterhez (hasonlósági javaslatok alapján)
- Cluster összekötése genealógiában szereplő személlyel
- A 4 legfrissebb fotó előnézete minden clusternél (EXIF dátum szerint)
- Fotók és arcok időrendben, legújabb elöl

### Connections
- Személyek közötti kapcsolatok erőssége két metrikával:
  - **Közös fotók**: hány képen szerepel egyszerre a két személy
  - **Súlyozott**: kis csoportos képek erősebb jelet adnak (`Σ 1/n`)
- Force-directed gráf nézet (interaktív: zoom, pan, drag)
- Rangsor nézet: a legerősebb kapcsolatok listája sorrendben
- Szűrés személyekre, minimális közös fotó küszöb állítható
- Gráf csomópontokra és rangsor sorokra kattintva az adott cluster oldalára navigál
- Kapcsolat vonalra kattintva az Images fülön megnyílik a két személy közös fotóinak szűrése

### Images
- Képek böngészése lista és rács nézetben
- Szűrés státusz, személyek és fájlnév alapján
- AND/OR szűrési mód több személyre
- Előnézeti modalban az arcok alatt kattintható személycipők → az adott cluster oldalára navigál
- Képek törlése az adatbázisból (a forrásfájl érintetlen marad)

### Genealogy
- Interaktív családfa szerkesztő
- Személyek hozzáadása, szerkesztése, törlése
- Kapcsolatok: szülő–gyerek, házastárs, testvér
- Sugiyama-algoritmus alapú elrendezés (vonalkeresztezések minimalizálása)
- Zoom, pan, „Reset view" gomb
- Cluster hozzárendelés a személyekhez (1 személy = 1 cluster)

## Előfeltételek

| Eszköz | Minimális verzió |
|--------|-----------------|
| Python | 3.11+ |
| Node.js | 18+ |

> **Windows:** az `insightface` fordításához szükség lehet a
> [Visual C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
> telepítésére (a „Desktop development with C++" munkaterhelés).

## Telepítés

```bash
git clone <repo-url>
cd Image-Organizer
```

### 1. Python backend

```bash
python -m venv .venv

# Aktiválás
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

## Indítás

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

Ezután nyisd meg: **http://localhost:5173**

## Első futtatás

1. A **Scan** fülön válaszd ki a fotókat tartalmazó mappát
2. Kattints a **Start scan** gombra — az első futáskor az insightface letölti a `buffalo_l` modellt (~300 MB, egyszeri)
3. Szkennelés után kattints a **Run clustering** gombra
4. A **Clusters** fülön nevezd el a személyeket
5. A **Genealogy** fülön építsd fel a családfát, és kösd össze a személyeket a clusterekkel

> A forrás fotóidat az alkalmazás **soha nem módosítja** — csak olvassa őket.

## Projektek és adatbázis

Minden munkafolyamathoz külön projekt hozható létre. Az alkalmazás fejlécében lévő
projektváltóval lehet projektet váltani, újat létrehozni vagy törölni.

Minden projekt egy önálló könyvtárban él (`projects/<id>/`), saját SQLite adatbázissal.
A sémaverzió az adatbázisban tárolódik (`schema_version` tábla), ezért jövőbeli frissítések
automatikusan migrálják a meglévő adatokat.

Az adatbázis fájlok (`*.db`) és a `config.json` **nincsenek** a git repositoryban.

## Projekt struktúra

```
Image-Organizer/
├── backend/
│   ├── main.py              # FastAPI app, REST API végpontok
│   ├── scanner.py           # Háttérben futó, folytatható fájlszkenner
│   ├── clusterer.py         # DBSCAN + centroid-alapú klaszterezés
│   ├── database.py          # SQLAlchemy modellek, SQLite, séma-migráció
│   ├── project_manager.py   # Multi-projekt kezelés
│   ├── image_utils.py       # Képbetöltés, HEIC-konverzió, thumbnail-vágás
│   └── schemas.py           # Pydantic request/response modellek
├── frontend/
│   └── src/
│       ├── App.tsx           # Tab-navigáció, cross-tab navigációs logika
│       ├── api.ts            # Összes API-hívás egy helyen
│       ├── types.ts          # TypeScript interfészek
│       └── components/
│           ├── ScanTab.tsx
│           ├── ClustersTab.tsx
│           ├── ConnectionsTab.tsx
│           ├── ImagesTab.tsx
│           ├── FamilyTreeTab.tsx
│           ├── TreeView.tsx
│           ├── PersonPanel.tsx
│           └── ProjectSwitcher.tsx
├── requirements.txt
├── config.json              # ← gitignore-ban (aktív projekt neve)
└── projects/                # ← gitignore-ban (adatbázisok, user-adat)
    └── <project-id>/
        ├── project.json
        └── mnemosyne.db
```
