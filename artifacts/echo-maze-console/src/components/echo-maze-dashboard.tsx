import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Activity,
  ArrowDownToLine,
  Check,
  ChevronRight,
  CircleHelp,
  FileCheck2,
  Gauge,
  Layers3,
  Link2,
  Moon,
  Radio,
  SlidersHorizontal,
  Sun,
  Wifi,
  WifiOff,
} from 'lucide-react';
import {
  DEFAULT_TELEMETRY_URL,
  EchoMazeSocket,
  type CommandResult,
  type DashboardCommand,
  type RoverStatusMessage,
  type SocketStatus,
  type TelemetryMessage,
} from '@/lib/echo-maze-socket';
import {
  baselineGrid,
  currentGrid,
  diffGrid,
  diffZones,
  makePointCloud,
  pose,
  runMetadata,
  scores,
  telemetry,
  type ScoreSet,
  type RunState,
} from '@/lib/demo-model';
import { DashboardPanel, PanelBody } from './DashboardPanel';
import { ControlPanel } from './ControlPanel';
import { DiffHeatmap } from './DiffHeatmap';
import { FinalReport } from './FinalReport';
import { GhostMapOverlay } from './GhostMapOverlay';
import { OccupancyGridView } from './OccupancyGridView';
import { PointCloudView } from './PointCloudView';
import { LiveTraceView } from './LiveTraceView';
import { LiveLineMap } from './LiveLineMap';
import { MissionAnalytics, type TelemetryTrendSample } from './MissionAnalytics';
import { OperationsConsole } from './OperationsConsole';
import { ScanVolume3D } from './ScanVolume3D';
import { VerificationReviewModal } from './VerificationReviewModal';
import { ScorePanel } from './ScorePanel';
import { TelemetryPanel } from './TelemetryPanel';
import { TimeMachineSlider } from './TimeMachineSlider';
import { consumeTelemetry, createLiveMapState, poseHeadingDeg, resetLiveMap, type LiveMapState } from '@/lib/live-mapping';

type View = 'overview' | 'telemetry' | 'analysis' | 'operations' | 'report';
const socket = new EchoMazeSocket();

function Panel({ title, code, children, className = '' }: { title: string; code?: string; children: ReactNode; className?: string }) {
  return <DashboardPanel title={title} code={code} className={className}>{children}</DashboardPanel>;
}

function NavButton({ view, active, icon: Icon, label, onClick }: {
  view: View;
  active: boolean;
  icon: typeof Activity;
  label: string;
  onClick: (view: View) => void;
}) {
  return (
    <button className={`nav-button ${active ? 'active' : ''}`} onClick={() => onClick(view)} aria-current={active ? 'page' : undefined}>
      <Icon />
      <span>{label}</span>
      {active && <ChevronRight size={14} className="nav-chevron" />}
    </button>
  );
}

function parseLiveTelemetry(message: TelemetryMessage) {
  const motor = (message.motor ?? {}) as Record<string, unknown>;
  const scan = (message.scan ?? {}) as Record<string, unknown>;
  const imu = (message.imu ?? null) as Record<string, unknown> | null;
  const number = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  const vector = (value: unknown, fallback: string) => Array.isArray(value) && value.length === 3
    ? value.map((part) => number(part, 0).toFixed(2)).join(' / ')
    : fallback;
  return {
    motorState: String(message.mode ?? 'Live telemetry').toUpperCase(),
    leftMotor: number(motor.left_speed, telemetry.leftMotor),
    rightMotor: number(motor.right_speed, telemetry.rightMotor),
    accel: imu ? vector(imu.accel, 'Unavailable') : 'Unavailable',
    gyro: imu ? vector(imu.gyro, 'Unavailable') : 'Unavailable',
    ultrasonic: number(scan.distance_cm, telemetry.ultrasonic),
    ir: number(message.ir, telemetry.ir),
    temperature: number(message.temp_c, telemetry.temperature),
  };
}

function trendSample(message: TelemetryMessage): TelemetryTrendSample {
  const motor = (message.motor ?? {}) as Record<string, unknown>;
  const scan = (message.scan ?? {}) as Record<string, unknown>;
  const numberOrNull = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null;
  return {
    timestamp: numberOrNull(message.timestamp) ?? Date.now(),
    distanceCm: numberOrNull(scan.distance_cm ?? scan.distance),
    temperatureC: numberOrNull(message.temp_c),
    leftSpeed: numberOrNull(motor.left_speed) ?? 0,
    rightSpeed: numberOrNull(motor.right_speed) ?? 0,
  };
}

function finiteSamples(samples: TelemetryTrendSample[], field: 'distanceCm' | 'temperatureC') {
  return samples.map((sample) => sample[field]).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, value));
}

/**
 * A transparent live evidence delta used until a persisted sklearn score
 * artifact is connected to the WebSocket. It compares the actual Learn and
 * Verify range/temperature streams; it never pretends missing IMU data is a
 * zero-vibration measurement.
 */
function deriveLiveScores(
  baselineSamples: TelemetryTrendSample[],
  currentSamples: TelemetryTrendSample[],
  baselineMap: LiveMapState | null,
  currentMap: LiveMapState,
): ScoreSet {
  const liveCurrent = currentMap.latest?.source === 'live' && currentSamples.length > 0;
  if (!liveCurrent) return scores;
  if (!baselineMap || baselineSamples.length < 2) {
    return {
      geometry: 0, tilt: 0, vibration: 0, thermal: 0, total: 0,
      source: 'live-evidence',
      note: 'Capture a Learn run before Verify to establish a comparison baseline.',
    };
  }

  const baselineRanges = finiteSamples(baselineSamples, 'distanceCm');
  const currentRanges = finiteSamples(currentSamples, 'distanceCm');
  let geometry = 0;
  if (baselineRanges.length && currentRanges.length) {
    const pairCount = Math.min(80, Math.max(baselineRanges.length, currentRanges.length));
    let absoluteDelta = 0;
    for (let index = 0; index < pairCount; index += 1) {
      const baselineIndex = Math.round(index * (baselineRanges.length - 1) / Math.max(1, pairCount - 1));
      const currentIndex = Math.round(index * (currentRanges.length - 1) / Math.max(1, pairCount - 1));
      absoluteDelta += Math.abs(baselineRanges[baselineIndex] - currentRanges[currentIndex]);
    }
    const baselineMean = average(baselineRanges) ?? 1;
    geometry = clampScore((absoluteDelta / pairCount) / Math.max(25, baselineMean * 0.35) * 100);
  }
  // New close-range/avoidance evidence is a meaningful geometric change even
  // when the paired sweep has very few valid range samples.
  geometry = clampScore(geometry + Math.max(0, currentMap.dangerCount - baselineMap.dangerCount) * 8);

  const baselineTemperature = average(finiteSamples(baselineSamples, 'temperatureC'));
  const currentTemperature = average(finiteSamples(currentSamples, 'temperatureC'));
  const thermal = baselineTemperature === null || currentTemperature === null
    ? 0
    : clampScore(Math.abs(currentTemperature - baselineTemperature) / 3 * 100);
  const total = clampScore(geometry * 0.7 + thermal * 0.3);
  return {
    geometry: Number(geometry.toFixed(1)),
    tilt: 0,
    vibration: 0,
    thermal: Number(thermal.toFixed(1)),
    total: Number(total.toFixed(1)),
    source: 'live-evidence',
    note: 'Live range and temperature deltas; IMU tilt/vibration unavailable in this hardware build.',
  };
}

type ThemeMode = 'draft' | 'reproduction';

function Header({ connection, onLink, onReport, theme, onToggleTheme }: { connection: SocketStatus; onLink: () => void; onReport: () => void; theme: ThemeMode; onToggleTheme: () => void }) {
  const live = connection === 'connected';
  const connecting = connection === 'connecting';
  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark">EM</div>
        <div>
          <div className="brand-wordmark">ECHO—MAZE</div>
          <div className="brand-sub">Robotic structure lab</div>
        </div>
      </div>
      <div className="top-meta">
        <span className="top-date">07 SEP 2026 / FIELD UNIT 01</span>
        <button className="mode-switch" onClick={onToggleTheme} aria-label={`Switch to ${theme === 'draft' ? 'reproduction' : 'draft'} mode`}>
          {theme === 'draft' ? <Moon size={14} /> : <Sun size={14} />}
          <span>{theme === 'draft' ? 'Draft' : 'Reproduction'}</span>
        </button>
        <button className={`connection connection-button ${live ? 'is-live' : connecting ? 'is-connecting' : ''}`} onClick={onLink}>
          {live ? <Wifi size={14} /> : connecting ? <Radio size={14} /> : <WifiOff size={14} />}
          <i className="live-dot" />
          {live ? 'Receiver linked' : connecting ? 'Connecting' : 'Link receiver'}
        </button>
        <button className="top-action report-top-action" onClick={onReport}>
          <ArrowDownToLine size={14} /> Report
        </button>
      </div>
    </header>
  );
}

function MissionStrip({ connection, packetCount, state, activeScores }: { connection: SocketStatus; packetCount: number; state: RunState; activeScores: ScoreSet }) {
  const mapAgreement = activeScores.source === 'live-evidence' && activeScores.note?.startsWith('Capture a Learn')
    ? '—'
    : `${Math.max(0, 100 - activeScores.geometry).toFixed(1)}%`;
  return (
    <section className="mission-strip" aria-label="Mission summary">
      <div className="mission-primary">
        <span>Active survey</span>
        <strong>{runMetadata.id}</strong>
      </div>
      <div><span>Map agreement</span><strong>{mapAgreement === '—' ? mapAgreement : <>{mapAgreement.replace('%', '')}<small>%</small></>}</strong></div>
      <div><span>Pose confidence</span><strong>{pose.confidence.toFixed(1)}<small>%</small></strong></div>
      <div><span>Frames received</span><strong>{packetCount.toLocaleString()}</strong></div>
      <div><span>System state</span><strong className="mission-state"><i />{connection === 'connected' ? state : 'Local rehearsal'}</strong></div>
    </section>
  );
}

function RunFacts() {
  return (
    <Panel title="Run ledger" code="CHAIN OF CUSTODY">
      <PanelBody className="run-ledger">
        <div><span>Active case</span><strong>{runMetadata.id}</strong></div>
        <div><span>Baseline</span><strong>MAZE-ALPHA / v.01</strong></div>
        <div><span>Route</span><strong>{runMetadata.route}</strong></div>
        <div><span>Capture window</span><strong>00:02:14</strong></div>
        <div><span>Model</span><strong>Isolation Forest / v1</strong></div>
        <div className="ledger-seal"><Check size={14} /> Raw packets immutable</div>
      </PanelBody>
    </Panel>
  );
}

function EvidencePulse({ activeScores }: { activeScores: ScoreSet }) {
  const pulsePath = 'M0,69 C18,62 28,65 44,53 S72,61 88,45 S116,49 132,38 S158,55 176,34 S208,41 224,27 S255,35 276,21 S310,30 336,14';
  return (
    <Panel title="Evidence trace" code="LAST 60 SEC">
      <PanelBody className="evidence-pulse">
        <svg className="pulse-chart" viewBox="0 0 336 84" role="img" aria-label="Recent anomaly score trend">
          <path className="pulse-area" d={`${pulsePath} L336,84 L0,84 Z`} />
          <path className="pulse-line" d={pulsePath} />
          <line x1="0" y1="56" x2="336" y2="56" />
          <circle cx="336" cy="14" r="4" />
        </svg>
        <div className="pulse-footer">
          <span><Activity size={14} /> Stream health <b>99.8%</b></span>
          <span>Window score <b>{activeScores.total}/100</b></span>
        </div>
      </PanelBody>
    </Panel>
  );
}

function Overview({ state, progress, connected, liveTelemetry, packetCount, onCommand, onView, ghostOn, onToggleGhost, frame, liveMap, telemetryHistory, activeScores }: {
  state: RunState;
  progress: number;
  connected: boolean;
  liveTelemetry: ReturnType<typeof parseLiveTelemetry> | null;
  packetCount: number;
  onCommand: (command: DashboardCommand, durationMs?: number, payload?: Record<string, unknown>) => void;
  onView: (view: View) => void;
  ghostOn: boolean;
  onToggleGhost: () => void;
  frame: number;
  liveMap: LiveMapState;
  telemetryHistory: TelemetryTrendSample[];
  activeScores: ScoreSet;
}) {
  const visibleTelemetry = liveTelemetry ?? telemetry;
  const hasLiveMap = liveMap.latest?.source === 'live' && liveMap.packetCount > 0;
  const points = useMemo(() => makePointCloud(frame / 9), [frame]);
  return (
    <div className="view-stack">
      <div className="overview-grid">
        <Panel title={hasLiveMap ? 'Live environment reconstruction' : 'Environment reconstruction'} code="10 CM / LOG-ODDS GRID" className="map-panel">
          <PanelBody className="map-panel-body">
            <div className="map-toolbar">
              <span className="status-chip"><i />{hasLiveMap ? 'Live range evidence + danger overlay' : connected ? 'Live range trace below' : state === 'LEARNING' || state === 'VERIFYING' || state === 'EXPLORING' ? 'Acquiring geometry' : 'Reference map preview'}</span>
              <span className="toolbar-muted">{hasLiveMap ? `${liveMap.packetCount} frames / ${liveMap.dangerCount} red cells` : '16 × 10 cells / route 01'}</span>
              {!hasLiveMap && <button className="ghost-button" onClick={onToggleGhost}>{ghostOn ? 'Baseline visible' : 'Show baseline'}</button>}
            </div>
            {hasLiveMap ? <LiveLineMap state={liveMap} /> : <GhostMapOverlay
              baseline={baselineGrid}
              current={currentGrid}
              pose={pose}
              enabled={ghostOn}
              onToggle={onToggleGhost}
              interpolation={state === 'LEARNING' ? Math.max(.1, progress / 100) : state === 'VERIFYING' ? 1 : .72}
            />}
            <div className="map-footer">
              <span>{hasLiveMap ? `Live trace ${ (liveMap.pose.xCm / 100).toFixed(2) } m / ${ (liveMap.pose.yCm / 100).toFixed(2) } m / heading ${ poseHeadingDeg(liveMap.pose).toFixed(1) }°` : `Preview pose ${pose.x.toFixed(2)} m / ${pose.y.toFixed(2)} m / heading ${pose.heading}°`}</span>
              <strong>{hasLiveMap ? `${liveMap.packetCount} packets plotted` : 'Awaiting live trace'}</strong>
            </div>
          </PanelBody>
        </Panel>
        <div className="overview-rail">
          <ControlPanel state={state} progress={progress} connected={connected} onCommand={onCommand} />
          <ScorePanel scores={activeScores} />
        </div>
      </div>
      <LiveTraceView state={liveMap} connected={connected} />
      <MissionAnalytics samples={telemetryHistory} liveMap={liveMap} />
      <div className="overview-lower">
        <PointCloudView points={points} pose={pose} scanning={state === 'LEARNING' || state === 'VERIFYING' || state === 'EXPLORING'} />
        <TelemetryPanel telemetry={visibleTelemetry} connected={connected} packetCount={packetCount} source={liveTelemetry ? 'ESP32 / live' : 'Recorded fixture'} />
      </div>
      <div className="overview-facts"><RunFacts /><EvidencePulse activeScores={activeScores} /></div>
      <div className="footer-strip">
        <span><Check size={13} /> Local model ready</span>
        <span>{connected ? 'Receiving live frames' : 'Awaiting hardware link'}</span>
        <button onClick={() => onView('analysis')}>Open spatial analysis <ChevronRight size={14} /></button>
      </div>
    </div>
  );
}

function TelemetryWorkspace({ connected, liveTelemetry, packetCount, frame, liveMap }: { connected: boolean; liveTelemetry: ReturnType<typeof parseLiveTelemetry> | null; packetCount: number; frame: number; liveMap: LiveMapState }) {
  return (
    <div className="view-stack">
      <div className="workspace-heading">
        <div><div className="eyebrow">Signal inspector</div><h2>Receiver telemetry</h2><p>Every rover frame before mapping or anomaly scoring.</p></div>
        <div className="workspace-stamp"><Radio size={15} /><span>{connected ? 'WebSocket frame stream' : 'Deterministic local replay'}</span><strong>{packetCount.toLocaleString()} frames</strong></div>
      </div>
      <div className="telemetry-workspace-grid">
        <LiveTraceView state={liveMap} connected={connected} />
        <TelemetryPanel telemetry={liveTelemetry ?? telemetry} connected={connected} packetCount={packetCount} source={liveTelemetry ? 'ESP32 / live' : 'Recorded fixture'} />
        <PointCloudView points={makePointCloud(frame / 9)} pose={pose} scanning={connected} />
        <Panel title="Packet contract" code="SCHEMA / v1">
          <PanelBody className="packet-anatomy">
            <div className="packet-row"><span>Run ID</span><strong>{runMetadata.id}</strong><em>string</em></div>
            <div className="packet-row"><span>Timestamp</span><strong>{(Date.now() % 100000).toLocaleString()} ms</strong><em>monotonic</em></div>
            <div className="packet-row"><span>Mode</span><strong>{liveTelemetry?.motorState ?? 'Test / fixture'}</strong><em>learn / verify</em></div>
            <div className="packet-row"><span>IMU / GYRO</span><strong>{liveTelemetry?.gyro === 'Unavailable' ? 'Not installed' : liveTelemetry ? '3-axis / valid' : 'Demo fixture'}</strong><em>gyro-free odometry</em></div>
            <div className="packet-row"><span>Optional</span><strong>scan / IR / temp</strong><em>null safe</em></div>
            <div className="packet-note"><CircleHelp size={15} /><span>Fixture packets validate transport only. Production learn/verify runs require live IMU readings.</span></div>
          </PanelBody>
        </Panel>
      </div>
    </div>
  );
}

function Analysis({ ghostOn, onToggleGhost, liveMap }: { ghostOn: boolean; onToggleGhost: () => void; liveMap: LiveMapState }) {
  const [time, setTime] = useState(72);
  const blended = currentGrid.map((value, index) => baselineGrid[index] * (1 - time / 100) + value * (time / 100));
  const hasLiveMap = liveMap.latest?.source === 'live' && liveMap.packetCount > 0;
  return (
    <div className="view-stack">
      <div className="workspace-heading">
        <div><div className="eyebrow">Spatial comparison</div><h2>{hasLiveMap ? 'Live field / danger map' : 'Baseline ↔ current'}</h2><p>{hasLiveMap ? 'Current occupancy reconstructed from live ultrasonic evidence.' : 'Registered geometry, reviewed cell by cell.'}</p></div>
        <div className="analysis-tags"><span>{hasLiveMap ? `LIVE / ${liveMap.runId ?? 'unnamed run'}` : 'Baseline locked'}</span><span className="tag-alert">{hasLiveMap ? `${liveMap.dangerCount} danger cells` : '2 review zones'}</span></div>
      </div>
      <div className="analysis-grid">
        <Panel title={hasLiveMap ? 'Live occupancy + danger field' : 'Time-indexed occupancy'} code={hasLiveMap ? 'LIVE / 10 CM LOG-ODDS' : 'INTERPOLATED GRID'} className="analysis-map-panel">
          <PanelBody className="analysis-map-body">
            {hasLiveMap ? (
              <>
                <div className="map-toolbar"><span><Radio size={14} /> Live range evidence / danger overlay</span><span className="toolbar-muted">{liveMap.packetCount} frames · {liveMap.dangerCount} red cells</span></div>
                <LiveLineMap state={liveMap} />
              </>
            ) : (
              <>
                <div className="map-toolbar"><span><Layers3 size={14} /> Current contribution / {time}%</span><button className="ghost-button" onClick={onToggleGhost}>{ghostOn ? 'Baseline visible' : 'Show baseline'}</button></div>
                <div className="analysis-grid-canvas"><OccupancyGridView values={blended} pose={pose} ghostValues={ghostOn ? baselineGrid : undefined} /></div>
                <TimeMachineSlider value={time} onChange={setTime} />
              </>
            )}
          </PanelBody>
        </Panel>
        {hasLiveMap ? (
          <Panel title="Obstacle evidence" code="STOP / REVERSE EVENTS">
            <PanelBody className="analysis-live-evidence">
              <div className="live-evidence-stat"><span>Red danger cells</span><strong>{liveMap.dangerCount}</strong><small>Unique 10 cm cells marked from close ultrasonic hits or Explore avoidance.</small></div>
              <div className="live-evidence-stat"><span>Current rover position</span><strong>{(liveMap.pose.xCm / 100).toFixed(2)} m / {(liveMap.pose.yCm / 100).toFixed(2)} m</strong><small>{(liveMap.pose.confidence * 100).toFixed(1)}% command-pose confidence · heading {poseHeadingDeg(liveMap.pose).toFixed(1)}°</small></div>
              <div className="live-evidence-note"><i className="trace-legend-danger" /> A red cell is a navigation hazard marker, not a structural-damage classification.</div>
            </PanelBody>
          </Panel>
        ) : <DiffHeatmap values={diffGrid} zones={diffZones} />}
      </div>
      <div className="analysis-bottom">
        <Panel title="Run pair" code="BASELINE / CURRENT">
          <PanelBody className="side-by-side">
            <div><span>Baseline</span><strong>MAZE-ALPHA</strong><small>Healthy reference / 1,901 points</small><OccupancyGridView values={baselineGrid} mode="baseline" compact /></div>
            {hasLiveMap ? <div className="live-run-card"><span>Current live run</span><strong>{liveMap.runId ?? 'LIVE'}</strong><small>{liveMap.packetCount} frames · {liveMap.dangerCount} danger cells · {liveMap.mapConfidence.toFixed(1)}% map confidence</small><div className="live-run-status">Live map is shown above; run is ready for baseline registration and temporal diff.</div></div> : <div><span>Current</span><strong>EM-0427-VR</strong><small>Verification capture / 1,842 points</small><OccupancyGridView values={currentGrid} mode="current" compact /></div>}
          </PanelBody>
        </Panel>
        <Panel title="Evidence reading" code="MODEL NOTES">
          <PanelBody className="interpretation">
            <div><i className="interpretation-icon cyan">01</i><p><strong>Geometry leads.</strong> East-wall displacement is the strongest signal.</p></div>
            <div><i className="interpretation-icon violet">02</i><p><strong>Sensor coverage is explicit.</strong> Gyro/vibration evidence is offline in this hardware build.</p></div>
            <div><i className="interpretation-icon amber">03</i><p><strong>Human review remains final.</strong> Anomaly detection is an early-warning aid.</p></div>
          </PanelBody>
        </Panel>
      </div>
      <div className="footer-strip"><span><Check size={13} /> Geometry model ready</span><span>Diff threshold / 0.35</span><span>Range window / 2.0 sec</span></div>
    </div>
  );
}

function OperationsWorkspace({
  connection,
  state,
  liveMap,
  telemetryHistory,
  onCommand,
  roverStatus,
}: {
  connection: SocketStatus;
  state: RunState;
  liveMap: LiveMapState;
  telemetryHistory: TelemetryTrendSample[];
  onCommand: (command: DashboardCommand, durationMs?: number, payload?: Record<string, unknown>) => void;
  roverStatus: RoverStatusMessage | null;
}) {
  return (
    <div className="view-stack">
      <div className="workspace-heading">
        <div><div className="eyebrow">Runtime operations</div><h2>Field functions</h2><p>Bounded mission, motion, sensing, and service contracts for a sellable rover platform.</p></div>
        <div className="workspace-stamp"><SlidersHorizontal size={15} /><span>Safety-gated controls</span><strong>{connection === 'connected' ? 'Receiver linked' : 'Link required'}</strong></div>
      </div>
      <OperationsConsole connection={connection} state={state} liveMap={liveMap} roverStatus={roverStatus} onCommand={onCommand} />
      <div className="operations-evidence-grid">
        <ScanVolume3D state={liveMap} />
        <MissionAnalytics samples={telemetryHistory} liveMap={liveMap} />
      </div>
    </div>
  );
}

export function EchoMazeDashboard() {
  const [view, setView] = useState<View>('overview');
  const [state, setState] = useState<RunState>('IDLE');
  const [progress, setProgress] = useState(72);
  const [commandNote, setCommandNote] = useState('Awaiting command');
  const [connection, setConnection] = useState<SocketStatus>('disconnected');
  const [liveTelemetry, setLiveTelemetry] = useState<ReturnType<typeof parseLiveTelemetry> | null>(null);
  const [liveMap, setLiveMap] = useState<LiveMapState>(() => createLiveMapState());
  const [telemetryHistory, setTelemetryHistory] = useState<TelemetryTrendSample[]>([]);
  const [baselineLiveMap, setBaselineLiveMap] = useState<LiveMapState | null>(null);
  const [baselineTelemetryHistory, setBaselineTelemetryHistory] = useState<TelemetryTrendSample[]>([]);
  const [roverStatus, setRoverStatus] = useState<RoverStatusMessage | null>(null);
  const [packetCount, setPacketCount] = useState(1842);
  const [ghostOn, setGhostOn] = useState(true);
  const [frame, setFrame] = useState(0);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [verificationReviewOpen, setVerificationReviewOpen] = useState(false);
  const previousState = useRef<RunState>('IDLE');
  const [theme, setTheme] = useState<ThemeMode>('reproduction');
  const activeScores = useMemo(
    () => deriveLiveScores(baselineTelemetryHistory, telemetryHistory, baselineLiveMap, liveMap),
    [baselineLiveMap, baselineTelemetryHistory, liveMap, telemetryHistory],
  );

  useEffect(() => {
    const unsubscribeStatus = socket.onStatus(setConnection);
    const unsubscribeCommandResult = socket.onCommandResult((result: CommandResult) => {
      const label = result.cmd ? result.cmd.replaceAll('_', ' ') : 'command';
      if (!result.ok || (result.cmd && result.delivered_to === 0 && result.cmd !== 'stop')) {
        const reason = result.error ?? 'no rover client is connected to the receiver';
        setCommandNote(`${label} rejected: ${reason}`);
        if (result.cmd !== 'stop' && result.cmd !== 'reset') {
          setState((current) => ['LEARNING', 'VERIFYING', 'EXPLORING'].includes(current) ? 'IDLE' : current);
          setProgress(72);
        }
        return;
      }
      if (result.cmd && result.cmd !== 'failsafe_status') {
        setCommandNote(`${label} delivered to rover`);
      }
    });
    const unsubscribeTelemetry = socket.onTelemetry((message) => {
      setLiveTelemetry(parseLiveTelemetry(message));
      setLiveMap((current) => consumeTelemetry(current, message));
      setTelemetryHistory((current) => [...current, trendSample(message)].slice(-360));
      setPacketCount((count) => count + 1);
    });
    const unsubscribeRoverStatus = socket.onRoverStatus((status) => {
      setRoverStatus(status);
      const normalized = String(status.state ?? '').toUpperCase();
      const stateMap: Partial<Record<string, RunState>> = {
        LEARN: 'LEARNING', LEARNING: 'LEARNING',
        VERIFY: 'VERIFYING', VERIFYING: 'VERIFYING',
        EXPLORE: 'EXPLORING', EXPLORING: 'EXPLORING',
        COMPLETE: 'COMPLETE', READY: 'IDLE', ONLINE: 'IDLE',
        STOPPED: 'STOPPED', FAILSAFE: 'STOPPED', EMERGENCY_STOP: 'STOPPED',
      };
      const nextState = stateMap[normalized];
      if (nextState) setState(nextState);
      if (status.reason) setCommandNote(status.reason);
    });
    // Try the local receiver immediately so the live map is useful as soon as
    // the page opens. The button still allows a manual reconnect/disconnect.
    socket.connect();
    return () => { unsubscribeStatus(); unsubscribeCommandResult(); unsubscribeTelemetry(); unsubscribeRoverStatus(); socket.disconnect(); };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setFrame((value) => value + 1), 1200);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if ((state === 'COMPLETE' || state === 'STOPPED') && previousState.current === 'VERIFYING') {
      setVerificationReviewOpen(true);
    }
    previousState.current = state;
  }, [state]);

  useEffect(() => {
    if (state !== 'LEARNING' && state !== 'VERIFYING' && state !== 'EXPLORING') return;
    const timer = window.setInterval(() => setProgress((value) => {
      if (value >= 100) {
        setState('COMPLETE');
        setCommandNote('Route complete / evidence ready');
        return 100;
      }
      return Math.min(100, value + 2);
    }), 750);
    return () => window.clearInterval(timer);
  }, [state]);

  // Firmware deliberately stops active motion when it hasn't heard from the
  // operator for two seconds. Browsers cannot send a WebSocket control-frame
  // ping, so keep the safety channel alive with the explicit, non-motion
  // status command while a bounded field function is active.
  useEffect(() => {
    if (connection !== 'connected' || !['LEARNING', 'VERIFYING', 'EXPLORING'].includes(state)) return;
    const heartbeat = window.setInterval(() => {
      socket.send('failsafe_status', { heartbeat: true });
    }, 750);
    return () => window.clearInterval(heartbeat);
  }, [connection, state]);

  const command = (next: DashboardCommand, durationMs?: number, payload: Record<string, unknown> = {}) => {
    const bounded = next === 'explore' || next === 'drive_straight' || next === 'scan_only';
    const commandPayload = bounded ? { ...payload, duration_ms: durationMs ?? 10000 } : payload;
    const delivered = socket.send(next, Object.keys(commandPayload).length ? commandPayload : undefined);
    // Never put the UI into a busy state when the browser cannot even write
    // to the receiver. This prevents a failed click from locking every field
    // function until a full page reload.
    if (!delivered && next !== 'stop' && next !== 'reset') {
      setCommandNote('Command not sent: receiver link is unavailable; reconnect and try again');
      setState('IDLE');
      setProgress(72);
      return;
    }
    if (next === 'learn' || next === 'verify' || next === 'reset') setVerificationReviewOpen(false);
    if (next === 'learn') {
      setBaselineLiveMap(null);
      setBaselineTelemetryHistory([]);
    }
    if (next === 'verify') {
      // Preserve the completed Learn evidence before clearing the live buffers
      // for the new Verify run. This is what makes successive runs differ.
      setBaselineLiveMap(liveMap);
      setBaselineTelemetryHistory(telemetryHistory);
    }
    if (next === 'learn' || next === 'verify' || next === 'explore' || next === 'drive_straight' || next === 'scan_only' || next === 'reset') {
      setLiveMap(resetLiveMap());
      setTelemetryHistory([]);
    }
    if (next === 'learn') { setState('LEARNING'); setProgress(14); setCommandNote(delivered ? 'Baseline command sent to rover' : 'Baseline capture staged locally'); }
    if (next === 'verify') { setState('VERIFYING'); setProgress(58); setCommandNote(delivered ? 'Verification command sent to rover' : 'Verification staged locally'); }
    if (next === 'explore') { setState('EXPLORING'); setProgress(0); setCommandNote(delivered ? 'Guarded exploration sent to rover' : 'Exploration requires a live receiver'); }
    if (next === 'drive_straight') { setState('EXPLORING'); setProgress(0); setCommandNote(delivered ? 'Bounded straight-drive check sent to rover' : 'Straight-drive check requires a live receiver'); }
    if (next === 'scan_only') { setState('EXPLORING'); setProgress(0); setCommandNote(delivered ? 'Stationary scan sent to rover' : 'Scan-only requires a live receiver'); }
    if (next === 'motor_diagnostic') { setState('EXPLORING'); setProgress(0); setCommandNote(delivered ? 'Motor diagnostic sent to rover' : 'Motor diagnostic requires a live receiver'); }
    if (next === 'stop') { setState('STOPPED'); setCommandNote('Run halted by operator'); }
    if (next === 'reset') { setState('IDLE'); setProgress(72); setCommandNote('Awaiting command'); }
  };
  const link = () => connection === 'connected' || connection === 'connecting' ? socket.disconnect() : socket.connect();
  const nav = [
    { view: 'overview' as View, icon: Gauge, label: 'Field overview' },
    { view: 'telemetry' as View, icon: Radio, label: 'Telemetry' },
    { view: 'analysis' as View, icon: Layers3, label: 'Spatial comparison' },
    { view: 'operations' as View, icon: SlidersHorizontal, label: 'Field functions' },
    { view: 'report' as View, icon: FileCheck2, label: 'Inspection record' },
  ];
  const titles: Record<View, [string, string]> = {
    overview: ['Field overview', 'Live structural verification'],
    telemetry: ['Telemetry', 'Receiver frames and sensor integrity'],
    analysis: ['Spatial comparison', 'Baseline geometry against the current run'],
    operations: ['Field functions', 'Bounded runtime modes and fail-safe observability'],
    report: ['Inspection record', 'Consolidated evidence for field review'],
  };

  return (
    <div className={`app-shell theme-${theme}`}>
      <Header connection={connection} onLink={link} onReport={() => setView('report')} theme={theme} onToggleTheme={() => setTheme((value) => value === 'draft' ? 'reproduction' : 'draft')} />
      <div className="mobile-nav">{nav.map((item) => <NavButton key={item.view} {...item} active={view === item.view} onClick={setView} />)}</div>
      <div className="body-layout">
        <aside className="sidebar">
          <div className="nav-kicker">INSPECTION / 01 <span>v0.2</span></div>
          <nav className="nav-list">{nav.map((item) => <NavButton key={item.view} {...item} active={view === item.view} onClick={setView} />)}</nav>
          <div className="sidebar-status"><div className="status-orbit"><span /><span /><span /></div><div><strong>EM-RVR-01</strong><small>{connection === 'connected' ? 'Linked / receiving' : 'Local / standby'}</small></div></div>
          <div className="sidebar-footer">
            <div className="side-unit">Environment<strong>MAZE-ALPHA</strong></div>
            <div className="side-unit">Run mode<strong>{state}</strong></div>
            <button className="notice-link" onClick={() => setNoticeOpen(true)}><Link2 size={12} /> Connection boundary</button>
          </div>
        </aside>
        <main className="main">
          <div className="view-heading">
            <div><div className="eyebrow">Echo—Maze / {connection === 'connected' ? 'live bus' : 'local bus'}</div><h1>{titles[view][0]}</h1><p>{titles[view][1]} — {commandNote}.</p></div>
            <div className={`run-chip ${state === 'VERIFYING' || state === 'STOPPED' ? 'review' : ''}`}><span className="live-dot" />{state === 'IDLE' ? 'Ready for command' : state === 'STOPPED' ? 'Run halted' : `${state} / ${runMetadata.id}`}</div>
          </div>
          <MissionStrip connection={connection} packetCount={packetCount} state={state} activeScores={activeScores} />
          {view === 'overview' && <Overview state={state} progress={progress} connected={connection === 'connected'} liveTelemetry={liveTelemetry} packetCount={packetCount} onCommand={command} onView={setView} ghostOn={ghostOn} onToggleGhost={() => setGhostOn((value) => !value)} frame={frame} liveMap={liveMap} telemetryHistory={telemetryHistory} activeScores={activeScores} />}
          {view === 'telemetry' && <TelemetryWorkspace connected={connection === 'connected'} liveTelemetry={liveTelemetry} packetCount={packetCount} frame={frame} liveMap={liveMap} />}
          {view === 'analysis' && <Analysis ghostOn={ghostOn} onToggleGhost={() => setGhostOn((value) => !value)} liveMap={liveMap} />}
          {view === 'operations' && <OperationsWorkspace connection={connection} state={state} liveMap={liveMap} telemetryHistory={telemetryHistory} roverStatus={roverStatus} onCommand={command} />}
          {view === 'report' && <FinalReport metadata={runMetadata} scores={activeScores} onExport={() => setCommandNote('Report staged for export')} />}
        </main>
      </div>
      {noticeOpen && <div className="modal-shade"><div className="privacy-modal" role="dialog" aria-labelledby="privacy-title"><h2 id="privacy-title">Connection boundary</h2><p>The console can run with deterministic replay data or connect to the laptop receiver at <code>{DEFAULT_TELEMETRY_URL}</code>. Raw telemetry remains in the local Echo-Maze workspace.</p><button onClick={() => setNoticeOpen(false)}><Check size={13} /> Close notice</button></div></div>}
      <VerificationReviewModal
        open={verificationReviewOpen}
        status={state === 'STOPPED' ? 'STOPPED' : 'COMPLETE'}
        scores={activeScores}
        liveMap={liveMap}
        onClose={() => setVerificationReviewOpen(false)}
        onOpenReport={() => { setVerificationReviewOpen(false); setView('report'); }}
      />
    </div>
  );
}
