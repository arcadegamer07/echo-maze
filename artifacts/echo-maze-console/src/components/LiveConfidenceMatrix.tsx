import type { LiveMapState } from '@/lib/live-mapping';

function cellColour(probability: number | undefined) {
  if (probability === undefined) return 'rgba(240, 235, 219, .035)';
  const certainty = Math.min(1, Math.abs(probability - .5) * 2);
  if (probability >= .5) return `rgba(255, 118, 84, ${.16 + certainty * .7})`;
  return `rgba(126, 240, 190, ${.10 + certainty * .58})`;
}

export function LiveConfidenceMatrix({ state }: { state: LiveMapState }) {
  const { minX, maxX, minY, maxY } = state.occupancyBounds;
  const columns = Math.max(1, maxX - minX + 1);
  const rows = Math.max(1, maxY - minY + 1);
  const poseX = Math.floor(state.pose.xCm / 10) - minX + 1;
  const poseY = maxY - Math.floor(state.pose.yCm / 10) + 1;
  const cells = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const cellX = minX + column;
      const cellY = maxY - row;
      const probability = state.occupancy[`${cellX},${cellY}`];
      const isRover = column + 1 === poseX && row + 1 === poseY;
      cells.push(
        <div
          key={`${cellX},${cellY}`}
          className={`confidence-cell${isRover ? ' rover-cell' : ''}`}
          style={{ background: cellColour(probability) }}
          title={`${cellX * 10}, ${cellY * 10} cm${probability === undefined ? ' / unexplored' : ` / occupied ${(probability * 100).toFixed(0)}%`}`}
        >
          {isRover && <span />}
        </div>,
      );
    }
  }
  return (
    <div className="confidence-matrix-panel">
      <div className="confidence-matrix-heading">
        <div><span>LIVE OCCUPANCY / 10 CM CELLS</span><strong>Position + confidence matrix</strong></div>
        <div className="confidence-score"><b>{state.mapConfidence.toFixed(1)}%</b><small>map confidence</small></div>
      </div>
      <div className="confidence-matrix-wrap">
        <div
          className="confidence-matrix"
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(8px, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(8px, 1fr))` }}
          aria-label="Live occupancy confidence matrix"
        >
          {cells}
        </div>
      </div>
      <div className="confidence-matrix-legend">
        <span><i className="free" /> FREE / LOW OCCUPANCY</span>
        <span><i className="unknown" /> UNKNOWN</span>
        <span><i className="occupied" /> RANGE HIT</span>
        <em>● rover position / command-estimated</em>
      </div>
    </div>
  );
}
