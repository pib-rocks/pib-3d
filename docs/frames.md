# Frame and unit contract (PR-2150)

The `@pib/robot-view` package exposes poses in a single **REP-103 base frame** attached to
the robot foot point, with **Z up**. Joint angles in the public API are always **radians**;
degrees appear only in the panel UI via `joints/math.ts`.

## Base frame

At the zero pose, the viewer finds the lowest point of the loaded CAD geometry (centre of the
bottom of the axis-aligned bounding box) and defines that as the **foot point**. The model is
seated on the grid by shifting `modelRoot` so the foot point sits on the ground plane; this
replaces the old `liftModelToFloor()` blind shift with the same visual result, but the foot
point is now the explicit origin of the base frame.

The `root` link origin is reported as **base** in `getPose()`. Positions are returned in
**metres** relative to the foot point, with axes aligned to the seated model (Z up).

## TCP (provisional)

Until PR-2057 defines the operational hand frame, the TCP is the palm link origin:

| Arm   | URDF link            | Property   |
|-------|----------------------|------------|
| Right | `d01_r_palm_right`   | `tcpLink` default |
| Left  | `d01_l_palm_left`    | set `poseSide` / `tcpLink` |

## Pose API

```ts
getPose(side?: 'left' | 'right'): { base: {x,y,z}, hand: {x,y,z} } | null
```

- Values are in **metres** in the base frame.
- The panel readout shows **millimetres** for base and TCP.
- A `posechange` event is dispatched when the pose updates.

## CAD vs pib-sdk forward kinematics

The bundled **Onshape / control URDF** in this repository is geometry-rich; **pib-sdk** uses an
idealized URDF (segment lengths differ by roughly 5–15 mm). We do **not** assume the viewer
matches the SDK within 1 mm. Instead, `tools/fk_reference.py` records SDK palm positions for
fixed joint vectors (keyed by URDF joint name via `joints/mapping.json`), and
`packages/robot-view/test/fkReference.test.ts` computes the viewer FK and asserts per-axis
deltas stay inside a **measured envelope** (recorded maximum + 1 mm).

Measured deltas on build `0770fee55b36` (TCP palm origin, mm):

| Case               | Δx   | Δy   | Δz    |
|--------------------|------|------|-------|
| zero_right         | 81.4 | 17.2 | 298.8 |
| sdk_smoke_right    | 68.8 | 20.9 | 304.1 |
| shoulder_lift_right| 81.4 | 46.3 | 323.2 |
| elbow_bend_right   | 73.8 | 58.5 | 362.5 |
| zero_left          | 43.0 | 17.4 | 282.7 |

Recorded guard envelope (max + 1 mm): **Δx ≤ 82.4**, **Δy ≤ 59.5**, **Δz ≤ 363.5**.

Closing this gap belongs to the model-alignment follow-up **PR-2158** (shared URDF / segment
lengths between the viewer CAD export and pib-sdk).

## Regenerating the reference

```bash
PYTHONPATH=/path/to/pib-sdk/src python3 tools/fk_reference.py --write
PYTHONPATH=/path/to/pib-sdk/src python3 tools/fk_reference.py --check
cd packages/robot-view && npm test -- test/fkReference.test.ts
```

After intentional model changes, re-run the vitest, update `envelopeMm` in
`tools/fk_reference.json` if needed, and refresh the table above.
