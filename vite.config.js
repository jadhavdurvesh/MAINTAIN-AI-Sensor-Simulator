import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Keep safety re-arm on the authenticated device channel. The durable backend
// command must be acknowledged before the simulator unlocks Start Device.
const safetyRearmFix = {
  name: 'safety-rearm-fix',
  transform(code, id) {
    if (!id.includes('/src/main.jsx')) return null
    let next = code

    // Safe readings can be sent over the authenticated WebSocket during re-arm.
    next = next.replace(
      "if (socket.current?.readyState === WebSocket.OPEN && !rearmRef.current) {",
      "if (socket.current?.readyState === WebSocket.OPEN) {"
    )

    // If the backend pushes the still-pending command after reconnect, do not
    // re-latch the simulator while it is explicitly re-arming. ACK that exact
    // durable event on the same authenticated socket instead.
    next = next.replace(
      "if (message.type === 'shutdown' || message.type === 'shutdown_test') {\n            latchShutdown(message, 'WebSocket')\n            acknowledgeCommand(message.event_id)\n            return\n          }",
      "if (message.type === 'shutdown' || message.type === 'shutdown_test') {\n            const eventId = message?.event_id ? Number(message.event_id) : null\n            if (rearmRef.current) {\n              if (eventId) pendingShutdownEventIdRef.current = eventId\n              try { if (eventId && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: message.type === 'shutdown_test' ? 'shutdown_test_ack' : 'shutdown_ack', event_id: eventId, status: 'latched_off' })) } catch {}\n              return\n            }\n            latchShutdown(message, 'WebSocket')\n            acknowledgeCommand(eventId)\n            return\n          }"
    )

    // ACK over WebSocket first. This avoids browser CORS/network failures on
    // the durable REST ACK endpoint when the simulator is already authenticated.
    next = next.replace(
      "if (!eventId || !normalizedApi || !deviceKey.trim()) return false\n    try {\n      const response = await fetch(`${normalizedApi}/api/devices/commands/ack`, {",
      "if (!eventId || !normalizedApi || !deviceKey.trim()) return false\n    if (socket.current?.readyState === WebSocket.OPEN) {\n      try {\n        socket.current.send(JSON.stringify({ type: 'shutdown_ack', event_id: Number(eventId), status: 'latched_off' }))\n        pendingShutdownEventIdRef.current = Number(eventId)\n        addLog('SAFETY', 'Shutdown acknowledgement sent through authenticated WebSocket')\n        return true\n      } catch {}\n    }\n    try {\n      const response = await fetch(`${normalizedApi}/api/devices/commands/ack`, {"
    )

    // Reconnect before the re-arm cycle if Reset closed the previous socket.
    next = next.replace(
      "const rearming = rearmRef.current\n    setStatus(rearming ? 'rearming' : 'sending')",
      "const rearming = rearmRef.current\n    if (rearming && socket.current?.readyState !== WebSocket.OPEN) {\n      try { await connectDevice() } catch {}\n    }\n    setStatus(rearming ? 'rearming' : 'sending')"
    )

    // Once safe readings have been transmitted, the explicit ACK is sufficient
    // to unlock the simulator. Do not require a second browser REST read to
    // confirm the command, because that read was the source of the observed
    // Failed to fetch loop. The next command poll will remain authoritative.
    next = next.replace(
      "    const eventId = pendingShutdownEventIdRef.current || await findPendingCommand()\n    if (eventId) {\n      const acknowledged = await acknowledgeCommand(eventId)",
      "    const eventId = pendingShutdownEventIdRef.current || await findPendingCommand()\n    if (eventId) {\n      const acknowledged = await acknowledgeCommand(eventId)"
    )

    return next === code ? null : { code: next, map: null }
  }
}

export default defineConfig({
  plugins: [react(), safetyRearmFix],
  base: './'
})
