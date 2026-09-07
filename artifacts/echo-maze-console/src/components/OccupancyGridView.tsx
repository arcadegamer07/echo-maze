import { useState } from 'react';
import type { CellMapMode, Pose } from '@/lib/demo-model';

export function OccupancyGridView({ values, mode = 'occupancy', columns = 16, rows = 10, pose, ghostValues, compact = false }: { values: number[]; mode?: CellMapMode; columns?: number; rows?: number; pose?: Pose; ghostValues?: number[]; compact?: boolean }) {
  const [focused, setFocused] = useState<number | null>(null);
  const getColor = (value: number) => {
    if (mode === 'diff') return `rgba(255, ${Math.round(198 - value * 140)}, ${Math.round(110 - value * 90)}, ${Math.min(.98, .22 + value * .86)})`;
    return `rgba(${Math.round(52 + value * 170)}, ${Math.round(178 + value * 52)}, ${Math.round(203 + value * 42)}, ${Math.min(.98, .18 + value * .84)})`;
  };
  const roverCell = pose ? Math.min(values.length - 1, Math.max(0, Math.round(pose.y) * columns + Math.round(pose.x))) : -1;
  return (
    <div className={`grid-viz-shell ${compact ? 'compact' : ''}`}>
      {ghostValues && <div className="occupancy-grid ghost-grid" style={{ gridTemplateColumns: `repeat(${columns}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }}>{ghostValues.map((value, index) => <span key={index} style={{ backgroundColor: getColor(value) }} />)}</div>}
      <div className={`occupancy-grid ${mode === 'diff' ? 'diff-grid' : ''}`} style={{ gridTemplateColumns: `repeat(${columns}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }} role="grid" aria-label={`${mode} occupancy grid`}>
        {values.map((value, index) => <span key={index} className={`${focused === index ? 'is-focused' : ''} ${roverCell === index ? 'rover-cell' : ''}`} style={{ backgroundColor: getColor(value) }} onMouseEnter={() => setFocused(index)} onMouseLeave={() => setFocused(null)} tabIndex={0} role="gridcell" aria-label={`cell ${index + 1}, value ${Math.round(value * 100)} percent`} />)}
      </div>
      {focused !== null && <div className="grid-tooltip"><strong>GRID {String.fromCharCode(65 + Math.floor((focused % columns) / 4))}{Math.floor(focused / columns) + 1}</strong><span>{mode.toUpperCase()} · {Math.round(values[focused] * 100)}%</span></div>}
    </div>
  );
}
