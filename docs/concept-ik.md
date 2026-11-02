# Inverse kinematics in the 3D tab: drag the hand, the robot follows

Status: concept, 2026-11-02. Nothing here is built yet. Every **D** below is a fork that needs a
decision before the first line of code - the recommendation is a recommendation, not a ruling.

## 1. What the question is

Today the 3D tab is a mirror plus 26 sliders: one slider drives one joint. That is exact, but it
is not how a person thinks about an arm. The wish is to **grab the hand in the picture and move
it**, let the arm figure out which joints have to do what, and have the real robot follow. Same
for the head: look somewhere, the head turns there. The interaction should explain itself while
it happens (where the hand is, what is near a limit, whether the robot has caught up), and the
fingers have to fit into that story instead of being a separate corner of the UI.

## 2. What already exists, and what that buys us

| Piece | Where | Why it matters here |
|---|---|---|
| Forward kinematics in the viewer | `model/viewerFk.ts`, `model/kinematicTree.ts` | The solver can measure itself against the same scene graph that is drawn - no second model to keep in sync. |
| Frame and unit contract | `docs/frames.md` | Targets are metres, REP-103, Z up, radians internally. The UI is the only place that speaks degrees. |
| TCP | palm link origin (`d01_r_palm_right` / `d01_l_palm_left`), provisional | The drag handle is the palm, not a fingertip. |
| Joint limits and couplings | `joints/mapping.json` (`limitsRad`, `JointCoupling`) | Limits are already the authority; `applyJointValue()` clamps. Sixteen coupled finger joints follow their knuckle by factor 1. |
| Command path | `joints/commandPath.ts` | One request per 120 ms, coalesced to the latest value, `commandrequest` / `commandaccepted` / `commandrejected`. The robot already follows a stream of targets - IK only has to produce them. |
| Full IK with an error taxonomy | pib-sdk `ChainKinematics.inverse()` (workspace, behind-body, joint limits, convergence) | Python, so it cannot run in the browser - but it is the reference the viewer's solver has to agree with. |
| Picking and raycasting | `interaction/picking.ts` | The pointer-to-model plumbing (ray to link) is there; a drag handle reuses it. |

The important consequence: **the viewer already knows how to draw a pose given joint angles and
already knows how to command a pose.** IK is the missing middle: end-effector target to joint
angles.

## 3. Decisions

### D1 - Where does the solver run?

**A. In the viewer (TypeScript).**
The solver uses the same three.js chain that is rendered. Latency is one frame, the preview and
the commanded value are the same numbers, and the standalone viewer (GitHub Pages, no robot)
keeps working.
Cost: a second kinematics implementation next to pib-sdk. Mitigation: golden tests that compare
viewer FK against pib-sdk poses for a few hundred sampled configurations, at millimetre precision
- the `fkReference.test.ts` pattern already exists for the zero pose.

**B. In the backend (pib-sdk behind a new `POST /api/kinematics/ik`).**
One implementation, and the proven error taxonomy for free.
Cost: every pointer move becomes an HTTP round trip. Over LAN that is 5-20 ms plus Flask, so a
60 Hz drag turns into a 20-40 Hz stutter, and the published demo viewer has no backend at all.
You would still need local prediction to hide it - which is the solver again.

**C. Hybrid.** Viewer solves for the drag, backend re-checks asynchronously and can veto.
Most faithful, most moving parts, and a veto that arrives after the robot already moved is a
warning at best.

**Recommendation: A**, with a `checkWithBackend` hook left open for later. Rationale: the drag
loop is a real-time interaction, and the viewer has to be useful without a robot.

### D2 - What does the pointer grab?

**A. Effector drag.** A ghost sphere sits at the palm; grabbing it moves the target in a plane
facing the camera. Direct and obvious; depth is ambiguous, so a modifier (or the wheel) has to
shift the plane.

**B. Axis gizmo.** Arrows and rings per axis. Precise, self-explaining, but slow: three drags for
one diagonal move.

**C. Click-to-reach.** Click a point; the hand travels there. No depth problem if the point is on
the model or the floor grid, but it is a command, not a gesture - and the accent here is *drag*.

**Recommendation: A**, with three refinements:
- drag = move in the plane through the current palm facing the camera;
- `Shift` while dragging = move that plane forward/back (depth);
- wheel = depth without a modifier, because it is discoverable ("scroll to reach further").

B stays available as an "expert" overlay for the last centimetre.

### D3 - Does the robot follow while dragging, or on release?

**A. While dragging** (streaming, the existing 120 ms coalescing). This is the same behaviour the
sliders have since the approval bar was removed, so nothing new to explain. The arm looks slower
than the mouse; that gap is visible and honest, and the ghost of the commanded pose shows it.

**B. On release.** Deterministic, one trajectory, but it makes the robot feel like it is taking
orders instead of following - and a user who lets go mid-drag gets nothing.

**Recommendation: A**, plus a **velocity clamp** (see D6) so a fast flick cannot slam the arm,
and a visible "Roboter folgt" indicator while the commanded pose and the measured pose differ.

### D4 - How do the fingers get in?

**A. Presets** - open, relaxed, grip - one tap each, mapped onto the existing couplings (four
fingers share the knuckle angle, the thumb keeps its own stretch and opposition).

**B. Wheel / second drag while the hand moves.** Left button moves the arm, wheel closes the
grip, `Alt`+drag does the thumb. One motion, no mode switch - the "carry and grab" gesture.

**C. Per-finger sliders** - already in the panel. Keep them, they are the precision tool.

**D. Fingertip IK** against an object that is grabbed in the viewer. Large, and only worth it once
there is something to grasp.

**Recommendation: A + B now, C stays as is, D later.** Fingers are a posture, not a position: the
four fingers are one coupled chain, so "close the hand" is a single number, and pretending
otherwise in the UI would contradict the mechanics. During an arm drag the finger targets are
held constant and only sent if they actually change.

### D5 - How does the head move?

**A. Look-at a draggable target.** A small ring (the "gaze point") sits 1.5 m in front of the
head; dragging it turns and tilts the head, and the model draws the gaze ray. Two degrees of
freedom, analytic solution (`atan2`), no solver needed.

**B. Free drag on the head itself.** Pointer delta becomes yaw/pitch. Simple, but has no
"where" - the user cannot say "look at the door".

**Recommendation: A.** It is the same idea as the hand (move the target, not the joints), it makes
the head's two degrees of freedom obvious, and the gaze ray is the self-explaining part.

### D6 - What happens at the edge of what the arm can do?

**A. Clamp and warn.** The target slides along the boundary of the reachable set; the handle turns
amber/red and says why ("nicht erreichbar - 4 cm zu weit"). No jump, no rejection.
**B. Reject.** The command is refused and the hand snaps back. Honest, but it makes the model
feel broken exactly when the user is exploring.
**C. Silently reach the closest point.** Confusing - the model and the pointer disagree with no
explanation.

**Recommendation: A.** The solver always returns a feasible posture; the UI states the distance
to the requested point, and the joint limits are already enforced by `applyJointValue()`.

Two safety additions, not optional in my view:
- **velocity clamp** per joint (e.g. 60 °/s) applied to the delta between two commands, so a
  pointer flick is smoothed into the robot's speed;
- **workspace envelope** per arm, taken from the same numbers pib-sdk uses, so the viewer and the
  Python IK cannot disagree about "reachable".

### D7 - What wins when both the panel and the drag want to move a joint?

**Recommendation: last writer wins, and the loser is visibly released.** Starting a drag clears
the pending slider values for that arm; touching a slider ends the drag. No silent fighting
between two inputs.

## 4. Interaction, spelled out

**Mode chips** above the panel: `Hände` · `Kopf` · `Greifer`. One is active; the active one
highlights its handles in the picture.

**Handles.** A translucent ghost sphere at each palm, a ring for the gaze point; hover shows a
label ("Rechte Hand") and a thin outline on the real link.

**Live readout while dragging** - short, numeric, in the same place every time:
`Rechte Hand · 32 cm vor · 18 cm hoch · 12 cm rechts` and `Greifer offen (85°)`.

**Feedback states** (colour + one sentence, never colour alone):
- green: reachable, robot within 1 cm of the target;
- amber: near a joint limit ("Ellbogen 4° vor dem Anschlag");
- red: outside the workspace ("nicht erreichbar - bleibende 4 cm");
- grey ghost of the arm: where the robot actually is, while it catches up.

**Keys.** `Esc` release, `R` rest pose, `Tab` switch hand, `Shift` depth, wheel depth/grip.

## 5. How it hangs together technically

```
pointer -> ray -> target in base frame (m, REP-103)
        -> IK (per arm: 6 DOF, damped least squares, limits from mapping)
        -> clamp to limits + velocity clamp
        -> buildCommandFromPending (existing) -> commandrequest (120 ms, coalesced)
        -> Cerebra -> /apply_joint_trajectory -> motors
```

The solver is a new module `joints/ik.ts` in the package (pure, no DOM): input is the current
joint vector, the target pose, the chain and the limits; output is a joint vector plus a
`reach` report (`ok`, `distance_m`, `blockedBy`). Keeping it pure is what makes it testable
without a browser.

Head: `joints/lookAt.ts`, analytic, two joints, same report shape.

## 6. Verification

1. **Solver unit tests.** FK(IK(target)) within 2 mm and 1° for a grid of reachable targets;
   unreachable target returns the boundary point and `ok: false`, never `NaN`; limit-saturated
   solution is reported, not silently clamped.
2. **Agreement with pib-sdk.** A generated table of configurations: viewer FK vs pib-sdk FK, and
   viewer IK vs pib-sdk inverse on the same targets. Differences beyond tolerance fail the build -
   two implementations are only acceptable if they are comparable.
3. **Playwright** (tests/e2e, written red first): drag the ghost 10 cm to the right, the requested
   pose changes by 10 cm, one command per 120 ms, no command while the pointer is still.
4. **On the robot.** Drag the hand 10 cm forward: measured TCP moves 10 ± 1 cm and in the right
   direction. Drag the gaze ring 20°: the head turns 20 ± 2°. A drag into the workspace edge stops
   at the boundary and says so.

## 7. Slices

| # | Content | Effort |
|---|---|---|
| S1 | `ik.ts` + tests, ghost handle, drag on the model only (no commands) | 2-3 d |
| S2 | Streaming through the existing command path, velocity clamp, readout and states | 1-2 d |
| S3 | Gaze point and analytic head look-at | 1 d |
| S4 | Finger presets, wheel grip, thumb on `Alt` | 1-2 d |
| S5 | Cerebra wiring (chips, strings, limits pass-through), docs, release | 1-2 d |

Each slice is a PR of its own; S1 and S2 are the ones that answer "does it feel right" on the
robot.

## 8. Open questions

1. Should the drag target be the palm origin or a point 10 cm beyond it (between thumb and
   index)? The palm is the contract we have; the pinch point is what a person aims with.
2. Do we want an inverse for the *fingertip* later (D4-D), and if so, against what - a clicked
   point, or a virtual object that can be picked up?
3. Is a "record and replay" of the dragged path wanted (the motion is already a stream of
   trajectory points)?
4. Does the head need a "look at the hand" mode, which is the natural thing to want next?
