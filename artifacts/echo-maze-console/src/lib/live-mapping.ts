import type { TelemetryMessage } from './echo-maze-socket';

/**
 * Small, deliberately honest live mapping model for the dashboard.
 *
 * The firmware sends the active motor command (including its total duration)
 * on every telemetry frame.  That duration must not be integrated repeatedly;
 * we use the elapsed ESP32 timestamp between frames instead.  This avoids the
 * classic "10x too long" path that made the earlier preview look inaccurate.
 */
export type LivePose = {
  xCm: number;
  yCm: number;
  headingRad: number;
  confidence: number;
};

export type LivePathPoint = LivePose & { timestamp: number };

export type LiveRangePoint = {
  originXcm: number;
  originYcm: number;
  xCm: number;
  yCm: number;
  distanceCm: number;
  angleDeg: number;
  timestamp: number;
  temperatureC: number | null;
  ir: number | null;
  danger: boolean;
};

export type LiveDangerCell = {
  reason: 'close-range' | 'avoidance';
  distanceCm: number | null;
  timestamp: number;
};

export type LivePacketSummary = {
  timestamp: number;
  mode: string;
  source: string;
  leftSpeed: number;
  rightSpeed: number;
  commandDurationMs: number;
  angleDeg: number;
  distanceCm: number | null;
  temperatureC: number | null;
  ir: number | null;
  dtSec: number;
};

export type LiveMapState = {
  runId: string | null;
  pose: LivePose;
  path: LivePathPoint[];
  returns: LiveRangePoint[];
  packetCount: number;
  totalDistanceCm: number;
  lastTimestamp: number | null;
  latest: LivePacketSummary | null;
  /** Sparse occupancy probabilities keyed by integer cell coordinates. */
  occupancy: Record<string, number>;
  /** Cells that caused a close-range stop or an explore reverse/pivot. */
  dangerCells: Record<string, LiveDangerCell>;
  occupancyBounds: { minX: number; maxX: number; minY: number; maxY: number };
  mapConfidence: number;
  dangerCount: number;
};

// These are intentionally visible in the UI so the team can calibrate them.
// README.md uses 0.08 cm/s per PWM as the first conservative estimate.
export const LIVE_MAPPING_CONFIG = {
  wheelBaseCm: 14,
  speedScaleCmPerSecondPerPwm: 0.08,
  scanStartDeg: 0,
  scanEndDeg: 180,
  servoCenterDeg: 90,
  maxRangeCm: 250,
  maxPacketGapSec: 0.5,
  pathLimit: 600,
  returnLimit: 1400,
  cellSizeCm: 10,
  mapMaxRangeCm: 250,
  obstacleDistanceCm: 22,
} as const;

const HIT_LOG_ODDS = Math.log(.85 / .15);
const MISS_LOG_ODDS = Math.log(.30 / .70);
const MIN_LOG_ODDS = -6;
const MAX_LOG_ODDS = 6;

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const numberOr = (value: unknown, fallback: number) => finite(value) ? value : fallback;
const nullableNumber = (value: unknown) => finite(value) ? value : null;

function normalizeAngle(angle: number) {
  let result = angle;
  while (result > Math.PI) result -= Math.PI * 2;
  while (result <= -Math.PI) result += Math.PI * 2;
  return result;
}

export function createLiveMapState(): LiveMapState {
  const pose: LivePose = { xCm: 0, yCm: 0, headingRad: 0, confidence: 1 };
  return {
    runId: null,
    pose,
    path: [{ ...pose, timestamp: 0 }],
    returns: [],
    packetCount: 0,
    totalDistanceCm: 0,
    lastTimestamp: null,
    latest: null,
    occupancy: {},
    dangerCells: {},
    occupancyBounds: { minX: 0, maxX: 0, minY: 0, maxY: 0 },
    mapConfidence: 0,
    dangerCount: 0,
  };
}

/** Start a fresh trace without changing any raw receiver data. */
export function resetLiveMap(runId: string | null = null): LiveMapState {
  const state = createLiveMapState();
  state.runId = runId;
  return state;
}

function readPacket(message: TelemetryMessage) {
  const motor = (message.motor ?? {}) as Record<string, unknown>;
  const scan = (message.scan ?? {}) as Record<string, unknown>;
  return {
    runId: typeof message.run_id === 'string' ? message.run_id : null,
    timestamp: numberOr(message.timestamp, 0),
    mode: typeof message.mode === 'string' ? message.mode : 'live',
    source: typeof message.source === 'string' ? message.source : 'live',
    leftSpeed: numberOr(motor.left_speed, 0),
    rightSpeed: numberOr(motor.right_speed, 0),
    commandDurationMs: numberOr(motor.duration_ms, 0),
    angleDeg: numberOr(scan.angle, numberOr(scan.angle_deg, LIVE_MAPPING_CONFIG.servoCenterDeg)),
    distanceCm: nullableNumber(scan.distance_cm ?? scan.distance),
    temperatureC: nullableNumber(message.temp_c),
    ir: nullableNumber(message.ir),
  };
}

function cellKey(x: number, y: number) {
  return `${x},${y}`;
}

function worldToCell(valueCm: number) {
  return Math.floor(valueCm / LIVE_MAPPING_CONFIG.cellSizeCm);
}

function rayCells(startX: number, startY: number, endX: number, endY: number) {
  const cells: Array<[number, number]> = [];
  let x = startX;
  let y = startY;
  const dx = Math.abs(endX - startX);
  const dy = Math.abs(endY - startY);
  const stepX = startX < endX ? 1 : -1;
  const stepY = startY < endY ? 1 : -1;
  let error = dx - dy;
  while (true) {
    cells.push([x, y]);
    if (x === endX && y === endY) break;
    const twice = 2 * error;
    if (twice > -dy) { error -= dy; x += stepX; }
    if (twice < dx) { error += dx; y += stepY; }
  }
  return cells;
}

function probabilityFromLogOdds(logOdds: number) {
  const bounded = Math.max(MIN_LOG_ODDS, Math.min(MAX_LOG_ODDS, logOdds));
  return 1 / (1 + Math.exp(-bounded));
}

function updateOccupancy(
  occupancy: Record<string, number>,
  originXcm: number,
  originYcm: number,
  endpointXcm: number,
  endpointYcm: number,
  hit: boolean,
) {
  const next = { ...occupancy };
  const originX = worldToCell(originXcm);
  const originY = worldToCell(originYcm);
  const endpointX = worldToCell(endpointXcm);
  const endpointY = worldToCell(endpointYcm);
  const cells = rayCells(originX, originY, endpointX, endpointY);
  const freeCells = hit && cells.length > 1 ? cells.slice(0, -1) : cells;
  for (const [x, y] of freeCells) {
    const key = cellKey(x, y);
    const oldProbability = next[key] ?? .5;
    const oldLogOdds = Math.log(oldProbability / (1 - oldProbability));
    next[key] = probabilityFromLogOdds(oldLogOdds + MISS_LOG_ODDS);
  }
  if (hit) {
    const [x, y] = cells[cells.length - 1];
    const key = cellKey(x, y);
    const oldProbability = next[key] ?? .5;
    const oldLogOdds = Math.log(oldProbability / (1 - oldProbability));
    next[key] = probabilityFromLogOdds(oldLogOdds + HIT_LOG_ODDS);
  }
  return next;
}

function endpointForReading(
  pose: LivePose,
  angleDeg: number,
  distanceCm: number,
) {
  const angleRad = pose.headingRad
    + (angleDeg - LIVE_MAPPING_CONFIG.servoCenterDeg) * Math.PI / 180;
  return {
    xCm: pose.xCm + distanceCm * Math.cos(angleRad),
    yCm: pose.yCm + distanceCm * Math.sin(angleRad),
  };
}

function markDanger(
  dangerCells: Record<string, LiveDangerCell>,
  xCm: number,
  yCm: number,
  reason: LiveDangerCell['reason'],
  distanceCm: number | null,
  timestamp: number,
) {
  const key = cellKey(worldToCell(xCm), worldToCell(yCm));
  return {
    ...dangerCells,
    [key]: {
      reason,
      distanceCm,
      timestamp,
    },
  };
}

function occupancySummary(
  occupancy: Record<string, number>,
  dangerCells: Record<string, LiveDangerCell>,
  pose: LivePose,
) {
  const keys = Object.keys(occupancy);
  const dangerKeys = Object.keys(dangerCells);
  const poseCell: [number, number] = [worldToCell(pose.xCm), worldToCell(pose.yCm)];
  if (!keys.length && !dangerKeys.length) {
    return {
      bounds: { minX: poseCell[0], maxX: poseCell[0], minY: poseCell[1], maxY: poseCell[1] },
      confidence: 0,
    };
  }
  const cells = keys.map((key) => key.split(',').map(Number) as [number, number]);
  const dangerCellsAsCoordinates = dangerKeys.map((key) => key.split(',').map(Number) as [number, number]);
  const allX = [...cells.map(([x]) => x), ...dangerCellsAsCoordinates.map(([x]) => x), poseCell[0]];
  const allY = [...cells.map(([, y]) => y), ...dangerCellsAsCoordinates.map(([, y]) => y), poseCell[1]];
  const confidence = keys.length
    ? Object.values(occupancy).reduce((sum, probability) => sum + 2 * Math.abs(probability - .5), 0) / keys.length * 100
    : 0;
  return {
    bounds: {
      minX: Math.min(...allX), maxX: Math.max(...allX),
      minY: Math.min(...allY), maxY: Math.max(...allY),
    },
    confidence,
  };
}

/** Consume one live packet and return a new immutable map state. */
export function consumeTelemetry(state: LiveMapState, message: TelemetryMessage): LiveMapState {
  const packet = readPacket(message);
  // Fixture/test frames validate transport only. They must never move the
  // pose or paint the real occupancy map (otherwise a connectivity test can
  // look like rover motion). Only source=live is mappable evidence.
  const mappable = packet.source === 'live';
  const newRun = mappable && Boolean(state.runId && packet.runId && state.runId !== packet.runId);
  const rebooted = mappable && state.lastTimestamp !== null && packet.timestamp < state.lastTimestamp;
  const base = newRun || rebooted ? resetLiveMap(packet.runId) : state;
  const previousTimestamp = base.lastTimestamp;
  const rawDt = !mappable || previousTimestamp === null ? 0 : (packet.timestamp - previousTimestamp) / 1000;
  const dtSec = Math.max(0, Math.min(LIVE_MAPPING_CONFIG.maxPacketGapSec, rawDt));
  const scale = LIVE_MAPPING_CONFIG.speedScaleCmPerSecondPerPwm;
  const dLeft = mappable ? packet.leftSpeed * dtSec * scale : 0;
  const dRight = mappable ? packet.rightSpeed * dtSec * scale : 0;
  const deltaDistance = (dLeft + dRight) / 2;
  const deltaHeading = (dRight - dLeft) / LIVE_MAPPING_CONFIG.wheelBaseCm;
  const headingMid = base.pose.headingRad + deltaHeading / 2;
  const distanceTravelled = Math.abs(deltaDistance);
  const pose: LivePose = {
    xCm: base.pose.xCm + deltaDistance * Math.cos(headingMid),
    yCm: base.pose.yCm + deltaDistance * Math.sin(headingMid),
    headingRad: normalizeAngle(base.pose.headingRad + deltaHeading),
    confidence: Math.max(0, Math.min(1, base.pose.confidence * Math.exp(
      -distanceTravelled / 500 - Math.abs(deltaHeading) / (Math.PI * 2),
    ))),
  };
  const pathPoint: LivePathPoint = { ...pose, timestamp: packet.timestamp };
  const nextPath = [...base.path, pathPoint].slice(-LIVE_MAPPING_CONFIG.pathLimit);
  const validRange = mappable && packet.distanceCm !== null
    && packet.distanceCm >= 0
    && packet.distanceCm <= LIVE_MAPPING_CONFIG.maxRangeCm;
  const rangeEndpoint = validRange
    ? endpointForReading(pose, packet.angleDeg, packet.distanceCm as number)
    : null;
  const rangePoint: LiveRangePoint | null = rangeEndpoint
    ? {
      originXcm: pose.xCm,
      originYcm: pose.yCm,
      xCm: rangeEndpoint.xCm,
      yCm: rangeEndpoint.yCm,
      distanceCm: packet.distanceCm as number,
      angleDeg: packet.angleDeg,
      timestamp: packet.timestamp,
      temperatureC: packet.temperatureC,
      ir: packet.ir,
      danger: (packet.distanceCm as number) <= LIVE_MAPPING_CONFIG.obstacleDistanceCm,
    }
    : null;
  const nextReturns = rangePoint
    ? [...base.returns, rangePoint].slice(-LIVE_MAPPING_CONFIG.returnLimit)
    : base.returns;
  // A null/no-echo reading is still useful evidence: it means the ray was
  // clear out to the configured maximum range. Only a finite return shorter
  // than that limit paints an occupied endpoint.
  const noEchoEndpoint = mappable && (packet.distanceCm === null || packet.distanceCm >= LIVE_MAPPING_CONFIG.mapMaxRangeCm)
    ? endpointForReading(pose, packet.angleDeg, LIVE_MAPPING_CONFIG.mapMaxRangeCm)
    : null;
  const nextOccupancy = rangePoint
    ? updateOccupancy(base.occupancy, rangePoint.originXcm, rangePoint.originYcm, rangePoint.xCm, rangePoint.yCm, packet.distanceCm! < LIVE_MAPPING_CONFIG.mapMaxRangeCm)
    : noEchoEndpoint
      ? updateOccupancy(base.occupancy, pose.xCm, pose.yCm, noEchoEndpoint.xCm, noEchoEndpoint.yCm, false)
      : base.occupancy;
  const previousWasForward = base.latest !== null
    && base.latest.source === 'live'
    && base.latest.leftSpeed > 0
    && base.latest.rightSpeed > 0;
  const isExploreAvoidance = mappable
    && packet.mode === 'explore'
    && packet.leftSpeed < 0
    && packet.rightSpeed < 0
    && previousWasForward;
  const closeRangeDanger = rangePoint?.danger === true;
  let nextDangerCells = base.dangerCells;
  if (closeRangeDanger && rangePoint) {
    nextDangerCells = markDanger(
      nextDangerCells,
      rangePoint.xCm,
      rangePoint.yCm,
      'close-range',
      rangePoint.distanceCm,
      packet.timestamp,
    );
  }
  if (isExploreAvoidance && !closeRangeDanger) {
    // If the reverse was triggered by an IR hit or repeated no-echo reads,
    // preserve a red marker just ahead of the last estimated pose.
    const markerDistance = LIVE_MAPPING_CONFIG.obstacleDistanceCm;
    nextDangerCells = markDanger(
      nextDangerCells,
      base.pose.xCm + markerDistance * Math.cos(base.pose.headingRad),
      base.pose.yCm + markerDistance * Math.sin(base.pose.headingRad),
      'avoidance',
      packet.distanceCm,
      packet.timestamp,
    );
  }
  const occupancy = occupancySummary(nextOccupancy, nextDangerCells, pose);
  return {
    runId: mappable ? packet.runId ?? base.runId : base.runId,
    pose,
    path: nextPath,
    returns: nextReturns,
    packetCount: base.packetCount + 1,
    totalDistanceCm: base.totalDistanceCm + (mappable ? distanceTravelled : 0),
    lastTimestamp: mappable ? packet.timestamp : base.lastTimestamp,
    latest: { ...packet, dtSec },
    occupancy: nextOccupancy,
    dangerCells: nextDangerCells,
    occupancyBounds: occupancy.bounds,
    mapConfidence: occupancy.confidence,
    dangerCount: Object.keys(nextDangerCells).length,
  };
}

export function poseHeadingDeg(pose: LivePose) {
  return normalizeAngle(pose.headingRad) * 180 / Math.PI;
}
