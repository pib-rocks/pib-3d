#!/usr/bin/env python3
"""Print the next parts to ask about, ordered by how rarely they are visible."""
import json
import sys
import trimesh

LIMIT = int(sys.argv[1]) if len(sys.argv) > 1 else 5
MAXVIEWS = int(sys.argv[2]) if len(sys.argv) > 2 else 6

d = json.load(open("docs/visibility.json"))
ov = json.load(open("visual_overrides.json"))
drop, keep = set(ov.get("drop", [])), set(ov.get("keep", []))
cache = {}
def tris(m):
    if m not in cache:
        cache[m] = len(trimesh.load(m, force="mesh", process=False).faces)
    return cache[m]

rows = {}
for p in d["parts"]:
    if (not p["visible"] and p["part"] not in keep) or p["part"] in drop:
        continue
    r = rows.setdefault(p["part"], {"part": p["part"], "views": 0, "mesh": p["mesh"]})
    r["views"] = max(r["views"], p["max_views"])
for r in rows.values():
    r["tris"] = tris(r["mesh"])

cand = [r for r in rows.values() if r["views"] <= MAXVIEWS]
cand.sort(key=lambda r: (r["views"], -r["tris"]))
print(f"remaining: {len(rows)} | marginal (<= {MAXVIEWS} views): {len(cand)}")
for r in cand[:LIMIT]:
    print(f"{r['part']}|{r['tris']}|{r['views']}|{r['mesh']}")
