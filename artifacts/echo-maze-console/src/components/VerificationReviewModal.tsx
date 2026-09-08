import { AlertTriangle, CheckCircle2, GitCompareArrows, ShieldCheck, X } from 'lucide-react';
import type { RunState, ScoreSet } from '@/lib/demo-model';
import type { LiveMapState } from '@/lib/live-mapping';

function severityFor(score: number) {
  return score >= 65 ? 'HIGH' : score >= 35 ? 'MODERATE' : 'LOW';
}

function featureLabel(label: string, value: number) {
  const offline = (label === 'Tilt' || label === 'Vibration') && value === 0;
  return offline ? 'offline / unavailable' : `${value}/100 deviation`;
}

export function VerificationReviewModal({
  open,
  status,
  scores,
  liveMap,
  onClose,
  onOpenReport,
}: {
  open: boolean;
  status: Extract<RunState, 'COMPLETE' | 'STOPPED'>;
  scores: ScoreSet;
  liveMap: LiveMapState;
  onClose: () => void;
  onOpenReport: () => void;
}) {
  if (!open) return null;
  const severity = severityFor(scores.total);
  const liveEvidence = liveMap.latest?.source === 'live' && liveMap.packetCount > 0;
  const runId = liveMap.runId ?? 'EM-0427-VR';
  const sourceLabel = scores.source === 'live-evidence' ? 'Live evidence delta' : scores.source === 'ml' ? 'Isolation Forest / v1' : 'Isolation Forest / fixture';
  const decisionTitle = scores.source === 'live-evidence' && scores.note?.startsWith('Capture a Learn')
    ? 'Baseline required before scoring'
    : severity === 'LOW' ? 'No strong structural change signal' : 'Evidence needs human review';
  return (
    <div className="modal-shade review-shade" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="review-modal" role="dialog" aria-modal="true" aria-labelledby="verification-review-title">
        <div className="review-modal-head">
          <div>
            <div className="review-kicker"><GitCompareArrows size={14} /> VERIFY / {status === 'COMPLETE' ? 'COMPLETE' : 'STOPPED'}</div>
            <h2 id="verification-review-title">Learn → Verify comparison</h2>
            <p>The Learn run defines the healthy baseline. Verify is compared against that baseline and scored for unusual feature combinations.</p>
          </div>
          <button className="review-close" onClick={onClose} aria-label="Close verification review"><X size={17} /></button>
        </div>

        <div className="review-model-banner">
          <div><span>SCORING ENGINE</span><strong>{sourceLabel}</strong></div>
          <div><span>INPUT</span><strong>{liveEvidence ? 'Live telemetry captured' : 'Local rehearsal fixture'}</strong></div>
          <div><span>VERIFY RUN</span><strong>{runId}</strong></div>
        </div>

        <div className="review-score-row">
          <div className={`review-score review-score-${severity.toLowerCase()}`}>
            <span>ANOMALY SCORE</span>
            <strong>{scores.total}<small>/100</small></strong>
            <b>{severity}</b>
          </div>
          <div className="review-decision-copy">
            <strong>{decisionTitle}</strong>
            <p>{scores.source === 'live-evidence'
              ? 'This live score is derived from the actual Learn → Verify range and temperature deltas. It changes with the received run; IMU tilt/vibration remain unavailable.'
              : 'Isolation Forest isolates unusual rows quickly. A higher score means the Verify features look less like the Learn baseline; it is an early-warning score, not a proof of damage.'}</p>
          </div>
        </div>

        <div className="review-columns">
          <div className="review-run-block baseline"><span>01 / LEARN</span><strong>Healthy reference</strong><p>{scores.source === 'live-evidence' ? 'The range and temperature stream captured here is the comparison reference.' : 'Model learns the normal geometry, vibration, tilt, and temperature pattern from this run.'}</p><i><CheckCircle2 size={14} /> baseline locked</i></div>
          <div className="review-run-block current"><span>02 / VERIFY</span><strong>Current inspection</strong><p>{scores.source === 'live-evidence' ? 'This run is paired against the preserved Learn evidence and rescored as frames arrive.' : 'Each feature window is sent through the trained forest and compared with the learned pattern.'}</p><i><ShieldCheck size={14} /> {status === 'COMPLETE' ? 'capture complete' : 'operator stopped capture'}</i></div>
        </div>

        <div className="review-feature-section">
          <div className="review-section-label">Feature deviations</div>
          {([
            ['Geometry / map', scores.geometry],
            ['Tilt', scores.tilt],
            ['Vibration', scores.vibration],
            ['Thermal', scores.thermal],
          ] as Array<[string, number]>).map(([label, value]) => (
            <div className="review-feature" key={label}>
              <span>{label}</span><div><i style={{ width: `${Math.min(100, value)}%` }} /></div><strong>{featureLabel(label, value)}</strong>
            </div>
          ))}
        </div>

        <div className="review-live-evidence">
          <div><span>Spatial evidence</span><strong>{liveEvidence ? `${liveMap.dangerCount} red danger zones` : 'No live map in this run'}</strong><small>{liveEvidence ? `${liveMap.packetCount} frames · ${liveMap.mapConfidence.toFixed(1)}% map confidence · pose ${(liveMap.pose.confidence * 100).toFixed(1)}%` : 'Connect the receiver and run Verify to populate live range evidence.'}</small></div>
          <div className="review-warning"><AlertTriangle size={15} /><span>Red navigation zones mark obstacles or avoidance events. They are not automatically classified as structural damage by Isolation Forest.</span></div>
        </div>

        <div className="review-modal-foot"><span>Model decision is advisory — confirm critical findings with a human inspection.</span><div><button className="review-secondary" onClick={onClose}>Close</button><button className="review-primary" onClick={onOpenReport}>Open full report</button></div></div>
      </div>
    </div>
  );
}
