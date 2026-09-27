import json
import os
import random
import time
from datetime import datetime, timezone

import requests
from flask import Flask, jsonify

API_URL = os.environ.get("SIMULATOR_API_URL", "").rstrip("/")
INTERVAL = max(1.0, float(os.environ.get("SIMULATOR_INTERVAL_SECONDS", "5")))
DEVICE_KEYS_RAW = os.environ.get("SIMULATOR_DEVICE_KEYS", "[]")

app = Flask(__name__)
state = {"running": False, "last_cycle": None, "machines": 0, "sent": 0, "errors": 0}


def load_devices():
    try:
        value = json.loads(DEVICE_KEYS_RAW)
        if isinstance(value, dict):
            return [{"id": int(k), "device_key": str(v)} for k, v in value.items()]
        if isinstance(value, list):
            return [x for x in value if isinstance(x, dict) and x.get("device_key")]
    except Exception:
        pass
    return []


def signal_profile(machine, tick):
    phase = (tick + machine["id"] * 17) % 240
    fault_wave = phase > 215
    category = (machine.get("category") or "other").lower()
    base_current = {"compressor": 6.0, "induction_motor": 4.8, "pump": 4.2, "conveyor": 5.2}.get(category, 4.5)
    current = base_current + random.uniform(-0.25, 0.25)
    temperature = 30.0 + random.uniform(-0.8, 0.8)
    humidity = 52.0 + random.uniform(-2.0, 2.0)
    vibration = 0.12 + random.uniform(-0.02, 0.02)
    load = max(0.0, min(100.0, current * 10.0 + random.uniform(-2, 2)))
    if fault_wave:
        temperature += 18 + random.uniform(0, 8)
        vibration += 1.2 + random.uniform(0, 0.8)
        current += 2.5 + random.uniform(0, 2)
        load = min(100.0, load + 20)
    return [
        ("temperature", temperature, "C"),
        ("humidity", humidity, "%"),
        ("vibration", vibration, "g"),
        ("current", current, "A"),
        ("load", load, "%"),
    ]


def send_reading(device_key, reading_type, value, unit):
    response = requests.post(
        f"{API_URL}/api/devices/ingest",
        headers={"X-Device-Key": device_key, "Content-Type": "application/json"},
        json={
            "reading_type": reading_type,
            "value": round(float(value), 3),
            "unit": unit,
            "recorded_at": datetime.now(timezone.utc).isoformat(),
            "event_id": f"cloud-sim-{time.time_ns()}",
        },
        timeout=15,
    )
    response.raise_for_status()


def cycle():
    devices = load_devices()
    state["machines"] = len(devices)
    tick = int(time.time() / INTERVAL)
    for machine in devices:
        for reading_type, value, unit in signal_profile(machine, tick):
            try:
                send_reading(machine["device_key"], reading_type, value, unit)
                state["sent"] += 1
            except Exception as exc:
                state["errors"] += 1
                print(f"telemetry error machine={machine.get('id')}: {exc}", flush=True)
    state["last_cycle"] = datetime.now(timezone.utc).isoformat()


def worker_loop():
    state["running"] = True
    while True:
        started = time.monotonic()
        if API_URL and load_devices():
            cycle()
        else:
            state["last_cycle"] = datetime.now(timezone.utc).isoformat()
            if not API_URL:
                print("SIMULATOR_API_URL is not configured; waiting.", flush=True)
            elif not load_devices():
                print("SIMULATOR_DEVICE_KEYS is empty; waiting.", flush=True)
        time.sleep(max(0.1, INTERVAL - (time.monotonic() - started)))


@app.get("/")
def health():
    return jsonify({"service": "MAINTAIN AI cloud simulator", **state})


if __name__ == "__main__":
    import threading
    threading.Thread(target=worker_loop, daemon=True).start()
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "10000")))
