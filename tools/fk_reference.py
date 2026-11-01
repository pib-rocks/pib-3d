#!/usr/bin/env python3
"""SDK forward-kinematics reference for the viewer FK regression test."""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
MAPPING_PATH = REPO_ROOT / "joints" / "mapping.json"
OUT_PATH = Path(__file__).resolve().parent / "fk_reference.json"

ARM_URDF_JOINTS: dict[str, tuple[str, ...]] = {
    "right": (
        "rotation_inner_shoulder_1",
        "rotation_shoulder_left",
        "central_rotator_rotation",
        "rotation_elbow",
        "rotate_forearm",
        "rotation_wrist_right",
    ),
    "left": (
        "rotation_inner_shoulder",
        "rotation_shoulder_left_1",
        "central_rotator_rotation_1",
        "rotation_elbow_1",
        "rotate_forearm_1",
        "rotation_wrist_left",
    ),
}

CASES: list[dict] = [
    {
        "name": "zero_right",
        "side": "right",
        "jointsRad": {name: 0.0 for name in ARM_URDF_JOINTS["right"]},
    },
    {
        "name": "sdk_smoke_right",
        "side": "right",
        "jointsRad": {
            "rotation_inner_shoulder_1": 0.0,
            "rotation_shoulder_left": math.radians(30.0),
            "central_rotator_rotation": 0.0,
            "rotation_elbow": 0.0,
            "rotate_forearm": math.radians(45.0),
            "rotation_wrist_right": 0.0,
        },
    },
    {
        "name": "shoulder_lift_right",
        "side": "right",
        "jointsRad": {
            "rotation_inner_shoulder_1": math.radians(45.0),
            "rotation_shoulder_left": 0.0,
            "central_rotator_rotation": 0.0,
            "rotation_elbow": 0.0,
            "rotate_forearm": 0.0,
            "rotation_wrist_right": 0.0,
        },
    },
    {
        "name": "elbow_bend_right",
        "side": "right",
        "jointsRad": {
            "rotation_inner_shoulder_1": 0.0,
            "rotation_shoulder_left": math.radians(-30.0),
            "central_rotator_rotation": 0.0,
            "rotation_elbow": math.radians(-40.0),
            "rotate_forearm": 0.0,
            "rotation_wrist_right": 0.0,
        },
    },
    {
        "name": "zero_left",
        "side": "left",
        "jointsRad": {name: 0.0 for name in ARM_URDF_JOINTS["left"]},
    },
]


def model_rad_to_motor_rad(entry: dict, model_rad: float) -> float:
    direction = entry.get("direction") or 1
    gear = entry.get("gearRatio") or 1.0
    zero_deg = entry.get("zeroOffsetDeg") or 0.0
    motor_deg = (math.degrees(model_rad) + zero_deg) * direction / gear
    return math.radians(motor_deg)


def load_mapping_by_joint() -> dict[str, dict]:
    doc = json.loads(MAPPING_PATH.read_text(encoding="utf-8"))
    return {entry["urdfJoint"]: entry for entry in doc["joints"]}


def joints_rad_to_sdk_q(side: str, joints_rad: dict[str, float], by_joint: dict[str, dict]) -> list[float]:
    order = ARM_URDF_JOINTS[side]
    q: list[float] = []
    for name in order:
        entry = by_joint[name]
        model_rad = float(joints_rad.get(name, 0.0))
        q.append(model_rad_to_motor_rad(entry, model_rad))
    return q


def build_document() -> dict:
    from pib_sdk.kinematics import ArmKinematics

    by_joint = load_mapping_by_joint()
    cases_out = []
    for case in CASES:
        side = case["side"]
        arm = ArmKinematics(side)
        q = joints_rad_to_sdk_q(side, case["jointsRad"], by_joint)
        pose = arm.forward(q)
        t = pose.translation
        cases_out.append(
            {
                "name": case["name"],
                "side": side,
                "jointsRad": case["jointsRad"],
                "sdkPalmMm": {"x": float(t[0]), "y": float(t[1]), "z": float(t[2])},
            }
        )

    return {
        "schemaVersion": 1,
        "mappingPath": "joints/mapping.json",
        "tcpLinkBySide": {
            "right": "d01_r_palm_right",
            "left": "d01_l_palm_left",
        },
        "envelopeMm": {"x": 999.0, "y": 999.0, "z": 999.0},
        "cases": cases_out,
    }


def check_document(doc: dict) -> None:
    from pib_sdk.kinematics import ArmKinematics

    by_joint = load_mapping_by_joint()
    for case in doc["cases"]:
        arm = ArmKinematics(case["side"])
        q = joints_rad_to_sdk_q(case["side"], case["jointsRad"], by_joint)
        pose = arm.forward(q)
        t = pose.translation
        ref = case["sdkPalmMm"]
        for axis, idx in (("x", 0), ("y", 1), ("z", 2)):
            if abs(float(ref[axis]) - float(t[idx])) > 0.05:
                raise SystemExit(
                    f"{case['name']}: sdkPalmMm.{axis} stale "
                    f"(file {ref[axis]}, fresh {t[idx]:.4f})"
                )
    print(f"fk_reference.json: {len(doc['cases'])} cases match pib-sdk forward kinematics")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--check",
        action="store_true",
        help="Verify tools/fk_reference.json against the installed pib-sdk",
    )
    parser.add_argument(
        "--write",
        action="store_true",
        help="Regenerate tools/fk_reference.json (keeps envelope unless --reset-envelope)",
    )
    parser.add_argument("--reset-envelope", action="store_true")
    args = parser.parse_args()

    if args.write:
        doc = build_document()
        if OUT_PATH.exists() and not args.reset_envelope:
            prev = json.loads(OUT_PATH.read_text(encoding="utf-8"))
            doc["envelopeMm"] = prev.get("envelopeMm", doc["envelopeMm"])
        OUT_PATH.write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8")
        print(f"Wrote {OUT_PATH}")
        return

    if not OUT_PATH.exists():
        doc = build_document()
        OUT_PATH.write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8")
        print(f"Created {OUT_PATH}")

    doc = json.loads(OUT_PATH.read_text(encoding="utf-8"))
    if args.check or (not args.write and not args.check):
        check_document(doc)


if __name__ == "__main__":
    try:
        main()
    except ImportError as exc:
        print(f"pib-sdk import failed: {exc}", file=sys.stderr)
        sys.exit(1)
