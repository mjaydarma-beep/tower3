# Beach Guard Tower Network – Node + MQTT Prototype

This project turns the demo page into a runnable Node.js app with a backend that serves the UI, maintains tower state, exposes REST + WebSocket APIs, and can publish/consume MQTT topics. A simulator keeps the UI lively when no broker is configured.

## Prerequisites
- Node.js 18+ (recommended) and npm
- Optional: MQTT broker URL/creds if you want live device topics

## Install
```sh
npm install
```

## Run
- Dev (with reload): `npm run dev`
- Prod: `npm start`

Then open http://localhost:3000

## Configuration (env vars)
- `PORT` – default `3000`
- `MQTT_URL` – e.g. `mqtt://localhost:1883` or `mqtts://broker:8883`
- `MQTT_USER`, `MQTT_PASS` – optional credentials
- `SIM_MODE` – default enabled; set `SIM_MODE=false` to disable the built-in simulator

## MQTT topics (used by backend)
- Publish commands (UI -> devices):
  - `tower/<id>/cmd/output` `{ index, state }`
  - `tower/<id>/cmd/led` `{ mode, preset, text, durationSec, brightness, priority }`
  - `group/<region>/cmd/led` (region broadcast)
  - `group/all/cmd/led` (global broadcast)
  - `tower/<id>/cmd/ptt` `{ action: "start" }`
- Subscribe for device events (devices -> backend):
  - `tower/<id>/event/status` `{ online, signal }`
  - `tower/<id>/event/io` `{ inputs:[0/1], outputs:[0/1] }`
  - `tower/<id>/event/call` `{ input: 0, state: true }`
  - `tower/<id>/event/led` `{ mode, preset, text, ... }`

## HTTP endpoints
- `GET /api/state` – initial towers/regions/stats/logs
- `POST /api/towers/:id/output` – body `{ index }` (toggles)
- `POST /api/towers/:id/led` – body `{ target: "tower"|"region"|"all", mode, preset?, text?, durationSec?, brightness?, priority? }`
- `POST /api/towers/:id/ptt` – demo PTT start
- `POST /api/demo/call` – triggers a demo call event (uses random tower when id not provided)

## Frontend behavior
- Loads initial state from `/api/state`
- Subscribes to WebSocket for `init`, `tower_update`, `log`, `stats`
- Calls backend endpoints for outputs, LED (tower/region/all), PTT demo, and demo call
- Map/popup/overlay stay in sync; LED canvases redraw live

## Raspberry Pi client (MQTT publisher)
- File: `pi-client.js`
- Install: `npm install mqtt` (inside repo or copy the file elsewhere and install there)
- Run (no auth example): `MQTT_URL=mqtt://2.245.63.236 TOWER_ID="PERTH PR1001" node pi-client.js`
- Topics it sends:
  - `tower/<id>/event/status` `{ online, signal }`
  - `tower/<id>/event/io` `{ inputs, outputs }`
  - `tower/<id>/event/call` `{ input, state }`
  - (add your own publishes as needed)

## Notes
- Simulator is on by default and periodically triggers calls and output toggles so the UI has activity without MQTT.
- CCTV uses the demo YouTube embed; swap `DEMO_CCTV_EMBED_URL` in `public/index.html` with your stream gateway when ready.
