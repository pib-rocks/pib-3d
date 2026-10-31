#!/usr/bin/env python3
"""Check that the mesh references in both URDFs resolve, and that nothing in
meshes/ is unused. Case matters: the FAT stick is case-insensitive, Linux is not.
"""
import os
import sys
import xml.etree.ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MESH_DIR = os.path.join(ROOT, "meshes")
URDFS = ["urdf/pib.urdf", "urdf/pib.control.urdf"]


def main():
    on_disk = {f for f in os.listdir(MESH_DIR) if f.lower().endswith(".glb")}
    if not on_disk:
        print(f"no glb files in {MESH_DIR}")
        return 1
    used = set()
    problems = []
    for rel in URDFS:
        path = os.path.join(ROOT, rel)
        robot = ET.parse(path).getroot()
        refs = [str(el.get("filename")) for el in robot.iter("mesh") if el.get("filename")]
        print(f"{rel}: {len(robot.findall('link'))} links, {len(set(refs))} distinct meshes")
        for ref in refs:
            if not ref.startswith("package://pib/meshes/"):
                problems.append(f"{rel}: not under package://pib/meshes/: {ref}")
                continue
            name = ref.rsplit("/", 1)[-1]
            used.add(name)
            if name not in on_disk:
                problems.append(f"{rel}: missing file meshes/{name}")

    unused = sorted(on_disk - used)
    if unused:
        problems.append(f"{len(unused)} unused file(s) in meshes/: {', '.join(unused[:5])}")
    print(f"meshes/ on disk: {len(on_disk)}, referenced: {len(used)}, unused: {len(unused)}")

    for p in problems:
        print("  ! " + p)
    print("RESULT:", "PASS" if not problems else "FAIL")
    return 0 if not problems else 1


if __name__ == "__main__":
    sys.exit(main())
