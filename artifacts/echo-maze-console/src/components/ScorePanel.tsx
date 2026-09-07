import { Activity, ArrowUpRight, ShieldAlert } from 'lucide-react';
import { DashboardPanel, PanelBody } from './DashboardPanel';
import type { ScoreSet } from '@/lib/demo-model';

export function ScorePanel({ scores }: { scores: ScoreSet }) {
  const rows: Array<[string, number, string]> = [['GEOMETRY', scores.geometry, '#5ce4ea'], ['TILT', scores.tilt, '#bba7ff'], ['VIBRATION', scores.vibration, '#ffd166'], ['THERMAL', scores.thermal, '#ff8f8c']];
  const severity = scores.total >= 65 ? 'HIGH' : scores.total >= 35 ? 'MODERATE' : 'LOW';
  return <DashboardPanel title="Structural anomaly" code="WEIGHTED EVIDENCE"><PanelBody><div className="score-intro"><span><Activity size={13} /> MULTI-SENSOR FUSION</span><span className="score-health"><i /> MODEL HEALTHY</span></div><div className="score-list">{rows.map(([label, value, color]) => <div className="score-row" key={label}><span className="score-label">{label}</span><div className="score-track"><div className="score-bar" style={{ width: `${Math.min(100, value * 2.5)}%`, backgroundColor: color }} /></div><span className="score-number">{value}</span></div>)}</div><div className="score-summary"><div><div className="score-total">{scores.total}</div><div className="zones">COMBINED CHANGE SCORE / 100</div></div><div className={`severity severity-${severity.toLowerCase()}`}><ShieldAlert size={13} /> {severity}<small>2 ZONES FLAGGED <ArrowUpRight size={11} /></small></div></div></PanelBody></DashboardPanel>;
}
