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
        "  const commandBusyRef = useRef(false)\n  const pendingShutdownEventIdRef = useRef(null)\n  const rearmModeRef = useRef(false)\n"
      )
      .replace(
        "    setShutdownLatched(true)\n    setShutdownInfo({ type, reason: message.reason || 'Safety limit crossed', value: message.value, threshold: message.threshold, readingType: message.reading_type })\n",
        "    setShutdownLatched(true)\n    shutdownRef.current = true\n    pendingShutdownEventIdRef.current = message.event_id ? Number(message.event_id) : pendingShutdownEventIdRef.current\n    setShutdownInfo({ type, reason: message.reason || 'Safety limit crossed', value: message.value, threshold: message.threshold, readingType: message.reading_type })\n"
      )
      .replace(
        "      if (response.ok) addLog('SAFETY', 'Shutdown acknowledgement stored by MAINTAIN AI')\n      else addLog('DEVICE ERROR', `Shutdown acknowledgement failed (${response.status})`, false)\n",
        "      if (response.ok) { addLog('SAFETY', 'Shutdown acknowledgement stored by MAINTAIN AI'); return true }\n      addLog('DEVICE ERROR', `Shutdown acknowledgement failed (${response.status})`, false)\n      return false\n"
      )
      .replace(
        "    } catch (error) {\n      addLog('DEVICE ERROR', `Shutdown acknowledgement failed: ${error.message}`, false)\n    }\n  }\n",
        "    } catch (error) {\n      addLog('DEVICE ERROR', `Shutdown acknowledgement failed: ${error.message}`, false)\n      return false\n    }\n  }\n",
        1
      )
      .replace(
        "  const sendReading = async (readingType, value, unit) => {\n    if (shutdownLatched) return false\n",
        "  const sendReading = async (readingType, value, unit) => {\n    if (shutdownLatched && !rearmModeRef.current) return false\n"
      )
      .replace(
        "  const sendCycle = async (next = values) => {\n    if (shutdownLatched) return\n    setStatus('sending')\n",
        "  const sendCycle = async (next = values) => {\n    if (shutdownLatched && !rearmModeRef.current) return\n    const rearming = rearmModeRef.current\n    setStatus(rearming ? 'rearming' : 'sending')\n"
      )
      .replace(
        "    if (allSent && !shutdownLatched) setStatus('connected')\n    if (!allSent && !shutdownRef.current) setStatus('device_offline')\n",
        "    if (allSent && rearming) {\n      let pendingEventId = pendingShutdownEventIdRef.current\n      if (!pendingEventId) {\n        try {\n          const response = await fetch(`${normalizedApi}/api/devices/commands?ts=${Date.now()}`, { headers: { 'X-Device-Key': deviceKey.trim() }, cache: 'no-store' })\n          if (response.ok) {\n            const command = await response.json()\n            if (command?.pending) pendingEventId = Number(command.event_id)\n          }\n        } catch (error) {\n          addLog('DEVICE ERROR', `Could not verify pending shutdown before re-arm: ${error.message}`, false)\n        }\n      }\n      if (pendingEventId) {\n        const acknowledged = await acknowledgeCommand(pendingEventId)\n        if (!acknowledged) {\n          setStatus('rearm_pending')\n          addLog('SAFETY', 'Safe readings received, but the previous shutdown is still pending acknowledgement. Press Send Current Readings Now again.', false)\n          return\n        }\n      }\n      pendingShutdownEventIdRef.current = null\n      rearmModeRef.current = false\n      shutdownRef.current = false\n      setShutdownLatched(false)\n      setShutdownInfo(null)\n      setStatus('connected')\n      addLog('SAFETY', 'Safe readings verified — shutdown latch cleared. Start Device when ready.')\n      return\n    }\n    if (allSent && !shutdownLatched) setStatus('connected')\n    if (!allSent && !shutdownRef.current) setStatus('device_offline')\n"
      )
      .replace(
        "  const resetDevice = () => {\n    runningRef.current = false\n    setRunning(false)\n    clearTimeout(timer.current)\n    clearInterval(commandTimer.current)\n    intentionalCloseRef.current = true\n    socket.current?.close()\n    socket.current = null\n    intentionalCloseRef.current = false\n    setShutdownLatched(false)\n    shutdownRef.current = false\n    setShutdownInfo(null)\n    setValues(initialValues())\n    setStatus('idle')\n    setDeviceStatus('rest')\n    addLog('SAFETY', 'Simulated relay/output reset — adjust readings before reconnecting the device')\n  }\n",
        "  const resetDevice = () => {\n    runningRef.current = false\n    setRunning(false)\n    clearTimeout(timer.current)\n    clearInterval(commandTimer.current)\n    clearTimeout(reconnectTimer.current)\n    intentionalCloseRef.current = true\n    socket.current?.close()\n    socket.current = null\n    intentionalCloseRef.current = false\n    rearmModeRef.current = true\n    shutdownRef.current = true\n    setShutdownLatched(true)\n    setValues(initialValues())\n    setStatus('rearm')\n    setDeviceStatus('rest')\n    addLog('SAFETY', 'Relay reset locally — lower any unsafe reading, then press Send Current Readings Now to clear the shutdown latch.')\n  }\n"
      )

    if (next === code) return null
    return { code: next, map: null }
  }
}

export default defineConfig({
  plugins: [react(), safetyRearmPlugin],
  base: './'
})
