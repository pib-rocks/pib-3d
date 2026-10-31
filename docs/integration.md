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

## Versioning

The tarball URL is immutable. To take a new viewer version, bump the URL to the new tag
and rebuild the host — the component is compiled in, not loaded at runtime.
