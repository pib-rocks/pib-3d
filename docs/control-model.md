# Control model — `urdf/pib.control.urdf`

`urdf/pib.control.urdf` is the reduced, simulation- and controller-friendly
version of the Onshape export `urdf/pib.urdf`. The export is kept unchanged
next to it as the provenance copy.

## What changed

| | Onshape export | control model |
|---|---|---|
| links | 351 | **49** |
| joints | 350 | **48** |
| joint types | 243 fixed, 42 revolute, 20 prismatic, 45 continuous | **44 revolute, 4 continuous** |
| kinematic loops | 31 loop-closure joints, 38 four-bar joints | **none** |
| collision geometry | 0 links | **every link, 395 elements** |
| mass | 14.412 kg | **14.412 kg** |
| duplicate parts | 4 exact copies at the same pose | removed |

302 joints were welded away. Their parts are still there — the meshes moved
into the parent link, the masses were summed and the inertia tensors moved
with the parallel-axis theorem, so nothing is lost but the joints.

Removed, by category:

- **243 fixed mates** (`fastened*`, `cable_axis`, `calibration_axis`,
  `clamp_left/right`, `upper_shell_lock`, `fixed_node_to_root_joint`, …) —
  every screw in the assembly was exported as a fixed joint.
- **32 finger four-bar couplings** (`j4`, `j5`, `j6`, `j7` families) and
  **31 loop-closure joints** — the exporter models each phalanx twice: once
  as a hinge and once through a bar plus a prismatic joint that closes the
  loop. URDF cannot express a loop, so the parallel path is dropped.
- **4 thumb four-bar joints** (`cylindrical_1*`) and **2 forearm bar joints**
  (`revolute_3*`) — same pattern.

## Corrections against the export

- **Left wrist roll restored (PR-2089).** The export welds the left palm to
  the forearm with a *fixed* joint named `rotation_wrist`, while the right arm
  carries the same mate as a continuous joint `rotation_wrist_right`. Both arms
  are built the same way, so the model adds `rotation_wrist_left` as the mirror
  of the right one: same type (continuous), same axis (1 0 0 in the joint
  frame), origin taken from the weld so no part moves.
- **Service doors rest closed.** The CAD draws the two back doors open
  (0 rad = flap out, −90° = flush). A control model should rest closed, so the
  joint origin absorbs the −90°: **0° = flush, +90° = open**. Closed depth is
  0.209 m, open 0.359 m.
- **Four duplicate parts dropped.** `C65_Bracket_Outer_Shoulder` and
  `C68_Inner_Ring_Outer_Shoulder` sat twice at exactly the same pose, a
  leftover of the exporter's loop handling.

## The model that is left

- **Body** — `root` carries everything rigid (100 CAD parts, 196 meshes,
  6.89 kg): ribcage, clavicles, electronics, power bay, both door hinges.
- **Head** — 2 axes: `gearing_rotation__new_body_` (±90°) inside
  `a71_inner_part`, `nodding_rotation` (±45°) at `a81_motor_shaft`.
- **Arms** — 7 axes each: `rotation_inner_shoulder` (continuous, the ring),
  `rotation_shoulder_left` (±90°), `central_rotator_rotation` (±90°),
  `rotation_elbow` (±67.5°), `rotate_forearm` (±90°), `dof_wrist` (±90°),
  `rotation_wrist_left` / `rotation_wrist_right` (continuous).
- **Hands** — every digit has its proximal hinge (`j1*`, −90…0°) plus, where
  the export has one, a distal hinge (`j2*`/`j3*`, −90…0°) and the thumb
  rotator (`revolute_1`, +120…0° right, −120…0° left).

All 351 CAD part names survive the merge: `reduce_summary.json` maps every
link to the parts it absorbed, and the viewer shows that list.

## Approximations you should know about

1. **Each finger's four-bar is replaced by a serial hinge.** The nine digits
   that had no serial distal joint got one (`d54_finger_distal_*_hinge`,
   `d58_thumb_tip*_hinge`) with the export's own axis and the −90…0° range
   the export declares for every finger hinge. It reproduces the zero pose
   exactly, but it is *not* the real coupling: in hardware the distal follows
   the proximal through the bar, with a non-linear ratio. If the linkage ratio
   matters, that has to be modelled as a loop (SDF/MuJoCo/Isaac) or as
   measured `mimic` joints.
2. **Four joints are continuous**, i.e. unlimited: the two inner-shoulder
   rings and the two wrist rolls. The export gives them no limits; none were
   invented.
3. **Collision = visual mesh.** Every visual element got a collision element
   with the same mesh, so the model is collision-capable but heavy: 395 GLB
   elements, 105 MB. Physics engines that convexify at load (PyBullet, MuJoCo)
   work; per-link convex hulls are the next step if load time hurts.
4. **No `mimic` joints, no transmissions, no ros2_control config** — the
   model is geometry and kinematics, not the drive train.
5. **Mass of welded-away parts sits inside the parent link**, so per-link
   masses are not the CAD part masses; the total (14.412 kg) is unchanged.

## How it was verified

Four tests, all run against the original export (`make verify`):

1. **Zero pose, part by part.** All 395 mesh instances land on the same world
   positions as in the export; worst deviation **3.2 × 10⁻⁸ m**. The four
   missing instances are the exporter's own duplicate copies, and the report
   confirms each removed copy sat exactly on a copy that remains.
2. **Posed, frame by frame.** Every kept joint driven to the middle of its
   range; each comparable link's absolute frame matches the export to
   **6.8 × 10⁻⁹**. Links below a synthesised finger hinge are excluded here
   (their drive differs by design) and covered by test 1.
3. **Wrist symmetry.** Both wrist rolls at +0.3 rad: each palm rotates
   **17.19°**, its parts move up to **29.90 mm**; the two sides differ by
   **4.6 × 10⁻¹⁴°** and **1.8 µm**.
4. **Digits stay in one piece.** Proximal joints bent by −0.5 rad: the gap
   between proximal and distal changes by **0.0 µm**, the distal moves
   **15.5 mm**.

`yourdfpy` loads the file as a 48-joint, 49-link robot and computes forward
kinematics without complaint.

## The browser viewer

`web/` is a static three.js viewer (three r160, vendored — no CDN).

```bash
make assets      # bake web/meshes/<link>.glb from meshes/ (trimesh, ~60 s)
make serve       # http://localhost:8099/
```

- 49 links, 48 joints, 2,542,604 triangles, 395 parts in 49 GLB files.
- One slider per joint with its real range, grouped head / left arm / right
  arm / left hand / right hand / body.
- **Click a part** to select the joint that moves it: the row is highlighted,
  the list scrolls to it, the slider takes focus (arrow keys adjust it), and
  the part is tinted. Clicking a welded part (the torso) keeps the selection.
- The info box under the list names the link, its joint and the CAD parts it
  is made of; hovering shows link name and part count.

`pib.control.tree.png` is the kinematic tree with joint limits.
