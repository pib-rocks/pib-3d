#!/usr/bin/env python3
"""Compare two generated URDFs numerically.

The reducer is deterministic per Python/numpy build, but the last digits of a
trigonometric result move between versions. Byte identity is therefore the
wrong gate for CI: this compares structure exactly and every number to a
tolerance, so a real change (a moved joint, a different mesh, a changed mass)
still fails.

    python3 tools/compare_urdf.py a.urdf b.urdf [--tol 1e-9]
"""
import sys
import math
import xml.etree.ElementTree as ET

NUMERIC = {"xyz", "rpy", "lower", "upper", "effort", "velocity", "value", "ixx", "ixy",
           "ixz", "iyy", "iyz", "izz", "scale", "radius", "length"}


def numbers(text):
    return [float(v) for v in text.replace(",", " ").split()]


def close(a, b, tol):
    return abs(a - b) <= tol * max(1.0, abs(a), abs(b))


def compare(path_a, path_b, tol):
    a = ET.parse(path_a).getroot()
    b = ET.parse(path_b).getroot()
    problems = []

    def walk(ea, eb, where):
        if ea.tag != eb.tag:
            problems.append(f"{where}: tag {ea.tag} != {eb.tag}")
            return
        for key in sorted(set(ea.attrib) | set(eb.attrib)):
            va, vb = ea.attrib.get(key), eb.attrib.get(key)
            if va == vb:
                continue
            if va is None or vb is None:
                problems.append(f"{where}: attribute {key} only on one side")
                continue
            if key in NUMERIC:
                try:
                    na, nb = numbers(va), numbers(vb)
                except ValueError:
                    problems.append(f"{where}: {key} {va!r} != {vb!r}")
                    continue
                if len(na) != len(nb) or not all(close(x, y, tol) for x, y in zip(na, nb)):
                    problems.append(f"{where}: {key} {va} != {vb}")
            else:
                problems.append(f"{where}: {key} {va!r} != {vb!r}")
        ca, cb = list(ea), list(eb)
        if len(ca) != len(cb):
            problems.append(f"{where}: {len(ca)} children != {len(cb)}")
        for i, (x, y) in enumerate(zip(ca, cb)):
            walk(x, y, f"{where}/{x.tag}[{i}]")

    walk(a, b, "")
    for p in problems[:25]:
        print("  !", p)
    if len(problems) > 25:
        print(f"  … and {len(problems) - 25} more")
    print(f"compared {path_a} with {path_b} (tolerance {tol:g}): "
          f"{'IDENTICAL' if not problems else f'{len(problems)} difference(s)'}")
    return 0 if not problems else 1


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    tol = 1e-9
    for a in sys.argv[1:]:
        if a.startswith("--tol"):
            tol = float(a.split("=", 1)[1])
    if len(args) != 2:
        sys.exit(__doc__)
    sys.exit(compare(args[0], args[1], tol))
