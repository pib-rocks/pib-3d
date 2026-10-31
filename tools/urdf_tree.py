#!/usr/bin/env python3
"""Draw the kinematic tree of the reduced model (structure evidence, not looks)."""
import collections
import pathlib
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch
import xml.etree.ElementTree as ET

ROOT = pathlib.Path(__file__).resolve().parent.parent
PATH = str(ROOT / "urdf" / "pib.control.urdf")
OUT = str(ROOT / "docs" / "pib.control.tree.png")

robot = ET.parse(PATH).getroot()
links = [l.get("name") for l in robot.findall("link")]
joints = robot.findall("joint")
kids = collections.defaultdict(list)
parent_of = {}
for j in joints:
    kids[j.find("parent").get("link")].append(j)
    parent_of[j.find("child").get("link")] = j.get("name")
root = [l for l in links if l not in parent_of][0]

# tidy layout: leaves get consecutive rows, parents centred on their children
rows = {}
counter = [0]


def layout(link, depth):
    ch = kids.get(link, [])
    if not ch:
        rows[link] = counter[0]
        counter[0] += 1
        return rows[link]
    ys = [layout(j.find("child").get("link"), depth + 1) for j in ch]
    rows[link] = (min(ys) + max(ys)) / 2
    return rows[link]


layout(root, 0)
depth = {}


def depths(link, d):
    depth[link] = d
    for j in kids.get(link, []):
        depths(j.find("child").get("link"), d + 1)


depths(root, 0)

maxd = max(depth.values())
fig_h = max(6, 0.36 * counter[0] + 2)
fig_w = max(14, 0.62 * maxd + 3)
fig, ax = plt.subplots(figsize=(fig_w, fig_h))
ax.set_axis_off()
ax.set_xlim(-0.6, maxd + 1.0)
ax.set_ylim(counter[0] + 1, -1.2)

COL = {"revolute": "#1f6feb", "continuous": "#2ea043"}

for j in joints:
    p = j.find("parent").get("link")
    c = j.find("child").get("link")
    x1, y1 = depth[p], rows[p]
    x2, y2 = depth[c], rows[c]
    ax.plot([x1, x2], [y1, y2], color="#8b949e", lw=1.1, zorder=1)
    lim = j.find("limit")
    label = j.get("name")
    if lim is not None:
        label += f"\n{float(lim.get('lower')):.3f} … {float(lim.get('upper')):.3f} rad"
    else:
        label += "\n∞"
    ax.text((x1 + x2) / 2, (y1 + y2) / 2 - 0.12, label, fontsize=5.0, ha="center", va="bottom",
            color=COL.get(j.get("type"), "#8b949e"), zorder=3,
            bbox=dict(boxstyle="round,pad=0.12", fc="white", ec="none", alpha=0.85))

for link in links:
    x, y = depth[link], rows[link]
    ax.text(x, y, link, fontsize=5.8, ha="center", va="center", zorder=4,
            bbox=dict(boxstyle="round,pad=0.25", fc="#eef3fb", ec="#57606a", lw=0.6))

ax.set_title(f"pib.control.urdf — {len(links)} links, {len(joints)} joints "
             f"(revolute blue, continuous green; limits in rad)", fontsize=9)
plt.tight_layout()
plt.savefig(OUT, dpi=200, facecolor="white")
print("written", OUT)
