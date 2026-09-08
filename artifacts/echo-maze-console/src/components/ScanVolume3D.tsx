import { useMemo, useState } from 'react';
import { LIVE_MAPPING_CONFIG, poseHeadingDeg, type LiveDangerCell, type LiveMapState, type LiveRangePoint } from '@/lib/live-mapping';

/**
 * An intentionally honest 2.5D view of the rover's range evidence.
 *
 * It is an isometric projection of the XY ground plane. It doesn't invent a
 * third axis from ultrasonic data: the vertical-looking perspective is a
 * visual aid only, not a height, depth, or 3D reconstruction claim.
 */

const VIEWBOX_WIDTH = 860;
const VIEWBOX_HEIGHT = 500;
const VIEW_PADDING = 48;

type Point = { x: number; y: number };

type Inspectable =
  | { kind: 'return'; point: LiveRangePoint }
  | { kind: 'danger'; point: Point; evidence: LiveDangerCell };

function cellCentre(key: string): Point {
  const [cellX, cellY] = key.split(',').map(Number);
  return {
    x: (cellX + .5) * LIVE_MAPPING_CONFIG.cellSizeCm,
    y: (cellY + .5) * LIVE_MAPPING_CONFIG.cellSizeCm,
  };
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function fmtDistance(value: number | null) {
  return value === null ? 'range not reported' : `${value.toFixed(1)} cm`;
}

function diamondPath(project: (x: number, y: number) => Point, x: number, y: number, halfSize: number) {
  const vertices = [
    project(x - halfSize, y),
    project(x, y + halfSize),
    project(x + halfSize, y),
    project(x, y - halfSize),
  ];
  return `M ${vertices.map((vertex) => `${vertex.x.toFixed(1)} ${vertex.y.toFixed(1)}`).join(' L ')} Z`;
}

/**
 * Drop-in visual for the live dashboard. `state` is the same command-odometry
 * map used by the other live panels, so no simulated or fabricated geometry is
 * introduced here.
 */
export function ScanVolume3D({ state }: { state: LiveMapState }) {
  const [selected, setSelected] = useState<Inspectable | null>(null);
  const visibleReturns = state.returns.slice(-300);
  const dangerPoints = useMemo(() => Object.entries(state.dangerCells).map(([key, evidence]) => ({
    key,
    ...cellCentre(key),
    evidence,
  })), [state.dangerCells]);

  const world = useMemo(() => {
    const coordinates = [
      ...state.path.map((point) => ({ x: point.xCm, y: point.yCm })),
      ...visibleReturns.flatMap((point) => [
        { x: point.originXcm, y: point.originYcm },
        { x: point.xCm, y: point.yCm },
      ]),
      ...dangerPoints.map((point) => ({ x: point.x, y: point.y })),
      { x: 0, y: 0 },
    ];
    const rawMinX = Math.min(...coordinates.map((point) => point.x));
    const rawMaxX = Math.max(...coordinates.map((point) => point.x));
    const rawMinY = Math.min(...coordinates.map((point) => point.y));
    const rawMaxY = Math.max(...coordinates.map((point) => point.y));
    const minX = rawMinX - 35;
    const maxX = rawMaxX + 35;
    const minY = rawMinY - 35;
    const maxY = rawMaxY + 35;
    const spanX = Math.max(100, maxX - minX);
    const spanY = Math.max(100, maxY - minY);
    const combinedSpan = spanX + spanY;
    const scale = Math.min(
      (VIEWBOX_WIDTH - VIEW_PADDING * 2) / (combinedSpan * .88),
      (VIEWBOX_HEIGHT - VIEW_PADDING * 2) / (combinedSpan * .46),
    );
    const centreX = (minX + maxX) / 2;
    const centreY = (minY + maxY) / 2;
    const project = (x: number, y: number): Point => ({
      x: VIEWBOX_WIDTH / 2 + (x - centreX - (y - centreY)) * scale * .88,
      y: VIEWBOX_HEIGHT / 2 - ((x - centreX) + (y - centreY)) * scale * .46,
    });
    return { minX, maxX, minY, maxY, scale, project };
  }, [state.path, visibleReturns, dangerPoints]);

  const { project } = world;
  const pathPoints = state.path.map((point) => {
    const projected = project(point.xCm, point.yCm);
    return `${projected.x.toFixed(1)},${projected.y.toFixed(1)}`;
  }).join(' ');
  const rover = project(state.pose.xCm, state.pose.yCm);
  const headingRad = state.pose.headingRad;
  const projectedHeading = project(
    state.pose.xCm + Math.cos(headingRad) * 15,
    state.pose.yCm + Math.sin(headingRad) * 15,
  );
  const roverAngle = Math.atan2(projectedHeading.y - rover.y, projectedHeading.x - rover.x) * 180 / Math.PI;
  const cellMinX = Math.floor(world.minX / LIVE_MAPPING_CONFIG.cellSizeCm) * LIVE_MAPPING_CONFIG.cellSizeCm;
  const cellMaxX = Math.ceil(world.maxX / LIVE_MAPPING_CONFIG.cellSizeCm) * LIVE_MAPPING_CONFIG.cellSizeCm;
  const cellMinY = Math.floor(world.minY / LIVE_MAPPING_CONFIG.cellSizeCm) * LIVE_MAPPING_CONFIG.cellSizeCm;
  const cellMaxY = Math.ceil(world.maxY / LIVE_MAPPING_CONFIG.cellSizeCm) * LIVE_MAPPING_CONFIG.cellSizeCm;
  const gridStepX = Math.max(1, Math.ceil((cellMaxX - cellMinX) / LIVE_MAPPING_CONFIG.cellSizeCm / 12));
  const gridStepY = Math.max(1, Math.ceil((cellMaxY - cellMinY) / LIVE_MAPPING_CONFIG.cellSizeCm / 12));
  const gridXs = Array.from({ length: Math.floor((cellMaxX - cellMinX) / LIVE_MAPPING_CONFIG.cellSizeCm / gridStepX) + 1 }, (_, index) => cellMinX + index * gridStepX * LIVE_MAPPING_CONFIG.cellSizeCm);
  const gridYs = Array.from({ length: Math.floor((cellMaxY - cellMinY) / LIVE_MAPPING_CONFIG.cellSizeCm / gridStepY) + 1 }, (_, index) => cellMinY + index * gridStepY * LIVE_MAPPING_CONFIG.cellSizeCm);
  const actualHeading = poseHeadingDeg(state.pose);
  const selectedMessage = selected?.kind === 'return'
    ? `Range return · ${fmtDistance(selected.point.distanceCm)} · servo ${selected.point.angleDeg.toFixed(0)}°${selected.point.danger ? ' · close-range danger' : ''}`
    : selected?.kind === 'danger'
      ? `Navigation danger · ${selected.evidence.reason.replace('-', ' ')} · ${fmtDistance(selected.evidence.distanceCm)}`
      : 'Hover or select a return marker to inspect its live evidence.';

  const panelStyle = {
    background: 'linear-gradient(145deg, rgba(9, 24, 42, .98), rgba(9, 34, 52, .98))',
    border: '1px solid rgba(113, 192, 209, .24)',
    borderRadius: 14,
    overflow: 'hidden',
    boxShadow: '0 20px 50px rgba(0, 0, 0, .25)',
  } as const;

  return (
    <section style={panelStyle} aria-label="2.5D range evidence view">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', padding: '18px 20px 13px' }}>
        <div>
          <div style={{ color: '#78d4e8', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 10, fontWeight: 700, letterSpacing: '.14em' }}>LIVE SPATIAL EVIDENCE / ISOMETRIC XY</div>
          <h3 style={{ color: '#f5fbff', margin: '5px 0 0', fontSize: 18, letterSpacing: '-.02em' }}>2.5D range field</h3>
        </div>
        <div style={{ color: '#a8c0cd', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 10, lineHeight: 1.55, textAlign: 'right' }}>
          <strong style={{ color: '#ff8374' }}>{state.dangerCount} DANGER ZONES</strong><br />
          {state.packetCount} LIVE FRAMES · {state.mapConfidence.toFixed(1)}% MAP CONFIDENCE
        </div>
      </div>

      <div style={{ position: 'relative', padding: '0 14px 10px' }}>
        <svg
          viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
          role="img"
          aria-label="Isometric XY projection of rover path, ultrasonic range returns, and danger zones"
          style={{ display: 'block', width: '100%', minHeight: 340, maxHeight: 540, borderRadius: 10, background: '#061521', cursor: 'crosshair' }}
        >
          <rect width={VIEWBOX_WIDTH} height={VIEWBOX_HEIGHT} fill="#061521" />
          <rect x="12" y="12" width={VIEWBOX_WIDTH - 24} height={VIEWBOX_HEIGHT - 24} rx="8" fill="none" stroke="rgba(125, 211, 252, .16)" />
          <g stroke="rgba(124, 171, 192, .18)" strokeWidth="1">
            {gridXs.map((x) => {
              const start = project(x, cellMinY);
              const end = project(x, cellMaxY);
              return <line key={`x-${x}`} x1={start.x} y1={start.y} x2={end.x} y2={end.y} />;
            })}
            {gridYs.map((y) => {
              const start = project(cellMinX, y);
              const end = project(cellMaxX, y);
              return <line key={`y-${y}`} x1={start.x} y1={start.y} x2={end.x} y2={end.y} />;
            })}
          </g>
          <g fill="#6f94a8" fontSize="9" fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" letterSpacing=".08em">
            <text x="28" y="38">XY GROUND PLANE / WORLD CM</text>
            <text x={VIEWBOX_WIDTH - 225} y={VIEWBOX_HEIGHT - 24}>NOT A HEIGHT OR DEPTH MAP</text>
          </g>

          {visibleReturns.map((point, index) => {
            const origin = project(point.originXcm, point.originYcm);
            const hit = project(point.xCm, point.yCm);
            const opacity = clamp(.13 + index / Math.max(visibleReturns.length, 1) * .52, .13, .65);
            return (
              <g key={`${point.timestamp}-${index}`}>
                <line x1={origin.x} y1={origin.y} x2={hit.x} y2={hit.y} stroke={point.danger ? '#ff5d5d' : '#65d7e8'} strokeWidth={point.danger ? 1.8 : 1} strokeOpacity={point.danger ? .82 : opacity} />
                <circle
                  cx={hit.x}
                  cy={hit.y}
                  r={point.danger ? 5.3 : 3.1}
                  fill={point.danger ? '#ff4d5b' : '#70dae5'}
                  fillOpacity={point.danger ? 1 : opacity + .2}
                  stroke={point.danger ? '#ffd7d7' : 'rgba(239, 253, 255, .7)'}
                  strokeWidth={point.danger ? 1.2 : .4}
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={() => setSelected({ kind: 'return', point })}
                  onFocus={() => setSelected({ kind: 'return', point })}
                  onClick={() => setSelected({ kind: 'return', point })}
                  role="button"
                  tabIndex={0}
                  aria-label={`Ultrasonic return: ${fmtDistance(point.distanceCm)} at servo ${point.angleDeg.toFixed(0)} degrees`}
                />
              </g>
            );
          })}

          {dangerPoints.map((point) => {
            const marker = project(point.x, point.y);
            const diamond = diamondPath(project, point.x, point.y, LIVE_MAPPING_CONFIG.cellSizeCm * .5);
            return (
              <g
                key={point.key}
                style={{ cursor: 'pointer' }}
                onMouseEnter={() => setSelected({ kind: 'danger', point, evidence: point.evidence })}
                onFocus={() => setSelected({ kind: 'danger', point, evidence: point.evidence })}
                onClick={() => setSelected({ kind: 'danger', point, evidence: point.evidence })}
                role="button"
                tabIndex={0}
                aria-label={`Danger zone: ${point.evidence.reason}, ${fmtDistance(point.evidence.distanceCm)}`}
              >
                <path d={diamond} fill="rgba(255, 58, 77, .35)" stroke="#ff5260" strokeWidth="1.2" />
                <circle cx={marker.x} cy={marker.y} r="11" fill="none" stroke="#ff5260" strokeOpacity=".8" strokeWidth="1.3" />
                <path d={`M ${marker.x - 4} ${marker.y - 4} L ${marker.x + 4} ${marker.y + 4} M ${marker.x + 4} ${marker.y - 4} L ${marker.x - 4} ${marker.y + 4}`} stroke="#ffe2e5" strokeWidth="1.35" />
              </g>
            );
          })}

          {state.path.length > 1 && <polyline points={pathPoints} fill="none" stroke="#f2c14e" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" opacity=".95" />}
          <circle cx={project(0, 0).x} cy={project(0, 0).y} r="5" fill="#0d2535" stroke="#bdeaf0" strokeWidth="1.6" />
          <text x={project(0, 0).x + 9} y={project(0, 0).y - 9} fill="#bdeaf0" fontSize="9" fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace">START</text>

          <g transform={`translate(${rover.x} ${rover.y}) rotate(${roverAngle})`}>
            <circle r="16" fill="rgba(246, 194, 69, .13)" stroke="#f2c14e" strokeWidth="1.25" />
            <path d="M 15 0 L -9 -8 L -4 0 L -9 8 Z" fill="#f6cf58" stroke="#fff4c7" strokeWidth="1" />
            <line x1="16" y1="0" x2="28" y2="0" stroke="#fff4c7" strokeWidth="1.4" />
          </g>
          <text x={rover.x + 18} y={rover.y + 27} fill="#fff4c7" fontSize="10" fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace">ROVER / {actualHeading.toFixed(0)}°</text>
          {!state.latest && <text x={VIEWBOX_WIDTH / 2} y={VIEWBOX_HEIGHT / 2} fill="#9ab6c4" fontSize="16" fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" textAnchor="middle">WAITING FOR LIVE RANGE EVIDENCE</text>}
        </svg>
        <div style={{ position: 'absolute', left: 30, bottom: 23, maxWidth: '72%', padding: '8px 10px', border: '1px solid rgba(114, 209, 225, .24)', borderRadius: 7, background: 'rgba(3, 18, 29, .88)', color: '#c7e4eb', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 10, lineHeight: 1.45, pointerEvents: 'none' }}>
          {selectedMessage}
        </div>
      </div>

      <footer style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12, padding: '12px 20px 15px', borderTop: '1px solid rgba(113, 192, 209, .17)', color: '#a7c3cd', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 10, letterSpacing: '.035em' }}>
        <span><b style={{ color: '#f2c14e' }}>━</b> COMMAND-ESTIMATED PATH</span>
        <span><b style={{ color: '#70dae5' }}>●</b> ULTRASONIC RETURN</span>
        <span><b style={{ color: '#ff5260' }}>◆</b> STOP / AVOIDANCE ZONE</span>
        <span>ISOMETRIC XY ONLY · NO FABRICATED 3D GEOMETRY</span>
      </footer>
    </section>
  );
}
