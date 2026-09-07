import { Crosshair, ScanLine } from 'lucide-react';
import { DashboardPanel, PanelBody } from './DashboardPanel';
import type { PointCloudPoint, Pose } from '@/lib/demo-model';

export function PointCloudView({ points, pose, scanning }: { points: PointCloudPoint[]; pose: Pose; scanning: boolean }) {
  return (
    <DashboardPanel title="Point cloud / pose" code={`${points.length.toLocaleString()} REGISTERED PTS`}>
      <PanelBody className="point-cloud-body">
        <div className="viz-toolbar"><span><ScanLine size={13} /> POLAR RETURNS → CARTESIAN REGISTRATION</span><span className="viz-live"><i /> {scanning ? 'ACQUIRING' : 'STABLE'}</span></div>
        <svg className="point-cloud" viewBox="0 0 320 220" role="img" aria-label="Live point cloud with rover pose">
          <defs><radialGradient id="cloudGlow"><stop offset="0" stopColor="#54e6ed" stopOpacity=".35" /><stop offset="1" stopColor="#54e6ed" stopOpacity="0" /></radialGradient></defs>
          <rect width="320" height="220" fill="#0a1a23" />
          {[35, 70, 105].map((radius) => <circle key={radius} cx="160" cy="110" r={radius} fill="none" stroke="rgba(123,221,230,.14)" strokeDasharray="3 6" />)}
          <path d="M 15 110 H305 M160 12 V208" stroke="rgba(123,221,230,.12)" />
          <circle cx="160" cy="110" r="46" fill="url(#cloudGlow)" />
          {points.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r={index % 8 === 0 ? 1.6 : 1} fill={index % 9 === 0 ? '#ffd166' : '#56e3e9'} opacity={0.28 + point.intensity * 0.7} />)}
          {scanning && <path className="cloud-sweep" d="M160 110 L160 22 A88 88 0 0 1 199 31 Z" />}
          <g transform={`translate(${160 + pose.x * 12} ${110 - pose.y * 12}) rotate(${pose.heading})`}>
            <path d="M0 -11 L7 8 L0 5 L-7 8 Z" fill="#f7fbff" stroke="#54e6ed" strokeWidth="1.5" />
            <circle r="3" fill="#54e6ed" />
          </g>
          <text x="15" y="202" fill="rgba(186,229,235,.58)" fontSize="8" fontFamily="DM Mono">X / METRES</text><text x="268" y="202" fill="rgba(186,229,235,.58)" fontSize="8" fontFamily="DM Mono">POSE LOCK</text>
        </svg>
        <div className="point-cloud-footer"><span><Crosshair size={13} /> POSE LOCKED · {pose.x.toFixed(2)}m / {pose.y.toFixed(2)}m</span><strong>{pose.confidence.toFixed(1)}% CONFIDENCE</strong></div>
      </PanelBody>
    </DashboardPanel>
  );
}
