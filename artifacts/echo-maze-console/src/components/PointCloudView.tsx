import { Crosshair, ScanLine } from 'lucide-react';
import { DashboardPanel, PanelBody } from './DashboardPanel';
import type { PointCloudPoint, Pose } from '@/lib/demo-model';

export function PointCloudView({ points, pose, scanning }: { points: PointCloudPoint[]; pose: Pose; scanning: boolean }) {
  return (
    <DashboardPanel title="Range field" code={`${points.length.toLocaleString()} RETURNS`}>
      <PanelBody className="point-cloud-body">
        <div className="viz-toolbar"><span><ScanLine size={14} /> Registered point cloud</span><span className="viz-live"><i /> {scanning ? 'acquiring' : 'stable'}</span></div>
        <svg className="point-cloud" viewBox="0 0 320 220" role="img" aria-label="Live point cloud with rover pose">
          <rect width="320" height="220" fill="var(--map-field)" />
          {[32, 64, 96].map((radius) => <circle key={radius} cx="160" cy="110" r={radius} fill="none" stroke="var(--map-grid)" strokeOpacity=".55" />)}
          <path d="M 12 110 H308 M160 10 V210" stroke="var(--map-grid)" strokeOpacity=".7" strokeDasharray="2 5" />
          <path d="M35 68 C78 30 119 44 155 55 S231 39 286 78 M29 151 C78 178 117 161 158 170 S239 182 292 145" fill="none" stroke="var(--map-grid)" strokeOpacity=".9" strokeWidth="1" />
          {points.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r={index % 11 === 0 ? 1.7 : .85} fill={index % 17 === 0 ? 'var(--accent)' : 'var(--signal)'} opacity={0.22 + point.intensity * 0.72} />)}
          {scanning && <path className="cloud-sweep" d="M160 110 L160 18 A92 92 0 0 1 208 31 Z" />}
          <g transform={`translate(${160 + pose.x * 12} ${110 - pose.y * 12}) rotate(${pose.heading})`}>
            <circle r="10" fill="none" stroke="var(--map-ink)" strokeOpacity=".5" />
            <path d="M10 0 L-7 -6 L-3 0 L-7 6 Z" fill="var(--map-ink)" />
            <circle r="2.6" fill="var(--signal)" />
          </g>
          <text x="15" y="204" fill="var(--muted)" fontSize="8" fontFamily="ui-monospace">0.0 M</text><text x="269" y="204" fill="var(--muted)" fontSize="8" fontFamily="ui-monospace">5.0 M</text>
        </svg>
        <div className="point-cloud-footer"><span><Crosshair size={14} /> Position {pose.x.toFixed(2)} m / {pose.y.toFixed(2)} m</span><strong>{pose.confidence.toFixed(1)}% confidence</strong></div>
      </PanelBody>
    </DashboardPanel>
  );
}
