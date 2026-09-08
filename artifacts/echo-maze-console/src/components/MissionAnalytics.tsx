import { Activity, BarChart3, Gauge, Thermometer } from 'lucide-react';
import type { LiveMapState } from '@/lib/live-mapping';
import { DashboardPanel, PanelBody } from './DashboardPanel';

export type TelemetryTrendSample = {
  timestamp: number;
  distanceCm: number | null;
  temperatureC: number | null;
  leftSpeed: number;
  rightSpeed: number;
};

const WIDTH = 580;
const HEIGHT = 92;
const PAD_X = 7;
const PAD_Y = 12;

function finiteValues(values: Array<number | null>) {
  return values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
}

function Trend({ label, values, color, suffix }: { label: string; values: Array<number | null>; color: string; suffix: string }) {
  const numeric = finiteValues(values);
  if (numeric.length < 2) {
    return <div className="mission-trend empty"><div><span>{label}</span><strong>Awaiting live samples</strong></div><small>Telemetry history builds while the rover is running.</small></div>;
  }
  const min = Math.min(...numeric);
  const max = Math.max(...numeric);
  const span = Math.max(1, max - min);
  const points = values.map((value, index) => {
    const x = PAD_X + index / Math.max(1, values.length - 1) * (WIDTH - PAD_X * 2);
    const y = typeof value === 'number'
      ? HEIGHT - PAD_Y - (value - min) / span * (HEIGHT - PAD_Y * 2)
      : null;
    return y === null ? null : `${x.toFixed(1)},${y.toFixed(1)}`;
  }).filter((point): point is string => point !== null).join(' ');
  const latest = numeric[numeric.length - 1];
  return <div className="mission-trend">
    <div className="mission-trend-head"><span>{label}</span><strong>{latest.toFixed(1)}{suffix}</strong><small>{min.toFixed(1)}–{max.toFixed(1)}{suffix}</small></div>
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={`${label} telemetry trend`}>
      {[.25, .5, .75].map((ratio) => <line key={ratio} className="mission-trend-grid" x1="0" x2={WIDTH} y1={HEIGHT * ratio} y2={HEIGHT * ratio} />)}
      <polyline points={points} fill="none" stroke={color} strokeWidth="2.2" vectorEffect="non-scaling-stroke" />
    </svg>
  </div>;
}

export function MissionAnalytics({ samples, liveMap }: { samples: TelemetryTrendSample[]; liveMap: LiveMapState }) {
  const visible = samples.slice(-120);
  const averagePwm = visible.length
    ? visible.reduce((sum, sample) => sum + (Math.abs(sample.leftSpeed) + Math.abs(sample.rightSpeed)) / 2, 0) / visible.length
    : 0;
  return (
    <DashboardPanel title="Mission analytics" code="LIVE TRENDS / FIELD EVIDENCE" className="mission-analytics-panel">
      <PanelBody className="mission-analytics-body">
        <div className="mission-analytics-summary">
          <div><Gauge size={14} /><span>AVERAGE DRIVE</span><strong>{averagePwm.toFixed(0)} PWM</strong></div>
          <div><Activity size={14} /><span>RANGE FRAMES</span><strong>{liveMap.returns.length}</strong></div>
          <div><BarChart3 size={14} /><span>DANGER ZONES</span><strong>{liveMap.dangerCount}</strong></div>
          <div><Thermometer size={14} /><span>MAP CONFIDENCE</span><strong>{liveMap.mapConfidence.toFixed(1)}%</strong></div>
        </div>
        <div className="mission-trends-grid">
          <Trend label="ULTRASONIC RANGE" values={visible.map((sample) => sample.distanceCm)} color="var(--accent)" suffix=" cm" />
          <Trend label="MOTOR COMMAND" values={visible.map((sample) => (sample.leftSpeed + sample.rightSpeed) / 2)} color="var(--signal)" suffix=" PWM" />
          <Trend label="TEMPERATURE" values={visible.map((sample) => sample.temperatureC)} color="var(--amber)" suffix="°C" />
        </div>
        <div className="mission-analytics-note">Trends are raw received telemetry. They explain what the rover sensed and was commanded to do; they do not prove physical wheel motion without encoders.</div>
      </PanelBody>
    </DashboardPanel>
  );
}
