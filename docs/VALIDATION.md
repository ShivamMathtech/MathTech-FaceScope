# Validation record

Validation date: **2026-09-22**.

## Automated checks

- **17 JavaScript tests passed:** pixel-correct EAR for multiple aspect ratios, centered iris geometry, degenerate inputs, matrix pose for identity and known rotations, missing-face behavior, blink hysteresis, unilateral eye closure, tracking loss, discontinuities, long closures, tracked-time rate, smoothing, summary statistics, CSV missing values, and HTML escaping.
- **11 Python API tests passed:** session CRUD, cross-origin write rejection, marker rejection, Host validation, traversal rejection, non-finite JSON, invalid timestamps, empty datasets, static-module MIME/security headers, and server/database isolation from the static directory.
- **8 bundled assets passed SHA-256 validation.**

## Browser integration

Environment: Linux with headless Chromium 153.0.8010.52, software WebGL, CPU inference. The test starts the real Python server, loads the real bundled model, and drives the actual interface with Playwright.

Input: the user-supplied 54.833-second MP4, 720×960 pixels, 30 fps, including its existing face-tracking graphics.

Verified:

1. Model startup without external HTTP requests.
2. Actual MP4 decoding, face landmark inference, nonempty eye measurements, and 52 returned blendshape coefficients.
3. Thirty-sample neutral calibration.
4. Complete file analysis at 15 sample times per second, with strictly increasing exported timestamps.
5. Real CSV, JSON, PNG snapshot, and HTML report downloads.
6. Session save, review, browser-reload persistence, and deletion.
7. Responsive layout at 390-pixel viewport width without horizontal overflow.
8. No unhandled browser page errors.

The included `validation-results.json` contains the recorded sample count and test results. The initial full scan produced **823 samples with 822 face detections**. This is a functional coverage result for one clip, not an accuracy benchmark; the final run's exact measurements are recorded in that JSON.

## Camera and edge cases

A Chromium fake camera backed by a short Y4M conversion of the input video exercised the browser's real `getUserMedia` path. The test confirmed acquisition, 478 exported landmark triplets, a 16-value matrix, and release of the camera track when Stop source is clicked.

A generated one-second black MP4 produced 15 missing-face samples, null geometric measurements, and no blink events. Batch cancellation retained partial measurements. Scrubbing to the middle of the reference video started a new dataset at the selected media time. These checks completed without page errors.

Example test-fixture generation with FFmpeg:

```bash
ffmpeg -i face-video.mp4 -t 3 -vf scale=320:426 -pix_fmt yuv420p -r 15 -f yuv4mpegpipe camera.y4m
ffmpeg -f lavfi -i color=c=black:s=320x240:d=1 -c:v libx264 -pix_fmt yuv420p blank.mp4
node tests/browser_edges.cjs camera.y4m blank.mp4 face-video.mp4
```

## Limits of this validation

- A physical webcam and Windows/macOS launchers were not exercised on actual hardware in this environment. They use standard browser capture and Python entry points.
- Chrome-family browsers were tested. Other browsers and mobile devices are not certified.
- Headless software rendering is slower than typical accelerated desktop rendering. No guaranteed real-time frame rate is claimed.
- No ground-truth landmark coordinates, labeled blink events, calibrated head poses, or known gaze locations were available. Therefore no numerical accuracy, sensitivity, specificity, or clinical claims are made.
- Single-face analysis does not guarantee selection of the same person in a video with multiple people or picture-in-picture faces.
- User video and exported personal measurements are excluded from the distribution. The validation JSON contains aggregate results only.
