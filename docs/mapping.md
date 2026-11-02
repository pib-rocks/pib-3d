# Joint ↔ motor mapping (pib5advanced)

The file `joints/mapping.json` is the single source of truth that connects every URDF joint in `web/model.json` to the robot’s actuators. The web demonstrator loads a copy at `web/mapping.json` (updated on `npm run build` in `packages/robot-view`).

## Field semantics

Each entry describes one model joint:

| Field | Meaning |
| --- | --- |
| `urdfJoint` | Joint name in `model.json` / URDF |
| `motor` | Backend motor name for **driven** joints; `null` for coupled/passive |
| `class` | `driven` (has a motor), `coupled` (linkage follower), or `passive` (no actuator) |
| `direction` | Sign that maps the motor angle onto the CAD joint (`+1` or `-1`); `null` if not applicable |
| `gearRatio` | Motor revolutions per joint revolution (1.0 until measured) |
| `zeroOffsetDeg` | Encoder zero offset in degrees (0.0 until measured) |
| `limitsRad` | `[lower, upper]` in radians from the model, or `null` for continuous joints |
| `verifiedOnHardware` | Set to `true` only after the round-trip test below |

**Conversions** (API motor positions are centidegrees; the backend already applies encoder polarity):

```
motorCentideg = (radToDeg(modelRad) + zeroOffsetDeg) * 100 * direction / gearRatio
modelRad      = degToRad((motorCentideg * gearRatio) / (100 * direction)) - degToRad(zeroOffsetDeg)
```

`direction` does **not** include `upper_endpoint` or other backend polarity flags.

The axis dot product against pib-sdk is the starting point, not the proof: the left arm's CAD
frame is turned against the right one, so a dot product computed per joint silently agrees with
itself while the arm renders on the wrong side of the body. `packages/robot-view/test/armSymmetry.test.ts`
is the authority - it drives both arms with the same motor magnitudes and requires the hands to
land mirrored. On the left shoulder it caught 101-344 mm of forward error that no mesh or manifest
check could see.

## Provenance

- **Motor names (26):** `pib-backend` seed profile `pib_api/flask/seed_profiles/pib5advanced.py`, constant `MOTOR_MAPPING` for variant `pib5advanced` (Feetech ST bus / waveshare layout). Each name appears exactly once on a **driven** joint.
- **Directions:** Dot product between the Onshape/CAD joint axis and the calibrated axis in `pib-sdk`’s `pib_model.urdf` at the zero pose. Values with `|axisDot| = 1.0` are aligned; ~0.92 indicates a frame rotation between export and SDK idealization.
- **Coupled joints (20):** Two forearm disc joints (`dof_wrist`, `dof_wrist_1`) and 18 finger distal/tip hinges are four-bar followers. They move when a driven joint moves; no motor commands them.
- **Passive joints (2):** `upper_door_rotation` and `lower_door_rotation` are service lids. They stay poseable in the demonstrator for diagnosis but are never commandable.

## Mapping by region

### Right arm (6 driven)

| URDF joint | Class | Motor | Direction |
|---|---|---|---|
| rotation_inner_shoulder_1 | driven | shoulder_vertical_right | -1 |
| rotation_shoulder_left | driven | shoulder_horizontal_right | 1 |
| central_rotator_rotation | driven | upper_arm_right_rotation | 1 |
| rotation_elbow | driven | elbow_right | -1 |
| rotate_forearm | driven | lower_arm_right_rotation | 1 |
| rotation_wrist_right | driven | wrist_right | 1 |

### Left arm (6 driven)

| URDF joint | Class | Motor | Direction |
|---|---|---|---|
| rotation_inner_shoulder | driven | shoulder_vertical_left | -1 |
| rotation_shoulder_left_1 | driven | shoulder_horizontal_left | 1 |
| central_rotator_rotation_1 | driven | upper_arm_left_rotation | 1 |
| rotation_elbow_1 | driven | elbow_left | 1 |
| rotate_forearm_1 | driven | lower_arm_left_rotation | 1 |
| rotation_wrist_left | driven | wrist_left | 1 |

### Head (2 driven)

| URDF joint | Class | Motor | Direction |
|---|---|---|---|
| gearing_rotation__new_body_ | driven | turn_head_motor | 1 |
| nodding_rotation | driven | tilt_forward_motor | -1 |

### Right hand (6 driven)

| URDF joint | Class | Motor | Direction |
|---|---|---|---|
| revolute_1 | driven | thumb_right_opposition | -1 |
| j1_2 | driven | thumb_right_stretch | -1 |
| j1 | driven | index_right_stretch | -1 |
| j1_1 | driven | middle_right_stretch | -1 |
| j1_4 | driven | ring_right_stretch | -1 |
| j1_3 | driven | pinky_right_stretch | -1 |

### Left hand (6 driven)

| URDF joint | Class | Motor | Direction |
|---|---|---|---|
| revolute_1_1 | driven | thumb_left_opposition | -1 |
| j1_7 | driven | thumb_left_stretch | -1 |
| j1_5 | driven | index_left_stretch | -1 |
| j1_6 | driven | middle_left_stretch | -1 |
| j1_9 | driven | ring_left_stretch | -1 |
| j1_8 | driven | pinky_left_stretch | -1 |

### Coupled linkages (20)

| URDF joint | Class | Motor | Direction |
|---|---|---|---|
| dof_wrist | coupled | — | — |
| dof_wrist_1 | coupled | — | — |
| j2 | coupled | — | — |
| j2_1 | coupled | — | — |
| j3 | coupled | — | — |
| j3_1 | coupled | — | — |
| j3_2 | coupled | — | — |
| j3_3 | coupled | — | — |
| j3_4 | coupled | — | — |
| j3_5 | coupled | — | — |
| j3_6 | coupled | — | — |
| d54_finger_distal_1_hinge | coupled | — | — |
| d54_finger_distal_2_hinge | coupled | — | — |
| d54_finger_distal_3_hinge | coupled | — | — |
| d54_finger_distal_4_hinge | coupled | — | — |
| d54_finger_distal_6_hinge | coupled | — | — |
| d54_finger_distal_7_hinge | coupled | — | — |
| d55_finger_tip_5_hinge | coupled | — | — |
| d58_thumb_tip_hinge | coupled | — | — |
| d58_thumb_tip_1_hinge | coupled | — | — |

### What drives a coupled joint

A finger is a linkage: one motor turns the knuckle (`j1*`) and the two joints behind it bend by
**the same angle**. That relationship lives in the mapping as a `coupling` block on the follower:

```json
{ "urdfJoint": "j2", "class": "coupled", "motor": null,
  "coupling": { "follows": "j1", "factor": 1.0 } }
```

`factor` is the sign that lines the follower's CAD axis up with the knuckle's; all sixteen finger
followers use `1`. The viewer resolves couplings after every sample, so a knuckle that moves takes
its whole finger with it; `applyCouplings()` in `src/joints/liveState.ts`.

Three joints stay uncoupled on purpose:

- `dof_wrist`, `dof_wrist_1` - parallel wrist mechanism, not a finger.
- `d58_thumb_tip_hinge`, `d58_thumb_tip_1_hinge` - the thumb is one rigid digit on this robot, not
  a linkage. A photo of the right hand (2026-11-01) shows the thumb straight while its knuckle
  motor sits at its -90 degree stop; the CAD agrees - the distal segment is 7 degrees off the
  proximal one at a straight hinge and 83 degrees at -90.

Also note the finger directions: all eleven finger-driving joints carry `direction: +1`. With the old value the knuckles sat at +90° against a CAD limit of [-90°, 0°] - visibly bent against the
palm. The check that finds this class of error is a limit test on live samples: every driven joint
must land inside `limitsRad`.

### The finger servos are geared and offset

The ten finger servos travel -90…+90 degrees, the CAD finger joints only -90…0: **180 degrees of
servo is 90 degrees of joint**, so `gearRatio: 0.5`. And the servo's -90 is a *straight* finger
while the CAD zero is a straight finger too, so the mapping carries `zeroOffsetDeg: 45` with
`direction: -1`:

```
model = (motor * 0.5 / -1) - 45        motor -90 -> 0 (straight)   motor +90 -> -90 (closed)
```

Checked against the machine: a photo of the right hand in front of the camera on 2026-11-01 shows
the fingers extended while all ten stretch servos read -89.8 degrees. A plain `motor * direction`
(or a plain sign flip) put a closed fist on a hand that was open.

**Measured with the robot, not inferred** (2026-11-01): the servo was swept from -180 to +180 in
30 degree steps with the hand in front of the camera. Every step was accepted and reported, and the
finger moves only between servo -90 (straight) and +90 (closed) - roughly 8 mm of image difference
at the start, saturating by +90. Beyond those two points the cable is slack and the finger rests on
its stop; the model clamps at the CAD limits for that reason (`applyJointValue`), otherwise it
would hyperextend at -180 and fold through the palm at +180. That is what the extra servo travel
buys: 360 degrees of servo, 90 degrees of finger, slack at both ends.

### Passive service lids (2)

| URDF joint | Class | Motor | Direction |
|---|---|---|---|
| upper_door_rotation | passive | — | — |
| lower_door_rotation | passive | — | — |

## Hardware round-trip (26 driven joints)

Until every driven entry has `verifiedOnHardware: true`, the viewer refuses `mode="command"` and stays in preview.

For **each** of the 26 driven joints, on real hardware:

1. Note the current motor position (centidegrees) from the API.
2. Command **+15°** on that motor only (joint centidegrees: current + 1500 centideg).
3. Observe the physical joint and the 3D model after applying the same value through the mapping conversions.
4. Record whether motion matches (+), is inverted (−), or needs a gear/offset tweak.
5. Update `direction`, `gearRatio`, and/or `zeroOffsetDeg` in `joints/mapping.json` if needed, then set `verifiedOnHardware` to `true` for that entry.

Re-run `npm run check:mapping` and the demonstrator validation after any edit.

## Validation

Runtime (`validateMapping` in `packages/robot-view`) and CI (`npm run check:mapping`) enforce:

1. Mapping keys match `model.json` joints exactly.
2. Each pib5advanced motor appears once; no unknown motors.
3. Driven joints have a motor and non-null `direction`.
4. Coupled/passive joints have `motor: null`.
5. `limitsRad` matches the model (continuous → `null`).

Command mode additionally requires all driven joints to be hardware-verified.

## Panel: one slider per driven joint

The joint panel renders a slider only for joints the mapping classifies as `driven` - 26 on pib.
Coupled joints follow their driver, and a passive joint has no motor, so a slider on either would
suggest a control that does not exist. The rows are grouped by body region and labelled with the
host's names (`labels` property, keyed by motor name) - Cerebra passes the same names it uses in
its joint tabs, e.g. `Left Hand · Index Finger`.
