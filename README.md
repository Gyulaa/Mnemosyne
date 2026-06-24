# Photo Organizer

Arcfelismerésen alapuló fotórendező alkalmazás. Beolvassa a képtáradat, automatikusan
detektálja és klaszterezi az arcokat, te pedig neveket rendelhetsz a személyekhez —
az elnevezési munkád megmarad az újraklaszterezések között.

## Funkciók

- Arcdetektálás és ArcFace embedding (insightface `buffalo_l` modell)
- DBSCAN klaszterezés, centroid-alapú személyfelismeréssel
- Manuális szerkesztés: átnevezés, összevonás, törlés, ismeretlen arcok hozzárendelése
- HEIC/HEIF támogatás (iPhone fotók)
- Folytatható szkennelés — megszakítás után onnan folytatja, ahol abbahagyta

## Előfeltételek

| Eszköz | Minimális verzió |
|--------|-----------------|
| Python | 3.11+ |
| Node.js | 18+ |
| Git | bármely |

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
# Virtuális környezet létrehozása
python -m venv .venv

# Aktiválás
.venv\Scripts\activate          # Windows
source .venv/bin/activate       # macOS / Linux

# Függőségek telepítése
pip install -r requirements.txt
```

### 2. Frontend

```bash
cd frontend
npm install
cd ..
```

## Indítás

Minden használat előtt két terminált kell nyitni a projekt gyökerében.

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
2. Kattints a **Start scan** gombra
3. Az első szkenneléskor az insightface letölti a `buffalo_l` modellt (~300 MB, egyszeri)
4. Szkennelés után a **Run clustering** gombbal klaszterezhetsz
5. A **Clusters** fülön elnevezheted a személyeket, összevonhatsz clustereket,
   és az ismeretlen arcokat hozzárendelheted meglévő vagy új clusterekhez

> A forrás fotóidat az alkalmazás **soha nem módosítja** — csak olvassa őket.

## Adatbázis

Az összes adat (embeddingek, clusterek, nevek) a projekt gyökerében lévő
`photo_organizer.db` SQLite fájlban tárolódik. Ez **nincs** a git repositoryban —
minden gép a saját szkennelését végzi.

A forrás képek elérési útjai is az adatbázisban tárolódnak, ezért ha a fotóidat
áthelyezed, újra kell szkennelni.

## Projekt struktúra

```
Image-Organizer/
├── backend/
│   ├── main.py          # FastAPI app, REST API végpontok
│   ├── scanner.py       # Háttérben futó, folytatható fájlszkenner
│   ├── clusterer.py     # DBSCAN + centroid-alapú klaszterezés
│   ├── database.py      # SQLAlchemy modellek, SQLite
│   ├── image_utils.py   # Képbetöltés, HEIC-konverzió, thumbnail-vágás
│   └── schemas.py       # Pydantic request/response modellek
├── frontend/
│   └── src/
│       ├── App.tsx
│       ├── api.ts        # Összes API-hívás egy helyen
│       ├── types.ts
│       └── components/
│           ├── ScanTab.tsx
│           ├── ClustersTab.tsx
│           └── FolderPicker.tsx
├── requirements.txt
└── photo_organizer.db   # ← gitignore-ban van, automatikusan jön létre
```
