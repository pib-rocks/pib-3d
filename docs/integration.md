# Using @pib/robot-view in a host application

The component is published as a tarball on a GitHub release, one per tag, built by
`.github/workflows/release.yml`:

```
https://github.com/pib-rocks/pib-3d/releases/download/v0.1.0/pib-robot-view-0.1.0.tgz
```

A plain git dependency does not work: the package lives in `packages/robot-view`, and
`npm install github:pib-rocks/pib-3d` installs the repository root, which has no
`package.json`.

## In Cerebra (or any Angular host)

```jsonc
// package.json
"dependencies": {
  "@pib/robot-view": "https://github.com/pib-rocks/pib-3d/releases/download/v0.1.0/pib-robot-view-0.1.0.tgz",
  "three": "^0.170.0"            // peer dependency, not bundled
}
```

The tarball contains `dist/` only — no model, no meshes, no mapping. Those are data and
come from the robot at runtime, so the viewer always shows the machine it is talking to.

```html
<pib-robot-view
  model-url="http://<robot>:5000/robot-model/model.json"
  mapping-url="http://<robot>:5000/robot-model/mapping.json">
</pib-robot-view>
```

Until the backend serves the model (PR-2148), the same element can point at the published
demo instead: `https://pib-rocks.github.io/pib-3d/model.json` and `mapping.json`.

The element is side-effect free until it is connected: import it once, then use it.

```ts
import '@pib/robot-view';               // registers <pib-robot-view>
```

## Live state and commands

- `setJointStateSample({ names, positions, stampMs })` — `names` are backend motor names,
  `positions` are the radians from `/joint_states`; the mapping converts them.
- `jointStates` / `setJointStates(map)` — URDF joint names in model radians.
- `setCommandedStates(map)` — targets from the host, drawn against the actual values.
- `mode` (`read` | `preview` | `command`) and `effectiveMode`: `command` falls back to
  `preview` while the mapping is not trustworthy, with `guardReason` explaining it.
- `dispose()` on `disconnectedCallback`; safe to call twice.

## Acknowledging a command

In `command` mode, approving sends a `commandrequest` event. The host may still refuse
synchronously with `preventDefault()` on that event (same as before). If it does not refuse,
the command stays **in flight**: the viewer keeps the pending pose until you answer.

Answer asynchronously with methods on the element:

```ts
view.confirmCommand(commandId);           // accepted — updates commanded state, emits commandaccepted
view.rejectCommand(commandId, reason);    // rejected — reverts to the actual pose, emits commandrejected
```

Do **not** call `preventDefault()` when you intend to execute the motion and acknowledge later
(for example after a ROS trajectory action returns). Only use `preventDefault()` for an
immediate refusal.

If neither method is called within `ackTimeoutMs` (default 3000), the viewer rejects the command
with reason `"no acknowledgement"`. While a command is in flight, further `approve()` calls have
no effect until it is accepted or rejected.

## The model archive

Every release also carries `robot-model-<tag>.zip` (about 15 MB) with `version.json`, `model.json`,
`mapping.json` and `meshes/*.glb`, plus a `.sha256` next to it. That is what the robot installs
with `pib-backend/tools/install_robot_model.py`; the backend then serves it under `/robot-model/`.

## Versioning

The tarball URL is immutable. To take a new viewer version, bump the URL to the new tag
and rebuild the host — the component is compiled in, not loaded at runtime.
