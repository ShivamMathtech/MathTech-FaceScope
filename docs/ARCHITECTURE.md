# Architecture

FaceScope is a local research and development workbench. The browser owns source decoding, inference, measurements, visualization, and export. A small Python service serves immutable application assets and persists explicitly saved sessions in SQLite.

## Data flow

1. `getUserMedia` or a browser file object supplies video frames.
2. A capture canvas scales the frame to a maximum dimension of 1,280 pixels. Aspect ratio is preserved.
3. A transferable `ImageBitmap` is sent to a dedicated classic worker. Only one frame is in flight at a time; there is no unbounded inference queue.
4. The worker runs the bundled MediaPipe CPU/XNNPACK model with WebGL support for graph processing. It closes the bitmap after inference and returns landmarks, blendshapes, and transform matrices.
5. `metrics.js` computes raw geometric measurements and blink events. A separate smoother supplies the live numerical display.
6. `render.js` draws the original captured frame and matching overlay, eye crops, relative-depth mesh, and time-series canvas. All coordinates are unmirrored until the overlay presentation step.
7. Measurements accumulate in a bounded session dataset. Explicit saves call the local session API; browser exports download directly without server storage.

## Source state and time

Camera time and video media time are used for exported sample timestamps. Inference receives strictly increasing timestamps even when a user seeks or changes a source. Source generation counters discard in-flight responses from an earlier source. Full-video analysis pauses playback and serializes seeks and inference.

The file-analysis grid is `t_i = i / requested_fps` while `t_i < video_duration`. Browser decoding/seek resolution can differ from exact container frame timestamps. The source video is not demuxed into frame-indexed images. Results reflect decoded frames sampled at the requested time points.

The live loop is inference-limited: selected fps is an upper bound, not a throughput promise. Batch analysis keeps its sample grid independently of inference speed. Tracking gaps produce missing values rather than artificial zeroes. The chart breaks lines across gaps longer than 0.5 s.

## Persistence

Each save creates a session UUID and UTC creation timestamp. The complete versioned JSON document is stored as text alongside list metadata. Connections are short-lived and writes are transactional. SQLite WAL mode supports the local HTTP server's worker threads.

No source video, camera audio, face embedding, or identity record is stored. Optional raw landmark arrays are stored only when explicitly enabled. Source filenames, dimensions, duration, and input file size appear in metadata.

## Local security boundary

The service binds only to `127.0.0.1`. It validates the Host header against its actual local port. Writes require the application marker header and reject an external Origin. There is no cross-origin access policy. Static content is rooted under `web/`, and parent traversal, hidden paths, and directory listings are rejected. SQLite uses parameterized statements.

This service has no user accounts, TLS termination, organization roles, quotas across users, or centralized audit log. Do not modify the bind address to expose it as a production network service. A hosted product requires a separately designed authentication, authorization, operational monitoring, and retention layer.

## Extension points

- Add pure measurements in `web/metrics.js`, then add units and export columns.
- Replace `tracker.worker.js` for another compatible inference engine; preserve the result contract.
- Add a labeled evaluation harness that compares blink events and landmarks against annotated ground truth.
- Replace browser seeking with a native decoder for frame-index-exact offline analysis.
- Implement a calibrated gaze-estimation model if actual screen gaze is needed; iris x/y alone is insufficient.
- For multiple people, add explicit face association and per-track event state. Setting `numFaces` above one alone does not provide persistent identities.

## Dependency policy

Application JavaScript is native ES modules. There is no frontend build step and no runtime npm install. The vendor package version, source URLs, byte lengths, and SHA-256 hashes are pinned in `assets.lock.json`. Verification is separate from launch to avoid rehashing 26 MB on every start.
