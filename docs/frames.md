# Frame and unit contract (PR-2150)

The `@pib/robot-view` package exposes poses in a single **REP-103 base frame** attached to
the robot foot point, with **Z up**. Joint angles in the public API are always **radians**;
degrees appear only in the panel UI via `joints/math.ts`.

## Base frame

At the zero pose, the viewer takes the lowest point of the loaded CAD geometry as the floor and
the `root` link's X/Z as the axis, so an opened service lid cannot move the origin sideways. The
model is seated on the grid by shifting `modelRoot` down by that amount - the old
`liftModelToFloor()` blind shift is gone, and the foot point is the explicit origin.

`getPose()` reports the base as **0, 0, 0 by definition** - it *is* the frame. Reports of the
`root` link position were dropped: the root sits inside the body and read like a 0.77 m offset.
Positions are in **metres**, Z up, in this frame.

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
matches the SDK within 1 mm. `tools/fk_reference.py` records SDK palm positions for fixed joint vectors
(keyed by URDF joint name via `joints/mapping.json`), and
`packages/robot-view/test/fkReference.test.ts` compares **how far the hand travels** between two
poses - a frame-invariant number - against the SDK. Absolute positions cannot be compared: the two
base frames are defined differently, so the difference would be dominated by a constant offset.

Measured with the real pib-sdk (`ArmKinematics`, pinocchio) on build `0770fee55b36`: the worst
difference in hand travel between two poses is **75.4 mm** (right arm, elbow bend). The test's
tolerance is **80 mm** and is a **regression guard**: it does not claim the models agree - they do
not - it fails when the difference changes, which means the CAD or the SDK geometry moved.

Closing this gap belongs to the model-alignment follow-up **PR-2158** (shared URDF / segment
lengths between the viewer CAD export and pib-sdk).

## Regenerating the reference

```bash
PYTHONPATH=/path/to/pib-sdk/src python3 tools/fk_reference.py --write
PYTHONPATH=/path/to/pib-sdk/src python3 tools/fk_reference.py --check
cd packages/robot-view && npm test -- test/fkReference.test.ts
```

After intentional model changes, re-run the vitest, update `toleranceMm` in
`tools/fk_reference.json` if the measured difference really changed, and say why in the commit.
