import numpy as np
from sklearn.preprocessing import normalize
from sklearn.cluster import DBSCAN
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from .database import Face, Cluster, Person, PersonSubcluster

# Minimum number of faces a sub-cluster must contain to be used as a
# matching prototype. Below this threshold the centroid is too noisy.
MIN_SUBCLUSTER_SUPPORT = 5

# Tighter epsilon for internal per-person sub-clustering.
# We know all faces belong to the same person, so we want finer granularity.
SUBCLUSTER_EPS = 0.30


# ── Sub-cluster management ────────────────────────────────────────────────────

def recompute_person_subclusters(person_id: int, db: Session) -> None:
    """Run DBSCAN on all faces of a named person and store sub-cluster centroids.

    Called after any operation that changes which faces belong to a person
    (link, rename, merge). The results are used by the next run_clustering call
    to improve centroid-matching across age-spanning face sets.
    """
    db.query(PersonSubcluster).filter(PersonSubcluster.person_id == person_id).delete()

    faces = (
        db.query(Face)
        .options(joinedload(Face.image))
        .join(Cluster, Face.cluster_id == Cluster.id)
        .filter(Cluster.person_id == person_id, Face.embedding != None)
        .all()
    )

    if len(faces) < MIN_SUBCLUSTER_SUPPORT:
        db.commit()
        return

    embs = np.array([np.frombuffer(f.embedding, dtype=np.float32) for f in faces])
    embs_norm = normalize(embs, norm="l2")

    labels = DBSCAN(
        eps=SUBCLUSTER_EPS,
        min_samples=MIN_SUBCLUSTER_SUPPORT,
        metric="cosine",
        n_jobs=-1,
    ).fit_predict(embs_norm)

    for label in set(labels):
        if label == -1:
            continue
        mask = labels == label
        count = int(mask.sum())
        if count < MIN_SUBCLUSTER_SUPPORT:
            continue

        sub_embs = embs_norm[mask]
        centroid = np.mean(sub_embs, axis=0)
        norm = np.linalg.norm(centroid)
        if norm > 0:
            centroid /= norm

        sub_faces = [faces[i] for i in range(len(faces)) if mask[i]]
        years = [f.image.exif_date.year for f in sub_faces if f.image and f.image.exif_date]
        year_min = min(years) if years else None
        year_max = max(years) if years else None

        db.add(PersonSubcluster(
            person_id=person_id,
            centroid=centroid.astype(np.float32).tobytes(),
            face_count=count,
            year_min=year_min,
            year_max=year_max,
        ))

    db.commit()


def recompute_all_person_subclusters(db: Session) -> None:
    """Recompute sub-clusters for every named person. Called after run_clustering."""
    person_ids = [
        row[0] for row in
        db.query(Person.id).filter(Person.name != None).all()
    ]
    for pid in person_ids:
        recompute_person_subclusters(pid, db)


# ── Centroid computation for matching ────────────────────────────────────────

def _compute_matching_prototypes(
    db: Session,
    face_id_to_idx: dict,
    embeddings_norm: np.ndarray,
) -> list[tuple[int, np.ndarray]]:
    """Return (person_id, centroid) pairs for every named person.

    For persons that have computed sub-clusters (i.e. enough faces to form
    reliable age-range prototypes), one entry per sub-cluster is returned —
    giving finer-grained matching that is robust to temporal embedding drift.

    For persons without sub-clusters (too few faces), a single averaged
    centroid is returned as a fallback (same behaviour as before).
    """
    prototypes: list[tuple[int, np.ndarray]] = []
    persons_with_subs: set[int] = set()

    # Load all trusted sub-cluster centroids
    subclusters = db.query(PersonSubcluster).all()
    for sc in subclusters:
        centroid = np.frombuffer(sc.centroid, dtype=np.float32).copy()
        prototypes.append((sc.person_id, centroid))
        persons_with_subs.add(sc.person_id)

    # Single-centroid fallback for persons not yet covered by sub-clusters
    persons = db.query(Person).filter(Person.name != None).all()
    for person in persons:
        if person.id in persons_with_subs:
            continue
        embs = []
        for cluster in person.clusters:
            for face in cluster.faces:
                if face.id in face_id_to_idx:
                    embs.append(embeddings_norm[face_id_to_idx[face.id]])
        if embs:
            centroid = np.mean(embs, axis=0)
            norm = np.linalg.norm(centroid)
            if norm > 0:
                centroid /= norm
            prototypes.append((person.id, centroid))

    return prototypes


# ── Main clustering entry point ───────────────────────────────────────────────

def run_clustering(db: Session, eps: float = 0.4, min_samples: int = 2, min_det_score: float = 0.0) -> dict:
    # ── Phase 1: Collect faces ────────────────────────────────────────────────
    all_faces = db.query(Face).filter(Face.embedding != None).all()
    if min_det_score > 0:
        all_faces = [f for f in all_faces if f.det_score >= min_det_score]
    if not all_faces:
        return {"faces": 0, "clusters": 0, "noise": 0}

    all_embs = np.array([np.frombuffer(f.embedding, dtype=np.float32) for f in all_faces])
    all_embs_norm = normalize(all_embs, norm="l2")
    face_id_to_idx = {f.id: i for i, f in enumerate(all_faces)}

    # ── Phase 2: Separate pinned from active faces ────────────────────────────
    # Pinned = any face already in a non-noise cluster.
    # Re-clustering only touches unclassified (noise / null) faces so that
    # imported or previously-organised clusters are never disturbed.
    noise_cluster = db.query(Cluster).filter(Cluster.label == -1).first()
    noise_cid = noise_cluster.id if noise_cluster else None

    pinned: dict[int, int] = {}  # face.id -> cluster_id
    active_faces: list[Face] = []

    for f in all_faces:
        in_noise = f.cluster_id is None or f.cluster_id == noise_cid
        if not in_noise:
            pinned[f.id] = f.cluster_id  # type: ignore[assignment]
        elif f.manually_assigned and f.cluster_id is not None:
            pinned[f.id] = f.cluster_id
        else:
            active_faces.append(f)

    if not active_faces:
        return {"faces": len(all_faces), "clusters": 0, "noise": 0}

    active_indices = [face_id_to_idx[f.id] for f in active_faces]
    active_embs = all_embs_norm[active_indices]

    # ── Phase 3: Prototype pre-assignment ────────────────────────────────────
    # Each active face is compared against all known person prototypes.
    # Persons with sub-clusters contribute one prototype per age-range sub-cluster,
    # giving better recall for faces that drift from the overall centroid over time.
    # Persons without sub-clusters fall back to a single averaged centroid.
    prototypes = _compute_matching_prototypes(db, face_id_to_idx, all_embs_norm)
    pre_assigned: dict[int, int] = {}  # index into active_faces -> person_id

    if prototypes:
        pid_list = [p[0] for p in prototypes]
        centroid_matrix = np.stack([p[1] for p in prototypes])
        sims = active_embs @ centroid_matrix.T
        dists = 1.0 - sims
        best_pidx = np.argmin(dists, axis=1)
        best_dist = dists[np.arange(len(active_faces)), best_pidx]

        snap_threshold = eps * 0.7
        for i in range(len(active_faces)):
            if best_dist[i] <= snap_threshold:
                pre_assigned[i] = pid_list[int(best_pidx[i])]

    # ── Phase 4: DBSCAN on remaining active faces ─────────────────────────────
    unassigned_pos = [i for i in range(len(active_faces)) if i not in pre_assigned]
    dbscan_result: dict[int, int] = {}

    if unassigned_pos:
        uembs = active_embs[unassigned_pos]
        if len(uembs) >= min_samples:
            raw = DBSCAN(eps=eps, min_samples=min_samples, metric="cosine", n_jobs=-1).fit_predict(uembs)
        else:
            raw = np.full(len(uembs), -1)
        for pos, label in enumerate(raw):
            dbscan_result[unassigned_pos[pos]] = int(label)

    # ── Phase 5: Assign active faces to clusters ──────────────────────────────
    person_to_cid: dict[int, int] = {}
    for pid in set(pre_assigned.values()):
        existing = db.query(Cluster).filter(Cluster.person_id == pid).first()
        if existing:
            person_to_cid[pid] = existing.id
        else:
            max_lbl = int(db.query(func.max(Cluster.label)).scalar() or -1)
            c = Cluster(label=max_lbl + 1, person_id=pid)
            db.add(c)
            db.flush()
            person_to_cid[pid] = c.id

    dbscan_label_set = set(dbscan_result.values())
    dbscan_label_to_cid: dict[int, int] = {}

    if -1 in dbscan_label_set:
        if not noise_cluster:
            noise_cluster = Cluster(label=-1)
            db.add(noise_cluster)
            db.flush()
        dbscan_label_to_cid[-1] = noise_cluster.id  # type: ignore[union-attr]

    new_groups = sorted(l for l in dbscan_label_set if l >= 0)
    if new_groups:
        max_lbl = int(db.query(func.max(Cluster.label)).scalar() or -1)
        for i, label in enumerate(new_groups):
            c = Cluster(label=max_lbl + 1 + i, person_id=None)
            db.add(c)
            db.flush()
            dbscan_label_to_cid[label] = c.id

    for i, face in enumerate(active_faces):
        if i in pre_assigned:
            face.cluster_id = person_to_cid[pre_assigned[i]]
        elif i in dbscan_result:
            face.cluster_id = dbscan_label_to_cid[dbscan_result[i]]

    db.commit()

    # ── Phase 6: Refresh sub-clusters for all named persons ───────────────────
    # Done after commit so the face assignments above are visible.
    recompute_all_person_subclusters(db)

    n_named = len(person_to_cid)
    n_new = len(new_groups)
    n_noise = sum(1 for l in dbscan_result.values() if l == -1)
    return {
        "faces": len(all_faces),
        "clusters": n_named + n_new,
        "noise": n_noise,
    }
