# Quick start

1. Install Python 3.10+ if it is not already installed.
2. Extract the entire ZIP into a normal folder.
3. Windows: double-click `start_windows.bat`. macOS/Linux: run `bash start.sh` from the extracted folder.
4. Open `http://127.0.0.1:8765` in Chrome or Edge.
5. Wait for **Vision engine ready**.
6. Click **Open video** and choose the reference MP4 or your own face video.
7. To scan the entire file, click **Analyze full video**. Use 15 fps to begin.
8. Use **CSV**, **JSON**, or **Report** to download results. Use **Save session** to keep them on this computer.

For webcam input, click **Start camera** and allow the browser permission prompt. Click **Stop source** to release it. No audio is requested.

The app works locally after extraction. Runtime/model files are included. No API key, pip install, or npm install is required for normal use. The uploaded demonstration video is not bundled; select your existing copy.

If the launcher fails, open a terminal in the extracted folder and run:

```bash
python run.py
```

If Python uses another command name, try `python3 run.py` or `py -3 run.py`. If port 8765 is busy, add `--port 8766`.

Read the main README for formulas, limitations, setup troubleshooting, and development tests.
