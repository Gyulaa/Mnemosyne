import numpy as np
from sklearn.preprocessing import normalize
from sklearn.cluster import DBSCAN
from sqlalchemy import func
from sqlalchemy.orm import Session

from .database import Face, Cluster, Person


def _compute_person_centroids(db, face_id_to_idx: dict, embeddings_norm: np.ndarray) -> dict:
    """Return {person_id: normalized_centroid} for every named person who has faces
    in the current face set."""
    persons = db.query(Person).filter(Person.name != None).all()
    centroids = {}
    for person in persons:
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
            centroids[person.id] = centroid
    return centroids


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
            # Already in a real cluster — leave completely alone.
            pinned[f.id] = f.cluster_id  # type: ignore[assignment]
        elif f.manually_assigned and f.cluster_id is not None:
            # Manually pinned to a cluster (even noise) — respect that.
            pinned[f.id] = f.cluster_id
        else:
            active_faces.append(f)

    if not active_faces:
        return {"faces": len(all_faces), "clusters": 0, "noise": 0}

    active_indices = [face_id_to_idx[f.id] for f in active_faces]
    active_embs = all_embs_norm[active_indices]

    # ── Phase 3: Person centroid pre-assignment ───────────────────────────────
    # Noise faces close to a named person's centroid snap to that person's cluster.
    person_centroids = _compute_person_centroids(db, face_id_to_idx, all_embs_norm)
    pre_assigned: dict[int, int] = {}  # index into active_faces -> person_id

    if person_centroids:
        pid_list = list(person_centroids.keys())
        centroid_matrix = np.stack([person_centroids[pid] for pid in pid_list])
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
    # Pinned faces are NOT touched at all. Existing named/unnamed clusters are
    # preserved. We only create new clusters for newly-formed DBSCAN groups.

    # Resolve person_id -> cluster id (use existing cluster if present)
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

    # Create new unnamed clusters for DBSCAN groups among noise faces
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

    n_named = len(person_to_cid)
    n_new = len(new_groups)
    n_noise = sum(1 for l in dbscan_result.values() if l == -1)
    return {
        "faces": len(all_faces),
        "clusters": n_named + n_new,
        "noise": n_noise,
    }
