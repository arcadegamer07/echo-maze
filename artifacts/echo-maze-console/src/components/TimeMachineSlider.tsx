import { Clock3 } from 'lucide-react';

export function TimeMachineSlider({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  return <div className="time-machine"><div className="time-machine-head"><span><Clock3 size={13} /> TIME MACHINE</span><strong>{value}% CURRENT STATE</strong></div><input aria-label="Map time machine" type="range" min="0" max="100" value={value} onChange={(event) => onChange(Number(event.target.value))} /><div className="time-labels"><span>BASELINE <small>14:09:34</small></span><span>VERIFY <small>14:32:08</small></span></div></div>;
}
