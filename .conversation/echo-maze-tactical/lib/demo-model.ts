export type RunState = 'IDLE' | 'LEARNING' | 'VERIFYING' | 'COMPLETE' | 'STOPPED'

export type Telemetry = {
  motorState: string
  leftMotor: number
  rightMotor: number
  accel: string
  gyro: string
  ultrasonic: number
  ir: number
  temperature: number
}

export type Pose = { x: number; y: number; heading: number; confidence: number }
export type ScoreSet = { geometry: number; tilt: number; vibration: number; thermal: number; total: number }
export type DiffZone = { id: string; label: string; severity: string; delta: string }
export type RunMetadata = { id: string; mode: string; startedAt: string; route: string; points: number; confidence: number }

export const telemetry: Telemetry = {
  motorState: 'CRUISE / SCAN',
  leftMotor: 68,
  rightMotor: 71,
  accel: '0.02 / -0.01 / 0.98 g',
  gyro: '0.3 / 0.1 / -0.2 °/s',
  ultrasonic: 42.8,
  ir: 318,
  temperature: 24.6,
}

export const pose: Pose = { x: 2.84, y: 1.42, heading: 18, confidence: 94.7 }
export const scores: ScoreSet = { geometry: 22, tilt: 11, vibration: 38, thermal: 9, total: 31 }
export const diffZones: DiffZone[] = [
  { id: 'ZONE B3', label: 'east wall displacement', severity: 'HIGH', delta: '+12.4 cm' },
  { id: 'ZONE C1', label: 'floor plane tilt', severity: 'MEDIUM', delta: '+2.8°' },
  { id: 'ZONE A4', label: 'thermal signature', severity: 'LOW', delta: '+1.7°C' },
]
export const runMetadata: RunMetadata = {
  id: 'EM-0427-VR',
  mode: 'VERIFY / DEMO DATA',
  startedAt: '14:32:08 UTC',
  route: 'CSE-4 / MAZE-ALPHA',
  points: 1842,
  confidence: 96.2,
}

export function makeGrid(columns = 16, rows = 10, phase = 0): number[] {
  return Array.from({ length: columns * rows }, (_, index) => {
    const x = index % columns
    const y = Math.floor(index / columns)
    const wall = x === 2 || x === 13 || y === 1 || y === 8 || (x > 5 && x < 12 && y === 5)
    const pulse = Math.sin((x + phase) * 0.75) * Math.cos((y + phase) * 0.9)
    return wall ? 0.8 + pulse * 0.04 : 0.12 + (pulse + 1) * 0.06
  })
}

export function makeDiff(columns = 16, rows = 10): number[] {
  return Array.from({ length: columns * rows }, (_, index) => {
    const x = index % columns
    const y = Math.floor(index / columns)
    if ((x === 11 && y >= 3 && y <= 6) || (x === 12 && y === 6)) return 0.88
    if ((x === 7 && y === 5) || (x === 8 && y === 5)) return 0.42
    if ((x === 4 && y === 2) || (x === 5 && y === 2)) return 0.24
    return 0.04 + ((x * 3 + y) % 5) * 0.012
  })
}

export const baselineGrid = makeGrid()
export const currentGrid = makeGrid(16, 10, 0.35)
export const diffGrid = makeDiff()
