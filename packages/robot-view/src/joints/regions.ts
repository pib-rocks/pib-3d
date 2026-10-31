export const LEFT_ARM = new Set([
  'rotation_inner_shoulder_1',
  'rotation_shoulder_left_1',
  'central_rotator_rotation_1',
  'rotation_elbow_1',
  'rotate_forearm_1',
  'dof_wrist_1',
  'rotation_wrist_left',
]);

export const RIGHT_ARM = new Set([
  'rotation_inner_shoulder',
  'rotation_shoulder_left',
  'central_rotator_rotation',
  'rotation_elbow',
  'rotate_forearm',
  'dof_wrist',
  'rotation_wrist_right',
]);

export const HEAD = new Set(['gearing_rotation__new_body_', 'nodding_rotation']);

export const REGION_ORDER = [
  'Kopf',
  'Linker Arm',
  'Rechter Arm',
  'Linke Hand',
  'Rechte Hand',
  'Körper',
] as const;
