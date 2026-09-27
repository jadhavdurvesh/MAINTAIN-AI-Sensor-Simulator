# MAINTAIN AI Sensor Simulator

A Vercel-ready browser simulator for testing MAINTAIN AI live sensor ingestion without physical ESP32 hardware.

## Browser simulator

- Temperature, humidity, vibration, and current controls
- Start/stop continuous simulation
- Normal, warning, and critical presets
- Adjustable send interval
- Live request log
- Direct `POST /api/devices/ingest` integration
- Device key stored locally in the browser, not in the repository

## Always-on cloud simulator

`cloud_worker.py` is an always-running Render service that sends synthetic telemetry without depending on a browser or laptop. It reads:

- `SIMULATOR_API_URL` — MAINTAIN AI backend base URL
- `SIMULATOR_DEVICE_KEYS` — JSON list such as `[{"id":18,"device_key":"..."}]` or JSON object such as `{"18":"..."}`
- `SIMULATOR_INTERVAL_SECONDS` — default 5 seconds

The worker sends temperature, humidity, vibration, current, and load readings and periodically introduces a synthetic high-load/fault wave so the predictive-maintenance pipeline has meaningful variation.

## Run locally

```bash
npm install
npm run dev
```

## Deploy browser simulator to Vercel

Build command: `npm run build`

Output directory: `dist`

For the browser simulator to call a deployed MAINTAIN AI backend, the backend must allow the simulator origin through CORS.

## Deploy cloud simulator to Render

The repository includes `render.yaml`. The cloud service is designed to run on an always-on paid compute plan; Render's free web instances can spin down after inactivity. Configure the two secret environment variables in Render before telemetry will be emitted.
