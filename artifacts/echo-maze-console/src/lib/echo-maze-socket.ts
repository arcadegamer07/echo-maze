export type SocketStatus = 'connected' | 'connecting' | 'disconnected' | 'error';
export type TelemetryMessage = Record<string, unknown> & { run_id?: string; mode?: string; timestamp?: number };
export type DashboardCommand = 'learn' | 'verify' | 'stop' | 'reset' | 'run_route' | 'explore';
export const DEFAULT_TELEMETRY_URL = (import.meta.env.VITE_TELEMETRY_URL as string | undefined) ?? 'ws://127.0.0.1:8765';

type StatusListener = (status: SocketStatus) => void;
type TelemetryListener = (message: TelemetryMessage) => void;

export class EchoMazeSocket {
  status: SocketStatus = 'disconnected';
  private socket?: WebSocket;
  private statusListeners = new Set<StatusListener>();
  private telemetryListeners = new Set<TelemetryListener>();

  onStatus(listener: StatusListener) {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => this.statusListeners.delete(listener);
  }

  onTelemetry(listener: TelemetryListener) {
    this.telemetryListeners.add(listener);
    return () => this.telemetryListeners.delete(listener);
  }

  private setStatus(status: SocketStatus) {
    this.status = status;
    this.statusListeners.forEach((listener) => listener(status));
  }

  connect(url = DEFAULT_TELEMETRY_URL) {
    if (typeof WebSocket === 'undefined' || !url) {
      this.setStatus('error');
      return;
    }
    this.disconnect();
    this.setStatus('connecting');
    try {
      this.socket = new WebSocket(url);
      this.socket.onopen = () => this.setStatus('connected');
      this.socket.onclose = () => this.setStatus('disconnected');
      this.socket.onerror = () => this.setStatus('error');
      this.socket.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data));
          if (message && typeof message === 'object' && !Array.isArray(message)
            && typeof message.run_id === 'string' && message.motor && message.scan) {
            this.telemetryListeners.forEach((listener) => listener(message as TelemetryMessage));
          }
        } catch {
          // Non-JSON acknowledgements are intentionally ignored by the UI.
        }
      };
    } catch {
      this.setStatus('error');
    }
  }

  send(command: DashboardCommand, payload: Record<string, unknown> = {}) {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify({ cmd: command, source: 'echo-maze-dashboard', ...payload }));
    return true;
  }

  disconnect() {
    this.socket?.close();
    this.socket = undefined;
    if (this.status !== 'disconnected') this.setStatus('disconnected');
  }
}
