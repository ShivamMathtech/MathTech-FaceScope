# Measurement reference

## Coordinate system

For a normalized landmark `(x, y, z)` and analysis image size `(W, H)`, use `(xW, yH)` for image-plane distances. Using normalized x/y directly would distort measurements whenever W and H differ. Z is the model's relative-depth coordinate, not a measured physical distance. Eye labels are anatomical subject left/right; a mirrored preview never changes those labels or raw values.

The subject's right eye uses indices `[33,160,158,133,153,144]`; left eye uses `[362,385,387,263,373,380]`. Right iris center is index 468; left is 473. Indices correspond to the bundled model's 478-point topology.

## Eye aspect ratio and events

For six eye contour points p1 through p6:

`EAR = (||p2-p6|| + ||p3-p5||) / (2 ||p1-p4||)`.

The default close threshold is 0.20, and the reopen threshold is 0.24. Both eyes must be below the close threshold to begin an event. Reopening either eye above the open threshold ends it. A duration between 0.05 and 0.8 seconds is classified as a bilateral blink; a longer duration is recorded as an extended closure. These are engineering thresholds, not physiological diagnoses.

The event detector does not operate on display-smoothed EAR, which could attenuate short events. A tracking failure, backward timestamp, or gap above 0.5 s invalidates an open event. The tracked-time denominator sums positive deltas up to 0.5 s only when both adjacent samples contain a face. Rates remain unavailable until five seconds of tracked time.

Long source pauses and no-face gaps do not add to tracked time. Blink counts and rates depend on sample spacing and threshold quality; no blink recall or precision is claimed. Evaluate against annotated videos before research use.

## Mouth ratio

`mouth = distance(landmark13, landmark14) / distance(landmark61, landmark291)`.

This describes apparent vertical inner-lip separation relative to mouth width. It changes with viewpoint, facial motion, and landmark error. It is not an absolute mouth area or a physiological measurement.

## Approximate head orientation

The model returns a 4×4 transformation mapping a canonical face to the observed face. The browser result stores values in column-major order. Extract the 3×3 rotation/scale block and divide by its column norm to remove uniform scale.

For `R = Rz(roll) Ry(yaw) Rx(pitch)`:

```text
yaw   = asin(-R20)
pitch = atan2(R21, R22)
roll  = atan2(R10, R00)
```

Angles are converted from radians to degrees. At gimbal lock, set roll to zero and use the documented alternative pitch branch in code. These are model-coordinate Euler angles, not independent calibrated medical head-pose measurements. The implementation does not estimate camera intrinsics from the source camera.

## Iris proxy

Let a and b be eye corners ordered from left to right in the unmirrored image. Let v=b-a, d=iris-a. Then:

```text
x = dot(d,v) / dot(v,v)
y = (d_y v_x - d_x v_y) / dot(v,v)
```

Average the two eyes. x≈0.5 means an iris near the midpoint of its visible eye corners. y is signed perpendicular displacement in eye-width units. Eye-corner geometry changes with head pose and eyelid closure, so this proxy is unsuitable for determining an actual screen fixation, attention, or line of sight.

## Neutral calibration and smoothing

Thirty tracked samples with both EARs at least 0.13 form a baseline. The componentwise median is used. The close threshold becomes 0.68 × mean baseline EAR; reopen becomes 0.83 × that EAR. A failed face detection restarts the baseline sample collection.

Head orientation and iris values are displayed relative to the baseline; raw values remain unchanged in exports. The session includes the calibration object and actual thresholds. Calibration completion starts a new dataset, so pre-calibration and post-calibration events are not mixed.

Live numerical smoothing uses `alpha = 1 - exp(-dt / tau)`, with tau 0, 0.08, or 0.18 seconds. Discontinuities reset the filter. Raw samples, blendshapes, charts, and event detection are not smoothed by this additional display filter. The upstream single-face model itself applies temporal processing.

## Sources

- Google MediaPipe Face Landmarker Web guide: https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker/web_js
- JavaScript FaceLandmarker source at the pinned version: https://github.com/google-ai-edge/mediapipe/blob/v0.10.32/mediapipe/tasks/web/vision/face_landmarker/face_landmarker.ts
- Face geometry reference: https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/modules/face_geometry/protos/face_geometry.proto
- Face Mesh model card: https://storage.googleapis.com/mediapipe-assets/Model%20Card%20MediaPipe%20Face%20Mesh%20V2.pdf

The measurement formulas and thresholds are inspectable in `web/metrics.js` and `web/app.js`. The reference video is a functional test input, not an annotated accuracy benchmark.
