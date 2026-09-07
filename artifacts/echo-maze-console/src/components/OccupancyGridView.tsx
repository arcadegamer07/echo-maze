import { useId, useState } from 'react';
import type { CellMapMode, Pose } from '@/lib/demo-model';

export function OccupancyGridView({ values, mode = 'occupancy', columns = 16, rows = 10, pose, ghostValues, compact = false }: { values: number[]; mode?: CellMapMode; columns?: number; rows?: number; pose?: Pose; ghostValues?: number[]; compact?: boolean }) {
  const [focused, setFocused] = useState<number | null>(null);
  const patternId = useId().replace(/:/g, '');
  const width = columns * 32;
  const height = rows * 32;
  const cellWidth = width / columns;
  const cellHeight = height / rows;
  const roverCell = pose ? Math.min(values.length - 1, Math.max(0, Math.round(pose.y) * columns + Math.round(pose.x))) : -1;
  const roverX = pose ? ((roverCell % columns) + .5) * cellWidth : 0;
  const roverY = pose ? (Math.floor(roverCell / columns) + .5) * cellHeight : 0;
  const occupancyFill = (value: number) => {
    if (mode === 'diff') return value > .65 ? '#ff6847' : value > .28 ? '#f3b83e' : '#6f897b';
    return value > .62 ? '#dbe2d8' : value > .42 ? '#66706a' : '#17201d';
  };
  const occupancyOpacity = (value: number) => mode === 'diff' ? Math.max(.08, value) : value > .62 ? Math.min(1, .52 + value * .55) : Math.max(.08, value * .34);
  return (
    <div className={`grid-viz-shell ${compact ? 'compact' : ''}`}>
      <svg className={`occupancy-grid ${mode === 'diff' ? 'diff-grid' : ''}`} viewBox={`0 0 ${width} ${height}`} role="grid" aria-label={`${mode} occupancy grid`}>
        <defs>
          <pattern id={`minor-${patternId}`} width={cellWidth} height={cellHeight} patternUnits="userSpaceOnUse"><path d={`M ${cellWidth} 0 L 0 0 0 ${cellHeight}`} fill="none" stroke="rgba(214,229,218,.09)" strokeWidth="1" /></pattern>
          <pattern id={`major-${patternId}`} width={cellWidth * 4} height={cellHeight * 4} patternUnits="userSpaceOnUse"><rect width={cellWidth * 4} height={cellHeight * 4} fill="none" stroke="rgba(214,229,218,.13)" strokeWidth="1" /></pattern>
        </defs>
        <rect width={width} height={height} fill="#0b100e" />
        <rect width={width} height={height} fill={`url(#minor-${patternId})`} />
        <rect width={width} height={height} fill={`url(#major-${patternId})`} />
        {ghostValues?.map((value, index) => value > .56 ? <rect key={`ghost-${index}`} className="ghost-cell" x={(index % columns) * cellWidth + 3} y={Math.floor(index / columns) * cellHeight + 3} width={cellWidth - 6} height={cellHeight - 6} fill="none" stroke="#8a9a90" strokeDasharray="4 3" opacity={Math.min(.55, value * .52)} /> : null)}
        {values.map((value, index) => <rect key={index} x={(index % columns) * cellWidth + 2} y={Math.floor(index / columns) * cellHeight + 2} width={cellWidth - 4} height={cellHeight - 4} rx="1.5" fill={occupancyFill(value)} opacity={occupancyOpacity(value)} className={`${focused === index ? 'is-focused' : ''} ${roverCell === index ? 'rover-cell' : ''}`} onMouseEnter={() => setFocused(index)} onMouseLeave={() => setFocused(null)} onFocus={() => setFocused(index)} onBlur={() => setFocused(null)} tabIndex={0} role="gridcell" aria-label={`cell ${index + 1}, value ${Math.round(value * 100)} percent`} />)}
        {pose && !compact && <g className="map-route"><path d={`M ${cellWidth * 1.2} ${height - cellHeight * 1.25} C ${cellWidth * 3.5} ${height - cellHeight * 1.2}, ${cellWidth * 5.2} ${height - cellHeight * 3.5}, ${cellWidth * 7.4} ${height - cellHeight * 3.7} S ${cellWidth * 10.2} ${cellHeight * 2.1}, ${roverX} ${roverY}`} /><circle cx={cellWidth * 1.2} cy={height - cellHeight * 1.25} r="4" /></g>}
        {pose && <g className="map-rover" transform={`translate(${roverX} ${roverY}) rotate(${pose.heading})`}><circle r="13" /><path d="M 11 0 L -7 -7 L -3 0 L -7 7 Z" /><line x1="13" y1="0" x2="27" y2="0" /></g>}
        {!compact && <g className="map-coordinate-labels"><text x="10" y="19">N 03.4</text><text x={width - 72} y={height - 10}>E 05.2</text><path d={`M ${width - 24} 24 v 28 M ${width - 24} 24 l -5 9 M ${width - 24} 24 l 5 9`} /><text x={width - 29} y="67">N</text></g>}
      </svg>
      {focused !== null && <div className="grid-tooltip"><strong>GRID {String.fromCharCode(65 + Math.floor((focused % columns) / 4))}{Math.floor(focused / columns) + 1}</strong><span>{mode.toUpperCase()} · {Math.round(values[focused] * 100)}%</span></div>}
      {!compact && <div className="map-scale"><span /> 1 metre</div>}
    </div>
  );
}
