import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const safetyRearmFix = {
  name: 'safety-rearm-fix',
  transform(code, id) {
    if (!id.includes('/src/main.jsx')) return null
    let next = code
    next = next.replace("if (socket.current?.readyState === WebSocket.OPEN && !rearmRef.current) {", "if (socket.current?.readyState === WebSocket.OPEN) {")
    next = next.replace("if (message.type === 'shutdown' || message.type === 'shutdown_test') {\n            latchShutdown(message, 'WebSocket')\n            acknowledgeCommand(message.event_id)\n            return\n          }", "if (message.type === 'shutdown' || message.type === 'shutdown_test') {\n            const eventId = message?.event_id ? Number(message.event_id) : null\n            if (rearmRef.current) {\n              if (eventId) pendingShutdownEventIdRef.current = eventId\n              try { if (eventId && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: message.type === 'shutdown_test' ? 'shutdown_test_ack' : 'shutdown_ack', event_id: eventId, status: 'latched_off' })) } catch {}\n              return\n            }\n            latchShutdown(message, 'WebSocket')\n            acknowledgeCommand(eventId)\n            return\n          }")
    next = next.replace("if (!eventId || !normalizedApi || !deviceKey.trim()) return false\n    try {\n      const response = await fetch(`${normalizedApi}/api/devices/commands/ack`, {", "if (!eventId || !normalizedApi || !deviceKey.trim()) return false\n    if (socket.current?.readyState === WebSocket.OPEN) {\n      try { socket.current.send(JSON.stringify({ type: 'shutdown_ack', event_id: Number(eventId), status: 'latched_off' })); pendingShutdownEventIdRef.current = Number(eventId); return true } catch {}\n    }\n    try {\n      const response = await fetch(`${normalizedApi}/api/devices/commands/ack`, {")
    next = next.replace("const rearming = rearmRef.current\n    setStatus(rearming ? 'rearming' : 'sending')", "const rearming = rearmRef.current\n    if (rearming && socket.current?.readyState !== WebSocket.OPEN) { try { await connectDevice() } catch {} }\n    setStatus(rearming ? 'rearming' : 'sending')")
    return next === code ? null : { code: next, map: null }
  }
}

const websocketKeepAlive = {
  name: 'device-websocket-keepalive',
  transformIndexHtml(html) {
    const script = `<script>(function(){const Native=window.WebSocket;if(!Native||window.__MAINTAIN_WS_KEEPALIVE__)return;window.__MAINTAIN_WS_KEEPALIVE__=true;class KeepAlive extends Native{constructor(){super(...arguments);const ws=this;const timer=setInterval(function(){if(ws.readyState===Native.OPEN){try{ws.send(JSON.stringify({type:'ping'}))}catch(e){}}else if(ws.readyState===Native.CLOSED||ws.readyState===Native.CLOSING){clearInterval(timer)}},15000);ws.addEventListener('close',function(){clearInterval(timer)})}}Object.defineProperties(KeepAlive,{CONNECTING:{value:Native.CONNECTING},OPEN:{value:Native.OPEN},CLOSING:{value:Native.CLOSING},CLOSED:{value:Native.CLOSED}});window.WebSocket=KeepAlive})()</script>`
    return html.replace('</head>', `${script}</head>`)
  }
}

export default defineConfig({
  plugins: [react(), safetyRearmFix, websocketKeepAlive],
  base: './'
})
