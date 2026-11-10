---
name: real-device-protocol
description: A checklist the human runs on real Windows (WebView2) and Android hardware, covering what a browser-based audit cannot see, with the observable outcome and the external standard for each step.
---

# Real-device protocol (for the person, not the agent)

An audit in a container drives Chromium. It cannot see the real WebView2, the real Android WebView, the system file dialogs, the on-screen keyboard, the real fonts, real storage limits or real game folders. These steps close that gap. For each: do it, write **what you saw**, and attach a screenshot or photo if something looks off. Any "I expected X, got Y" is a finding.

## Windows desktop app
1. **Install and first start:** run the installer; does Windows SmartScreen interrupt; does the window open at a sensible size; are the title bar buttons (own) usable, draggable, double-click-to-maximise; does it remember size and place after restart.
2. **Scaling:** repeat at 100%, 125%, 150%, 200% display scaling and with a second monitor of different scale. Look for blurry text, clipped panels, controls overlapping, text too small.
3. **Open a real game folder** (a real RPG Maker game, not a test one): time to open; is anything missing; open the biggest map; scroll quickly; type in a row; does typing lag.
4. **Save, close, reopen, kill:** edit a row, wait, close normally, reopen; edit a row, then end the process in Task Manager immediately; reopen: what survived? (Expected: at most the last second of typing is lost.)
5. **Write to the game** and run it: is the translation shown; do line breaks, colours, names and variables still work; is the original game untouched where it should be (compare the data folder before and after for files you did not expect to change).
6. **Keyboard only:** Tab through the whole window; is the focus always visible; can every function be reached; can you get stuck.
7. **Narrator or NVDA** for two minutes: are buttons named; is the current row announced.
8. **Offline and slow disk:** disable the network, repeat steps 3–5; use a game on a USB drive; disconnect it while editing.

## Android app
1. **Install** the APK on a real phone; permissions asked; first screen.
2. **Open files** from storage and from a cloud provider; very large file (50–100 MB).
3. **Keyboard:** open the translation field; does the keyboard cover it; switch between Ukrainian and English layouts; use voice input and the clipboard; autocorrect changing your text (it must not alter control codes).
4. **Rotate** during typing and during a dialog; split-screen; a different font size and display size in system settings; dark and light system themes.
5. **Interrupt:** receive a call while typing; switch apps for 10 minutes; kill the app; reopen: is the work there.
6. **Back button and gestures:** does Back do what a user expects on every screen; does a swipe go the right way.
7. **Widgets** on the home screen: add, update, tap; do they show current data.
8. **Low-end phone** or battery saver mode: scroll a long list; type; open the biggest file.

## Cross-device
- Put the same project on both; edit different rows on each; sync (file or GitHub); is anything lost or duplicated; edit the same row on both; what does the product tell you.
- Language: all interface text is Ukrainian or intentionally something else; no raw keys or English leftovers; dates and numbers formatted for Ukrainian.

## How to report back
One line per step: `step — OK` or `step — what was wrong (screenshot name)`. Include device model, Windows/Android version, display scaling, and the app build id shown in the app.
