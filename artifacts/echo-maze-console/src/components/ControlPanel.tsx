import { useState } from 'react';
import { ArrowUpRight, CheckCircle2, CircleStop, RotateCcw, ScanLine, Wifi } from 'lucide-react';
import { DashboardPanel, PanelBody } from './DashboardPanel';
import type { RunState } from '@/lib/demo-model';

type MissionCommand = 'learn' | 'verify' | 'explore' | 'stop' | 'reset';

export function ControlPanel({
  state,
  progress,
  connected,
  onCommand,
}: {
  state: RunState;
  progress: number;
  connected: boolean;
  onCommand: (command: MissionCommand, durationMs?: number) => void;
}) {
  const [exploreSeconds, setExploreSeconds] = useState('10');
  const active = state === 'LEARNING' || state === 'VERIFYING' || state === 'EXPLORING';

  const startExplore = () => {
    const parsed = Number(exploreSeconds);
    const seconds = Number.isFinite(parsed) ? Math.min(30, Math.max(1, parsed)) : 10;
    setExploreSeconds(String(seconds));
    onCommand('explore', Math.round(seconds * 1000));
  };

  return (
    <DashboardPanel title="Mission control" code="ROUTE / 01">
      <PanelBody>
        <div className="command-connection">
          <span><Wifi size={14} /> {connected ? 'Receiver linked' : 'Local rehearsal'}</span>
          <i className={connected ? 'online' : 'simulation'}>{connected ? 'ONLINE' : 'OFFLINE'}</i>
        </div>

        <div className="command-row">
          <button className="command learn-command" disabled={active} onClick={() => onCommand('learn')}>
            <b>01</b><span>Learn environment<small>Record the reference route</small></span><ArrowUpRight size={17} />
          </button>
          <button className="command verify-command" disabled={active} onClick={() => onCommand('verify')}>
            <b>02</b><span>Verify structure<small>Repeat and compare the route</small></span><ArrowUpRight size={17} />
          </button>
        </div>

        <div className="explore-controls">
          <div className="explore-label"><span>Guarded exploration</span><small>Forward, sense, reverse + pivot / max 30 s</small></div>
          <div className="explore-row">
            <label>
              <input
                aria-label="Exploration duration in seconds"
                type="number"
                min="1"
                max="30"
                step="1"
                value={exploreSeconds}
                onChange={(event) => setExploreSeconds(event.target.value)}
                disabled={active}
              />
              <span>SEC</span>
            </label>
            <button className="explore-button" disabled={active || !connected} onClick={startExplore}>
              <ScanLine size={14} /> Explore
            </button>
          </div>
        </div>

        <button className="stop-button" disabled={!active} onClick={() => onCommand('stop')}>
          <CircleStop size={15} /> Stop active run
        </button>

        <div className="mission-progress">
          <div><span>Mission state</span><strong>{state}</strong></div>
          <div className="progress-track"><span style={{ width: `${progress}%` }} /></div>
          <div className="progress-meta"><span>{active ? 'Route in progress' : state === 'COMPLETE' ? 'Evidence ready' : 'Standing by'}</span><b>{progress}%</b></div>
        </div>

        {state === 'STOPPED' && <button className="reset-command" onClick={() => onCommand('reset')}><RotateCcw size={14} /> Reset mission state</button>}
        {state === 'COMPLETE' && <div className="complete-note"><CheckCircle2 size={16} /> Run complete / evidence ready</div>}
      </PanelBody>
    </DashboardPanel>
  );
}
