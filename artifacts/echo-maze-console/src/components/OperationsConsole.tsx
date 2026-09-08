import { useMemo, useState, type CSSProperties } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  CircleStop,
  Compass,
  Gauge,
  ScanLine,
  ShieldCheck,
  Wifi,
  Wrench,
  Zap,
} from 'lucide-react';
import type { LiveMapState } from '@/lib/live-mapping';
import type { RoverStatusMessage } from '@/lib/echo-maze-socket';

/**
 * Commands exposed by the product-facing operations surface.
 *
 * `drive_straight`, `scan_only`, and `motor_diagnostic` intentionally remain
 * separate from Learn/Verify so firmware can enforce a tighter safety policy
 * around each of them. They must be implemented by the receiver/ESP32 command
 * parser before their buttons are connected to live hardware.
 */
export type OperationsCommand =
  | 'learn'
  | 'verify'
  | 'explore'
  | 'drive_straight'
  | 'scan_only'
  | 'motor_diagnostic'
  | 'stop';

export type OperationsConnection =
  | boolean
  | 'connected'
  | 'connecting'
  | 'disconnected'
  | 'error';

export type OperationsConsoleProps = {
  connection: OperationsConnection;
  /** Uses the dashboard's RunState today, but permits future fail-safe states. */
  state: string;
  liveMap: LiveMapState;
  roverStatus?: RoverStatusMessage | null;
  /** `durationMs` is used only by bounded motion and scan modes. */
  onCommand: (command: OperationsCommand, durationMs?: number, payload?: Record<string, unknown>) => void;
};

type Mode = Exclude<OperationsCommand, 'stop'>;

type ModeDefinition = {
  id: Mode;
  eyebrow: string;
  title: string;
  detail: string;
  risk: 'mission' | 'motion' | 'safe' | 'service';
  needsDuration?: boolean;
  maxSeconds?: number;
  icon: typeof Compass;
};

const MODES: ModeDefinition[] = [
  {
    id: 'learn',
    eyebrow: '01 / BASELINE',
    title: 'Learn environment',
    detail: 'Drive the reference route and lock normal spatial evidence.',
    risk: 'mission',
    icon: Compass,
  },
  {
    id: 'verify',
    eyebrow: '02 / COMPARE',
    title: 'Verify structure',
    detail: 'Repeat the reference route and compare it against Learn.',
    risk: 'mission',
    icon: Activity,
  },
  {
    id: 'explore',
    eyebrow: 'AUTONOMOUS / GUARDED',
    title: 'Explore',
    detail: 'Sense ahead, reverse and pivot when an obstacle is detected.',
    risk: 'motion',
    needsDuration: true,
    maxSeconds: 30,
    icon: ScanLine,
  },
  {
    id: 'drive_straight',
    eyebrow: 'BOUNDED / MOTION',
    title: 'Straight drive',
    detail: 'A timed forward-drive check for traction and route calibration.',
    risk: 'motion',
    needsDuration: true,
    maxSeconds: 10,
    icon: ArrowUpRight,
  },
  {
    id: 'scan_only',
    eyebrow: 'STATIONARY / SENSING',
    title: 'Scan-only',
    detail: 'Stay still and sweep the range sensor to capture a local scene.',
    risk: 'safe',
    needsDuration: true,
    maxSeconds: 20,
    icon: ScanLine,
  },
  {
    id: 'motor_diagnostic',
    eyebrow: 'SERVICE / LIFT WHEELS',
    title: 'Motor diagnostic',
    detail: 'Short, individually bounded motor response check.',
    risk: 'service',
    icon: Wrench,
  },
];

const palette = {
  ink: '#e9f3ff',
  muted: '#91a8c4',
  line: 'rgba(168, 211, 255, .14)',
  panel: 'linear-gradient(145deg, rgba(17, 42, 70, .96), rgba(9, 27, 49, .98))',
  panelSoft: 'rgba(20, 56, 88, .42)',
  cyan: '#69e5f7',
  green: '#77df9b',
  amber: '#ffd26e',
  red: '#ff6975',
  redDark: '#7d2836',
} as const;

const shellStyle: CSSProperties = {
  color: palette.ink,
  border: `1px solid ${palette.line}`,
  background: palette.panel,
  borderRadius: 18,
  overflow: 'hidden',
  boxShadow: '0 18px 54px rgba(0, 0, 0, .22)',
};

function connected(connection: OperationsConnection) {
  return connection === true || connection === 'connected';
}

function normalizedSeconds(raw: string, maximum: number) {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(1, Math.round(parsed))) : Math.min(10, maximum);
}

function stateIsBusy(state: string) {
  return ['LEARNING', 'VERIFYING', 'EXPLORING', 'DRIVING', 'SCANNING', 'DIAGNOSTIC'].includes(state.toUpperCase());
}

/**
 * Product-style mission control, deliberately kept independent of the current
 * dashboard so it can be dropped into Overview or a future dedicated Ops view.
 */
export function OperationsConsole({ connection, state, liveMap, roverStatus, onCommand }: OperationsConsoleProps) {
  const [selected, setSelected] = useState<Mode>('explore');
  const [seconds, setSeconds] = useState('10');
  const [wheelsLifted, setWheelsLifted] = useState(false);
  const isConnected = connected(connection);
  const busy = stateIsBusy(state);
  const selectedDefinition = MODES.find((mode) => mode.id === selected) ?? MODES[0];

  const failSafe = useMemo(() => {
    const latest = liveMap.latest;
    const stateUpper = state.toUpperCase();
    const hasObstacleEvidence = liveMap.dangerCount > 0;
    const firmwareState = String(roverStatus?.state ?? '').toUpperCase();
    const firmwareStopped = ['FAILSAFE', 'EMERGENCY_STOP', 'STOPPED'].includes(firmwareState);
    if (firmwareStopped) {
      const cause = roverStatus?.cause ? ` (${String(roverStatus.cause).replaceAll('_', ' ')})` : '';
      return {
        tone: 'red' as const,
        title: 'Firmware fail-safe engaged',
        detail: `${roverStatus?.detail ?? roverStatus?.reason ?? 'The rover reported a safety stop.'}${cause} ${roverStatus?.recommended_action ? `Recommended next step: ${roverStatus.recommended_action}.` : 'Inspect the red evidence zones, battery, wiring, and receiver link before resetting.'}`,
        action: 'ACTION REQUIRED',
      };
    }
    if (!isConnected) {
      return {
        tone: 'amber' as const,
        title: 'Command link unavailable',
        detail: 'New motion commands are locked. Stop remains visible locally, but reconnect before relying on remote control.',
        action: 'RECONNECT REQUIRED',
      };
    }
    if (stateUpper === 'STOPPED') {
      return {
        tone: hasObstacleEvidence ? 'red' as const : 'amber' as const,
        title: hasObstacleEvidence ? 'Obstacle response recorded' : 'Run halted safely',
        detail: hasObstacleEvidence
          ? `${liveMap.dangerCount} danger zone${liveMap.dangerCount === 1 ? '' : 's'} were marked before the stop. Inspect the rover path and obstacle clearance before resuming.`
          : 'The active mission was stopped by the operator or a safety routine. Review the last telemetry frame before starting again.',
        action: 'INSPECTION HOLD',
      };
    }
    if (busy) {
      return {
        tone: hasObstacleEvidence ? 'amber' as const : 'green' as const,
        title: hasObstacleEvidence ? 'Guarded motion — obstacle evidence present' : 'Fail-safe monitor armed',
        detail: hasObstacleEvidence
          ? 'The run is still active, but red navigation zones have been recorded. The rover should brake, reverse, or pivot according to the active firmware policy.'
          : 'Telemetry, packet freshness, range observations, and command state are being watched while this run is active.',
        action: hasObstacleEvidence ? 'WATCH CLEARANCE' : 'MONITORING',
      };
    }
    if (latest?.source === 'live') {
      return {
        tone: 'green' as const,
        title: 'Rover ready / last link healthy',
        detail: `Last live frame: ${latest.mode.toUpperCase()} · ${Math.round(latest.leftSpeed)} / ${Math.round(latest.rightSpeed)} PWM · ${liveMap.mapConfidence.toFixed(1)}% map confidence.`,
        action: 'READY',
      };
    }
    return {
      tone: 'green' as const,
      title: 'Fail-safe armed before motion',
      detail: 'Every motion mode must be time-bounded. Stop immediately if the rover behaves differently from the commanded mode.',
      action: 'STANDING BY',
    };
  }, [busy, isConnected, liveMap.dangerCount, liveMap.latest, liveMap.mapConfidence, roverStatus, state]);

  const launch = () => {
    const maxSeconds = selectedDefinition.maxSeconds ?? 0;
    if (selected === 'motor_diagnostic' && !wheelsLifted) return;
    const durationMs = selectedDefinition.needsDuration ? normalizedSeconds(seconds, maxSeconds) * 1000 : undefined;
    onCommand(selected, durationMs, selected === 'motor_diagnostic' ? { wheels_lifted: wheelsLifted } : undefined);
  };

  const launchDisabled = !isConnected || busy || (selected === 'motor_diagnostic' && !wheelsLifted);
  const failColour = failSafe.tone === 'red' ? palette.red : failSafe.tone === 'amber' ? palette.amber : palette.green;

  return (
    <section style={shellStyle} aria-labelledby="operations-console-title">
      <div style={{ padding: '20px 22px 16px', display: 'flex', justifyContent: 'space-between', gap: 18, alignItems: 'flex-start', borderBottom: `1px solid ${palette.line}` }}>
        <div>
          <div style={{ color: palette.cyan, fontSize: '.68rem', fontWeight: 800, letterSpacing: '.14em' }}>RUNTIME OPERATIONS / V2</div>
          <h2 id="operations-console-title" style={{ margin: '6px 0 5px', fontSize: '1.25rem', letterSpacing: '-.03em' }}>Choose a bounded rover function</h2>
          <p style={{ margin: 0, color: palette.muted, maxWidth: 690, fontSize: '.87rem', lineHeight: 1.55 }}>Modes are separate operating contracts: mission capture, guarded navigation, stationary sensing, or supervised service.</p>
        </div>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, border: `1px solid ${isConnected ? 'rgba(119,223,155,.34)' : 'rgba(255,210,110,.34)'}`, borderRadius: 999, padding: '7px 10px', color: isConnected ? palette.green : palette.amber, background: isConnected ? 'rgba(47, 131, 86, .12)' : 'rgba(172, 117, 23, .12)', fontSize: '.72rem', fontWeight: 800, letterSpacing: '.08em', whiteSpace: 'nowrap' }}>
          <Wifi size={13} /> {isConnected ? 'LIVE LINK' : String(connection).toUpperCase()}
        </div>
      </div>

      <div style={{ padding: 20, display: 'grid', gridTemplateColumns: 'minmax(0, 1.75fr) minmax(250px, .85fr)', gap: 18 }}>
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
            {MODES.map((mode) => {
              const Icon = mode.icon;
              const active = selected === mode.id;
              const accent = mode.risk === 'motion' ? palette.amber : mode.risk === 'service' ? palette.red : mode.risk === 'safe' ? palette.cyan : palette.green;
              return (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() => setSelected(mode.id)}
                  aria-pressed={active}
                  style={{
                    minHeight: 145,
                    textAlign: 'left',
                    color: palette.ink,
                    cursor: 'pointer',
                    padding: 14,
                    borderRadius: 13,
                    border: `1px solid ${active ? accent : palette.line}`,
                    background: active ? `linear-gradient(145deg, ${mode.risk === 'service' ? 'rgba(124, 39, 55, .34)' : 'rgba(49, 106, 147, .25)'}, rgba(13, 37, 63, .85))` : 'rgba(7, 26, 48, .45)',
                    boxShadow: active ? `0 0 0 1px ${accent}1c, inset 0 1px 0 rgba(255,255,255,.05)` : 'none',
                    transition: 'border-color 160ms ease, transform 160ms ease, background 160ms ease',
                  }}
                >
                  <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: accent, fontSize: '.63rem', fontWeight: 800, letterSpacing: '.09em' }}>
                    {mode.eyebrow}<Icon size={15} aria-hidden="true" />
                  </span>
                  <strong style={{ display: 'block', marginTop: 13, fontSize: '.91rem', lineHeight: 1.1 }}>{mode.title}</strong>
                  <small style={{ display: 'block', marginTop: 8, color: palette.muted, lineHeight: 1.42, fontSize: '.72rem' }}>{mode.detail}</small>
                </button>
              );
            })}
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginTop: 14, padding: 14, borderRadius: 13, background: 'rgba(5, 20, 37, .58)', border: `1px solid ${palette.line}` }}>
            <div style={{ flex: '1 1 190px' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', color: palette.cyan, fontSize: '.68rem', fontWeight: 800, letterSpacing: '.08em' }}><Zap size={13} /> SELECTED FUNCTION</div>
              <strong style={{ display: 'block', marginTop: 4, fontSize: '.95rem' }}>{selectedDefinition.title}</strong>
            </div>

            {selectedDefinition.needsDuration && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: palette.muted, fontSize: '.72rem', fontWeight: 700 }}>
                DURATION
                <input
                  aria-label={`${selectedDefinition.title} duration in seconds`}
                  type="number"
                  min="1"
                  max={selectedDefinition.maxSeconds}
                  step="1"
                  value={seconds}
                  onChange={(event) => setSeconds(event.target.value)}
                  style={{ width: 58, background: '#091d33', border: `1px solid ${palette.line}`, borderRadius: 8, padding: '8px 7px', color: palette.ink, fontWeight: 800, outline: 'none' }}
                />
                <span>SEC / MAX {selectedDefinition.maxSeconds}</span>
              </label>
            )}

            {selected === 'motor_diagnostic' && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 7, flex: '1 1 230px', color: palette.amber, fontSize: '.74rem', lineHeight: 1.35 }}>
                <input type="checkbox" checked={wheelsLifted} onChange={(event) => setWheelsLifted(event.target.checked)} />
                Wheels are lifted; the motor battery and surroundings are safe for a short service test.
              </label>
            )}

            <button
              type="button"
              onClick={launch}
              disabled={launchDisabled}
              style={{ border: 0, borderRadius: 9, padding: '10px 13px', color: '#062033', background: launchDisabled ? '#5b6f80' : palette.cyan, cursor: launchDisabled ? 'not-allowed' : 'pointer', fontWeight: 900, fontSize: '.76rem', letterSpacing: '.05em', opacity: launchDisabled ? .55 : 1 }}
            >
              {busy ? 'RUN ACTIVE' : isConnected ? `START ${selectedDefinition.title.toUpperCase()}` : 'LINK REQUIRED'}
            </button>
          </div>
        </div>

        <aside style={{ display: 'flex', flexDirection: 'column', gap: 12 }} aria-label="Fail-safe status">
          <div style={{ border: `1px solid ${failColour}55`, borderRadius: 14, padding: 15, background: `linear-gradient(150deg, ${failColour}16, rgba(7, 23, 41, .72))` }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, color: failColour, fontSize: '.68rem', fontWeight: 900, letterSpacing: '.1em' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><ShieldCheck size={14} /> FAIL-SAFE</span>
              <span>{failSafe.action}</span>
            </div>
            <strong style={{ display: 'block', marginTop: 13, fontSize: '.97rem', lineHeight: 1.2 }}>{failSafe.title}</strong>
            <p style={{ margin: '8px 0 0', color: palette.muted, fontSize: '.77rem', lineHeight: 1.52 }}>{failSafe.detail}</p>
          </div>

          <div style={{ border: `1px solid ${palette.line}`, borderRadius: 14, padding: 15, background: palette.panelSoft }}>
            <div style={{ color: palette.cyan, fontSize: '.68rem', fontWeight: 900, letterSpacing: '.1em' }}>SAFETY CHECKLIST</div>
            <div style={{ display: 'grid', gap: 10, marginTop: 13 }}>
              {[
                [isConnected, 'Receiver link', isConnected ? 'telemetry available' : 'new motion blocked'],
                [liveMap.latest?.source === 'live', 'Live evidence', liveMap.latest?.source === 'live' ? `${liveMap.packetCount} packets received` : 'awaiting rover packet'],
                [liveMap.dangerCount === 0, 'Obstacle zones', liveMap.dangerCount ? `${liveMap.dangerCount} red zone${liveMap.dangerCount === 1 ? '' : 's'} logged` : 'no danger zone logged'],
              ].map(([ok, label, detail]) => (
                <div key={String(label)} style={{ display: 'grid', gridTemplateColumns: '12px 1fr', gap: 8, alignItems: 'start' }}>
                  <i style={{ width: 8, height: 8, marginTop: 4, borderRadius: '50%', background: ok ? palette.green : palette.amber, boxShadow: `0 0 0 3px ${ok ? 'rgba(119,223,155,.12)' : 'rgba(255,210,110,.12)'}` }} />
                  <span style={{ display: 'grid', gap: 2, fontSize: '.75rem' }}><b style={{ color: palette.ink }}>{String(label)}</b><small style={{ color: palette.muted }}>{String(detail)}</small></span>
                </div>
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={() => onCommand('stop')}
            style={{ width: '100%', display: 'inline-flex', justifyContent: 'center', alignItems: 'center', gap: 8, padding: '12px 13px', borderRadius: 11, border: `1px solid ${palette.red}88`, color: '#fff4f4', background: `linear-gradient(135deg, ${palette.redDark}, #521c2b)`, cursor: 'pointer', fontWeight: 900, letterSpacing: '.08em', fontSize: '.75rem' }}
          >
            <CircleStop size={16} /> EMERGENCY STOP
          </button>
          <p style={{ margin: 0, color: palette.muted, fontSize: '.68rem', lineHeight: 1.42, textAlign: 'center' }}><AlertTriangle size={12} style={{ verticalAlign: -2, marginRight: 4, color: palette.amber }} />Stop is always available. Do not resume until the rover is stable and the cause is understood.</p>
        </aside>
      </div>

      <div style={{ borderTop: `1px solid ${palette.line}`, background: 'rgba(5, 17, 31, .56)', padding: '10px 20px', display: 'flex', justifyContent: 'space-between', gap: 12, color: palette.muted, fontSize: '.68rem', lineHeight: 1.4 }}>
        <span>Current state: <b style={{ color: palette.ink }}>{state}</b></span>
        <span>{liveMap.dangerCount ? `${liveMap.dangerCount} navigation hazard${liveMap.dangerCount === 1 ? '' : 's'} held in the live map` : 'No navigation hazards held in the live map'}</span>
      </div>
    </section>
  );
}
