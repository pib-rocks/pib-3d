import { describe, expect, it } from 'vitest';
import { meshUrl } from '../src/model/loadModel.js';
import type { ModelLink, RobotModel } from '../src/types.js';

const model = { build: 'abc123', links: [], joints: [] } as unknown as RobotModel;
const link = { name: 'root', mesh: 'meshes/root.glb' } as ModelLink;

describe('meshUrl', () => {
  it('resolves meshes next to the model, not next to the page', () => {
    // A host mounts the viewer on /joint-control/3d and serves the model from /api/robot-model.
    const url = meshUrl(model, link, '/api/robot-model/model.json');
    expect(new URL(url).pathname).toBe('/api/robot-model/meshes/root.glb');
    expect(new URL(url).search).toBe('?v=abc123');
  });

  it('keeps the old behaviour for a model in the page directory', () => {
    const url = meshUrl(model, link, './model.json');
    expect(new URL(url).pathname).toBe('/meshes/root.glb');
  });

  it('accepts an absolute model URL', () => {
    const url = meshUrl(model, link, 'http://robot.local:5000/robot-model/model.json');
    expect(url).toBe('http://robot.local:5000/robot-model/meshes/root.glb?v=abc123');
  });
});
