# tools

Everything that turns the Onshape export into the model we use is scripted, so
a new export can be processed again without hand work.

```bash
python3 tools/urdf_reduce.py       # urdf/pib.urdf      -> urdf/pib.control.urdf
python3 tools/urdf_verify.py       # compares both, prints PASS/FAIL
python3 tools/check_meshes.py      # every mesh reference resolves, none unused
python3 tools/compare_urdf.py a.urdf b.urdf   # structure exact, numbers to 1e-9
python3 tools/build_web_assets.py  # urdf -> web/model.json + web/meshes/*.glb
python3 tools/visibility_bake.py   # ray-casts the model -> docs/visibility.json
python3 tools/urdf_tree.py         # draws docs/pib.control.tree.png
python3 tools/serve_web.py 8099    # static viewer
```

`urdf_reduce.py` welds every joint that is not a real axis (fixed mates, loop
closures, four-bar couplings), moves each part's mesh, mass and inertia into
the link that remains, restores the left wrist roll (PR-2089) and puts the
doors into their closed rest pose. `urdf_verify.py` drives both models and
requires the parts to land in the same place.

Dependencies: `numpy` for the reducer and the verifier, `trimesh` for the web
assets and the bake, `open3d` (Embree) for the visibility rays, `matplotlib`
for the tree picture.

`visibility_bake.py` merges all 399 visual instances into one triangle soup,
ray-casts it from 32 directions in two door poses and records how many views
each instance wins. The reducer drops the geometry of the instances that never
win a pixel — the mass and inertia stay in the link. `visual_overrides.json`
lists parts to keep or drop regardless of the measurement.

After replacing `urdf/pib.urdf` with a newer export, read its joint names
before running: `KEEP_EXACT` and `DROP_RE` in `urdf_reduce.py` are written
against this naming. The reducer prints anything it cannot classify.
