# Roomtone

A small browser-based sound monitor. It listens through the selected microphone, displays a live relative level, and alerts when sound crosses your chosen threshold.

## Use it

Open the deployed GitHub Pages site in a modern browser and choose **Start monitoring**. Allow microphone access when prompted. Keep the page open while monitoring; supported browsers will request a screen wake lock to help keep the display awake. Use **Stop monitoring** to release the microphone.

The meter and threshold use dBFS, a relative digital input level. They are not calibrated sound-pressure measurements and should not be used for occupational or hearing-safety decisions. Beep and vibration behavior depends on device settings and browser support. Background monitoring is not guaranteed when the browser is suspended or the phone is locked.

## Publish on GitHub Pages

1. Push the repository to GitHub on the `main` branch.
2. In the repository, open **Settings → Pages** and set the source to **GitHub Actions**.
3. The included workflow deploys the static site after pushes to `main`. You can also start it from the **Actions** tab.

The site has no build step or runtime dependencies. For local testing, serve the repository over `localhost` (for example, `python3 -m http.server 8000`) and open `http://localhost:8000`.