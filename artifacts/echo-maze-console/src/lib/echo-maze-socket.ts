export type SocketStatus = 'connected' | 'connecting' | 'disconnected' | 'error';
export type TelemetryMessage = Record<string, unknown> & { run_id?: string; mode?: string; timestamp?: number };
export type RoverStatusMessage = Record<string, unknown> & {
  event: 'rover_status';
  state?: string;
  reason?: string;
  cause?: string;
  detail?: string;
  recommended_action?: string;
  runtime_mode?: string;
  run_id?: string;
  timestamp?: number;
};
export type DashboardCommand =
  | 'learn' | 'verify' | 'stop' | 'reset' | 'run_route' | 'explore'
  | 'drive_straight' | 'scan_only' | 'motor_diagnostic' | 'failsafe_status';
export type CommandResult = {
  ok: boolean;
  cmd?: DashboardCommand;
  delivered_to?: number;
  error?: string;
  message?: string;
};
export const DEFAULT_TELEMETRY_URL = (import.meta.env.VITE_TELEMETRY_URL as string | undefined) ?? 'ws://127.0.0.1:8765';

type StatusListener = (status: SocketStatus) => void;
type TelemetryListener = (message: TelemetryMessage) => void;
type RoverStatusListener = (status: RoverStatusMessage) => void;
type CommandResultListener = (result: CommandResult) => void;

export class EchoMazeSocket {
  status: SocketStatus = 'disconnected';
  private socket?: WebSocket;
  private statusListeners = new Set<StatusListener>();
  private telemetryListeners = new Set<TelemetryListener>();
  private roverStatusListeners = new Set<RoverStatusListener>();
  private commandResultListeners = new Set<CommandResultListener>();
  private socketUrl?: string;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private reconnectAttempt = 0;
  private manuallyDisconnected = true;
  private socketGeneration = 0;

  onStatus(listener: StatusListener) {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => this.statusListeners.delete(listener);
  }

  onTelemetry(listener: TelemetryListener) {
    this.telemetryListeners.add(listener);
    return () => this.telemetryListeners.delete(listener);
  }

  onRoverStatus(listener: RoverStatusListener) {
    this.roverStatusListeners.add(listener);
    return () => this.roverStatusListeners.delete(listener);
  }

  onCommandResult(listener: CommandResultListener) {
    this.commandResultListeners.add(listener);
    return () => this.commandResultListeners.delete(listener);
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
    this.manuallyDisconnected = false;
    this.socketUrl = url;
    this.reconnectAttempt = 0;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.closeActiveSocket();
    this.open(url);
  }

  private closeActiveSocket() {
    const active = this.socket;
    this.socket = undefined;
    this.socketGeneration += 1;
    if (active) {
      // Intentional close/replacement: don't schedule a reconnect for it.
      active.onopen = null;
      active.onclose = null;
      active.onerror = null;
      active.onmessage = null;
      active.close();
    }
  }

  private open(url: string) {
    const generation = ++this.socketGeneration;
    this.setStatus('connecting');
    try {
      const socket = new WebSocket(url);
      this.socket = socket;
      socket.onopen = () => {
        if (generation !== this.socketGeneration || this.socket !== socket) return;
        this.reconnectAttempt = 0;
        this.setStatus('connected');
      };
      socket.onclose = () => {
        if (generation !== this.socketGeneration || this.socket !== socket) return;
        this.socket = undefined;
        this.setStatus('disconnected');
        this.scheduleReconnect();
      };
      socket.onerror = () => {
        if (generation === this.socketGeneration && this.socket === socket) this.setStatus('error');
      };
      socket.onmessage = (event) => {
        if (generation !== this.socketGeneration || this.socket !== socket) return;
        try {
          const message = JSON.parse(String(event.data));
          if (message && typeof message === 'object' && !Array.isArray(message)
            && typeof message.ok === 'boolean'
            && (message.cmd || message.error || Object.prototype.hasOwnProperty.call(message, 'delivered_to'))) {
            this.commandResultListeners.forEach((listener) => listener(message as CommandResult));
            return;
          }
          if (message && typeof message === 'object' && !Array.isArray(message)
            && message.event === 'rover_status') {
            this.roverStatusListeners.forEach((listener) => listener(message as RoverStatusMessage));
            return;
          }
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
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.manuallyDisconnected || !this.socketUrl || this.reconnectTimer) return;
    const delay = Math.min(5000, 500 * (2 ** Math.min(this.reconnectAttempt, 3)));
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      if (!this.manuallyDisconnected && this.socketUrl) this.open(this.socketUrl);
    }, delay);
  }

  send(command: DashboardCommand, payload: Record<string, unknown> = {}) {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify({ cmd: command, source: 'echo-maze-dashboard', ...payload }));
    return true;
  }

  disconnect() {
    this.manuallyDisconnected = true;
    this.socketUrl = undefined;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.closeActiveSocket();
    this.setStatus('disconnected');
  }
}
