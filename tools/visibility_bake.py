#!/usr/bin/env python3
"""Which parts of the robot can ever be seen from outside?

Every <visual> instance of the export gets a unique triangle range, all of them
are merged into one triangle soup, and the soup is ray-cast from a sphere of
directions with Open3D (Embree). A part that no ray ever hits, in any pose, sits
inside the body and can lose its visual geometry while keeping its mass.

Poses matter: the two back doors hide parts when closed and expose them when
open, so both states are measured.

Writes docs/visibility.json.
"""
import json
import os
import sys
import time
import numpy as np
import trimesh
import xml.etree.ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "urdf", "pib.urdf")
OUT = os.path.join(ROOT, "docs", "visibility.json")

VIEWS = 32          # directions on a sphere
RES = 512           # rays per axis and view
FOV = 40.0

POSES = {
    "doors_closed": {"upper_door_rotation": -1.5707963, "lower_door_rotation": -1.5707963},
    "doors_open": {},
}


def rpy_matrix(r, p, y):
    cr, sr, cp, sp, cy, sy = np.cos(r), np.sin(r), np.cos(p), np.sin(p), np.cos(y), np.sin(y)
    return (np.array([[cy, -sy, 0], [sy, cy, 0], [0, 0, 1]]) @
            np.array([[cp, 0, sp], [0, 1, 0], [-sp, 0, cp]]) @
            np.array([[1, 0, 0], [0, cr, -sr], [0, sr, cr]]))


def vec(text, default=(0, 0, 0)):
    if not text:
        return np.array(default, float)
    parts = [float(v) for v in text.replace(",", " ").split()]
    while len(parts) < 3:
        parts.append(0.0)
    return np.array(parts[:3])


def axis_rotation(axis, angle):
    a = np.asarray(axis, float)
    n = np.linalg.norm(a)
    if n == 0 or angle == 0:
        return np.eye(3)
    a = a / n
    K = np.array([[0, -a[2], a[1]], [a[2], 0, -a[0]], [-a[1], a[0], 0]])
    return np.eye(3) + np.sin(angle) * K + (1 - np.cos(angle)) * (K @ K)


def instances(robot, links, joints, angles):
    """(part link, mesh file, 4x4 world matrix) for every visual, posed."""
    by_parent = {}
    parent_of = {}
    for j in joints:
        by_parent.setdefault(j.find("parent").get("link"), []).append(j)
        parent_of[j.find("child").get("link")] = j
    roots = [n for n in links if n not in parent_of]
    if len(roots) != 1:
        sys.exit(f"expected one root link, got {roots}")

    out = []
    stack = [(roots[0], np.eye(4))]
    while stack:
        link, T = stack.pop()
        for vis in links[link].findall("visual"):
            mesh = vis.find("geometry/mesh")
            if mesh is None:
                continue
            o = vis.find("origin")
            O = np.eye(4)
            if o is not None:
                O[:3, :3] = rpy_matrix(*vec(o.get("rpy")))
                O[:3, 3] = vec(o.get("xyz"))
            oxyz = vec(o.get("xyz")) if o is not None else np.zeros(3)
            key = f"{link}|{mesh.get('filename').rsplit('/', 1)[-1]}|{oxyz[0]:.6f},{oxyz[1]:.6f},{oxyz[2]:.6f}"
            out.append((link, mesh.get("filename"), T @ O, key))
        for j in by_parent.get(link, []):
            o = j.find("origin")
            O = np.eye(4)
            if o is not None:
                O[:3, :3] = rpy_matrix(*vec(o.get("rpy")))
                O[:3, 3] = vec(o.get("xyz"))
            angle = angles.get(j.get("name"), 0.0)
            M = np.eye(4)
            if j.get("type") in ("revolute", "continuous"):
                ax = j.find("axis")
                M[:3, :3] = axis_rotation(vec(ax.get("xyz"), (1, 0, 0)) if ax is not None else (1, 0, 0), angle)
            elif j.get("type") == "prismatic":
                ax = j.find("axis")
                M[:3, 3] = (vec(ax.get("xyz"), (1, 0, 0)) if ax is not None else np.array([1, 0, 0])) * angle
            stack.append((j.find("child").get("link"), T @ O @ M))
    return out


def soup(inst, cache):
    verts, faces, owner = [], [], []
    offset = 0
    for idx, (_, filename, M, _key) in enumerate(inst):
        path = filename.replace("package://pib/", ROOT + "/")
        if path not in cache:
            cache[path] = trimesh.load(path, force="mesh", process=False)
        m = cache[path]
        v = np.asarray(m.vertices, dtype=np.float64) @ M[:3, :3].T + M[:3, 3]
        f = np.asarray(m.faces, dtype=np.int64)
        verts.append(v)
        faces.append(f + offset)
        owner.append(np.full(len(f), idx, dtype=np.int32))
        offset += len(v)
    return (np.concatenate(verts).astype(np.float32),
            np.concatenate(faces).astype(np.int32),
            np.concatenate(owner))


def sphere_dirs(n):
    dirs = []
    for i in range(n):
        y = 1 - (i / (n - 1)) * 2
        r = np.sqrt(max(0.0, 1 - y * y))
        phi = i * np.pi * (3 - np.sqrt(5))
        dirs.append([np.cos(phi) * r, y, np.sin(phi) * r])
    return np.array(dirs)


def main():
    import open3d as o3d

    t0 = time.time()
    robot = ET.parse(SRC).getroot()
    links = {l.get("name"): l for l in robot.findall("link")}
    joints = robot.findall("joint")
    cache = {}
    results = {}

    for pose_name, angles in POSES.items():
        inst = instances(robot, links, joints, angles)
        V, F, owner = soup(inst, cache)
        mesh = o3d.t.geometry.TriangleMesh(o3d.core.Tensor(V), o3d.core.Tensor(F))
        scene = o3d.t.geometry.RaycastingScene()
        scene.add_triangles(mesh)

        centre = V.mean(axis=0)
        radius = float(np.linalg.norm(V - centre, axis=1).max())
        dist = radius / np.sin(np.radians(FOV / 2)) * 1.02
        half = np.tan(np.radians(FOV / 2))
        lin = (np.arange(RES) + 0.5) / RES * 2 - 1

        views = np.zeros(len(inst), dtype=np.int32)
        pixels = np.zeros(len(inst), dtype=np.int64)

        for d in sphere_dirs(VIEWS):
            d = d / np.linalg.norm(d)
            forward = -d
            up_hint = np.array([0.0, 0.0, 1.0]) if abs(forward[2]) < 0.9 else np.array([0.0, 1.0, 0.0])
            right = np.cross(up_hint, forward)
            right /= np.linalg.norm(right)
            up = np.cross(forward, right)

            origin = centre + d * dist
            uu, vv = np.meshgrid(lin, -lin)
            rays_dir = (forward[None, None, :]
                        + right[None, None, :] * (uu * half)[..., None]
                        + up[None, None, :] * (vv * half)[..., None]).reshape(-1, 3)
            rays_dir /= np.linalg.norm(rays_dir, axis=1, keepdims=True)
            rays = o3d.core.Tensor(np.hstack([np.broadcast_to(origin, rays_dir.shape), rays_dir]),
                                   dtype=o3d.core.Dtype.Float32)
            hit = scene.cast_rays(rays)
            prim = hit["primitive_ids"].numpy()
            mask = prim < len(F)          # misses come back as 0xFFFFFFFF (uint32)
            if not mask.any():
                continue
            ids = owner[prim[mask]]
            np.add.at(pixels, ids, 1)
            views[np.unique(ids)] += 1

        print(f"  {pose_name}: {len(inst)} instances, {len(F):,} triangles, {time.time() - t0:.1f}s", flush=True)

        for idx, (link, filename, _M, key) in enumerate(inst):
            entry = results.setdefault(key, {
                "key": key,
                "part": link,
                "mesh": filename.replace("package://pib/meshes/", "meshes/"),
                "views": {}, "pixels": {},
            })
            entry["views"][pose_name] = int(views[idx])
            entry["pixels"][pose_name] = int(pixels[idx])

    entries = []
    for _key, e in sorted(results.items()):
        worst = max(e["views"].values())
        entries.append({**e, "max_views": worst, "visible": worst > 0})

    hidden = [e for e in entries if not e["visible"]]
    payload = {
        "views": VIEWS,
        "resolution": RES,
        "fov_deg": FOV,
        "poses": list(POSES),
        "instances": len(entries),
        "hidden": len(hidden),
        "hidden_parts": sorted({e["part"] for e in hidden}),
        "parts": entries,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as fh:
        json.dump(payload, fh, indent=1)

    print(f"\n{len(entries)} instances, {len(hidden)} never visible "
          f"({100 * len(hidden) / max(1, len(entries)):.1f}%)")
    print(f"written {OUT} in {time.time() - t0:.1f}s")
    for e in hidden[:15]:
        print("   ", e["part"])
    if len(hidden) > 15:
        print(f"    … and {len(hidden) - 15} more")


if __name__ == "__main__":
    main()
