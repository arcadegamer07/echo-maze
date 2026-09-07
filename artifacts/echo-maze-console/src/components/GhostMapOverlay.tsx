import { Eye, EyeOff } from 'lucide-react';
import type { Pose } from '@/lib/demo-model';
import { OccupancyGridView } from './OccupancyGridView';

export function GhostMapOverlay({ baseline, current, pose, enabled, onToggle, interpolation = 1 }: { baseline: number[]; current: number[]; pose: Pose; enabled: boolean; onToggle: () => void; interpolation?: number }) {
  const blended = current.map((value, index) => baseline[index] * (1 - interpolation) + value * interpolation);
  return <div className="ghost-map"><div className="ghost-map-toolbar"><span><i className="legend-swatch legend-ghost" /> baseline ghost layer</span><button onClick={onToggle}>{enabled ? <Eye size={13} /> : <EyeOff size={13} />} {enabled ? 'HIDE GHOST' : 'SHOW GHOST'}</button></div><OccupancyGridView values={blended} pose={pose} ghostValues={enabled ? baseline : undefined} /><div className="ghost-map-legend"><span><i className="legend-swatch current-swatch" /> CURRENT</span><span><i className="legend-swatch legend-ghost" /> BASELINE</span><span><i className="legend-swatch rover-swatch" /> ROVER POSE</span></div></div>;
}
