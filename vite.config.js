import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const safetyRearmPlugin = {
  name: 'maintain-ai-safety-rearm',
  enforce: 'pre',
  transform(code, id) {
    if (!id.endsWith('/src/main.jsx')) return null

    let next = code
      .replace(
        "  const commandBusyRef = useRef(false)\n",
        "  const commandBusyRef = useRef(false)\n  const pendingShutdownEventIdRef = useRef(null)\n"
      )
      .replace(
        "    setShutdownInfo({ type, reason: message.reason || 'Safety limit crossed', value: message.value, threshold: message.threshold, readingType: message.reading_type })\n",
        "    setShutdownInfo({ type, reason: message.reason || 'Safety limit crossed', value: message.value, threshold: message.threshold, readingType: message.reading_type })\n    pendingShutdownEventIdRef.current = message.event_id ? Number(message.event_id) : null\n"
      )
      .replace(
        "    if (allSent && !shutdownLatched) setStatus('connected')\n    if (!allSent && !shutdownRef.current) setStatus('device_offline')\n",
        "    if (allSent && !shutdownLatched) {\n      const pendingEventId = pendingShutdownEventIdRef.current\n      if (pendingEventId) {\n        acknowledgeCommand(pendingEventId).then(ok => { if (ok) pendingShutdownEventIdRef.current = null })\n      }\n      setStatus('connected')\n    }\n    if (!allSent && !shutdownRef.current) setStatus('device_offline')\n"
      )
      .replace(
        "  const resetDevice = async () => {\n    setShutdownLatched(false); shutdownRef.current = false; setShutdownInfo(null); setValues(initialValues()); setStatus('idle'); addLog('SAFETY', 'Simulated relay/output reset — device ready')\n    try { await connectDevice() } catch { setDeviceStatus('rest') }\n  }\n",
        "  const resetDevice = () => {\n    runningRef.current = false\n    setRunning(false)\n    clearTimeout(timer.current)\n    clearInterval(commandTimer.current)\n    intentionalCloseRef.current = true\n    socket.current?.close()\n    socket.current = null\n    intentionalCloseRef.current = false\n    setShutdownLatched(false)\n    shutdownRef.current = false\n    setShutdownInfo(null)\n    setValues(initialValues())\n    setStatus('idle')\n    setDeviceStatus('rest')\n    addLog('SAFETY', 'Simulated relay/output reset — adjust readings before reconnecting the device')\n  }\n"
      )

    if (next === code) return null
    return { code: next, map: null }
  }
}

export default defineConfig({
  plugins: [react(), safetyRearmPlugin],
  base: './'
})
