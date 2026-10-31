#!/usr/bin/env python3
"""Pack the robot model into one archive the backend can install.

Contents (see pib-backend docs/robot-model.md):

    version.json      {"version": "...", "sha256": {"model.json": "...", "mapping.json": "..."}}
    model.json
    mapping.json
    meshes/*.glb

Usage:
    python tools/pack_robot_model.py --version v0.1.1 --out dist/robot-model-v0.1.1.zip
"""
import argparse
import hashlib
import json
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--version", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--web", default=str(ROOT / "web"))
    ap.add_argument("--mapping", default=str(ROOT / "joints" / "mapping.json"))
    args = ap.parse_args()

    web = Path(args.web)
    mapping = Path(args.mapping)
    model = web / "model.json"
    meshes = web / "meshes"

    for path in (model, mapping):
        if not path.is_file():
            print(f"missing {path}", file=sys.stderr)
            return 2
    if not meshes.is_dir() or not any(meshes.glob("*.glb")):
        print(f"missing meshes in {meshes} (run tools/build_web_assets.py)", file=sys.stderr)
        return 2

    model_json = json.loads(model.read_text())
    joint_count = len(model_json.get("joints", []))
    glbs = sorted(meshes.glob("*.glb"))

    version = {
        "version": args.version,
        "modelBuild": model_json.get("build"),
        "links": len(model_json.get("links", [])),
        "joints": joint_count,
        "sha256": {"model.json": sha256(model), "mapping.json": sha256(mapping)},
    }

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        zf.writestr("version.json", json.dumps(version, indent=2) + "\n")
        zf.write(model, "model.json")
        zf.write(mapping, "mapping.json")
        for glb in glbs:
            zf.write(glb, f"meshes/{glb.name}")

    size = out.stat().st_size
    print(json.dumps({"archive": str(out), "bytes": size, "sha256": sha256(out),
                      "meshes": len(glbs), "joints": joint_count}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
