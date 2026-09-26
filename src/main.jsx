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
  const [shutdownInfo, setShutdownInfo] = useState(null)
  const [lastSent, setLastSent] = useState(null)
  const [logs, setLogs] = useState([])
  const [rearmMode, setRearmMode] = useState(false)

  const timer = useRef(null)
  const commandTimer = useRef(null)
  const socket = useRef(null)
  const reconnectTimer = useRef(null)
  const runningRef = useRef(false)
  const shutdownRef = useRef(false)
  const rearmRef = useRef(false)
  const intentionalCloseRef = useRef(false)
  const commandBusyRef = useRef(false)
  const pendingShutdownEventIdRef = useRef(null)

  const normalizedApi = useMemo(() => apiUrl.trim().replace(/\/$/, ''), [apiUrl])
  const wsUrl = useMemo(() => {
    if (!normalizedApi) return ''
    const url = new URL(normalizedApi)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    url.pathname = '/api/devices/ws'
    url.search = ''
    return url.toString()
  }, [normalizedApi])

  useEffect(() => {
    runningRef.current = running
    shutdownRef.current = shutdownLatched
    rearmRef.current = rearmMode
  }, [running, shutdownLatched, rearmMode])

  useEffect(() => () => {
    clearTimeout(timer.current)
    clearInterval(commandTimer.current)
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

  const latchShutdown = (message, source = 'REMOTE') => {
    const eventId = message?.event_id ? Number(message.event_id) : null
    if (eventId) pendingShutdownEventIdRef.current = eventId
    if (shutdownRef.current && !rearmRef.current) return
    const type = message?.command_type || message?.type || 'shutdown'
    shutdownRef.current = true
    setShutdownLatched(true)
    setRearmMode(false)
    rearmRef.current = false
    setShutdownInfo({ type, reason: message?.reason || 'Safety limit crossed', value: message?.value, threshold: message?.threshold, readingType: message?.reading_type })
    setRunning(false)
    runningRef.current = false
    clearTimeout(timer.current)
    clearInterval(commandTimer.current)
    setStatus('shutdown')
    addLog('SAFETY', `${type === 'shutdown_test' ? 'TEST ' : ''}SHUTDOWN COMMAND RECEIVED via ${source} — output latched OFF`)
  }

  const acknowledgeCommand = async eventId => {
    if (!eventId || !normalizedApi || !deviceKey.trim()) return false
    try {
      const response = await fetch(`${normalizedApi}/api/devices/commands/ack`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Device-Key': deviceKey.trim() },
        body: JSON.stringify({ event_id: Number(eventId) })
      })
      if (response.ok) {
        pendingShutdownEventIdRef.current = null
        addLog('SAFETY', 'Shutdown acknowledgement stored by MAINTAIN AI')
        return true
      }
      addLog('DEVICE ERROR', `Shutdown acknowledgement failed (${response.status})`, false)
      return false
    } catch (error) {
      addLog('DEVICE ERROR', `Shutdown acknowledgement failed: ${error.message}`, false)
      return false
    }
  }

  const findPendingCommand = async () => {
    if (!normalizedApi || !deviceKey.trim()) return null
    try {
      const response = await fetch(`${normalizedApi}/api/devices/commands?ts=${Date.now()}`, {
        headers: { 'X-Device-Key': deviceKey.trim() }, cache: 'no-store'
      })
      if (!response.ok) return null
      const command = await response.json()
      if (command?.pending && command.event_id) return Number(command.event_id)
    } catch (error) {
      addLog('DEVICE ERROR', `Could not check pending shutdown: ${error.message}`, false)
    }
    return null
  }

  const pollCommands = async () => {
    if (!normalizedApi || !deviceKey.trim() || commandBusyRef.current || shutdownRef.current || rearmRef.current) return
    commandBusyRef.current = true
    try {
      const response = await fetch(`${normalizedApi}/api/devices/commands?ts=${Date.now()}`, { headers: { 'X-Device-Key': deviceKey.trim() }, cache: 'no-store' })
      if (!response.ok) return
      const command = await response.json()
      if (command?.pending) {
        latchShutdown(command, 'HTTPS command polling')
        await acknowledgeCommand(command.event_id)
      }
    } catch {
      // Retry on the next poll.
    } finally {
      commandBusyRef.current = false
    }
  }

  const connectDevice = () => new Promise((resolve, reject) => {
    if (!wsUrl || !deviceKey.trim()) {
      setDeviceStatus('rest')
      reject(new Error('API URL and device key are required'))
      return
    }
    clearTimeout(reconnectTimer.current)
    intentionalCloseRef.current = true
    socket.current?.close()
    intentionalCloseRef.current = false
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
          if (message.type === 'reading_accepted') { setLastSent(new Date()); return }
          if (message.type === 'shutdown' || message.type === 'shutdown_test') {
            latchShutdown(message, 'WebSocket')
            acknowledgeCommand(message.event_id)
            return
          }
          if (message.type === 'error') finish(false, new Error(message.message || 'device authentication failed'))
        } catch { addLog('ERROR', 'Received invalid device message', false) }
      }
      ws.onerror = () => {
        setDeviceStatus('rest')
        addLog('DEVICE', 'WebSocket unavailable — switching to HTTPS telemetry and command polling.', false)
        finish(false, new Error('WebSocket connection failed'))
      }
      ws.onclose = () => {
        if (socket.current === ws) socket.current = null
        if (!intentionalCloseRef.current && !shutdownRef.current && !rearmRef.current) {
          setDeviceStatus('rest')
          addLog('DEVICE', 'WebSocket disconnected — HTTPS fallback remains active.', false)
          clearTimeout(reconnectTimer.current)
          reconnectTimer.current = setTimeout(() => {
            if (runningRef.current && !shutdownRef.current && !rearmRef.current) connectDevice().catch(() => {})
          }, 5000)
        }
      }
    } catch (error) {
      setDeviceStatus('rest')
      finish(false, error)
    }
  })

  const sendReading = async (readingType, value, unit) => {
    if (shutdownRef.current && !rearmRef.current) return false
    if (!normalizedApi || !deviceKey.trim()) { setStatus('error'); return false }
    const payload = { reading_type: readingType, value: Number(value.toFixed(2)), unit }

    if (socket.current?.readyState === WebSocket.OPEN && !rearmRef.current) {
      try {
        socket.current.send(JSON.stringify({ type: 'reading', ...payload }))
        addLog(readingType.toUpperCase(), `${value.toFixed(2)} ${unit} → WebSocket device channel`, true)
        setLastSent(new Date()); setStatus('connected'); return true
      } catch { setDeviceStatus('rest') }
    }

    try {
      const response = await fetch(`${normalizedApi}/api/devices/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Device-Key': deviceKey.trim() },
        body: JSON.stringify(payload)
      })
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
      const result = await response.json()
      if (result?.safety?.shutdown_requested) {
        latchShutdown({ ...result.safety, command_type: 'shutdown' }, 'HTTPS ingest')
        await acknowledgeCommand(result.safety.event_id)
        return false
      }
      setDeviceStatus('rest'); setLastSent(new Date())
      addLog(readingType.toUpperCase(), `${value.toFixed(2)} ${unit} → HTTPS device ingestion`, true)
      return true
    } catch (error) {
      addLog('DEVICE ERROR', `${readingType}: ${error.message}`, false)
      setStatus('device_offline'); return false
    }
  }

  const finishRearm = async () => {
    const eventId = pendingShutdownEventIdRef.current || await findPendingCommand()
    if (eventId) {
      const acknowledged = await acknowledgeCommand(eventId)
      if (!acknowledged) {
        setStatus('rearm_pending')
        addLog('SAFETY', 'Safe readings were received, but the previous shutdown is still pending acknowledgement. Fix the connection and press Send Current Readings Now again.', false)
        return false
      }
    }
    pendingShutdownEventIdRef.current = null
    rearmRef.current = false
    shutdownRef.current = false
    setRearmMode(false)
    setShutdownLatched(false)
    setShutdownInfo(null)
    setStatus('idle')
    setDeviceStatus('rest')
    addLog('SAFETY', 'Safe readings verified — shutdown latch cleared. Device is ready to start.')
    return true
  }

  const sendCycle = async (next = values) => {
    if (shutdownRef.current && !rearmRef.current) return
    const rearming = rearmRef.current
    setStatus(rearming ? 'rearming' : 'sending')
    const readings = [['temperature', next.temperature, '°C'], ['humidity', next.humidity, '%'], ['vibration', next.vibration, 'g'], ['current', next.current, 'A']]
    let allSent = true
    for (const [type, value, unit] of readings) {
      const sent = await sendReading(type, value, unit)
      if (!sent) allSent = false
      if (shutdownRef.current && !rearmRef.current) break
    }
    if (rearming && allSent && !shutdownRef.current) await finishRearm()
    else if (allSent && !shutdownLatched) setStatus('connected')
    else if (!allSent && !shutdownRef.current) setStatus('device_offline')
  }

  const tick = async () => {
    if (shutdownRef.current || rearmRef.current) return
    setValues(prev => {
      const next = {
        temperature: clamp(prev.temperature + noise(2.2), -20, 120),
        humidity: clamp(prev.humidity + noise(4), 0, 100),
        vibration: clamp(prev.vibration + noise(Math.max(0.03, prev.vibration * 0.12)), 0, 10),
        current: clamp(prev.current + noise(Math.max(0.12, prev.current * 0.08)), 0, 40)
      }
      sendCycle(next); return next
    })
  }

  useEffect(() => {
    if (!running || shutdownLatched || rearmMode) return
    timer.current = setTimeout(tick, interval)
    return () => clearTimeout(timer.current)
  }, [running, values, interval, shutdownLatched, rearmMode])

  useEffect(() => {
    if (!running || shutdownLatched || rearmMode) return
    pollCommands()
    commandTimer.current = window.setInterval(pollCommands, 1000)
    return () => clearInterval(commandTimer.current)
  }, [running, shutdownLatched, rearmMode, normalizedApi, deviceKey])

  const start = async () => {
    if (rearmRef.current || shutdownRef.current) {
      addLog('SAFETY', 'Complete the reset → safe readings → acknowledgement sequence before starting the device.', false)
      return
    }
    runningRef.current = true
    saveSettings()
    try { await connectDevice() } catch { setDeviceStatus('rest'); addLog('DEVICE', 'WebSocket is not available on this deployment; using HTTPS device transport instead.') }
    setRunning(true)
    addLog('SYSTEM', `Simulation started · device-key authenticated · every ${interval / 1000}s`)
    await sendCycle(values)
  }

  const stop = () => {
    runningRef.current = false
    intentionalCloseRef.current = true
    setRunning(false)
    clearTimeout(timer.current)
    clearInterval(commandTimer.current)
    clearTimeout(reconnectTimer.current)
    setStatus('idle')
    addLog('SYSTEM', 'Simulation stopped')
    socket.current?.close()
    socket.current = null
    intentionalCloseRef.current = false
  }

  const resetDevice = () => {
    runningRef.current = false
    setRunning(false)
    clearTimeout(timer.current)
    clearInterval(commandTimer.current)
    clearTimeout(reconnectTimer.current)
    intentionalCloseRef.current = true
    socket.current?.close()
    socket.current = null
    intentionalCloseRef.current = false

    rearmRef.current = true
    shutdownRef.current = true
    setRearmMode(true)
    setShutdownLatched(true)
    setValues(initialValues())
    setStatus('rearm')
    setDeviceStatus('rest')
    addLog('SAFETY', 'Relay reset locally. Adjust readings into the safe range, then press Send Current Readings Now to acknowledge and clear the shutdown latch.')
  }

  const preset = name => {
    const next = { ...PRESETS[name] }
    setValues(next)
    addLog('PRESET', `${name.toUpperCase()} sensor profile loaded`)
    if (running && !shutdownLatched && !rearmMode) sendCycle(next)
  }
  const clearLogs = () => setLogs([])

  const sensorCards = [
    { key: 'temperature', label: 'Temperature', unit: '°C', icon: Thermometer, min: -20, max: 120, step: 0.1 },
    { key: 'humidity', label: 'Humidity', unit: '%', icon: Droplets, min: 0, max: 100, step: 0.1 },
    { key: 'vibration', label: 'Vibration', unit: 'g', icon: Waves, min: 0, max: 10, step: 0.01 },
    { key: 'current', label: 'Current', unit: 'A', icon: Zap, min: 0, max: 40, step: 0.1 }
  ]

  const connectionLabel = rearmMode ? 'RE-ARM REQUIRED' : shutdownLatched ? 'SHUTDOWN LATCHED' : deviceStatus === 'authenticated' ? 'Device Authenticated' : deviceStatus === 'rest' ? 'HTTPS Device Connected' : deviceStatus === 'connecting' ? 'Connecting Device…' : status === 'sending' ? 'Sending…' : status === 'error' || deviceStatus === 'error' ? 'Connection Error' : 'Simulator Idle'

  return <div className="app">
    <header className="topbar"><div className="brand"><div className="brandmark"><Activity size={20}/></div><div><b>MAINTAIN AI</b><span>Sensor Simulator</span></div></div><div className={`connection ${rearmMode || shutdownLatched ? 'error' : deviceStatus === 'authenticated' || deviceStatus === 'rest' ? 'connected' : status}`}><span className="dot"/>{connectionLabel}</div></header>
    <main>
      <section className="hero"><div><div className="eyebrow"><Cpu size={15}/> VIRTUAL ESP32</div><h1>Live Sensor + Safety Laboratory</h1><p>Emulates the real device path with WebSocket when available and HTTPS ingestion + durable command polling when it is not.</p></div><div className="hero-actions"><button className="btn ghost" onClick={resetDevice}><RotateCcw size={16}/> Reset Device</button>{running ? <button className="btn danger" onClick={stop}><Square size={16}/> Stop Simulation</button> : <button className="btn primary" onClick={start}><Play size={16}/> Start Device</button>}</div></section>
      <section className={`machine-stage panel ${shutdownLatched ? 'machine-off' : running ? 'machine-running' : 'machine-idle'}`}><div className="machine-stage-head"><div><div className="panel-title"><Cog size={17}/> Machine Simulation</div><p>Live visual state of the virtual machine driven by the authenticated device channel.</p></div><div className="machine-state"><span className="machine-state-dot"/><b>{rearmMode ? 'RE-ARM' : shutdownLatched ? 'SAFETY OFF' : running ? 'MACHINE RUNNING' : 'MACHINE STOPPED'}</b><span>{deviceStatus === 'authenticated' || deviceStatus === 'rest' ? 'DEVICE LINKED' : 'DEVICE OFFLINE'}</span></div></div><div className="machine-visual"><div className="machine-cabinet"><div className="cabinet-label"><span>MAINTAIN AI</span><small>VIRTUAL DRIVE UNIT</small></div><div className="status-lamps"><i className="lamp power"/><i className="lamp link"/><i className={`lamp fault ${shutdownLatched ? 'active' : ''}`}/></div><div className="machine-face"><div className="rotor-wrap"><div className="rotor"><span/><span/><span/><span/></div><div className="rotor-hub"><Power size={18}/></div></div><div className="machine-bars"><i/><i/><i/><i/><i/></div></div></div><div className="drive-line"><div className="belt"><span/><span/><span/></div><div className="drive-wheel"><div className="wheel-core"/><div className="wheel-spokes"><i/><i/><i/><i/></div></div></div><div className="machine-metrics"><div><span>STATE</span><strong>{rearmMode ? 'REARM' : shutdownLatched ? 'OFF' : running ? 'RUN' : 'IDLE'}</strong></div><div><span>LOAD</span><strong>{Math.round(clamp(values.current * 6.2, 0, 100))}%</strong></div><div><span>SPEED</span><strong>{running && !shutdownLatched ? `${Math.round(900 + values.current * 42)} RPM` : '0 RPM'}</strong></div><div><span>HEALTH</span><strong>{shutdownLatched ? 'LOCKED' : values.temperature >= 65 || values.vibration >= 2.2 ? 'CRITICAL' : values.temperature >= 45 || values.vibration >= 0.8 ? 'ATTENTION' : 'NORMAL'}</strong></div></div></div><div className="machine-footer"><span><CircleGauge size={14}/> Telemetry-linked mechanical model</span><span><RotateCw size={14}/> {running && !shutdownLatched ? 'Rotating / transmitting' : shutdownLatched ? 'Output latched off' : 'Ready to start'}</span></div>{shutdownLatched && shutdownInfo && <div style={{marginTop:12,padding:12,borderRadius:10,border:'1px solid rgba(255,90,90,.45)',background:'rgba(255,70,70,.08)',color:'#ffb2ad',fontSize:12}}><strong>SAFETY SHUTDOWN · DEVICE OUTPUT OFF</strong><div style={{marginTop:5}}>{shutdownInfo.reason}</div>{shutdownInfo.value != null && shutdownInfo.threshold != null && <div style={{marginTop:4}}>Measured: <b>{Number(shutdownInfo.value).toFixed(2)} {shutdownInfo.readingType === 'temperature' ? '°C' : shutdownInfo.readingType === 'vibration' ? 'g' : shutdownInfo.readingType === 'current' ? 'A' : '%'}</b> · Limit: <b>{Number(shutdownInfo.threshold).toFixed(2)} {shutdownInfo.readingType === 'temperature' ? '°C' : shutdownInfo.readingType === 'vibration' ? 'g' : shutdownInfo.readingType === 'current' ? 'A' : '%'}</b></div>}<div style={{marginTop:4}}>{rearmMode ? '⚠ Safe readings are required before the latch can be cleared.' : '✓ Shutdown acknowledgement attempted through MAINTAIN AI.'}</div></div>}</section>
      <section className="grid settings-grid"><div className="panel settings"><div className="panel-title"><Settings2 size={17}/> Device Connection</div><label>MAINTAIN AI API URL<input value={apiUrl} onChange={e => setApiUrl(e.target.value)} placeholder="https://your-api.example.com" /></label><label>Machine Device Key<input type="password" value={deviceKey} onChange={e => setDeviceKey(e.target.value)} placeholder="Paste machine IoT device key" /></label><div className="two"><label>Primary protocol<input value="HTTPS /api/devices/ingest" readOnly /></label><label>Send interval<select value={interval} onChange={e => setIntervalMs(Number(e.target.value))}><option value="1000">1 second</option><option value="5000">5 seconds</option><option value="10000">10 seconds</option><option value="30000">30 seconds</option></select></label></div><div className="two"><button className="btn ghost wide" onClick={saveSettings}><CheckCircle2 size={16}/> Save locally</button><button className="btn ghost wide" onClick={() => connectDevice().catch(() => setDeviceStatus('rest'))}><Wifi size={16}/> Try WebSocket</button></div><small>HTTPS is the reliable device transport. WebSocket is an optimization when the backend supports long-lived connections. The device key identifies the machine.</small></div><div className="panel presets"><div className="panel-title"><Gauge size={17}/> Fault Profiles</div><p>Use these to drive the same telemetry path as the ESP32. Configure safety thresholds in MAINTAIN AI, then push Warning/Critical readings to exercise them.</p><div className="preset-buttons"><button onClick={() => preset('normal')} className="normal">Normal</button><button onClick={() => preset('warning')} className="warning">Warning</button><button onClick={() => preset('critical')} className="critical">Critical</button></div><div className="status-box"><span className="pulse"/>{rearmMode ? 'Adjust readings and send them to clear the shutdown latch' : running ? 'Streaming telemetry to MAINTAIN AI' : 'Ready to simulate'}<b>{lastSent ? `Last sent ${lastSent.toLocaleTimeString()}` : 'No readings sent yet'}</b></div></div></section>
      <section className={`panel safety-panel ${shutdownLatched ? 'shutdown' : ''}`}><div className="panel-head"><div><div className="panel-title">{shutdownLatched ? <ShieldAlert size={17}/> : <ShieldCheck size={17}/>} Device Safety Output</div><p>{rearmMode ? 'Device is safely disconnected after shutdown. Change the sensor values into a safe range and send them to acknowledge the previous event.' : shutdownLatched ? 'MAINTAIN AI sent a shutdown command. The virtual relay is latched OFF and telemetry transmission is stopped.' : 'The simulator checks the authenticated WebSocket and the durable HTTPS command queue for shutdown commands.'}</p></div><strong>{shutdownLatched ? 'RELAY / MACHINE OUTPUT: OFF' : 'OUTPUT: RUNNING'}</strong></div><div className="safety-state"><span className={`state-dot ${shutdownLatched ? 'off' : 'on'}`}/><b>{rearmMode ? 'REARM_REQUIRED' : shutdownLatched ? 'SHUTDOWN_LATCHED' : 'RUNNING'}</b><span>{rearmMode ? 'Safe readings + ACK required before Start Device.' : 'Device ACK is stored through the durable command endpoint.'}</span></div>{shutdownLatched && <button className="btn ghost" onClick={resetDevice}><RotateCcw size={16}/> Reset Simulated Device</button>}</section>
      <section className={`panel readings ${rearmMode ? 'rearm-active' : ''}`}><div className="panel-head"><div><div className="panel-title">Sensor Controls</div><p>{rearmMode ? 'Re-arm mode: sliders are unlocked. Put every reading inside its safe range, then send the readings.' : 'Adjust values manually or use a fault profile. Running mode adds small random variation every cycle.'}</p></div><span className="live-pill"><span/> DEVICE DATA</span></div><div className="sensor-grid">{sensorCards.map(({key,label,unit,icon:Icon,min,max,step}) => <div className="sensor" key={key}><div className="sensor-head"><span className="sensor-icon"><Icon size={18}/></span><span>{label}</span><strong>{values[key].toFixed(key === 'vibration' ? 2 : 1)} <em>{unit}</em></strong></div><input type="range" min={min} max={max} step={step} value={values[key]} disabled={shutdownLatched && !rearmMode} onChange={e => setValues(v => ({...v,[key]:Number(e.target.value)}))}/><div className="range-labels"><span>{min}</span><span>{max} {unit}</span></div></div>)}</div><button className="send-one" onClick={() => sendCycle(values)} disabled={status === 'sending' || status === 'rearming' || (shutdownLatched && !rearmMode)}><Send size={16}/> {rearmMode ? 'Verify Safe Readings & Clear Shutdown' : 'Send Current Readings Now'}</button></section>
      <section className="panel log-panel"><div className="panel-head"><div className="panel-title">Device Transmission & Safety Log</div><button className="clear" onClick={clearLogs}>Clear</button></div><div className="logs">{logs.length === 0 ? <div className="empty"><WifiOff size={20}/> No device events yet. Connect the simulator to begin.</div> : logs.map(log => <div className="log" key={log.id}><span className="time">{log.time}</span><span className={`tag ${log.ok ? 'ok' : 'bad'}`}>{log.type}</span><span>{log.message}</span>{log.ok ? <CheckCircle2 className="log-icon" size={15}/> : <XCircle className="log-icon" size={15}/>}</div>)}</div></section>
    </main>
    <footer><span>MAINTAIN AI Sensor Simulator</span><span>Virtual ESP32 · Device-key authenticated · HTTPS fallback</span></footer>
  </div>
}

createRoot(document.getElementById('root')).render(<App />)
