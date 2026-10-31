#!/usr/bin/env python3
"""Build the browser assets for the URDF demonstrator.

For every link of the control model the link's visual meshes are baked into
ONE glTF binary (transform applied, materials kept), so the browser loads 47
files instead of 395 elements. The kinematic tree goes into model.json.
"""
import json
import os
import sys
import time
import numpy as np
import trimesh
import xml.etree.ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URDF = os.path.join(ROOT, "urdf", "pib.control.urdf")
OUT = os.path.join(ROOT, "web")
MESH_OUT = os.path.join(OUT, "meshes")


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
    return np.array(parts[:3], float)


def main():
    os.makedirs(MESH_OUT, exist_ok=True)
    robot = ET.parse(URDF).getroot()

    cache = {}
    total_tris = 0
    links_out, links_missing = [], 0
    t0 = time.time()

    for link in robot.findall("link"):
        name = link.get("name")
        by_color = {}
        for vis in link.findall("visual"):
            mesh_el = vis.find("geometry/mesh")
            if mesh_el is None:
                continue
            fn = mesh_el.get("filename")
            path = fn.replace("package://pib/", ROOT + "/")
            if path not in cache:
                cache[path] = trimesh.load(path, force="scene", process=False)
            src = cache[path]
            org = vis.find("origin")
            xyz = vec(org.get("xyz")) if org is not None else np.zeros(3)
            rpy = vec(org.get("rpy")) if org is not None else np.zeros(3)
            M = np.eye(4)
            M[:3, :3] = rpy_matrix(*rpy)
            M[:3, 3] = xyz
            for g in src.dump(concatenate=False):
                g = g.copy()
                g.apply_transform(M)
                mat = getattr(g.visual, "material", None)
                base = getattr(mat, "baseColorFactor", None) if mat is not None else None
                key = tuple(int(v) for v in base[:3]) if base is not None else (230, 230, 230)
                by_color.setdefault(key, []).append(g)
                total_tris += len(g.faces)

        if not by_color:
            links_missing += 1
            continue
        scene = trimesh.Scene()
        for key, parts in by_color.items():
            merged = trimesh.util.concatenate(parts) if len(parts) > 1 else parts[0]
            merged.visual = trimesh.visual.TextureVisuals(
                material=trimesh.visual.material.PBRMaterial(
                    name=f"c{key[0]}_{key[1]}_{key[2]}",
                    baseColorFactor=[key[0], key[1], key[2], 255],
                    metallicFactor=0.15,
                    roughnessFactor=0.75,
                ))
            scene.add_geometry(merged, geom_name=f"{name}_{key[0]}_{key[1]}_{key[2]}",
                               node_name=f"{name}_{key[0]}_{key[1]}_{key[2]}")
        scene.export(os.path.join(MESH_OUT, f"{name}.glb"))
        links_out.append({"name": name, "mesh": f"meshes/{name}.glb", "parts": len(by_color)})

    joints = []
    for j in robot.findall("joint"):
        o = j.find("origin")
        ax = j.find("axis")
        lim = j.find("limit")
        joints.append({
            "name": j.get("name"),
            "type": j.get("type"),
            "parent": j.find("parent").get("link"),
            "child": j.find("child").get("link"),
            "origin": {"xyz": list(vec(o.get("xyz"))) if o is not None else [0, 0, 0],
                       "rpy": list(vec(o.get("rpy"))) if o is not None else [0, 0, 0]},
            "axis": list(vec(ax.get("xyz"), (1, 0, 0))) if ax is not None else [1, 0, 0],
            "limit": ({"lower": float(lim.get("lower")), "upper": float(lim.get("upper"))}
                      if lim is not None and lim.get("lower") is not None else None),
        })

    # the welded-away CAD parts still have names: carry them into the model file
    groups = {}
    summary_path = os.path.join(ROOT, "reduce_summary.json")
    if os.path.isfile(summary_path):
        with open(summary_path) as fh:
            groups = json.load(fh).get("groups", {})
    for link in links_out:
        link["parts"] = groups.get(link["name"], {}).get("members", [link["name"]])

    model = {
        "name": robot.get("name"),
        "links": links_out,
        "joints": joints,
        "stats": {"links": len(links_out), "joints": len(joints), "triangles": total_tris},
    }
    with open(os.path.join(OUT, "model.json"), "w") as fh:
        json.dump(model, fh, indent=1)

    size = sum(os.path.getsize(os.path.join(MESH_OUT, f)) for f in os.listdir(MESH_OUT))
    print(f"links written: {len(links_out)} (empty: {links_missing}), joints: {len(joints)}")
    print(f"triangles: {total_tris:,}  |  mesh payload: {size / 1e6:.1f} MB  |  {time.time() - t0:.1f}s")
    print("written:", os.path.join(OUT, "model.json"))


if __name__ == "__main__":
    main()
