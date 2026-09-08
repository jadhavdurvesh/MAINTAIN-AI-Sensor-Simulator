# MAINTAIN AI Sensor Simulator

A Vercel-ready browser simulator for testing MAINTAIN AI live sensor ingestion without physical ESP32 hardware.

## Features

- Temperature, humidity, vibration, and current controls
- Start/stop continuous simulation
- Normal, warning, and critical presets
- Adjustable send interval
- Live request log
- Direct `POST /api/devices/ingest` integration
- Device key stored locally in the browser, not in the repository
- No simulator backend required

## Run locally

```bash
npm install
npm run dev
```

## Deploy to Vercel

Import this repository into Vercel. It is a standard Vite frontend, so Vercel can build it with:

```text
Build command: npm run build
Output directory: dist
```

In the simulator UI, enter the deployed MAINTAIN AI API base URL and the IoT device key for the machine you want to test.

For the deployed simulator to call a deployed MAINTAIN AI backend from the browser, the MAINTAIN AI backend must allow the simulator's origin through CORS.
