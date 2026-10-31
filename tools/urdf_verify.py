#!/usr/bin/env python3
"""Verify the reduced control model against the Onshape original.

Test 1  zero pose: every part must sit where the original puts it (except the
        exporter's exact duplicate copies, which are reported separately)
Test 2  posed: every joint the model kept is set to half its range; the frame
        of every shared link must match the original's frame for that pose.
"""
import pathlib
import sys, os, collections
import numpy as np
import xml.etree.ElementTree as ET

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = str(ROOT / "urdf" / "pib.urdf")
RED = str(ROOT / "urdf" / "pib.control.urdf")


def rpy(r, p, y):
    cr, sr, cp, sp, cy, sy = np.cos(r), np.sin(r), np.cos(p), np.sin(p), np.cos(y), np.sin(y)
    return (np.array([[cy, -sy, 0], [sy, cy, 0], [0, 0, 1]]) @
            np.array([[cp, 0, sp], [0, 1, 0], [-sp, 0, cp]]) @
            np.array([[1, 0, 0], [0, cr, -sr], [0, sr, cr]]))


def vec(t, d=(0, 0, 0)):
    if not t:
        return np.array(d, float)
    parts = [float(x) for x in t.replace(",", " ").split()]
    while len(parts) < 3:
        parts.append(0.0)
    return np.array(parts[:3], float)


def axis_rot(axis, angle):
    a = np.array(axis, float)
    n = np.linalg.norm(a)
    if n == 0 or angle == 0:
        return np.eye(3)
    a = a / n
    K = np.array([[0, -a[2], a[1]], [a[2], 0, -a[0]], [-a[1], a[0], 0]])
    return np.eye(3) + np.sin(angle) * K + (1 - np.cos(angle)) * (K @ K)


def load(path):
    robot = ET.parse(path).getroot()
    links = {l.get("name"): l for l in robot.findall("link")}
    joints = robot.findall("joint")
    children = collections.defaultdict(list)
    parent_of = {}
    for j in joints:
        p = j.find("parent").get("link")
        children[p].append(j)
        parent_of[j.find("child").get("link")] = p
    roots = [n for n in links if n not in parent_of]
    return robot, links, joints, children, roots


def pose_of(j, factor=0.5):
    """Deterministic test angle for one joint."""
    t = j.get("type")
    if t == "continuous":
        return 0.4
    if t == "prismatic":
        return 0.0
    lim = j.find("limit")
    if lim is None:
        return 0.0
    lo, hi = float(lim.get("lower")), float(lim.get("upper"))
    return lo + factor * (hi - lo)


def fk(robot, angle_fn=None, use_names=True):
    """Absolute frame of every link. angle_fn(joint) -> angle."""
    links = {l.get("name"): l for l in robot.findall("link")}
    children = collections.defaultdict(list)
    parent_of = {}
    for j in robot.findall("joint"):
        children[j.find("parent").get("link")].append(j)
        parent_of[j.find("child").get("link")] = j
    roots = [n for n in links if n not in parent_of]
    frames, meshes = {}, []

    def walk(link, T):
        if link in frames:
            raise SystemExit(f"duplicate/cycle at {link}")
        frames[link] = T
        for v in links[link].findall("visual"):
            mesh = v.find("geometry/mesh")
            if mesh is None:
                continue
            o = v.find("origin")
            O = np.eye(4)
            if o is not None:
                O[:3, :3] = rpy(*vec(o.get("rpy")))
                O[:3, 3] = vec(o.get("xyz"))
            meshes.append((mesh.get("filename"), T @ O))
        for j in children[link]:
            o = j.find("origin")
            O = np.eye(4)
            if o is not None:
                O[:3, :3] = rpy(*vec(o.get("rpy")))
                O[:3, 3] = vec(o.get("xyz"))
            ang = angle_fn(j) if angle_fn else 0.0
            M = np.eye(4)
            ax = j.find("axis")
            if j.get("type") in ("revolute", "continuous"):
                M[:3, :3] = axis_rot(vec(ax.get("xyz"), (1, 0, 0)) if ax is not None else (1, 0, 0), ang)
            elif j.get("type") == "prismatic":
                M[:3, 3] = (vec(ax.get("xyz"), (1, 0, 0)) if ax is not None else np.array([1, 0, 0])) * ang
            walk(j.find("child").get("link"), T @ O @ M)

    if len(roots) != 1:
        raise SystemExit(f"expected exactly one root, got {roots}")
    walk(roots[0], np.eye(4))
    return frames, meshes, roots[0]


def match(src, red, tol=1e-4):
    """Greedy match mesh instances; returns (matched, unmatched_src, unmatched_red, max_err)."""
    pool = collections.defaultdict(list)
    for i, (m, T) in enumerate(red):
        pool[m].append(i)
    used = set()
    unmatched_src, errs = [], []
    for m, Ts in src:
        best, bestd = None, 1e9
        for i in pool.get(m, []):
            if i in used:
                continue
            d = np.abs(Ts[:3, 3] - red[i][1][:3, 3]).max()
            if d < bestd:
                bestd, best = d, i
        if best is not None and bestd < tol:
            used.add(best)
            errs.append(bestd)
        else:
            unmatched_src.append((m, Ts))
    unmatched_red = [(red[i][0], red[i][1]) for i in range(len(red)) if i not in used]
    return errs, unmatched_src, unmatched_red


def fmt(p):
    return "(" + ", ".join(f"{v:.6f}" for v in p[:3]) + ")"


src_robot = ET.parse(SRC).getroot()
red_robot = ET.parse(RED).getroot()
print(f"source : {len(src_robot.findall('link'))} links, {len(src_robot.findall('joint'))} joints")
print(f"reduced: {len(red_robot.findall('link'))} links, {len(red_robot.findall('joint'))} joints")

# the doors rest closed in the reduced model: the source has to be driven to
# its lower limit for the comparison to be like-for-like
def src_rest(j):
    if j.get("name", "").endswith("_door_rotation"):
        lim = j.find("limit")
        return float(lim.get("lower")) if lim is not None else 0.0
    return 0.0


# --- test 1: zero pose, geometry ---
_, src_meshes, src_root = fk(src_robot, src_rest)
_, red_meshes, red_root = fk(red_robot)
errs, un_src, un_red = match(src_meshes, red_meshes)
print(f"\n[1] zero pose: {len(src_meshes)} mesh instances in source, {len(red_meshes)} in reduced")
print(f"    matched {len(errs)}, max position error {max(errs) if errs else 0:.2e} m")
dup_only = True
for m, T in un_src:
    same = [T2 for m2, T2 in src_meshes if m2 == m and np.abs(T2[:3, 3] - T[:3, 3]).max() < 1e-6]
    if len(same) < 2:
        dup_only = False
    print(f"    missing copy: {m.split('/')[-1]:38s} at {fmt(T[:3, 3])}  (source had {len(same)}x here)")
for m, T in un_red:
    print(f"    unexpected  : {m.split('/')[-1]:38s} at {fmt(T[:3, 3])}")
print(f"    -> removed copies are exact duplicates of a remaining part: {dup_only}")

# --- test 2: same pose in both models ---
src_keep = {j.get("name") for j in src_robot.findall("joint")}
red_joints = {j.get("name"): j for j in red_robot.findall("joint")}
only_red = set(red_joints) - src_keep
print(f"\n[2] posed: {len(red_joints)} joints driven, {len(only_red)} synthesised ({sorted(only_red)[:4]})")


door_offset = {}
for name in red_joints:
    if name.endswith("_door_rotation") and name in src_keep:
        lim = [j for j in src_robot.findall("joint") if j.get("name") == name][0].find("limit")
        door_offset[name] = float(lim.get("lower")) if lim is not None else 0.0


def red_angle(j):
    return pose_of(red_joints[j.get("name")], 0.5) if j.get("name") in red_joints else 0.0


def src_angle(j):
    return red_angle(j) + door_offset.get(j.get("name"), 0.0)


src_frames, _, _ = fk(src_robot, src_angle)
red_frames, _, _ = fk(red_robot, red_angle)
# links below a synthesised joint cannot be compared under a pose: the
# original drives them through the four-bar (angle 0), the reduced model
# through the new hinge. Their zero pose is covered by test 1.
below = set()
kids = collections.defaultdict(list)
for j in red_robot.findall("joint"):
    kids[j.find("parent").get("link")].append((j.get("name"), j.find("child").get("link")))


def mark(link, excl=False):
    for name, c in kids[link]:
        e = excl or name in only_red
        if e:
            below.add(c)
        mark(c, e)


mark(red_root)
shared = (set(src_frames) & set(red_frames)) - below
worst = max((np.abs(src_frames[n] - red_frames[n]).max(), n) for n in shared)
print(f"    compared links: {len(shared)} (excluded {len(below)} below a synthesised hinge)")
print(f"    worst frame deviation {worst[0]:.2e} (link {worst[1]})")
moved = sum(1 for n in shared if np.abs(src_frames[n][:3, 3]).max() > 0)
print(f"    links displaced by the pose: {moved}")

# --- test 3: the restored left wrist mirrors the right one (PR-2089) ---
wrists = {"rotation_wrist_right", "rotation_wrist_left"}
pairs = {"rotation_wrist_right": "d01_r_palm_right", "rotation_wrist_left": "d01_l_palm_left"}


def wrist_only(j):
    return 0.3 if j.get("name") in wrists else 0.0


zero_frames, _, _ = fk(red_robot, None)
turned_frames, _, _ = fk(red_robot, wrist_only)
print("\n[3] wrist symmetry (both wrists +0.3 rad, zero elsewhere)")
links_red = {l.get("name"): l for l in red_robot.findall("link")}
gaps, angles = [], []
for joint, palm in pairs.items():
    if palm not in zero_frames:
        print(f"    {palm}: not in the model")
        continue
    T0, T1 = zero_frames[palm], turned_frames[palm]
    ang = np.degrees(np.arccos(np.clip((np.trace(T0[:3, :3].T @ T1[:3, :3]) - 1) / 2, -1, 1)))
    # the palm's own frame origin sits on the axis (see PR-2057), so measure
    # points of the palm that are off the axis: its part origins
    pts = [vec(v.find("origin").get("xyz")) for v in links_red[palm].findall("visual")
           if v.find("origin") is not None]
    moved = max((np.linalg.norm((T1[:3, :3] @ q + T1[:3, 3]) - (T0[:3, :3] @ q + T0[:3, 3])) for q in pts), default=0.0)
    gaps.append(float(moved))
    angles.append(float(ang))
    print(f"    {joint:22s} -> {palm:20s} rotated {ang:6.2f} deg, parts moved up to {moved * 1000:6.2f} mm")
if len(gaps) == 2:
    print(f"    angle difference {abs(angles[0] - angles[1]):.2e} deg, displacement difference {abs(gaps[0] - gaps[1]) * 1e6:.1f} µm")
sym_ok = len(gaps) == 2 and abs(gaps[0] - gaps[1]) < 1e-5 and gaps[0] > 1e-6 and abs(angles[0] - angles[1]) < 1e-6

# --- test 4: every digit stays in one piece (PR-2089 follow-up) ----------
prox = {}
for j in red_robot.findall("joint"):
    par = j.find("parent").get("link")
    chi = j.find("child").get("link")
    if "proximal" in par and "distal" in chi:
        prox.setdefault(par, []).append(chi)


def bend(j):
    return -0.5 if j.get("name", "").startswith("j1") else 0.0


f0, _, _ = fk(red_robot, None)
f1, _, _ = fk(red_robot, bend)
print("\n[4] digits stay attached when the proximal joint bends -0.5 rad")
worst_gap, moved_min = 0.0, 9e9
for parent, kids in prox.items():
    for kid in kids:
        if parent not in f0 or kid not in f0:
            continue
        d0 = np.linalg.norm(f0[parent][:3, 3] - f0[kid][:3, 3])
        d1 = np.linalg.norm(f1[parent][:3, 3] - f1[kid][:3, 3])
        worst_gap = max(worst_gap, abs(d0 - d1))
        moved = np.linalg.norm(f1[kid][:3, 3] - f0[kid][:3, 3])
        moved_min = min(moved_min, moved)
        print(f"    {parent:26s} -> {kid:24s} gap {d0*1000:7.2f} mm -> {d1*1000:7.2f} mm, moved {moved*1000:6.1f} mm")
print(f"    worst gap change {worst_gap*1e6:.1f} µm, smallest movement {moved_min*1000:.1f} mm")
digit_ok = worst_gap < 1e-6 and moved_min > 1e-3

# --- structural ---
names = [j.get("name") for j in red_robot.findall("joint")]
print("\nstructural")
print("  duplicate joint names:", [n for n, c in collections.Counter(names).items() if c > 1] or "none")
print("  joint types:", dict(collections.Counter(j.get("type") for j in red_robot.findall("joint"))))
print("  links without collision:", [l.get("name") for l in red_robot.findall("link") if l.find("collision") is None] or "none")
print("  links without inertial:", [l.get("name") for l in red_robot.findall("link") if l.find("inertial") is None] or "none")
mass = sum(float(l.find("inertial/mass").get("value")) for l in red_robot.findall("link") if l.find("inertial") is not None)
print(f"  total mass: {mass:.3f} kg (source: "
      f"{sum(float(l.find('inertial/mass').get('value')) for l in src_robot.findall('link') if l.find('inertial') is not None):.3f} kg)")
print("  revolute without limits:", [j.get("name") for j in red_robot.findall("joint")
                                     if j.get("type") == "revolute" and j.find("limit") is None] or "none")
miss = [el.get("filename") for el in red_robot.iter("mesh") if el.get("filename")
        and not os.path.isfile(el.get("filename").replace("package://pib/", str(ROOT) + "/"))]
print("  unresolvable meshes:", miss or "none")
print("  visual/collision elements:", len(red_robot.findall("link/visual")), "/", len(red_robot.findall("link/collision")))

ok = (max(errs) < 1e-4 if errs else True) and dup_only and worst[0] < 1e-6 and not un_red and sym_ok and digit_ok
print("\nRESULT:", "PASS" if ok else "FAIL")
sys.exit(0 if ok else 1)
