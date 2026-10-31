# pib-3d

The robot model of the pib: the Onshape export, the reduced control model we
build on, and a browser viewer to look at it.

| path | what it is |
|---|---|
| `urdf/pib.urdf` | the raw Onshape export (351 links, 350 joints) — provenance, never edited by hand |
| `urdf/pib.control.urdf` | the reduced model we use (49 links, 48 joints, collision geometry, no kinematic loops) — generated, see `tools/` |
| `meshes/` | the 130 CAD parts as glTF binaries, referenced by both URDFs |
| `launch/` | ROS 2 launch file for the control model; the original ROS 1 file is kept as `pib.launch` |
| `web/` | three.js viewer: orbit, joint sliders, click a part to select its joint |
| `tools/` | the reducer, the verifier, the visibility bake, the web asset builder, the static server |
| `docs/` | what the control model is, how it was verified, and which parts are invisible |

## Quickstart

```bash
git clone https://github.com/pib-rocks/pib-3d && cd pib-3d

# the viewer needs its meshes baked per link (~60 s, needs trimesh)
python3 -m venv .venv && . .venv/bin/activate
pip install trimesh numpy
make assets

make serve            # http://localhost:8099/
```

`make verify` checks the control model against the export (numpy only, runs in
CI). `make tree` redraws `docs/pib.control.tree.png` (needs matplotlib).

## Using the model in ROS

The repository is a plain `ament_cmake` package named `pib`:

```bash
colcon build --packages-select pib
ros2 launch pib pib_control.launch.py
```

Everything is in metres, Z is up, `root` is the CAD origin (inside the body,
not at the feet — the viewer lifts the model so its lowest point rests on the
floor plane).

## What "control model" means here

The export contains every screw as a fixed joint and every four-bar linkage as
a set of parallel joints plus loop closures — a tree no controller can consume.
The reducer welds everything that is not a real axis into its parent (meshes,
mass and inertia carried along), keeps one joint per physical degree of
freedom, restores the left wrist roll the export had typed as a fixed mate
(PR-2089), and gives every link collision geometry from its meshes.

Parts that can never be seen from outside lose their geometry too — but only
after a measurement, not from a hand-kept list: `tools/visibility_bake.py`
ray-casts the whole assembly from 32 directions in two poses (doors closed and
open) and writes `docs/visibility.json`. 40 of 399 instances (5.4 % of the
triangles) are never hit; they keep their mass and inertia, only their meshes
go. `visual_overrides.json` is the escape hatch for exceptions in both
directions.

`docs/control-model.md` has the numbers, the list of what was dropped and the
approximations that remain.

## Contributing

See `CONTRIBUTING.md`. Short version: never edit `urdf/pib.control.urdf` by
hand, run `make verify` before you open a pull request, and keep the CAD names.
