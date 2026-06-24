import numpy as np
from sklearn.preprocessing import normalize
from sklearn.cluster import DBSCAN
from sqlalchemy import update, func
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

    # ── Phase 2: Separate manually-pinned faces ───────────────────────────────
    # Pinned = user manually assigned to a NAMED cluster.
    # These skip all algorithms and keep their assignment through re-clustering.
    pinned = {}           # face.id -> cluster_id
    protected_cids = set()

    for f in all_faces:
        if f.manually_assigned and f.cluster_id is not None:
            target = db.get(Cluster, f.cluster_id)
            if target and target.person_id is not None:  # only pin to named clusters
                pinned[f.id] = f.cluster_id
                protected_cids.add(f.cluster_id)

    active_faces = [f for f in all_faces if f.id not in pinned]
    active_indices = [face_id_to_idx[f.id] for f in active_faces]
    active_embs = all_embs_norm[active_indices] if active_indices else np.empty((0, all_embs_norm.shape[1]))

    # ── Phase 3: Person centroid pre-assignment ───────────────────────────────
    # Every active face within eps of a named person's centroid goes straight
    # to that person's cluster — no DBSCAN needed for them.
    person_centroids = _compute_person_centroids(db, face_id_to_idx, all_embs_norm)
    pre_assigned = {}  # index into active_faces -> person_id

    if person_centroids and len(active_faces) > 0:
        pid_list = list(person_centroids.keys())
        centroid_matrix = np.stack([person_centroids[pid] for pid in pid_list])  # (n_persons, 512)
        sims = active_embs @ centroid_matrix.T   # (n_active, n_persons) cosine similarities
        dists = 1.0 - sims                        # cosine distances
        best_pidx = np.argmin(dists, axis=1)
        best_dist = dists[np.arange(len(active_faces)), best_pidx]

        for i in range(len(active_faces)):
            if best_dist[i] <= eps:
                pre_assigned[i] = pid_list[int(best_pidx[i])]

    # ── Phase 4: DBSCAN on truly unassigned faces ─────────────────────────────
    unassigned_pos = [i for i in range(len(active_faces)) if i not in pre_assigned]
    dbscan_result = {}  # index into active_faces -> dbscan label

    if unassigned_pos:
        uembs = active_embs[unassigned_pos]
        if len(uembs) >= min_samples:
            raw = DBSCAN(eps=eps, min_samples=min_samples, metric="cosine", n_jobs=-1).fit_predict(uembs)
        else:
            raw = np.full(len(uembs), -1)
        for pos, label in enumerate(raw):
            dbscan_result[unassigned_pos[pos]] = int(label)

    # ── Phase 5: Rebuild DB assignments ──────────────────────────────────────
    # Clear cluster_id for all non-pinned faces
    pinned_ids = list(pinned.keys())
    if pinned_ids:
        db.execute(update(Face).where(Face.id.notin_(pinned_ids)).values(cluster_id=None))
    else:
        db.execute(update(Face).values(cluster_id=None))
    db.flush()

    # Delete unnamed clusters that are not protecting pinned faces
    if protected_cids:
        db.query(Cluster).filter(
            Cluster.person_id == None,
            ~Cluster.id.in_(protected_cids),
        ).delete(synchronize_session="fetch")
    else:
        db.query(Cluster).filter(Cluster.person_id == None).delete()
    db.flush()

    # Map person_id -> surviving (or freshly created) cluster id
    person_to_cid = {}
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

    # Create new DBSCAN clusters
    dbscan_label_set = set(dbscan_result.values())
    dbscan_label_to_cid = {}

    if -1 in dbscan_label_set:
        noise = db.query(Cluster).filter(Cluster.label == -1).first()
        if not noise:
            noise = Cluster(label=-1)
            db.add(noise)
            db.flush()
        dbscan_label_to_cid[-1] = noise.id

    max_lbl = int(db.query(func.max(Cluster.label)).scalar() or -1)
    for i, label in enumerate(sorted(l for l in dbscan_label_set if l >= 0)):
        c = Cluster(label=max_lbl + 1 + i, person_id=None)
        db.add(c)
        db.flush()
        dbscan_label_to_cid[label] = c.id

    # Assign active faces to their new clusters
    for i, face in enumerate(active_faces):
        if i in pre_assigned:
            face.cluster_id = person_to_cid[pre_assigned[i]]
        elif i in dbscan_result:
            face.cluster_id = dbscan_label_to_cid[dbscan_result[i]]

    db.commit()

    n_named = len(person_to_cid)
    n_new = len(dbscan_label_set - {-1})
    n_noise = sum(1 for l in dbscan_result.values() if l == -1)
    return {
        "faces": len(all_faces),
        "clusters": n_named + n_new,
        "noise": n_noise,
    }
