# Working on pib-3d

## What is generated, what is hand-written

| file | who owns it |
|---|---|
| `urdf/pib.urdf` | Onshape. Replace it with a new export, never edit it. |
| `urdf/pib.control.urdf` | `tools/urdf_reduce.py`. Never edit by hand. |
| `reduce_summary.json` | the reducer (maps links to the CAD parts inside them) |
| `web/model.json` | `tools/build_web_assets.py` |
| `web/meshes/` | `tools/build_web_assets.py`, not in git |
| `docs/pib.control.tree.png` | `tools/urdf_tree.py` |
| everything else | hand-written |

## A change to the reduction

1. Edit `tools/urdf_reduce.py` (the `KEEP_EXACT` set and `DROP_RE` decide what
   counts as a real axis; the comment above each stage says why).
2. `make reproduce && make verify` — the regenerated URDF must be identical
   to the committed one, and all four verification tests must pass.
3. `make assets` and look at the viewer before you open the PR.

## A new CAD export

1. Replace `urdf/pib.urdf` and `meshes/`.
2. `make check-meshes` (case-sensitive, catches renames).
3. `make reproduce` — the reducer prints any joint it cannot classify as
   `UNCLASSIFIED … -> collapsed`. Read that list before committing.
4. `make verify`, `make assets`, `make tree`.

## Pull requests

- One topic per PR, branch from `main`, name it after the ticket
  (`PR-2089-left-wrist`).
- CI runs `make verify`, the reproducibility check and `make check-meshes`.
  A red check is a real failure, not noise: the tests compare against the
  export, they do not just parse XML.
- Say in the description what changed in the model (joints, links, mass) and
  what you measured — numbers, not impressions.

## Naming

CAD part names are the contract with Onshape (`a01_face`, `c36_elbow_lower_shell_1`).
Keep them in links; the joint names follow the export too. New joints that the
export does not have get a speaking name and a comment in the reducer.
