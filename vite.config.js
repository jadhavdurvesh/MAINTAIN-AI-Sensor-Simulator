import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The simulator uses WebSocket for the device channel. During safety re-arm we
// still need that same channel: forcing the re-arm readings through HTTPS made
// the browser hit CORS/network failures and left the latch stuck.
const rearmTransportFix = {
  name: 'rearm-transport-fix',
  transform(code, id) {
    if (!id.includes('/src/main.jsx')) return null

    let next = code

    next = next.replace(
      "if (socket.current?.readyState === WebSocket.OPEN && !rearmRef.current) {",
      "if (socket.current?.readyState === WebSocket.OPEN) {"
    )

    next = next.replace(
      "const rearming = rearmRef.current\n    setStatus(rearming ? 'rearming' : 'sending')",
      "const rearming = rearmRef.current\n    if (rearming && socket.current?.readyState !== WebSocket.OPEN) {\n      try { await connectDevice() } catch { /* HTTPS fallback below */ }\n    }\n    setStatus(rearming ? 'rearming' : 'sending')"
    )

    return next === code ? null : { code: next, map: null }
  }
}

export default defineConfig({
  plugins: [react(), rearmTransportFix],
  base: './'
})
