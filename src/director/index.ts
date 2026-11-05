// The director: plans a song ahead (layout, camera, transitions, cues, titles) and evaluates the plan at any time.
export * from './types';
export { plan, planCuesFor, measuresFor, ASPECTS, type PlanInput } from './plan';
export { cameraAt, idleK, lerpCam, type CamFrame } from './evaluate';
export { basePose } from './camera';
export { project, onScreen, FOCAL, NO_FX, type Cam, type Fx, type Projected } from './project';
export { wordState, unitPose, TIN_SPEC, type WordCtx, type WordState, type UnitPose } from './words';
export { transK, timePassage } from './passages';
export { corners, boxIn } from './layout';
export { recommendMotion, songTraits } from './recommend';
