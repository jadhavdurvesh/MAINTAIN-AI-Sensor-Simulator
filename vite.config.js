import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const safetyRearmFix = {
  name: 'safety-rearm-fix',
  transform(code, id) {
    if (!id.includes('/src/main.jsx')) return null
    let next = code
    next = next.replace(
      "if (socket.current?.readyState === WebSocket.OPEN && !rearmRef.current) {",
      "if (socket.current?.readyState === WebSocket.OPEN) {"
    )
    next = next.replace(
      "const rearming = rearmRef.current\n    setStatus(rearming ? 'rearming' : 'sending')",
      "const rearming = rearmRef.current\n    if (rearming && socket.current?.readyState !== WebSocket.OPEN) { try { await connectDevice() } catch {} }\n    setStatus(rearming ? 'rearming' : 'sending')"
    )
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
