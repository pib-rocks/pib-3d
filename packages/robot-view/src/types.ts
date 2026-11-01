import type * as THREE from 'three';

export interface ModelLink {
  name: string;
  mesh: string;
  parts?: string[];
}

export interface JointLimit {
  lower: number;
  upper: number;
}

export interface ModelJoint {
  name: string;
  type: string;
  parent: string;
  child: string;
  origin: { xyz: number[]; rpy: number[] };
  axis: number[];
  limit?: JointLimit;
}

export interface RobotModel {
  build?: string;
  links: ModelLink[];
  joints: ModelJoint[];
  stats?: unknown;
}

export interface MotionEntry {
  joint: ModelJoint;
  motion: THREE.Object3D;
  axis: THREE.Vector3;
}

export type ViewerMode = 'read' | 'preview' | 'command';

export type JointChangeSource = 'ui' | 'api';

export interface ReadyDetail {
  links: number;
  joints: number;
}

export interface JointChangeDetail {
  joint: string;
  value: number;
  source: JointChangeSource;
}

export interface SelectionChangeDetail {
  link: string;
  joint: string;
}

export interface ErrorDetail {
  message: string;
}

export interface MotorLimitDeg {
  minDeg: number;
  maxDeg: number;
}

export type MotorLimitMap = Record<string, MotorLimitDeg>;

export interface CommandRequestDetail {
  commandId: string;
  values: Record<string, number>;
  motors: Record<string, number>;
  source: JointChangeSource;
}

export interface CommandRejectedDetail {
  commandId: string;
  reason: string;
}

export interface CommandAcceptedDetail {
  commandId: string;
}

export interface EStopDetail {
  source: 'ui' | 'api';
}
