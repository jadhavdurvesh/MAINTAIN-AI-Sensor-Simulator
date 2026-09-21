import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Activity, Cpu, Gauge, Play, Square, RotateCcw, Send, Wifi, WifiOff, Thermometer, Droplets, Waves, Zap, CheckCircle2, XCircle, Settings2, ShieldAlert, ShieldCheck, Cog, Power, CircleGauge, RotateCw } from 'lucide-react'
import './style.css'

const DEFAULT_API = ''
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
  const [interval, setIntervalMs] = useState(5000)
  const [values, setValues] = useState(initialValues)
  const [running, setRunning] = useState(false)
  const [status, setStatus] = useState('idle')
  const [deviceStatus, setDeviceStatus] = useState('disconnected')
  const [shutdownLatched, setShutdownLatched] = useState(false)
  const [lastSent, setLastSent] = useState(null)
  const [logs, setLogs] = useState([])
  const timer = useRef(null)
  const socket = useRef(null)
  const reconnectTimer = useRef(null)

  const normalizedApi = useMemo(() => apiUrl.trim().replace(/\/$/, ''), [apiUrl])
  const wsUrl = useMemo(() => {
    if (!normalizedApi) return ''
    const url = new URL(normalizedApi)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    url.pathname = '/api/devices/ws'
    url.search = ''
    return url.toString()
  }, [normalizedApi])

  useEffect(() => () => {
    clearTimeout(timer.current)
    clearTimeout(reconnectTimer.current)
    socket.current?.close()
  }, [])

  const addLog = (type, message, ok = true) => {
    setLogs(prev => [{ id: Date.now() + Math.random(), time: new Date().toLocaleTimeString(), type, message, ok }, ...prev].slice(0, 100))
  }

  const saveSettings = () => {
    localStorage.setItem('mai_sim_api', apiUrl.trim())
    localStorage.setItem('mai_sim_key', deviceKey.trim())
    addLog('CONFIG', 'Configuration saved locally')
  }

  const connectDevice = () => new Promise((resolve, reject) => {
    if (!wsUrl || !deviceKey.trim()) {
      addLog('ERROR', 'API URL and device key are required for device connection', false)
      setDeviceStatus('error')
      reject(new Error('API URL and device key are required'))
      return
    }
    clearTimeout(reconnectTimer.current)
    socket.current?.close()
    setDeviceStatus('connecting')

    let settled = false
    const finish = (ok, error) => {
      if (settled) return
      settled = true
      if (ok) resolve()
      else reject(error || new Error('device connection failed'))
    }

    try {
      const ws = new WebSocket(wsUrl)
      socket.current = ws
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'authenticate', device_key: deviceKey.trim() }))
        addLog('DEVICE', 'WebSocket connected — authenticating device key')
      }
      ws.onmessage = event => {
        try {
          const message = JSON.parse(event.data)
          if (message.type === 'authenticated') {
            setDeviceStatus('authenticated')
            addLog('DEVICE', `Authenticated as machine #${message.machine_id} · ${message.machine}`)
            finish(true)
            return
          }
          if (message.type === 'reading_accepted') {
            setLastSent(new Date())
            return
          }
          if (message.type === 'shutdown' || message.type === 'shutdown_test') {
            setShutdownLatched(true)
            setRunning(false)
            clearTimeout(timer.current)
            setStatus('shutdown')
            addLog('SAFETY', `${message.type === 'shutdown_test' ? 'TEST ' : ''}SHUTDOWN COMMAND RECEIVED — output latched OFF`)
            ws.send(JSON.stringify({
              type: message.type === 'shutdown_test' ? 'shutdown_test_ack' : 'shutdown_ack',
              event_id: message.event_id || null,
              status: 'latched_off'
            }))
            addLog('SAFETY', 'Shutdown acknowledgement sent to MAINTAIN AI')
            return
          }
          if (message.type === 'error') {
            addLog('DEVICE ERROR', message.message || 'Device channel error', false)
            finish(false, new Error(message.message || 'device authentication failed'))
          }
        } catch {
          addLog('ERROR', 'Received invalid device message', false)
        }
      }
      ws.onerror = () => {
        setDeviceStatus('error')
        addLog('DEVICE ERROR', 'WebSocket connection failed. Check the MAINTAIN AI API URL and deployment WebSocket support.', false)
        finish(false, new Error('WebSocket connection failed'))
      }
      ws.onclose = () => {
        if (socket.current === ws) socket.current = null
        setDeviceStatus(prev => prev === 'authenticated' ? 'disconnected' : prev)
        if (!settled) finish(false, new Error('Device WebSocket closed before authentication'))
        addLog('DEVICE', 'Device WebSocket disconnected', false)
      }
    } catch (error) {
      setDeviceStatus('error')
      addLog('DEVICE ERROR', error.message, false)
      finish(false, error)
    }
  })

  const sendReading = async (readingType, value, unit) => {
    if (shutdownLatched) {
      addLog('SAFETY', 'Reading blocked: simulator is shutdown-latched. Reset the device before restarting.', false)
      return false
    }
    if (!normalizedApi || !deviceKey.trim()) {
      addLog('ERROR', 'API URL and device key are required', false)
      setStatus('error')
      return false
    }

    const payload = { type: 'reading', reading_type: readingType, value: Number(value.toFixed(2)), unit }
    if (socket.current?.readyState === WebSocket.OPEN) {
      try {
        socket.current.send(JSON.stringify(payload))
        addLog(readingType.toUpperCase(), `${value.toFixed(2)} ${unit} → device channel`, true)
        setLastSent(new Date())
        setStatus('connected')
        return true
      } catch (error) {
        addLog('ERROR', `${readingType}: ${error.message}`, false)
      }
    }

    // REST remains a compatibility fallback for older devices. It is only used
    // when the device WebSocket is not authenticated, so startup does not race
    // the WebSocket handshake.
    try {
      const response = await fetch(`${normalizedApi}/api/devices/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Device-Key': deviceKey.trim() },
        body: JSON.stringify({ reading_type: readingType, value: Number(value.toFixed(2)), unit })
      })
      const text = await response.text()
      if (!response.ok) throw new Error(`HTTP ${response.status}${text ? ` · ${text.slice(0, 140)}` : ''}`)
      addLog(readingType.toUpperCase(), `${value.toFixed(2)} ${unit} → REST accepted`, true)
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
    if (shutdownLatched) return
    setStatus('sending')
    const readings = [
      ['temperature', next.temperature, '°C'],
      ['humidity', next.humidity, '%'],
      ['vibration', next.vibration, 'g'],
      ['current', next.current, 'A']
    ]
    for (const [type, value, unit] of readings) await sendReading(type, value, unit)
    if (!shutdownLatched) setStatus('connected')
  }

  const tick = async () => {
    if (shutdownLatched) return
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
    if (!running || shutdownLatched) return
    timer.current = setTimeout(tick, interval)
    return () => clearTimeout(timer.current)
  }, [running, values, interval, shutdownLatched])

  const start = async () => {
    saveSettings()
    if (shutdownLatched) {
      addLog('SAFETY', 'Reset the simulated device before starting after shutdown.', false)
      return
    }
    try {
      await connectDevice()
      setRunning(true)
      addLog('SYSTEM', `Simulation started · authenticated device channel · every ${interval / 1000}s`)
      await sendCycle(values)
    } catch {
      setRunning(false)
      setStatus('error')
      addLog('SYSTEM', 'Simulation did not start because the device channel could not authenticate.', false)
    }
  }

  const stop = () => {
    setRunning(false)
    clearTimeout(timer.current)
    setStatus('idle')
    addLog('SYSTEM', 'Simulation stopped')
  }

  const resetDevice = async () => {
    setShutdownLatched(false)
    setValues(initialValues())
    setStatus('idle')
    addLog('SAFETY', 'Simulated relay/output reset — device ready')
    if (deviceStatus !== 'authenticated') {
      try { await connectDevice() } catch {}
    }
  }

  const preset = name => {
    const next = { ...PRESETS[name] }
    setValues(next)
    addLog('PRESET', `${name.toUpperCase()} sensor profile loaded`)
    if (running && !shutdownLatched) sendCycle(next)
  }

  const clearLogs = () => setLogs([])

  const sensorCards = [
    { key: 'temperature', label: 'Temperature', unit: '°C', icon: Thermometer, min: -20, max: 120, step: 0.1 },
    { key: 'humidity', label: 'Humidity', unit: '%', icon: Droplets, min: 0, max: 100, step: 0.1 },
    { key: 'vibration', label: 'Vibration', unit: 'g', icon: Waves, min: 0, max: 10, step: 0.01 },
    { key: 'current', label: 'Current', unit: 'A', icon: Zap, min: 0, max: 40, step: 0.1 }
  ]

  const connectionLabel = shutdownLatched
    ? 'SHUTDOWN LATCHED'
    : deviceStatus === 'authenticated'
      ? 'Device Authenticated'
      : deviceStatus === 'connecting'
        ? 'Connecting Device…'
        : status === 'sending'
          ? 'Sending…'
          : status === 'error' || deviceStatus === 'error'
            ? 'Connection Error'
            : 'Simulator Idle'

  return <div className="app">
    <header className="topbar">
      <div className="brand"><div className="brandmark"><Activity size={20}/></div><div><b>MAINTAIN AI</b><span>Sensor Simulator</span></div></div>
      <div className={`connection ${shutdownLatched ? 'error' : deviceStatus === 'authenticated' ? 'connected' : status}`}><span className="dot"/>{connectionLabel}</div>
    </header>

    <main>
      <section className="hero">
        <div><div className="eyebrow"><Cpu size={15}/> VIRTUAL ESP32</div><h1>Live Sensor + Safety Laboratory</h1><p>Emulates the real ESP32 device channel: authenticate with the machine device key, stream telemetry, receive shutdown commands, and acknowledge them.</p></div>
        <div className="hero-actions"><button className="btn ghost" onClick={resetDevice}><RotateCcw size={16}/> Reset Device</button>{running ? <button className="btn danger" onClick={stop}><Square size={16}/> Stop Simulation</button> : <button className="btn primary" onClick={start}><Play size={16}/> Start Device</button>}</div>
      </section>

      <section className={`machine-stage panel ${shutdownLatched ? 'machine-off' : running ? 'machine-running' : 'machine-idle'}`}>
        <div className="machine-stage-head"><div><div className="panel-title"><Cog size={17}/> Machine Simulation</div><p>Live visual state of the virtual machine driven by the authenticated device channel.</p></div><div className="machine-state"><span className="machine-state-dot"/><b>{shutdownLatched ? 'SAFETY OFF' : running ? 'MACHINE RUNNING' : 'MACHINE STOPPED'}</b><span>{deviceStatus === 'authenticated' ? 'DEVICE LINKED' : 'DEVICE OFFLINE'}</span></div></div>
        <div className="machine-visual">
          <div className="machine-cabinet"><div className="cabinet-label"><span>MAINTAIN AI</span><small>VIRTUAL DRIVE UNIT</small></div><div className="status-lamps"><i className="lamp power"/><i className="lamp link"/><i className={`lamp fault ${shutdownLatched ? 'active' : ''}`}/></div><div className="machine-face"><div className="rotor-wrap"><div className="rotor"><span/><span/><span/><span/></div><div className="rotor-hub"><Power size={18}/></div></div><div className="machine-bars"><i/><i/><i/><i/><i/></div></div></div>
          <div className="drive-line"><div className="belt"><span/><span/><span/></div><div className="drive-wheel"><div className="wheel-core"/><div className="wheel-spokes"><i/><i/><i/><i/></div></div></div>
          <div className="machine-metrics"><div><span>STATE</span><strong>{shutdownLatched ? 'OFF' : running ? 'RUN' : 'IDLE'}</strong></div><div><span>LOAD</span><strong>{Math.round(clamp(values.current * 6.2, 0, 100))}%</strong></div><div><span>SPEED</span><strong>{running && !shutdownLatched ? `${Math.round(900 + values.current * 42)} RPM` : '0 RPM'}</strong></div><div><span>HEALTH</span><strong>{shutdownLatched ? 'LOCKED' : values.temperature >= 65 || values.vibration >= 2.2 ? 'CRITICAL' : values.temperature >= 45 || values.vibration >= 0.8 ? 'ATTENTION' : 'NORMAL'}</strong></div></div>
        </div>
        <div className="machine-footer"><span><CircleGauge size={14}/> Telemetry-linked mechanical model</span><span><RotateCw size={14}/> {running && !shutdownLatched ? 'Rotating / transmitting' : shutdownLatched ? 'Output latched off' : 'Ready to start'}</span></div>
      </section>
      <section className="grid settings-grid">
        <div className="panel settings"><div className="panel-title"><Settings2 size={17}/> Device Connection</div>
          <label>MAINTAIN AI API URL<input value={apiUrl} onChange={e => setApiUrl(e.target.value)} placeholder="https://your-api.vercel.app" /></label>
          <label>Machine Device Key<input type="password" value={deviceKey} onChange={e => setDeviceKey(e.target.value)} placeholder="Paste machine IoT device key" /></label>
          <div className="two"><label>Protocol<input value="WebSocket /api/devices/ws" readOnly /></label><label>Send interval<select value={interval} onChange={e => setIntervalMs(Number(e.target.value))}><option value="1000">1 second</option><option value="5000">5 seconds</option><option value="10000">10 seconds</option><option value="30000">30 seconds</option></select></label></div>
          <div className="two"><button className="btn ghost wide" onClick={saveSettings}><CheckCircle2 size={16}/> Save locally</button><button className="btn ghost wide" onClick={connectDevice}><Wifi size={16}/> Connect Device</button></div>
          <small>The device key stays in this browser. The simulator does not contain a machine ID; the key identifies the machine.</small>
        </div>
        <div className="panel presets"><div className="panel-title"><Gauge size={17}/> Fault Profiles</div><p>Use these to drive the same telemetry path as the ESP32. Configure safety thresholds in MAINTAIN AI, then push Warning/Critical readings to exercise them.</p><div className="preset-buttons"><button onClick={() => preset('normal')} className="normal">Normal</button><button onClick={() => preset('warning')} className="warning">Warning</button><button onClick={() => preset('critical')} className="critical">Critical</button></div><div className="status-box"><span className="pulse"/>{running ? 'Streaming telemetry to MAINTAIN AI' : 'Ready to simulate'}<b>{lastSent ? `Last sent ${lastSent.toLocaleTimeString()}` : 'No readings sent yet'}</b></div></div>
      </section>

      <section className={`panel safety-panel ${shutdownLatched ? 'shutdown' : ''}`}>
        <div className="panel-head"><div><div className="panel-title">{shutdownLatched ? <ShieldAlert size={17}/> : <ShieldCheck size={17}/>} Device Safety Output</div><p>{shutdownLatched ? 'MAINTAIN AI sent a shutdown command. The virtual relay is latched OFF and telemetry transmission is stopped.' : 'The simulator listens on the authenticated device WebSocket for shutdown and shutdown_test commands.'}</p></div><strong>{shutdownLatched ? 'RELAY / MACHINE OUTPUT: OFF' : 'OUTPUT: RUNNING'}</strong></div>
        <div className="safety-state"><span className={`state-dot ${shutdownLatched ? 'off' : 'on'}`}/><b>{shutdownLatched ? 'SHUTDOWN_LATCHED' : 'RUNNING'}</b><span>Device ACK is sent automatically when a shutdown command is received.</span></div>
        {shutdownLatched && <button className="btn ghost" onClick={resetDevice}><RotateCcw size={16}/> Reset Simulated Device</button>}
      </section>

      <section className="panel readings"><div className="panel-head"><div><div className="panel-title">Sensor Controls</div><p>Adjust values manually or use a fault profile. Running mode adds small random variation every cycle.</p></div><span className="live-pill"><span/> DEVICE DATA</span></div><div className="sensor-grid">
        {sensorCards.map(({key,label,unit,icon:Icon,min,max,step}) => <div className="sensor" key={key}><div className="sensor-head"><span className="sensor-icon"><Icon size={18}/></span><span>{label}</span><strong>{values[key].toFixed(key === 'vibration' ? 2 : 1)} <em>{unit}</em></strong></div><input type="range" min={min} max={max} step={step} value={values[key]} disabled={shutdownLatched} onChange={e => setValues(v => ({...v,[key]:Number(e.target.value)}))}/><div className="range-labels"><span>{min}</span><span>{max} {unit}</span></div></div>)}
      </div><button className="send-one" onClick={() => sendCycle(values)} disabled={status === 'sending' || shutdownLatched}><Send size={16}/> Send Current Readings Now</button></section>

      <section className="panel log-panel"><div className="panel-head"><div className="panel-title">Device Transmission & Safety Log</div><button className="clear" onClick={clearLogs}>Clear</button></div><div className="logs">{logs.length === 0 ? <div className="empty"><WifiOff size={20}/> No device events yet. Connect the simulator to begin.</div> : logs.map(log => <div className="log" key={log.id}><span className="time">{log.time}</span><span className={`tag ${log.ok ? 'ok' : 'bad'}`}>{log.type}</span><span>{log.message}</span>{log.ok ? <CheckCircle2 className="log-icon" size={15}/> : <XCircle className="log-icon" size={15}/>}</div>)}</div></section>
    </main>
    <footer><span>MAINTAIN AI Sensor Simulator</span><span>Virtual ESP32 · Device-key authenticated</span></footer>
  </div>
}

createRoot(document.getElementById('root')).render(<App />)
