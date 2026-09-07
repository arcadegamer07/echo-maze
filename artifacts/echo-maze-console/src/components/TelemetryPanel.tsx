import { Activity, Radio, Thermometer, Waves } from 'lucide-react';
import { DashboardPanel, PanelBody } from './DashboardPanel';
import type { Telemetry } from '@/lib/demo-model';

function SensorValue({ label, value, state = 'nominal', icon: Icon }: { label: string; value: string; state?: 'nominal' | 'missing' | 'warning'; icon: typeof Activity }) {
  return (
    <div className="sensor-readout">
      <div className="sensor-readout-head"><Icon size={15} /><span>{label}</span><i className={`sensor-dot ${state}`} /></div>
      <strong>{value}</strong>
      <span className="sensor-rule"><i /></span>
    </div>
  );
}

export function TelemetryPanel({ telemetry, connected, packetCount, source }: { telemetry: Telemetry; connected: boolean; packetCount: number; source: string }) {
  return (
    <DashboardPanel title="Telemetry" code={`${connected ? 'LIVE' : 'REPLAY'} / 10 HZ`}>
      <PanelBody>
        <div className="telemetry-hero-line"><span><Radio size={14} /> {connected ? 'Receiver stream' : 'Recorded fixture'}</span><strong>{packetCount.toLocaleString()} packets</strong></div>
        <div className="sensor-grid">
          <SensorValue label="Drive" value={telemetry.motorState} icon={Activity} />
          <SensorValue label="Motor balance" value={`${telemetry.leftMotor}% / ${telemetry.rightMotor}%`} icon={Waves} />
          <SensorValue label="Ultrasonic" value={`${telemetry.ultrasonic.toFixed(1)} cm`} icon={Waves} />
          <SensorValue label="Temperature" value={`${telemetry.temperature.toFixed(1)} °C`} icon={Thermometer} />
        </div>
        <div className="telemetry-detail-grid">
          <div><span>IMU / ACCEL</span><strong>{telemetry.accel}</strong></div>
          <div><span>IMU / GYRO</span><strong>{telemetry.gyro}</strong></div>
          <div><span>IR REFLECTANCE</span><strong>{telemetry.ir} raw</strong></div>
          <div><span>PACKET SOURCE</span><strong>{source}</strong></div>
        </div>
      </PanelBody>
    </DashboardPanel>
  );
}
