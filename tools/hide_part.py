#!/usr/bin/env python3
"""Tell the model which parts we do not want to show.

    python3 tools/hide_part.py a01_face b49_hinge_plate      # never show these
    python3 tools/hide_part.py --keep c63_motor_axis_inner_shoulder
    python3 tools/hide_part.py --remove a01_face
    python3 tools/hide_part.py --list
    python3 tools/hide_part.py --search cable

Part names are the CAD names from the export; clicking a part in the viewer
shows its name. Edits `visual_overrides.json`; run `make reduce assets` (or
`make verify` first) to apply.
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OVERRIDES = os.path.join(ROOT, "visual_overrides.json")
VISIBILITY = os.path.join(ROOT, "docs", "visibility.json")


def load():
    data = {"keep": [], "drop": []}
    if os.path.isfile(OVERRIDES):
        data.update(json.load(open(OVERRIDES)))
    return {"keep": list(dict.fromkeys(data.get("keep", []))),
            "drop": list(dict.fromkeys(data.get("drop", [])))}


def save(data):
    with open(OVERRIDES, "w") as fh:
        json.dump({k: sorted(v) for k, v in data.items()}, fh, indent=2)
        fh.write("\n")


def main(argv):
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__)
        return 0
    data = load()

    if argv[0] == "--list":
        for key in ("drop", "keep"):
            print(f"{key} ({len(data[key])}):")
            for name in data[key]:
                print("   ", name)
        return 0

    if argv[0] == "--search":
        needle = argv[1].lower()
        names = set()
        if os.path.isfile(VISIBILITY):
            names = {p["part"] for p in json.load(open(VISIBILITY)).get("parts", [])}
        hits = sorted(n for n in names if needle in n.lower())
        print(f"{len(hits)} part(s) matching {needle!r}:")
        for n in hits:
            print("   ", n)
        return 0

    target = "drop"
    rest = argv
    if argv[0] in ("--keep", "--drop", "--remove"):
        target = argv[0].lstrip("-")
        rest = argv[1:]

    if target == "remove":
        removed = []
        for name in rest:
            for key in ("drop", "keep"):
                if name in data[key]:
                    data[key].remove(name)
                    removed.append(f"{name} ({key})")
        save(data)
        print("removed:", ", ".join(removed) or "nothing matched")
        return 0

    added = []
    for name in rest:
        if name not in data[target]:
            data[target].append(name)
            added.append(name)
    save(data)
    print(f"{target}: +{len(added)} ({', '.join(added) or 'nothing new'})")
    print("now: make reduce && make assets   (or make verify to check the model first)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
