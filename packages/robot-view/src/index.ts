export { PibRobotView, registerPibRobotView } from './element/PibRobotView.js';

// A host that only wants the element writes `import '@pib/robot-view'`. Registering on
// import keeps that working, guarded so a server-side render or a second import is inert.
import { registerPibRobotView as register } from './element/PibRobotView.js';
if (typeof customElements !== 'undefined' && !customElements.get('pib-robot-view')) {
  register();
}
export type {
  RobotModel,
  ModelJoint,
  ModelLink,
  ReadyDetail,
  JointChangeDetail,
  SelectionChangeDetail,
  ErrorDetail,
  ViewerMode,
  JointChangeSource,
} from './types.js';
export {
  rpyQuat,
  uiRange,
  fromUi,
  toUi,
  formatJointLabel,
  applyJointValue,
} from './joints/math.js';
export {
  loadMapping,
  validateMapping,
  canCommand,
  modelRadToMotorCentideg,
  motorCentidegToModelRad,
  mappingByUrdfJoint,
  jointClassLabel,
  PIB5ADVANCED_MOTORS,
  expectedLimitsRad,
} from './joints/mapping.js';
export type {
  JointMappingDocument,
  JointMappingEntry,
  JointClass,
  ValidationResult,
  LoadMappingResult,
} from './joints/mapping.js';
export type { JointStateSample } from './joints/liveState.js';
export {
  sampleToModelJoints,
  resolveJointStateMap,
  mappingByMotor,
  LiveJointInterpolator,
} from './joints/liveState.js';
