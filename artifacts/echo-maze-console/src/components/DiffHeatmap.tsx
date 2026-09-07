import { Flame, MapPin } from 'lucide-react';
import { DashboardPanel, PanelBody } from './DashboardPanel';
import type { DiffZone } from '@/lib/demo-model';
import { OccupancyGridView } from './OccupancyGridView';

export function DiffHeatmap({ values, zones }: { values: number[]; zones: DiffZone[] }) {
  return <DashboardPanel title="Diff heatmap" code="Δ OCCUPANCY"><PanelBody className="diff-panel-body"><div className="diff-intro"><span><Flame size={14} /> CHANGE INTENSITY</span><span>LOW → HIGH</span></div><OccupancyGridView values={values} mode="diff" compact /><div className="heat-legend"><span>LOW</span><div className="heat-gradient" /><span>HIGH</span></div><div className="critical-zone-list">{zones.map((zone) => <div className="critical-zone" key={zone.id}><div><MapPin size={12} /><strong>{zone.id}</strong><small>{zone.severity}</small></div><span>{zone.label}<b>{zone.delta}</b></span></div>)}</div></PanelBody></DashboardPanel>;
}
