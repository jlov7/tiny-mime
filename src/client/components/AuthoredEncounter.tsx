import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { MotionScoreV1 } from '../../shared/score.js';
import { Stage } from '../Stage.js';
import { usePlayback } from '../usePlayback.js';
import { ScoreComparison } from './ScoreComparison.js';

export function AuthoredEncounter({ left, right, notes, rehearsalActions, onNext, onReturn, focusOnMount = false }: { left: MotionScoreV1; right: MotionScoreV1; notes: ReactNode; rehearsalActions?: ReactNode; onNext?: () => void; onReturn: () => void; focusOnMount?: boolean }) {
  const id = useId(); const [take, setTake] = useState(0); const [phase, setPhase] = useState<'view' | 'reflect' | 'reveal' | 'finish'>('view'); const [inspection, setInspection] = useState(false);
  const score = take === 0 ? left : right; const p = usePlayback(score); const heading = useRef<HTMLHeadingElement>(null); const writtenHeading = useRef<HTMLHeadingElement>(null); const inspectionRegion = useRef<HTMLElement>(null);
  useEffect(() => { if (!focusOnMount) return; const frame = requestAnimationFrame(() => heading.current?.focus()); return () => cancelAnimationFrame(frame); }, [focusOnMount]);
  useLayoutEffect(() => { if (inspection) inspectionRegion.current?.querySelector<HTMLButtonElement>('button')?.focus(); }, [inspection]);
  const finished = p.elapsedMs >= score.durationMs;
  const step = phase === 'finish' ? -1 : phase === 'reveal' ? 3 : phase === 'reflect' ? 1 : take === 0 ? 0 : 2;
  function move(next: typeof phase) { p.pause(); setPhase(next); requestAnimationFrame(() => (next === 'reveal' ? writtenHeading : heading).current?.focus()); }
  function startFirst() { p.seek(0); setTake(0); setPhase('view'); setInspection(false); requestAnimationFrame(() => heading.current?.focus()); }
  if (inspection) return <section aria-label="Detailed timing inspection" ref={inspectionRegion}><ScoreComparison left={left} right={right} leftLabel="Authored first take" rightLabel="Authored second take"><details className="directing-notes"><summary>Intention and directing notes</summary>{notes}{rehearsalActions}</details></ScoreComparison><div className="controls encounter-inspection"><button onClick={startFirst}>Return to first take</button><span className="secondary">Both authored takes share one clock here.</span></div></section>;
  return <section className="authored-encounter" aria-label="Authored scene encounter">
    <ol className="encounter-progress" aria-label="Scene progress">{['First take', 'Reflect', 'Second take', 'Notes'].map((label, index) => <li key={label} aria-current={step === index ? 'step' : undefined}>{label}</li>)}</ol>
    <div className="encounter-title"><h2 ref={heading} tabIndex={-1}>{phase === 'reflect' ? 'A moment to think.' : phase === 'reveal' ? 'The directing choices.' : phase === 'finish' ? 'Finished for now.' : take === 0 ? 'Authored first take' : 'Authored second take'}</h2><output role="timer" aria-live="off" aria-label="Take playback position">{(p.elapsedMs / 1000).toFixed(2)} / {(score.durationMs / 1000).toFixed(2)} s</output></div>
    <div className="encounter-body"><div className="stage-surround encounter-stage"><Stage score={score} elapsedMs={p.elapsedMs} /></div><div className="encounter-actions">
      <div className="controls"><button className={phase === 'view' && !finished ? 'primary' : undefined} aria-label={p.playing ? 'Pause take' : p.frameMode ? finished ? 'Replay take frames' : 'Next take keyframe' : finished ? 'Replay take' : 'Play take'} onClick={p.playing ? p.pause : p.frameMode ? finished ? () => p.seek(0) : () => p.step(1) : p.play}>{p.playing ? 'Pause' : p.frameMode ? finished ? 'Replay frames' : 'Next keyframe' : finished ? 'Replay take' : 'Play take'}</button><span className="secondary" role="status">{p.playing ? 'Playing' : finished ? 'Finished' : 'Paused'}</span></div>
      {phase === 'view' && (take === 0 ? <button className={finished ? 'primary' : undefined} onClick={() => move('reflect')}>Reflect on first take</button> : <button className={finished ? 'primary' : undefined} onClick={() => move('reveal')}>Reveal intention and notes</button>)}
      {phase === 'reflect' && <div className="encounter-reflection"><p>What do you think is happening?</p><p className="secondary">Keep it private. Nothing is collected.</p><button className="primary" onClick={() => { p.seek(0); setTake(1); move('view'); }}>Continue to second take</button></div>}
      {phase === 'finish' && <div className="encounter-finish"><p>Stop here, return to the first scene, or inspect this pair.</p><button className="primary" onClick={() => { startFirst(); onReturn(); }}>Return to first scene</button></div>}
      {phase !== 'reveal' && phase !== 'finish' && <button className="encounter-skip" onClick={() => move('reveal')}>Skip to written reveal</button>}
      <details className="encounter-tools"><summary onClick={p.pause}>Playback controls</summary><label htmlFor={id}>Take timeline</label><input id={id} type="range" min={0} max={score.durationMs} step={1} value={p.elapsedMs} aria-valuetext={(p.elapsedMs / 1000).toFixed(2) + ' seconds'} onChange={event => p.seek(Number(event.target.value))} /><div className="controls"><button onClick={() => p.seek(0)}>Reset take</button><button onClick={() => p.step(-1)}>Previous take key</button><button onClick={() => p.step(1)}>Next take key</button><button onClick={() => p.setFrameMode(!p.frameMode)}>{p.frameMode ? 'Enable take animation' : 'Take frame by frame'}</button></div></details>
    </div></div>
    {phase === 'reveal' && <div className="directing-notes encounter-notes"><h2 ref={writtenHeading} tabIndex={-1}>Intention and directing notes</h2>{notes}<div className="controls">{onNext && <button className="primary" onClick={onNext}>Next scene</button>}<button className={!onNext ? 'primary' : undefined} onClick={() => move('finish')}>Finish for now</button></div>{rehearsalActions}</div>}
    <div className="controls encounter-inspection"><button onClick={() => { p.pause(); setInspection(true); }}>Inspect both takes together</button></div>
  </section>;
}
