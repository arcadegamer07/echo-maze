import { Activity, ArrowUpRight } from 'lucide-react';
import { DashboardPanel, PanelBody } from './DashboardPanel';
import type { ScoreSet } from '@/lib/demo-model';

export function ScorePanel({ scores }: { scores: ScoreSet }) {
  const rows: Array<[string, number]> = [['Geometry', scores.geometry], ['Tilt', scores.tilt], ['Vibration', scores.vibration], ['Thermal', scores.thermal]];
  const severity = scores.total >= 65 ? 'HIGH' : scores.total >= 35 ? 'MODERATE' : 'LOW';
  const circumference = 2 * Math.PI * 43;
  return <DashboardPanel title="Structural change" code="FUSED EVIDENCE"><PanelBody><div className="score-intro"><span><Activity size={14} /> Isolation Forest / v1</span><span className="score-health"><i /> ready</span></div><div className="score-hero"><div className="score-dial"><svg viewBox="0 0 100 100" aria-hidden="true"><circle className="score-dial-track" cx="50" cy="50" r="43" /><circle className="score-dial-value" cx="50" cy="50" r="43" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - scores.total / 100)} /></svg><div><strong>{scores.total}</strong><span>/ 100</span></div></div><div className="score-list">{rows.map(([label, value]) => <div className="score-row" key={label}><span className="score-label">{label}</span><div className="score-track"><div className="score-bar" style={{ width: `${Math.min(100, value)}%` }} /></div><span className="score-number">{value}</span></div>)}</div></div><div className="score-summary"><div><span>Decision</span><strong className={`severity severity-${severity.toLowerCase()}`}>{severity}</strong></div><button type="button">2 zones require review <ArrowUpRight size={14} /></button></div></PanelBody></DashboardPanel>;
}
