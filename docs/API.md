# Local session API

Base URL: `http://127.0.0.1:8765` (or the selected port).

| Method | Endpoint | Result |
|---|---|---|
| GET | `/api/health` | Status, app version, local-only indicator |
| GET | `/api/sessions` | Newest 200 session summaries |
| POST | `/api/sessions` | Create session; returns 201 with ID and summary |
| GET | `/api/sessions/{32-character hex ID}` | Full saved session or 404 |
| DELETE | `/api/sessions/{ID}` | Delete one session; returns deletion status |

Writes require `X-FaceScope: 1`. POST also requires `Content-Type: application/json`. External Origin values are rejected. The Host header must match localhost/127.0.0.1 with the active port. All examples assume a local client; there is no remote authentication layer.

## Session document

```json
{
  "schema_version": 1,
  "name": "Desk camera experiment",
  "source": {"type": "video", "name": "clip.mp4", "width": 720, "height": 960, "duration": 10.0},
  "engine": {"name": "MediaPipe Face Landmarker", "version": "0.10.32", "delegate": "CPU", "num_faces": 1},
  "settings": {"sample_rate": 15, "blink_close": 0.2, "blink_open": 0.24, "smoothing_seconds": 0.08, "include_landmarks": false},
  "calibration": null,
  "samples": [
    {"time": 0.0, "detected": false, "eye_left": null, "eye_right": null, "mouth": null, "yaw": null, "pitch": null, "roll": null, "iris_x": null, "iris_y": null, "blink_count": 0, "blinks_per_min": null, "inference_ms": 30.0, "blendshapes": {}}
  ],
  "events": []
}
```

Samples are nondecreasing nonnegative media timestamps in seconds. Detection is a boolean. Missing measurements are JSON null / blank CSV cells. Valid face samples include all returned blendshape coefficients. Optional landmarks are 478 `[x,y,z]` triplets; `transform` is a 16-number column-major matrix array.

Server-generated fields `id`, `created_at`, and `summary` are authoritative. The server computes summary duration, sample count, detected sample count, and tracking percentage rather than accepting client summary values. Maximum body size is 64 MiB; maximum sample count is 18,000. Empty datasets, invalid names, unsupported schema versions, non-finite numbers, and out-of-order timestamps are rejected. The server validates the storage envelope; it does not certify the scientific validity of client-provided measurements.

Possible errors: 400 invalid document, 403 host/origin/marker rejection, 404 unknown session, 413 size limit, 415 incorrect content type, 500 storage failure. Error responses are JSON with an `error` message.

Session JSON is intended as the integration format for downstream analytics. The app has no remote-frame upload, identification, or identity-search endpoint.
