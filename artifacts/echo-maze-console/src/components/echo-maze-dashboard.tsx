import { useEffect, useMemo, useState, type ReactNode } from 'react';
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
  Sun,
  Wifi,
  WifiOff,
} from 'lucide-react';
import {
  DEFAULT_TELEMETRY_URL,
  EchoMazeSocket,
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
  type RunState,
} from '@/lib/demo-model';
import { DashboardPanel, PanelBody } from './DashboardPanel';
import { ControlPanel } from './ControlPanel';
import { DiffHeatmap } from './DiffHeatmap';
import { FinalReport } from './FinalReport';
import { GhostMapOverlay } from './GhostMapOverlay';
import { OccupancyGridView } from './OccupancyGridView';
import { PointCloudView } from './PointCloudView';
import { ScorePanel } from './ScorePanel';
import { TelemetryPanel } from './TelemetryPanel';
import { TimeMachineSlider } from './TimeMachineSlider';

type View = 'overview' | 'telemetry' | 'analysis' | 'report';
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
  const imu = (message.imu ?? {}) as Record<string, unknown>;
  const number = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  const vector = (value: unknown, fallback: string) => Array.isArray(value) && value.length === 3
    ? value.map((part) => number(part, 0).toFixed(2)).join(' / ')
    : fallback;
  return {
    motorState: String(message.mode ?? 'Live telemetry').toUpperCase(),
    leftMotor: number(motor.left_speed, telemetry.leftMotor),
    rightMotor: number(motor.right_speed, telemetry.rightMotor),
    accel: vector(imu.accel, telemetry.accel),
    gyro: vector(imu.gyro, telemetry.gyro),
    ultrasonic: number(scan.distance_cm, telemetry.ultrasonic),
    ir: number(message.ir, telemetry.ir),
    temperature: number(message.temp_c, telemetry.temperature),
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

function MissionStrip({ connection, packetCount, state }: { connection: SocketStatus; packetCount: number; state: RunState }) {
  return (
    <section className="mission-strip" aria-label="Mission summary">
      <div className="mission-primary">
        <span>Active survey</span>
        <strong>{runMetadata.id}</strong>
      </div>
      <div><span>Map agreement</span><strong>92.4<small>%</small></strong></div>
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

function EvidencePulse() {
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
          <span>Window score <b>{scores.total}/100</b></span>
        </div>
      </PanelBody>
    </Panel>
  );
}

function Overview({ state, progress, connected, liveTelemetry, packetCount, onCommand, onView, ghostOn, onToggleGhost, frame }: {
  state: RunState;
  progress: number;
  connected: boolean;
  liveTelemetry: ReturnType<typeof parseLiveTelemetry> | null;
  packetCount: number;
  onCommand: (command: 'learn' | 'verify' | 'stop' | 'reset') => void;
  onView: (view: View) => void;
  ghostOn: boolean;
  onToggleGhost: () => void;
  frame: number;
}) {
  const visibleTelemetry = liveTelemetry ?? telemetry;
  const points = useMemo(() => makePointCloud(frame / 9), [frame]);
  return (
    <div className="view-stack">
      <div className="overview-grid">
        <Panel title="Environment reconstruction" code="10 CM / LOG-ODDS GRID" className="map-panel">
          <PanelBody className="map-panel-body">
            <div className="map-toolbar">
              <span className="status-chip"><i />{state === 'LEARNING' || state === 'VERIFYING' ? 'Acquiring geometry' : 'Map registered'}</span>
              <span className="toolbar-muted">16 × 10 cells / route 01</span>
              <button className="ghost-button" onClick={onToggleGhost}>{ghostOn ? 'Baseline visible' : 'Show baseline'}</button>
            </div>
            <GhostMapOverlay
              baseline={baselineGrid}
              current={currentGrid}
              pose={pose}
              enabled={ghostOn}
              onToggle={onToggleGhost}
              interpolation={state === 'LEARNING' ? Math.max(.1, progress / 100) : state === 'VERIFYING' ? 1 : .72}
            />
            <div className="map-footer">
              <span>Position {pose.x.toFixed(2)} m / {pose.y.toFixed(2)} m / heading {pose.heading}°</span>
              <strong>Estimated drift ± 8 cm</strong>
            </div>
          </PanelBody>
        </Panel>
        <div className="overview-rail">
          <ControlPanel state={state} progress={progress} connected={connected} onCommand={onCommand} />
          <ScorePanel scores={scores} />
        </div>
      </div>
      <div className="overview-lower">
        <PointCloudView points={points} pose={pose} scanning={state === 'LEARNING' || state === 'VERIFYING'} />
        <TelemetryPanel telemetry={visibleTelemetry} connected={connected} packetCount={packetCount} source={liveTelemetry ? 'ESP32 / live' : 'Recorded fixture'} />
      </div>
      <div className="overview-facts"><RunFacts /><EvidencePulse /></div>
      <div className="footer-strip">
        <span><Check size={13} /> Local model ready</span>
        <span>{connected ? 'Receiving live frames' : 'Awaiting hardware link'}</span>
        <button onClick={() => onView('analysis')}>Open spatial analysis <ChevronRight size={14} /></button>
      </div>
    </div>
  );
}

function TelemetryWorkspace({ connected, liveTelemetry, packetCount, frame }: { connected: boolean; liveTelemetry: ReturnType<typeof parseLiveTelemetry> | null; packetCount: number; frame: number }) {
  return (
    <div className="view-stack">
      <div className="workspace-heading">
        <div><div className="eyebrow">Signal inspector</div><h2>Receiver telemetry</h2><p>Every rover frame before mapping or anomaly scoring.</p></div>
        <div className="workspace-stamp"><Radio size={15} /><span>{connected ? 'WebSocket frame stream' : 'Deterministic local replay'}</span><strong>{packetCount.toLocaleString()} frames</strong></div>
      </div>
      <div className="telemetry-workspace-grid">
        <TelemetryPanel telemetry={liveTelemetry ?? telemetry} connected={connected} packetCount={packetCount} source={liveTelemetry ? 'ESP32 / live' : 'Recorded fixture'} />
        <PointCloudView points={makePointCloud(frame / 9)} pose={pose} scanning={connected} />
        <Panel title="Packet contract" code="SCHEMA / v1">
          <PanelBody className="packet-anatomy">
            <div className="packet-row"><span>Run ID</span><strong>{runMetadata.id}</strong><em>string</em></div>
            <div className="packet-row"><span>Timestamp</span><strong>{(Date.now() % 100000).toLocaleString()} ms</strong><em>monotonic</em></div>
            <div className="packet-row"><span>Mode</span><strong>{liveTelemetry?.motorState ?? 'Test / fixture'}</strong><em>learn / verify</em></div>
            <div className="packet-row"><span>IMU</span><strong>{liveTelemetry ? '3-axis / valid' : 'Canonical sample'}</strong><em>accel + gyro</em></div>
            <div className="packet-row"><span>Optional</span><strong>scan / IR / temp</strong><em>null safe</em></div>
            <div className="packet-note"><CircleHelp size={15} /><span>Fixture packets validate transport only. Production learn/verify runs require live IMU readings.</span></div>
          </PanelBody>
        </Panel>
      </div>
    </div>
  );
}

function Analysis({ ghostOn, onToggleGhost }: { ghostOn: boolean; onToggleGhost: () => void }) {
  const [time, setTime] = useState(72);
  const blended = currentGrid.map((value, index) => baselineGrid[index] * (1 - time / 100) + value * (time / 100));
  return (
    <div className="view-stack">
      <div className="workspace-heading">
        <div><div className="eyebrow">Spatial comparison</div><h2>Baseline ↔ current</h2><p>Registered geometry, reviewed cell by cell.</p></div>
        <div className="analysis-tags"><span>Baseline locked</span><span className="tag-alert">2 review zones</span></div>
      </div>
      <div className="analysis-grid">
        <Panel title="Time-indexed occupancy" code="INTERPOLATED GRID" className="analysis-map-panel">
          <PanelBody className="analysis-map-body">
            <div className="map-toolbar"><span><Layers3 size={14} /> Current contribution / {time}%</span><button className="ghost-button" onClick={onToggleGhost}>{ghostOn ? 'Baseline visible' : 'Show baseline'}</button></div>
            <div className="analysis-grid-canvas"><OccupancyGridView values={blended} pose={pose} ghostValues={ghostOn ? baselineGrid : undefined} /></div>
            <TimeMachineSlider value={time} onChange={setTime} />
          </PanelBody>
        </Panel>
        <DiffHeatmap values={diffGrid} zones={diffZones} />
      </div>
      <div className="analysis-bottom">
        <Panel title="Run pair" code="BASELINE / CURRENT">
          <PanelBody className="side-by-side">
            <div><span>Baseline</span><strong>MAZE-ALPHA</strong><small>Healthy reference / 1,901 points</small><OccupancyGridView values={baselineGrid} mode="baseline" compact /></div>
            <div><span>Current</span><strong>EM-0427-VR</strong><small>Verification capture / 1,842 points</small><OccupancyGridView values={currentGrid} mode="current" compact /></div>
          </PanelBody>
        </Panel>
        <Panel title="Evidence reading" code="MODEL NOTES">
          <PanelBody className="interpretation">
            <div><i className="interpretation-icon cyan">01</i><p><strong>Geometry leads.</strong> East-wall displacement is the strongest signal.</p></div>
            <div><i className="interpretation-icon violet">02</i><p><strong>Vibration corroborates.</strong> A high-energy window supports the spatial change.</p></div>
            <div><i className="interpretation-icon amber">03</i><p><strong>Human review remains final.</strong> Anomaly detection is an early-warning aid.</p></div>
          </PanelBody>
        </Panel>
      </div>
      <div className="footer-strip"><span><Check size={13} /> Fusion ready</span><span>Diff threshold / 0.35</span><span>FFT window / 2.0 sec</span></div>
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
  const [packetCount, setPacketCount] = useState(1842);
  const [ghostOn, setGhostOn] = useState(true);
  const [frame, setFrame] = useState(0);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>('reproduction');

  useEffect(() => {
    const unsubscribeStatus = socket.onStatus(setConnection);
    const unsubscribeTelemetry = socket.onTelemetry((message) => {
      setLiveTelemetry(parseLiveTelemetry(message));
      setPacketCount((count) => count + 1);
    });
    return () => { unsubscribeStatus(); unsubscribeTelemetry(); };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setFrame((value) => value + 1), 1200);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (state !== 'LEARNING' && state !== 'VERIFYING') return;
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

  const command = (next: 'learn' | 'verify' | 'stop' | 'reset') => {
    const delivered = socket.send(next);
    if (next === 'learn') { setState('LEARNING'); setProgress(14); setCommandNote(delivered ? 'Baseline command sent to rover' : 'Baseline capture staged locally'); }
    if (next === 'verify') { setState('VERIFYING'); setProgress(58); setCommandNote(delivered ? 'Verification command sent to rover' : 'Verification staged locally'); }
    if (next === 'stop') { setState('STOPPED'); setCommandNote('Run halted by operator'); }
    if (next === 'reset') { setState('IDLE'); setProgress(72); setCommandNote('Awaiting command'); }
  };
  const link = () => connection === 'connected' || connection === 'connecting' ? socket.disconnect() : socket.connect();
  const nav = [
    { view: 'overview' as View, icon: Gauge, label: 'Field overview' },
    { view: 'telemetry' as View, icon: Radio, label: 'Telemetry' },
    { view: 'analysis' as View, icon: Layers3, label: 'Spatial comparison' },
    { view: 'report' as View, icon: FileCheck2, label: 'Inspection record' },
  ];
  const titles: Record<View, [string, string]> = {
    overview: ['Field overview', 'Live structural verification'],
    telemetry: ['Telemetry', 'Receiver frames and sensor integrity'],
    analysis: ['Spatial comparison', 'Baseline geometry against the current run'],
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
          <MissionStrip connection={connection} packetCount={packetCount} state={state} />
          {view === 'overview' && <Overview state={state} progress={progress} connected={connection === 'connected'} liveTelemetry={liveTelemetry} packetCount={packetCount} onCommand={command} onView={setView} ghostOn={ghostOn} onToggleGhost={() => setGhostOn((value) => !value)} frame={frame} />}
          {view === 'telemetry' && <TelemetryWorkspace connected={connection === 'connected'} liveTelemetry={liveTelemetry} packetCount={packetCount} frame={frame} />}
          {view === 'analysis' && <Analysis ghostOn={ghostOn} onToggleGhost={() => setGhostOn((value) => !value)} />}
          {view === 'report' && <FinalReport metadata={runMetadata} scores={scores} onExport={() => setCommandNote('Report staged for export')} />}
        </main>
      </div>
      {noticeOpen && <div className="modal-shade"><div className="privacy-modal" role="dialog" aria-labelledby="privacy-title"><h2 id="privacy-title">Connection boundary</h2><p>The console can run with deterministic replay data or connect to the laptop receiver at <code>{DEFAULT_TELEMETRY_URL}</code>. Raw telemetry remains in the local Echo-Maze workspace.</p><button onClick={() => setNoticeOpen(false)}><Check size={13} /> Close notice</button></div></div>}
    </div>
  );
}
