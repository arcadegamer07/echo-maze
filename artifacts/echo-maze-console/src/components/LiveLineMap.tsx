import { LIVE_MAPPING_CONFIG, poseHeadingDeg, type LiveMapState } from '@/lib/live-mapping';

const WIDTH = 780;
const HEIGHT = 430;
const PAD = 48;

function cellCentre(key: string) {
  const [x, y] = key.split(',').map(Number);
  return {
    x: (x + 0.5) * LIVE_MAPPING_CONFIG.cellSizeCm,
    y: (y + 0.5) * LIVE_MAPPING_CONFIG.cellSizeCm,
  };
}

/** A continuous world-frame map: path, scan rays, and red hazard points. */
export function LiveLineMap({ state }: { state: LiveMapState }) {
  const dangerPoints = Object.entries(state.dangerCells).map(([key, evidence]) => ({
    ...cellCentre(key),
    key,
  }));
  const visibleReturns = state.returns.slice(-260);
  const coordinates = [
    ...state.path.map((point) => [point.xCm, point.yCm] as const),
    ...visibleReturns.flatMap((point) => [[point.xCm, point.yCm] as const, [point.originXcm, point.originYcm] as const]),
    ...dangerPoints.map((point) => [point.x, point.y] as const),
    [0, 0] as const,
  ];
  const minWorldX = Math.min(...coordinates.map(([x]) => x)) - 35;
  const maxWorldX = Math.max(...coordinates.map(([x]) => x)) + 35;
  const minWorldY = Math.min(...coordinates.map(([, y]) => y)) - 35;
  const maxWorldY = Math.max(...coordinates.map(([, y]) => y)) + 35;
  const spanX = Math.max(120, maxWorldX - minWorldX);
  const spanY = Math.max(100, maxWorldY - minWorldY);
  const scale = Math.min((WIDTH - PAD * 2) / spanX, (HEIGHT - PAD * 2) / spanY);
  const mapWidth = spanX * scale;
  const mapHeight = spanY * scale;
  const offsetX = (WIDTH - mapWidth) / 2;
  const offsetY = (HEIGHT - mapHeight) / 2;
  const project = (x: number, y: number): [number, number] => [
    offsetX + (x - minWorldX) * scale,
    HEIGHT - offsetY - (y - minWorldY) * scale,
  ];
  const pathPoints = state.path.map((point) => project(point.xCm, point.yCm).join(',')).join(' ');
  const rover = project(state.pose.xCm, state.pose.yCm);
  const gridLines = Array.from({ length: 9 }, (_, index) => index / 8);

  return (
    <div className="live-line-map-shell">
      <svg className="live-line-map" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="Live movement line map with ultrasonic scan rays and danger markers">
        <rect width={WIDTH} height={HEIGHT} fill="var(--map-field)" />
        <g className="line-map-grid">
          {gridLines.map((ratio) => {
            const x = offsetX + mapWidth * ratio;
            const y = offsetY + mapHeight * ratio;
            return <g key={ratio}><line x1={x} y1={offsetY} x2={x} y2={HEIGHT - offsetY} /><line x1={offsetX} y1={HEIGHT - y} x2={WIDTH - offsetX} y2={HEIGHT - y} /></g>;
          })}
        </g>
        <text className="line-map-axis" x={offsetX + 4} y={HEIGHT - 13}>X / WORLD CM</text>
        <text className="line-map-axis" x={WIDTH - 82} y={HEIGHT - 13}>Y ↑</text>
        {visibleReturns.map((point, index) => {
          const [x, y] = project(point.xCm, point.yCm);
          const [originX, originY] = project(point.originXcm, point.originYcm);
          return <g key={`${point.timestamp}-${index}`}>
            <line className={point.danger ? 'line-map-ray danger' : 'line-map-ray'} x1={originX} y1={originY} x2={x} y2={y} />
            <circle className={point.danger ? 'line-map-hit danger' : 'line-map-hit'} cx={x} cy={y} r={point.danger ? 4.5 : 2.4} />
          </g>;
        })}
        {dangerPoints.map((point) => {
          const [x, y] = project(point.x, point.y);
          return <g key={`danger-${point.key}`}>
            <circle className="line-map-danger-zone" cx={x} cy={y} r="10" />
            <path className="line-map-danger-cross" d={`M ${x - 5} ${y - 5} L ${x + 5} ${y + 5} M ${x + 5} ${y - 5} L ${x - 5} ${y + 5}`} />
          </g>;
        })}
        {state.path.length > 1 && <polyline className="line-map-path" points={pathPoints} />}
        <circle className="line-map-start" cx={project(0, 0)[0]} cy={project(0, 0)[1]} r="4" />
        <g className="line-map-rover" transform={`translate(${rover[0]} ${rover[1]}) rotate(${-poseHeadingDeg(state.pose)})`}>
          <circle r="14" />
          <path d="M 13 0 L -8 -7 L -4 0 L -8 7 Z" />
          <line x1="15" y1="0" x2="27" y2="0" />
        </g>
        {!state.latest && <text className="line-map-empty" x={WIDTH / 2} y={HEIGHT / 2}>WAITING FOR LIVE PACKETS</text>}
      </svg>
      <div className="line-map-footer">
        <span><i className="line-map-key path" /> MOVEMENT TRACE</span>
        <span><i className="line-map-key ray" /> RANGE RAY</span>
        <span><i className="line-map-key danger" /> DANGER / STOP OR REVERSE</span>
        <strong>{state.dangerCount} red zones · {state.mapConfidence.toFixed(1)}% confidence</strong>
      </div>
    </div>
  );
}
