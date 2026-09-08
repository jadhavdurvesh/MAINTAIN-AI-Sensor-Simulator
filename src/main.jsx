import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Activity, Cpu, Gauge, Play, Square, RotateCcw, Send, Wifi, WifiOff, Thermometer, Droplets, Waves, Zap, CheckCircle2, XCircle, Settings2 } from 'lucide-react'
import './style.css'

const DEFAULT_API = 'https://maintain-ai-3.vercel.app'
const DEFAULT_KEY = ''
const clamp = (n, min, max) => Math.min(max, Math.max(min, n))
const noise = amount => (Math.random() * 2 - 1) * amount

const PRESETS = {
  normal: { temperature: 30, humidity: 52, vibration: 0.12, current: 4.8 },
  warning: { temperature: 52, humidity: 68, vibration: 0.85, current: 8.5 },
  critical: { temperature: 72, humidity: 84, vibration: 2.7, current: 14.2 }
}

const initialValues = () => ({ ...PRESETS.normal })

function App() {
  const [apiUrl, setApiUrl] = useState(() => localStorage.getItem('mai_sim_api') || DEFAULT_API)
  const [deviceKey, setDeviceKey] = useState(() => localStorage.getItem('mai_sim_key') || DEFAULT_KEY)
  const [machine, setMachine] = useState(() => localStorage.getItem('mai_sim_machine') || 'motor')
  const [interval, setIntervalMs] = useState(5000)
  const [values, setValues] = useState(initialValues)
  const [running, setRunning] = useState(false)
  const [status, setStatus] = useState('idle')
  const [lastSent, setLastSent] = useState(null)
  const [logs, setLogs] = useState([])
  const timer = useRef(null)

  const normalizedApi = useMemo(() => apiUrl.trim().replace(/\/$/, ''), [apiUrl])

  useEffect(() => () => clearTimeout(timer.current), [])

  const addLog = (type, message, ok = true) => {
    setLogs(prev => [{ id: Date.now() + Math.random(), time: new Date().toLocaleTimeString(), type, message, ok }, ...prev].slice(0, 80))
  }

  const saveSettings = () => {
    localStorage.setItem('mai_sim_api', apiUrl.trim())
    localStorage.setItem('mai_sim_key', deviceKey.trim())
    localStorage.setItem('mai_sim_machine', machine.trim() || 'motor')
    addLog('CONFIG', 'Configuration saved locally')
  }

  const sendReading = async (readingType, value, unit) => {
    if (!normalizedApi || !deviceKey.trim()) {
      addLog('ERROR', 'API URL and device key are required', false)
      setStatus('error')
      return false
    }
    try {
      const response = await fetch(`${normalizedApi}/api/devices/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Device-Key': deviceKey.trim() },
        body: JSON.stringify({ reading_type: readingType, value: Number(value.toFixed(2)), unit })
      })
      const text = await response.text()
      if (!response.ok) throw new Error(`HTTP ${response.status}${text ? ` · ${text.slice(0, 140)}` : ''}`)
      addLog(readingType.toUpperCase(), `${value.toFixed(2)} ${unit} → accepted`, true)
      setLastSent(new Date())
      setStatus('connected')
      return true
    } catch (error) {
      addLog('ERROR', `${readingType}: ${error.message}`, false)
      setStatus('error')
      return false
    }
  }

  const sendCycle = async (next = values) => {
    setStatus('sending')
    const readings = [
      ['temperature', next.temperature, '°C'],
      ['humidity', next.humidity, '%'],
      ['vibration', next.vibration, 'g'],
      ['current', next.current, 'A']
    ]
    for (const [type, value, unit] of readings) await sendReading(type, value, unit)
    setStatus('connected')
  }

  const tick = async () => {
    setValues(prev => {
      const next = {
        temperature: clamp(prev.temperature + noise(2.2), -20, 120),
        humidity: clamp(prev.humidity + noise(4), 0, 100),
        vibration: clamp(prev.vibration + noise(Math.max(0.03, prev.vibration * 0.12)), 0, 10),
        current: clamp(prev.current + noise(Math.max(0.12, prev.current * 0.08)), 0, 40)
      }
      sendCycle(next)
      return next
    })
  }

  useEffect(() => {
    if (!running) return
    timer.current = setTimeout(async () => { await tick() }, interval)
    return () => clearTimeout(timer.current)
  }, [running, values, interval])

  const start = () => {
    saveSettings()
    if (!running) {
      setRunning(true)
      addLog('SYSTEM', `Simulation started · every ${interval / 1000}s`)
      sendCycle(values)
    }
  }

  const stop = () => {
    setRunning(false)
    clearTimeout(timer.current)
    setStatus('idle')
    addLog('SYSTEM', 'Simulation stopped')
  }

  const preset = name => {
    const next = { ...PRESETS[name] }
    setValues(next)
    addLog('PRESET', `${name.toUpperCase()} sensor profile loaded`)
    if (running) sendCycle(next)
  }

  const clearLogs = () => setLogs([])

  const sensorCards = [
    { key: 'temperature', label: 'Temperature', unit: '°C', icon: Thermometer, min: -20, max: 120, step: 0.1 },
    { key: 'humidity', label: 'Humidity', unit: '%', icon: Droplets, min: 0, max: 100, step: 0.1 },
    { key: 'vibration', label: 'Vibration', unit: 'g', icon: Waves, min: 0, max: 10, step: 0.01 },
    { key: 'current', label: 'Current', unit: 'A', icon: Zap, min: 0, max: 40, step: 0.1 }
  ]

  return <div className="app">
    <header className="topbar">
      <div className="brand"><div className="brandmark"><Activity size={20}/></div><div><b>MAINTAIN AI</b><span>Sensor Simulator</span></div></div>
      <div className={`connection ${status}`}><span className="dot"/>{status === 'connected' ? 'API Connected' : status === 'sending' ? 'Sending…' : status === 'error' ? 'Connection Error' : 'Simulator Idle'}</div>
    </header>

    <main>
      <section className="hero">
        <div><div className="eyebrow"><Cpu size={15}/> VIRTUAL ESP32</div><h1>Live Sensor Laboratory</h1><p>Simulate an ESP32 and push changing sensor readings directly into MAINTAIN AI for testing.</p></div>
        <div className="hero-actions"><button className="btn ghost" onClick={() => setValues(initialValues())}><RotateCcw size={16}/> Reset</button>{running ? <button className="btn danger" onClick={stop}><Square size={16}/> Stop Simulation</button> : <button className="btn primary" onClick={start}><Play size={16}/> Start Simulation</button>}</div>
      </section>

      <section className="grid settings-grid">
        <div className="panel settings"><div className="panel-title"><Settings2 size={17}/> Connection</div>
          <label>MAINTAIN AI API URL<input value={apiUrl} onChange={e => setApiUrl(e.target.value)} placeholder="https://your-api.vercel.app" /></label>
          <label>Device Key<input value={deviceKey} onChange={e => setDeviceKey(e.target.value)} placeholder="Paste machine IoT device key" /></label>
          <div className="two"><label>Machine<input value={machine} onChange={e => setMachine(e.target.value)} placeholder="motor" /></label><label>Send interval<select value={interval} onChange={e => setIntervalMs(Number(e.target.value))}><option value="1000">1 second</option><option value="5000">5 seconds</option><option value="10000">10 seconds</option><option value="30000">30 seconds</option></select></label></div>
          <button className="btn ghost wide" onClick={saveSettings}><CheckCircle2 size={16}/> Save locally</button>
          <small>Credentials are kept in this browser's local storage and are never included in the repository.</small>
        </div>
        <div className="panel presets"><div className="panel-title"><Gauge size={17}/> Fault Profiles</div><p>Load a realistic operating condition. While running, the new profile is sent immediately.</p><div className="preset-buttons"><button onClick={() => preset('normal')} className="normal">Normal</button><button onClick={() => preset('warning')} className="warning">Warning</button><button onClick={() => preset('critical')} className="critical">Critical</button></div><div className="status-box"><span className="pulse"/>{running ? `Streaming to ${machine || 'motor'}` : 'Ready to simulate'}<b>{lastSent ? `Last sent ${lastSent.toLocaleTimeString()}` : 'No readings sent yet'}</b></div></div>
      </section>

      <section className="panel readings"><div className="panel-head"><div><div className="panel-title">Sensor Controls</div><p>Adjust values manually or use a fault profile. Running mode adds small random variation every cycle.</p></div><span className="live-pill"><span/> LIVE DATA</span></div><div className="sensor-grid">
        {sensorCards.map(({key,label,unit,icon:Icon,min,max,step}) => <div className="sensor" key={key}><div className="sensor-head"><span className="sensor-icon"><Icon size={18}/></span><span>{label}</span><strong>{values[key].toFixed(key === 'vibration' ? 2 : 1)} <em>{unit}</em></strong></div><input type="range" min={min} max={max} step={step} value={values[key]} onChange={e => setValues(v => ({...v,[key]:Number(e.target.value)}))}/><div className="range-labels"><span>{min}</span><span>{max} {unit}</span></div></div>)}
      </div><button className="send-one" onClick={() => sendCycle(values)} disabled={status === 'sending'}><Send size={16}/> Send Current Readings Now</button></section>

      <section className="panel log-panel"><div className="panel-head"><div className="panel-title">Transmission Log</div><button className="clear" onClick={clearLogs}>Clear</button></div><div className="logs">{logs.length === 0 ? <div className="empty"><WifiOff size={20}/> No transmissions yet. Start the simulation to begin.</div> : logs.map(log => <div className="log" key={log.id}><span className="time">{log.time}</span><span className={`tag ${log.ok ? 'ok' : 'bad'}`}>{log.type}</span><span>{log.message}</span>{log.ok ? <CheckCircle2 className="log-icon" size={15}/> : <XCircle className="log-icon" size={15}/>}</div>)}</div></section>
    </main>
    <footer><span>MAINTAIN AI Sensor Simulator</span><span>Virtual testing only · No physical ESP32 required</span></footer>
  </div>
}

createRoot(document.getElementById('root')).render(<App />)
