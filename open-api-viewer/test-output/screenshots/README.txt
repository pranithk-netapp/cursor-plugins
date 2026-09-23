Latest run: 2026-09-23T08-36-49-980Z
File: preview-2026-09-23T08-36-49-980Z.png
Bytes: 0
screencapture error: Command failed: /usr/sbin/screencapture -x /Users/pranithk/go/cursor-plugins/open-api-viewer/test-output/screenshots/preview-2026-09-23T08-36-49-980Z.png
could not create image from display

Below the expected size floor -- likely missing macOS Screen Recording permission for the process running `npm test` (Terminal/node/Electron), or the window wasn't visible on screen. Grant Screen Recording permission to that process in System Settings > Privacy & Security > Screen Recording, then re-run. This is an environment/permission limitation, not a code bug: the functional assertions above (panel created, correct viewType) already passed independently of whether the screenshot captured real pixels.
