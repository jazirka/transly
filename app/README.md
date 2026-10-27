# Transly app

Real application, built from the design in `../mockup`.

- `src/core` — pure TypeScript, no DOM: RPG Maker import/export, QA, workflow, project merge, autosave. Covered by tests.
- `src/ui` — browser UI (vanilla TS + Vite). Folder access via File System Access API with an `<input webkitdirectory>` fallback; project stored in IndexedDB.

```
npm install
npm run dev        # dev server
npm test           # unit tests
GAME_DATA_DIR=/path/to/game/data npm test   # also run round-trip checks on real game files
npm run build      # typecheck + production build
```

Game files are only read, never modified. Translations live in the browser profile.

## Sync between devices (no cloud service)

Run the relay on a machine you control (a PC on your network, a VPS, behind a tunnel):

```
node server/relay.ts --port 7421 [--dir ./relay-data]
```

Then on every device: Settings → Synchronization → server address and the same passphrase.
Data is encrypted on the devices (AES-GCM, key from the passphrase); the relay only holds opaque blobs and forgets them after 30 days.
Edits are merged per string, the newer edit wins, and concurrent edits to the same string are reported.
For addresses reachable over the internet use https (browsers block plain http from https pages).

## Desktop app (Tauri)

The same UI runs in a Tauri shell that adds what a browser cannot do: remember the game folder, write the translation straight into the game's `data` folder (originals are backed up once next to it, in `data.transly-orig`, and can be restored), and launch the game for testing.

```
npm run tauri dev      # run the desktop app
npm run tauri build    # installer for the current OS
```

Linux needs `libwebkit2gtk-4.1-dev`, `build-essential`, `libssl-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`. The UI can only touch folders and the game executable picked in a native dialog; paths are checked in `src-tauri/src/lib.rs`.
