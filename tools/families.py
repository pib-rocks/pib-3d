#!/usr/bin/env python3
"""Group the remaining parts into families and walk them.

    python3 tools/families.py list [n]      # next n families, biggest first
    python3 tools/families.py show <family> # members of one family
    python3 tools/families.py drop <family> # add every member to visual_overrides.json
    python3 tools/families.py restore <family>  # bring a dropped family back

A family is the part name with the mirror/index suffix removed:
d52_finger_proximal_3 -> d52_finger_proximal.
"""
import json
import re
import sys
import trimesh

OVER = "visual_overrides.json"
VIS = "docs/visibility.json"
cache = {}


def tris(mesh):
    if mesh not in cache:
        cache[mesh] = len(trimesh.load(mesh, force="mesh", process=False).faces)
    return cache[mesh]


def family(name):
    base = re.sub(r"_(left|right)$", "", name)
    return re.sub(r"(_\d+)?_?$", "", base).rstrip("_") or name


def load():
    d = json.load(open(VIS))
    ov = json.load(open(OVER))
    drop, keep = set(ov.get("drop", [])), set(ov.get("keep", []))
    parts = {}
    for p in d["parts"]:
        if (not p["visible"] and p["part"] not in keep) or p["part"] in drop or p["part"] in keep:
            continue
        r = parts.setdefault(p["part"], {"part": p["part"], "views": 0, "mesh": p["mesh"]})
        r["views"] = max(r["views"], p["max_views"])
    fams = {}
    for name, r in parts.items():
        f = fams.setdefault(family(name), {"name": family(name), "parts": [], "tris": 0, "vmin": 99, "vmax": 0})
        f["parts"].append(name)
        f["tris"] += tris(r["mesh"])
        f["vmin"] = min(f["vmin"], r["views"])
        f["vmax"] = max(f["vmax"], r["views"])
    return ov, fams


def save(ov):
    with open(OVER, "w") as fh:
        json.dump({k: sorted(set(v)) for k, v in ov.items()}, fh, indent=2)
        fh.write("\n")


def main(argv):
    if not argv:
        print(__doc__)
        return 0
    ov, fams = load()
    cmd = argv[0]

    if cmd == "list":
        n = int(argv[1]) if len(argv) > 1 else 5
        order = sorted(fams.values(), key=lambda f: -f["tris"])
        print(f"{len(fams)} families, {sum(len(f['parts']) for f in fams.values())} parts left")
        for f in order[:n]:
            print(f"{f['name']}|{len(f['parts'])}|{f['tris']}|{f['vmin']}-{f['vmax']}")
        return 0

    if cmd == "show":
        f = fams[argv[1]]
        print(f"{f['name']}: {len(f['parts'])} parts, {f['tris']:,} triangles, views {f['vmin']}-{f['vmax']}")
        for p in sorted(f["parts"]):
            print("   ", p)
        return 0

    if cmd == "keep":
        f = fams[argv[1]]
        ov.setdefault("keep", [])
        ov["keep"].extend(f["parts"])
        save(ov)
        print(f"kept {len(f['parts'])} parts of {f['name']} ({f['tris']:,} triangles)")
        return 0

    if cmd == "restore":
        f = fams[argv[1]]
        ov.setdefault("drop", [])
        ov["drop"] = [x for x in ov["drop"] if x not in f["parts"]]
        ov.setdefault("keep", [])
        ov["keep"].extend(f["parts"])
        save(ov)
        print(f"restored {len(f['parts'])} parts of {f['name']} ({f['tris']:,} triangles)")
        return 0

    if cmd == "drop":
        f = fams[argv[1]]
        ov.setdefault("drop", [])
        ov["drop"].extend(f["parts"])
        save(ov)
        print(f"dropped {len(f['parts'])} parts of {f['name']} ({f['tris']:,} triangles)")
        return 0

    print(__doc__)
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
