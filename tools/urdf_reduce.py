#!/usr/bin/env python3
"""Reduce an Onshape URDF export to a clean control model.

Rules:
  * every joint in KEEP survives (real axis)
  * every other joint is collapsed: its child link is welded into the parent
    group at its zero configuration (visuals, collisions and inertia carried
    along, inertia with parallel-axis theorem), so no kinematic loop, no
    duplicate mate, no fixed-joint clutter remains
  * collision geometry is derived from the same mesh as the visual
"""
import pathlib
import re
import sys
import json
import copy
import numpy as np
import xml.etree.ElementTree as ET

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = str(ROOT / "urdf" / "pib.urdf")
VISIBILITY = ROOT / "docs" / "visibility.json"
OVERRIDES = ROOT / "visual_overrides.json"
OUT = str(ROOT / "urdf" / "pib.control.urdf")
MIN_MASS = 0.001

# --- joint classification -------------------------------------------------
# names that carry a real degree of freedom of the machine
KEEP_EXACT = {
    "central_rotator_rotation", "central_rotator_rotation_1",
    "dof_wrist", "dof_wrist_1",
    "gearing_rotation__new_body_",
    "nodding_rotation",
    "rotate_forearm", "rotate_forearm_1",
    "rotation_elbow", "rotation_elbow_1",
    "rotation_inner_shoulder", "rotation_inner_shoulder_1",
    "rotation_shoulder_left", "rotation_shoulder_left_1",
    "rotation_wrist_right",
    "revolute_1", "revolute_1_1",
    "upper_door_rotation", "lower_door_rotation",
}
KEEP_RE = re.compile(r"^j[123](_\d+)?$")          # finger: proximal, distal, tip
DROP_RE = re.compile(r"loop_closure|^j[4567](_\d+)?$|^cylindrical_1|^revolute_3|^revolute$")



def instance_key(link, vis):
    """Same key the visibility bake writes: link, mesh file, own origin."""
    mesh = vis.find("geometry/mesh")
    if mesh is None:
        return None
    o = vis.find("origin")
    oxyz = parse_vec(o.get("xyz")) if o is not None else np.zeros(3)
    name = (mesh.get("filename") or "").rsplit("/", 1)[-1]
    return f"{link}|{name}|{oxyz[0]:.6f},{oxyz[1]:.6f},{oxyz[2]:.6f}"


def hide_rules():
    """What to drop, from the bake plus the manual overrides.

    `visual_overrides.json` takes part names (`a01_face`) or full instance keys
    (`a01_face|A01_Face.glb|0.000000,...`) — a name hits every instance of that
    part, a key hits exactly one.

    * `drop` wins over everything: this part is not shown, whatever the bake says.
    * `keep` protects a part the bake called invisible (sensor window, label,
      anything that becomes visible when a hatch opens further than measured).
    * a part the bake never saw is kept, so a new export cannot silently lose
      geometry.
    """
    keep, drop = [], []
    if OVERRIDES.exists():
        data = json.loads(OVERRIDES.read_text())
        keep = list(data.get("keep", []))
        drop = list(data.get("drop", []))
    baked = set()
    if VISIBILITY.exists():
        data = json.loads(VISIBILITY.read_text())
        baked = {p["key"] for p in data.get("parts", []) if not p.get("visible", True) and p.get("key")}
    return baked, set(keep), set(drop)


def is_hidden(key, link, baked, keep, drop):
    if key in drop or link in drop:
        return True
    if key in baked and not (key in keep or link in keep):
        return True
    return False


def rpy_matrix(r, p, y):
    cr, sr = np.cos(r), np.sin(r)
    cp, sp = np.cos(p), np.sin(p)
    cy, sy = np.cos(y), np.sin(y)
    Rx = np.array([[1, 0, 0], [0, cr, -sr], [0, sr, cr]])
    Ry = np.array([[cp, 0, sp], [0, 1, 0], [-sp, 0, cp]])
    Rz = np.array([[cy, -sy, 0], [sy, cy, 0], [0, 0, 1]])
    return Rz @ Ry @ Rx


def parse_vec(text, default=(0.0, 0.0, 0.0)):
    if not text:
        return np.array(default, dtype=float)
    parts = [float(x) for x in text.replace(",", " ").split()]
    while len(parts) < 3:
        parts.append(0.0)
    return np.array(parts[:3], dtype=float)


def joint_transform(j):
    o = j.find("origin")
    if o is None:
        return np.eye(3), np.zeros(3)
    return rpy_matrix(*parse_vec(o.get("rpy"))), parse_vec(o.get("xyz"))


def transform_element(el, R, t):
    """Move a visual/collision element into the target frame."""
    el = copy.deepcopy(el)
    o = el.find("origin")
    if o is None:
        o = ET.SubElement(el, "origin")
        ox, orpy = np.zeros(3), np.zeros(3)
    else:
        ox = parse_vec(o.get("xyz"))
        orpy = parse_vec(o.get("rpy"))
    new_t = R @ ox + t
    Ro = rpy_matrix(*orpy)
    Rn = R @ Ro
    # back to rpy
    sy = np.hypot(Rn[0, 0], Rn[1, 0])
    if sy > 1e-9:
        roll = np.arctan2(Rn[2, 1], Rn[2, 2]); pitch = np.arctan2(-Rn[2, 0], sy); yaw = np.arctan2(Rn[1, 0], Rn[0, 0])
    else:
        roll = np.arctan2(-Rn[1, 2], Rn[1, 1]); pitch = np.arctan2(-Rn[2, 0], sy); yaw = 0.0
    o.set("xyz", " ".join(f"{v:.9g}" for v in new_t))
    o.set("rpy", " ".join(f"{v:.9g}" for v in (roll, pitch, yaw)))
    return el


def main():
    tree = ET.parse(SRC)
    robot = tree.getroot()
    links = {l.get("name"): l for l in robot.findall("link")}
    joints = robot.findall("joint")

    keep, collapse = {}, []
    for j in joints:
        n, t = j.get("name"), j.get("type")
        if n in KEEP_EXACT or (KEEP_RE.match(n) and "loop_closure" not in n):
            keep[n] = j
        elif t == "fixed" or DROP_RE.search(n):
            collapse.append(j)
        else:
            print(f"UNCLASSIFIED joint {n} ({t}) -> collapsed", file=sys.stderr)
            collapse.append(j)

    # --- stage 2: give the digits back their distal hinge ------------------
    # The exporter drives each distal phalanx through a four-bar linkage
    # (coupling bar + prismatic + continuous joint), so the only serial path
    # to the distal runs through the bar. URDF cannot express that loop, so
    # each distal is re-attached to its phalanx base with the hinge the
    # exporter itself declares for that finger (revolute, -90..0 deg).
    joint_of_child_src = {j.find("child").get("link"): j for j in joints}
    collapsed_ids_src = {id(j) for j in collapse}
    reattach_re = re.compile(r"^(d54_finger_distal|d55_finger_tip|d58_thumb_tip)(_\d+)?$")
    synthesized = []

    def zero_frame(link):
        """Absolute frame of a link with every joint at zero."""
        R, t = np.eye(3), np.zeros(3)
        cur = link
        chain = []
        while cur in joint_of_child_src:
            chain.append(joint_of_child_src[cur])
            cur = joint_of_child_src[cur].find("parent").get("link")
        for j in reversed(chain):
            Rj, tj = joint_transform(j)
            t = t + R @ tj
            R = R @ Rj
        return R, t

    kept_children = {j.find("child").get("link") for j in keep.values()}
    for link in list(links):
        if not reattach_re.match(link) or "loop_closure" in link or link in kept_children:
            continue
        src = joint_of_child_src.get(link)
        if src is None or id(src) not in collapsed_ids_src:
            continue
        # The distal must hang off its phalanx base, not off the palm: the
        # four-bar bar is welded into the palm, so walking up alone attaches
        # the digit to the palm and the finger splits when the proximal joint
        # turns. Walk up the collapsed chain instead and attach to the first
        # link that drives a phalanx of the same digit.
        cur = src.find("parent").get("link")
        guard = 0
        while cur is not None and guard < 40:
            distal = next((k.find("child").get("link") for k in keep.values()
                           if k.find("parent").get("link") == cur and "distal" in k.find("child").get("link")), None)
            if distal is not None:
                cur = distal
                break
            proximal = next((k.find("child").get("link") for k in keep.values()
                             if k.find("parent").get("link") == cur and "proximal" in k.find("child").get("link")), None)
            if proximal is not None:
                cur = proximal
                break
            up = joint_of_child_src.get(cur)
            if up is None:
                break
            cur = up.find("parent").get("link")
            guard += 1
        Rc, tc = zero_frame(cur)
        Rl, tl = zero_frame(link)
        Rrel = Rc.T @ Rl
        trel = Rc.T @ (tl - tc)
        sy = np.hypot(Rrel[0, 0], Rrel[1, 0])
        if sy > 1e-9:
            rpy_v = (np.arctan2(Rrel[2, 1], Rrel[2, 2]), np.arctan2(-Rrel[2, 0], sy), np.arctan2(Rrel[1, 0], Rrel[0, 0]))
        else:
            rpy_v = (np.arctan2(-Rrel[1, 2], Rrel[1, 1]), np.arctan2(-Rrel[2, 0], sy), 0.0)
        rv = ET.Element("joint", {"name": f"{link}_hinge", "type": "revolute"})
        ET.SubElement(rv, "origin", {"xyz": " ".join(f"{v:.9g}" for v in trel),
                                     "rpy": " ".join(f"{v:.9g}" for v in rpy_v)})
        ET.SubElement(rv, "parent", {"link": cur})
        ET.SubElement(rv, "child", {"link": link})
        ET.SubElement(rv, "axis", {"xyz": (src.find("axis").get("xyz") if src.find("axis") is not None else "1 0 0")})
        ET.SubElement(rv, "limit", {"lower": "-1.5708", "upper": "0", "effort": "1", "velocity": "1"})
        keep[rv.get("name")] = rv
        joints.append(rv)
        collapse.remove(src)
        synthesized.append((link, src.get("name"), cur))

    # --- stage 3: symmetry correction (PR-2089) ---------------------------
    # The export welds the left palm straight onto the forearm, while the
    # right arm has a wrist roll joint at that point. The left arm is built
    # the same as the right, so the joint is restored as the mirror of the
    # right one: same type, same axis, zero pose untouched.
    sym_added = []
    right_wrist = keep.get("rotation_wrist_right")
    if right_wrist is not None:
        child_r = right_wrist.find("child").get("link")
        cands = [child_r.replace("_r_", "_l_").replace("_right", "_left"),
                 child_r.replace("_r_", "_l_"),
                 child_r.replace("right", "left").replace("_r_", "_l_")]
        child_l = next((c for c in cands if c in links), None)
        src_l = joint_of_child_src.get(child_l) if child_l else None
        if child_l in links and src_l is not None and src_l in collapse:
            parent_l = src_l.find("parent").get("link")
            Rp, tp = zero_frame(parent_l)
            Rl, tl = zero_frame(child_l)
            Rrel = Rp.T @ Rl
            trel = Rp.T @ (tl - tp)
            sy = np.hypot(Rrel[0, 0], Rrel[1, 0])
            if sy > 1e-9:
                rpy_v = (np.arctan2(Rrel[2, 1], Rrel[2, 2]), np.arctan2(-Rrel[2, 0], sy), np.arctan2(Rrel[1, 0], Rrel[0, 0]))
            else:
                rpy_v = (np.arctan2(-Rrel[1, 2], Rrel[1, 1]), np.arctan2(-Rrel[2, 0], sy), 0.0)
            rv = ET.Element("joint", {"name": "rotation_wrist_left", "type": right_wrist.get("type")})
            ET.SubElement(rv, "origin", {"xyz": " ".join(f"{v:.9g}" for v in trel),
                                         "rpy": " ".join(f"{v:.9g}" for v in rpy_v)})
            ET.SubElement(rv, "parent", {"link": parent_l})
            ET.SubElement(rv, "child", {"link": child_l})
            rax = right_wrist.find("axis")
            ET.SubElement(rv, "axis", {"xyz": rax.get("xyz") if rax is not None else "1 0 0"})
            rlim = right_wrist.find("limit")
            if rlim is not None:
                ET.SubElement(rv, "limit", dict(rlim.attrib))
            keep[rv.get("name")] = rv
            joints.append(rv)
            collapse.remove(src_l)
            sym_added.append((child_l, parent_l, src_l.get("name")))
            print(f"symmetry: restored rotation_wrist_left ({parent_l} -> {child_l}), "
                  f"replacing weld {src_l.get('name')}")

    # union-find over collapsed edges
    parent = {n: n for n in links}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    for j in collapse:
        union(j.find("parent").get("link"), j.find("child").get("link"))

    # every kept joint must stay between two different groups
    bad = [n for n, j in keep.items() if find(j.find("parent").get("link")) == find(j.find("child").get("link"))]
    if bad:
        sys.exit(f"ERROR: kept joints inside one welded group: {bad}")

    # accumulate geometry per group root
    # chains: link -> [(R,t), ...] of the collapsed joints from its group root
    # down to the link. Computed by memoised recursion along the parent edge,
    # so it does not depend on the order joints appear in the file.
    joint_of_child = {j.find("child").get("link"): j for j in joints}
    collapsed_ids = {id(j) for j in collapse}
    chain_memo = {}

    def chain_of(link):
        if link in chain_memo:
            return chain_memo[link]
        chain_memo[link] = []          # guards against a malformed tree
        j = joint_of_child.get(link)
        if j is None or id(j) not in collapsed_ids:
            chain_memo[link] = []
            return []
        p = j.find("parent").get("link")
        R, t = joint_transform(j)
        chain_memo[link] = chain_of(p) + [(R, t)]
        return chain_memo[link]

    chains = {n: chain_of(n) for n in links}

    group_members = {}
    for n in links:
        group_members.setdefault(find(n), []).append(n)

    baked_hidden, keep_set, drop_set = hide_rules()
    dropped_visuals = 0
    new_links = {}
    report_groups = {}
    for root_name, members in group_members.items():
        base = ET.Element("link", {"name": root_name})
        entries = []   # (mass, com, Itensor, R, t, element_visuals, element_collisions)
        seen_meshes = set()
        for m in sorted(members):
            el = links[m]
            R, t = np.eye(3), np.zeros(3)
            for (Rc, tc) in chains[m]:
                t = R @ tc + t
                R = R @ Rc
            # actually compose in order parent->child
            R2, t2 = np.eye(3), np.zeros(3)
            for (Rc, tc) in chains[m]:
                R2 = R2 @ Rc
                t2 = t2 + R2 @ tc if False else t2
            # explicit ordered composition
            R3, t3 = np.eye(3), np.zeros(3)
            for (Rc, tc) in chains[m]:
                t3 = t3 + R3 @ tc
                R3 = R3 @ Rc
            kept_visuals = []
            for v in el.findall("visual"):
                key = instance_key(m, v)
                if is_hidden(key, m, baked_hidden, keep_set, drop_set):
                    dropped_visuals += 1      # mass and inertia stay, the geometry goes
                else:
                    kept_visuals.append(v)
            for v in kept_visuals:
                tv = transform_element(v, R3, t3)
                mesh = tv.find("geometry/mesh")
                if mesh is not None:
                    o = tv.find("origin")
                    pos = tuple(np.round(parse_vec(o.get("xyz")) if o is not None else np.zeros(3), 6))
                    key = (mesh.get("filename"), pos)
                    if key in seen_meshes:
                        continue        # exporter's loop-closure copy: same part, same place
                    seen_meshes.add(key)
                base.append(tv)
            for c in el.findall("collision"):
                base.append(transform_element(c, R3, t3))
            inert = el.find("inertial")
            if inert is not None:
                mass = float(inert.find("mass").get("value"))
                io = inert.find("origin")
                com_local = parse_vec(io.get("xyz")) if io is not None else np.zeros(3)
                com = R3 @ com_local + t3
                Iel = inert.find("inertia")
                I = np.array([
                    [float(Iel.get("ixx")), float(Iel.get("ixy")), float(Iel.get("ixz"))],
                    [float(Iel.get("ixy")), float(Iel.get("iyy")), float(Iel.get("iyz"))],
                    [float(Iel.get("ixz")), float(Iel.get("iyz")), float(Iel.get("izz"))],
                ])
                entries.append((mass, com, R3 @ I @ R3.T))

        # collision geometry from the meshes: one collision per visual element
        for v in list(base.findall("visual")):
            col = ET.Element("collision")
            o = v.find("origin")
            if o is not None:
                col.append(copy.deepcopy(o))
            geom = ET.SubElement(col, "geometry")
            sg = v.find("geometry")
            if sg is not None:
                for child in list(sg):
                    geom.append(copy.deepcopy(child))
            base.append(col)

        total_mass = sum(e[0] for e in entries)
        if entries and total_mass > 0:
            com = sum(e[0] * e[1] for e in entries) / total_mass
            Itot = np.zeros((3, 3))
            for mass, c, I in entries:
                d = c - com
                Itot += I + mass * (np.dot(d, d) * np.eye(3) - np.outer(d, d))
            new_links[root_name] = base
            report_groups[root_name] = dict(members=sorted(members), mass=round(total_mass, 4))
        else:
            # massless group: keep geometry, give a minimal inertia so physics runs
            new_links[root_name] = base
            report_groups[root_name] = dict(members=sorted(members), mass=0.0, note="no inertial in source")

    # rebuild links with inertial where data exists
    out_links = []
    for name, el in new_links.items():
        # re-derive the inertial block from the accumulated entries by recomputing here
        out_links.append((name, el))

    # second pass: write inertials back (computed above but discarded) -> recompute cleanly
    for name, el in out_links:
        members = group_members[name]
        entries = []
        for m in sorted(members):
            li = links[m]
            R3, t3 = np.eye(3), np.zeros(3)
            for (Rc, tc) in chains[m]:
                t3 = t3 + R3 @ tc
                R3 = R3 @ Rc
            inert = li.find("inertial")
            if inert is None:
                continue
            mass = float(inert.find("mass").get("value"))
            io = inert.find("origin")
            com = R3 @ (parse_vec(io.get("xyz")) if io is not None else np.zeros(3)) + t3
            Iel = inert.find("inertia")
            I = np.array([
                [float(Iel.get("ixx")), float(Iel.get("ixy")), float(Iel.get("ixz"))],
                [float(Iel.get("ixy")), float(Iel.get("iyy")), float(Iel.get("iyz"))],
                [float(Iel.get("ixz")), float(Iel.get("iyz")), float(Iel.get("izz"))],
            ])
            entries.append((mass, com, R3 @ I @ R3.T))
        if not entries:
            ent = ET.Element("inertial")
            ET.SubElement(ent, "origin", {"xyz": "0 0 0", "rpy": "0 0 0"})
            ET.SubElement(ent, "mass", {"value": str(MIN_MASS)})
            ET.SubElement(ent, "inertia", {"ixx": "1e-6", "ixy": "0", "ixz": "0", "iyy": "1e-6", "iyz": "0", "izz": "1e-6"})
            el.insert(0, ent)
            continue
        tm = sum(e[0] for e in entries)
        if tm <= 0:
            continue
        com = sum(e[0] * e[1] for e in entries) / tm
        Itot = np.zeros((3, 3))
        for mass, c, I in entries:
            d = c - com
            Itot += I + mass * (np.dot(d, d) * np.eye(3) - np.outer(d, d))
        ent = ET.Element("inertial")
        ET.SubElement(ent, "origin", {"xyz": " ".join(f"{v:.9g}" for v in com), "rpy": "0 0 0"})
        ET.SubElement(ent, "mass", {"value": f"{tm:.9g}"})
        ET.SubElement(ent, "inertia", {
            "ixx": f"{Itot[0,0]:.9g}", "ixy": f"{Itot[0,1]:.9g}", "ixz": f"{Itot[0,2]:.9g}",
            "iyy": f"{Itot[1,1]:.9g}", "iyz": f"{Itot[1,2]:.9g}", "izz": f"{Itot[2,2]:.9g}",
        })
        el.insert(0, ent)

    # The two service doors are drawn open in the CAD (0 rad = flap out, the
    # lower limit -90 deg = flush). A control model should rest in the closed
    # state, so the origin absorbs the closing rotation and the joint range
    # starts at 0 = closed, +90 deg = open.
    doors_closed = []
    for name, j in keep.items():
        if not name.endswith("_door_rotation"):
            continue
        lim = j.find("limit")
        if lim is None:
            continue
        lower = float(lim.get("lower"))
        upper = float(lim.get("upper"))
        o = j.find("origin")
        if o is None:
            o = ET.SubElement(j, "origin")
            ox, orpy = np.zeros(3), np.zeros(3)
        else:
            ox = parse_vec(o.get("xyz"))
            orpy = parse_vec(o.get("rpy"))
        ax = j.find("axis")
        axis = parse_vec(ax.get("xyz"), (1, 0, 0)) if ax is not None else np.array([1.0, 0, 0])
        n = np.linalg.norm(axis)
        axis = axis / n if n else np.array([1.0, 0, 0])
        K = np.array([[0, -axis[2], axis[1]], [axis[2], 0, -axis[0]], [-axis[1], axis[0], 0]])
        Rclosing = np.eye(3) + np.sin(lower) * K + (1 - np.cos(lower)) * (K @ K)
        Rn = rpy_matrix(*orpy) @ Rclosing
        sy = np.hypot(Rn[0, 0], Rn[1, 0])
        if sy > 1e-9:
            rpy_new = (np.arctan2(Rn[2, 1], Rn[2, 2]), np.arctan2(-Rn[2, 0], sy), np.arctan2(Rn[1, 0], Rn[0, 0]))
        else:
            rpy_new = (np.arctan2(-Rn[1, 2], Rn[1, 1]), np.arctan2(-Rn[2, 0], sy), 0.0)
        o.set("xyz", " ".join(f"{v:.9g}" for v in ox))
        o.set("rpy", " ".join(f"{v:.9g}" for v in rpy_new))
        lim.set("lower", "0")
        lim.set("upper", f"{upper - lower:.9g}")
        doors_closed.append((name, float(round(np.degrees(upper - lower), 1))))

    # kept joints, remapped to group roots
    out_joints = []
    for n, j in keep.items():
        j = copy.deepcopy(j)
        p, c = j.find("parent").get("link"), j.find("child").get("link")
        newp, newc = find(p), find(c)
        # if the parent was welded upward, carry its chain transform into the origin
        o = j.find("origin")
        if newp != p or newc != c:
            # compute absolute frames of p and c (relative to their group roots)
            R3p, t3p = np.eye(3), np.zeros(3)
            for (Rc, tc) in chains[p]:
                t3p = t3p + R3p @ tc
                R3p = R3p @ Rc
            R3c, t3c = np.eye(3), np.zeros(3)
            for (Rc, tc) in chains[c]:
                t3c = t3c + R3c @ tc
                R3c = R3c @ Rc
            oR, ot = joint_transform(j)   # child frame in parent frame
            # the kept joint now hangs off the parent group root P: the joint
            # frame is p's frame moved up by p's chain into the group
            absR = R3p @ oR
            abst = R3p @ ot + t3p
            newR, newt = absR, abst
            if o is None:
                o = ET.SubElement(j, "origin")
            o.set("xyz", " ".join(f"{v:.9g}" for v in newt))
            sy = np.hypot(newR[0, 0], newR[1, 0])
            if sy > 1e-9:
                rpy = (np.arctan2(newR[2, 1], newR[2, 2]), np.arctan2(-newR[2, 0], sy), np.arctan2(newR[1, 0], newR[0, 0]))
            else:
                rpy = (np.arctan2(-newR[1, 2], newR[1, 1]), np.arctan2(-newR[2, 0], sy), 0.0)
            o.set("rpy", " ".join(f"{v:.9g}" for v in rpy))
        j.find("parent").set("link", newp)
        j.find("child").set("link", newc)
        out_joints.append(j)

    out = ET.Element("robot", {"name": robot.get("name")})
    used = {j.find("parent").get("link") for j in out_joints} | {j.find("child").get("link") for j in out_joints}
    for name, el in out_links:
        if name in used:
            out.append(el)
    for j in out_joints:
        out.append(j)
    ET.indent(out, space="    ")
    ET.ElementTree(out).write(OUT, encoding="utf-8", xml_declaration=False)

    summary = dict(
        source_joints=len(joints), source_links=len(links),
        kept_joints=len(out_joints), welded_joints=len(collapse),
        out_links=len(out.findall("link")),
        groups=report_groups,
    )
    with open(ROOT / "reduce_summary.json", "w") as fh:
        json.dump(summary, fh, indent=1)
    print("kept joints:", len(out_joints), "welded:", len(collapse), "links:", len(out.findall("link")))
    print("doors closed into the rest pose:", doors_closed)
    print("visuals dropped as invisible:", dropped_visuals, "source links")
    print("written:", OUT)


if __name__ == "__main__":
    if "--out" in sys.argv:
        OUT = sys.argv[sys.argv.index("--out") + 1]
    main()
