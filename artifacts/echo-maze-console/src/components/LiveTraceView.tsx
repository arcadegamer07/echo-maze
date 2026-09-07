import { Activity, AlertTriangle, Crosshair, Gauge, MapPin, Radio, Ruler } from 'lucide-react';
import { DashboardPanel, PanelBody } from './DashboardPanel';
import { LiveConfidenceMatrix } from './LiveConfidenceMatrix';
import {
  LIVE_MAPPING_CONFIG,
  poseHeadingDeg,
  type LiveMapState,
  type LiveRangePoint,
} from '@/lib/live-mapping';

const WIDTH = 620;
const HEIGHT = 330;
const PAD = 32;

function metres(valueCm: number) {
  return `${(valueCm / 100).toFixed(2)} m`;
}

function TraceMap({ state }: { state: LiveMapState }) {
  const coordinates = [
    ...state.path.map((point) => [point.xCm, point.yCm] as const),
    ...state.returns.flatMap((point) => [[point.xCm, point.yCm] as const, [point.originXcm, point.originYcm] as const]),
    [0, 0] as const,
  ];
  const rawMinX = Math.min(...coordinates.map(([x]) => x));
  const rawMaxX = Math.max(...coordinates.map(([x]) => x));
  const rawMinY = Math.min(...coordinates.map(([, y]) => y));
  const rawMaxY = Math.max(...coordinates.map(([, y]) => y));
  const minX = rawMinX - 40;
  const maxX = rawMaxX + 40;
  const minY = rawMinY - 40;
  const maxY = rawMaxY + 40;
  const spanX = Math.max(100, maxX - minX);
  const spanY = Math.max(100, maxY - minY);
  const scale = Math.min((WIDTH - PAD * 2) / spanX, (HEIGHT - PAD * 2) / spanY);
  const mapWidth = spanX * scale;
  const mapHeight = spanY * scale;
  const offsetX = (WIDTH - mapWidth) / 2;
  const offsetY = (HEIGHT - mapHeight) / 2;
  const project = (xCm: number, yCm: number): [number, number] => [
    offsetX + (xCm - minX) * scale,
    HEIGHT - offsetY - (yCm - minY) * scale,
  ];
  const pathPoints = state.path.map((point) => project(point.xCm, point.yCm).join(',')).join(' ');
  const rover = project(state.pose.xCm, state.pose.yCm);
  const gridLines = Array.from({ length: 7 }, (_, index) => index / 6);
  const visibleReturns = state.returns.slice(-180);
  return (
    <svg className="live-trace-map" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="Live rover movement and ultrasonic returns">
      <rect width={WIDTH} height={HEIGHT} fill="var(--map-field)" />
      <g className="trace-grid-lines">
        {gridLines.map((ratio) => {
          const x = offsetX + mapWidth * ratio;
          const y = offsetY + mapHeight * ratio;
          return <g key={ratio}><line x1={x} y1={offsetY} x2={x} y2={HEIGHT - offsetY} /><line x1={offsetX} y1={HEIGHT - y} x2={WIDTH - offsetX} y2={HEIGHT - y} /></g>;
        })}
      </g>
      <text className="trace-axis-label" x={offsetX + 4} y={HEIGHT - 10}>X / WORLD CM</text>
      <text className="trace-axis-label" x={WIDTH - 88} y={HEIGHT - 10}>Y ↑</text>
      {visibleReturns.map((point: LiveRangePoint, index) => {
        const [x, y] = project(point.xCm, point.yCm);
        const [originX, originY] = project(point.originXcm, point.originYcm);
        return <g key={`${point.timestamp}-${index}`}>
          <line className="trace-ray" x1={originX} y1={originY} x2={x} y2={y} />
          <circle className="trace-return" cx={x} cy={y} r={index % 6 === 0 ? 3 : 2} opacity={.32 + (index / Math.max(1, visibleReturns.length)) * .58} />
        </g>;
      })}
      {state.path.length > 1 && <polyline className="trace-path" points={pathPoints} />}
      <circle className="trace-start" cx={project(0, 0)[0]} cy={project(0, 0)[1]} r="4" />
      <g className="trace-rover" transform={`translate(${rover[0]} ${rover[1]}) rotate(${-poseHeadingDeg(state.pose)})`}>
        <circle r="13" />
        <path d="M 12 0 L -8 -7 L -4 0 L -8 7 Z" />
        <line x1="14" y1="0" x2="28" y2="0" />
      </g>
      {state.latest && <g className="trace-cursor" transform={`translate(${rover[0]} ${rover[1]})`}>
        <text x="16" y="-16">{state.latest.mode.toUpperCase()} / {state.latest.timestamp} ms</text>
      </g>}
      {!state.latest && <text className="trace-empty" x={WIDTH / 2} y={HEIGHT / 2}>WAITING FOR LIVE PACKETS</text>}
    </svg>
  );
}

export function LiveTraceView({ state, connected }: { state: LiveMapState; connected: boolean }) {
  const latest = state.latest;
  const motion = latest
    ? Math.abs(latest.leftSpeed) < 1 && Math.abs(latest.rightSpeed) < 1
      ? 'stationary'
      : latest.leftSpeed > 0 && latest.rightSpeed > 0
        ? 'forward'
        : latest.leftSpeed < 0 && latest.rightSpeed < 0
          ? 'reverse'
          : 'turning'
    : 'awaiting';
  return (
    <DashboardPanel title="Live movement + range map" code={connected ? 'ESP32 / LIVE' : 'WAITING FOR BUS'} className="live-trace-panel">
      <PanelBody className="live-trace-body">
        <div className="live-trace-toolbar">
          <span className="status-chip"><i className={connected ? '' : 'is-muted'} />{connected ? 'Plotting received packets' : 'Connect receiver to plot'}</span>
          <span className="trace-method"><Activity size={13} /> command odometry / {LIVE_MAPPING_CONFIG.speedScaleCmPerSecondPerPwm.toFixed(2)} cm·s⁻¹·PWM⁻¹</span>
          <span className="trace-method"><Crosshair size={13} /> {latest?.mode === 'test' ? '90° forward safety scan' : `${LIVE_MAPPING_CONFIG.scanStartDeg}–${LIVE_MAPPING_CONFIG.scanEndDeg}° sweep / 90° forward`}</span>
        </div>
        <div className="trace-integrity-banner">
          <AlertTriangle size={14} />
          <span><strong>POSITION IS ESTIMATED</strong> Motor PWM tells us what was requested, not whether the wheels actually moved. Add wheel encoders (or visual odometry) before treating this path as ground truth.</span>
        </div>
        <div className="live-trace-layout">
          <div className="live-trace-canvas"><TraceMap state={state} /></div>
          <div className="live-trace-data">
            <div className="trace-data-heading"><MapPin size={14} /> Packet cursor</div>
            <div className="trace-metric"><span>Rover pose</span><strong>{metres(state.pose.xCm)} / {metres(state.pose.yCm)}</strong><small>{poseHeadingDeg(state.pose).toFixed(1)}° heading</small></div>
            <div className="trace-metric"><span>Requested movement</span><strong>{motion.toUpperCase()}</strong><small>{latest ? `${latest.leftSpeed.toFixed(0)} / ${latest.rightSpeed.toFixed(0)} PWM · command only` : 'No command yet'}</small></div>
            <div className="trace-metric"><span>Ultrasonic return</span><strong>{latest?.distanceCm === null || latest?.distanceCm === undefined ? 'NO RETURN' : `${latest.distanceCm.toFixed(1)} cm`}</strong><small>{latest ? `servo ${latest.angleDeg.toFixed(0)}°` : '—'}</small></div>
            <div className="trace-metric"><span>Environment</span><strong>{latest?.temperatureC === null || latest?.temperatureC === undefined ? '—' : `${latest.temperatureC.toFixed(1)} °C`}</strong><small>IR {latest?.ir === null || latest?.ir === undefined ? '—' : latest.ir.toFixed(0)}</small></div>
            <div className="trace-metric"><span>Trace health</span><strong>{(state.pose.confidence * 100).toFixed(1)}%</strong><small>{state.packetCount} packets / {metres(state.totalDistanceCm)} travelled</small></div>
            <div className="trace-note"><Gauge size={14} /><span>Dots are real ultrasonic returns. The line is command-based dead reckoning; if the rover stalls, slips, or is lifted, telemetry can still look “forward” while the true position stays still.</span></div>
          </div>
        </div>
        <div className="live-trace-legend"><span><i className="trace-legend-path" /> MOVEMENT PATH</span><span><i className="trace-legend-return" /> ULTRASONIC HIT</span><span><i className="trace-legend-start" /> START</span><span><Ruler size={12} /> AUTO-FIT WORLD FRAME</span><Radio size={12} />{state.runId ?? 'no run selected'}</div>
        <LiveConfidenceMatrix state={state} />
      </PanelBody>
    </DashboardPanel>
  );
}
