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
};

export type LivePacketSummary = {
  timestamp: number;
  mode: string;
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
  occupancyBounds: { minX: number; maxX: number; minY: number; maxY: number };
  mapConfidence: number;
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
    occupancyBounds: { minX: 0, maxX: 0, minY: 0, maxY: 0 },
    mapConfidence: 0,
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

function occupancySummary(occupancy: Record<string, number>, pose: LivePose) {
  const keys = Object.keys(occupancy);
  const poseCell: [number, number] = [worldToCell(pose.xCm), worldToCell(pose.yCm)];
  if (!keys.length) {
    return {
      bounds: { minX: poseCell[0], maxX: poseCell[0], minY: poseCell[1], maxY: poseCell[1] },
      confidence: 0,
    };
  }
  const cells = keys.map((key) => key.split(',').map(Number) as [number, number]);
  const allX = [...cells.map(([x]) => x), poseCell[0]];
  const allY = [...cells.map(([, y]) => y), poseCell[1]];
  const confidence = Object.values(occupancy).reduce((sum, probability) => sum + 2 * Math.abs(probability - .5), 0) / keys.length * 100;
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
  const newRun = Boolean(state.runId && packet.runId && state.runId !== packet.runId);
  const rebooted = state.lastTimestamp !== null && packet.timestamp < state.lastTimestamp;
  const base = newRun || rebooted ? resetLiveMap(packet.runId) : state;
  const previousTimestamp = base.lastTimestamp;
  const rawDt = previousTimestamp === null ? 0 : (packet.timestamp - previousTimestamp) / 1000;
  const dtSec = Math.max(0, Math.min(LIVE_MAPPING_CONFIG.maxPacketGapSec, rawDt));
  const scale = LIVE_MAPPING_CONFIG.speedScaleCmPerSecondPerPwm;
  const dLeft = packet.leftSpeed * dtSec * scale;
  const dRight = packet.rightSpeed * dtSec * scale;
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
  const rangePoint: LiveRangePoint | null = packet.distanceCm !== null
    && packet.distanceCm >= 0
    && packet.distanceCm <= LIVE_MAPPING_CONFIG.maxRangeCm
    ? {
      originXcm: pose.xCm,
      originYcm: pose.yCm,
      // Firmware servo angle 90° is forward; convert to a rover-relative angle.
      xCm: pose.xCm + packet.distanceCm * Math.cos(
        pose.headingRad + (packet.angleDeg - LIVE_MAPPING_CONFIG.servoCenterDeg) * Math.PI / 180,
      ),
      yCm: pose.yCm + packet.distanceCm * Math.sin(
        pose.headingRad + (packet.angleDeg - LIVE_MAPPING_CONFIG.servoCenterDeg) * Math.PI / 180,
      ),
      distanceCm: packet.distanceCm,
      angleDeg: packet.angleDeg,
      timestamp: packet.timestamp,
      temperatureC: packet.temperatureC,
      ir: packet.ir,
    }
    : null;
  const nextReturns = rangePoint
    ? [...base.returns, rangePoint].slice(-LIVE_MAPPING_CONFIG.returnLimit)
    : base.returns;
  const nextOccupancy = rangePoint
    ? updateOccupancy(
      base.occupancy,
      rangePoint.originXcm,
      rangePoint.originYcm,
      rangePoint.xCm,
      rangePoint.yCm,
      true,
    )
    : base.occupancy;
  const occupancy = occupancySummary(nextOccupancy, pose);
  return {
    runId: packet.runId ?? base.runId,
    pose,
    path: nextPath,
    returns: nextReturns,
    packetCount: base.packetCount + 1,
    totalDistanceCm: base.totalDistanceCm + distanceTravelled,
    lastTimestamp: packet.timestamp,
    latest: { ...packet, dtSec },
    occupancy: nextOccupancy,
    occupancyBounds: occupancy.bounds,
    mapConfidence: occupancy.confidence,
  };
}

export function poseHeadingDeg(pose: LivePose) {
  return normalizeAngle(pose.headingRad) * 180 / Math.PI;
}
