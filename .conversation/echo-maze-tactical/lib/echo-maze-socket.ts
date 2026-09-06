export type SocketStatus = 'connected' | 'disconnected'

export class EchoMazeSocket {
  status: SocketStatus = 'disconnected'
  private socket?: WebSocket

  connect(url?: string) {
    if (!url || typeof WebSocket === 'undefined') return
    try {
      this.socket = new WebSocket(url)
      this.socket.onopen = () => {
        this.status = 'connected'
      }
      this.socket.onclose = () => {
        this.status = 'disconnected'
      }
    } catch {
      this.status = 'disconnected'
    }
  }

  send(command: 'learn' | 'verify' | 'stop' | 'reset') {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ cmd: command, source: 'cse-4-dashboard' }))
    }
  }

  disconnect() {
    this.socket?.close()
  }
}
