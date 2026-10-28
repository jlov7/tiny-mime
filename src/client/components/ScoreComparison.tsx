import { memo, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { MotionScoreV1 } from '../../shared/score.js';
import { compareScores, comparisonKeyTimes, scoreChangeDetails, type ScoreChangeDetail } from '../../shared/compareScores.js';
import { Stage } from '../Stage.js';
import { usePlayback } from '../usePlayback.js';

const ChangeDetails = memo(function ChangeDetails({ changes, seek, leftLabel, rightLabel }: { changes: ScoreChangeDetail[]; seek: (time: number) => void; leftLabel: string; rightLabel: string }) {
  return <>
    <p className="secondary">Before: {leftLabel}. After: {rightLabel}. Inspect buttons pause both takes at the chosen elapsed time. The interval includes neighboring keys where motion can change.</p>
    {changes.some(change => change.kind === 'timing') && <p className="secondary">Same-index timing compares equal-length key lists only when every stored transform and easing value at each index is unchanged. It does not establish movement identity. Fixed endpoints can change transitions into and out of the retimed interval.</p>}
    {!changes.length ? <p>No stored key differences.</p> : <ol className="comparison-change-list" aria-label="Stored key changes">{changes.map((change, index) => {
      const { before, after } = change; const stored = before ?? after!;
      return <li key={index}>
        <p><strong>Actor {change.actorId} · {before && after && before.keyIndex !== after.keyIndex ? `first key ${before.keyIndex + 1}, second key ${after.keyIndex + 1}` : `key ${stored.keyIndex + 1}`}</strong> · {change.kind === 'timing' ? 'Same-index timing' : change.kind === 'fields' ? `Shared time ${stored.key.tMs} ms` : change.kind === 'added' ? 'Added in second take' : 'Removed from second take'}</p>
        {before && after ? <dl>{change.fields.map(field => <div key={field}><dt>{field}</dt><dd>{before.key[field]} → {after.key[field]}{field === 'tMs' ? ` ms (${after.key.tMs - before.key.tMs > 0 ? '+' : ''}${after.key.tMs - before.key.tMs} ms)` : ''}</dd></div>)}</dl> : <p className="comparison-stored-key">Stored values: {Object.entries(stored.key).map(([field, value]) => `${field} ${value}`).join(' · ')}. No corresponding key inferred.</p>}
        <p className="secondary">Inspect interval: {change.fromMs}–{change.toMs} ms.</p>
        <div className="controls"><button onClick={() => seek(change.fromMs)}>Inspect from {change.fromMs} ms</button>{before && <button onClick={() => seek(before.key.tMs)}>First key at {before.key.tMs} ms</button>}{after && (!before || before.key.tMs !== after.key.tMs) && <button onClick={() => seek(after.key.tMs)}>Second key at {after.key.tMs} ms</button>}</div>
      </li>;
    })}</ol>}
  </>;
});

export function ScoreComparison({ left, right, leftLabel = 'First take', rightLabel = 'Second take', children, dock }: { left: MotionScoreV1; right: MotionScoreV1; leftLabel?: string; rightLabel?: string; children?: ReactNode; dock?: { stageHost: HTMLElement | null; time: React.RefObject<number>; onViewStage: () => void } }) {
  const id = useId(); const [visibleTake, setVisibleTake] = useState(0); const [numericOpen, setNumericOpen] = useState(false);
  // Only the duration and key times drive playback. Each stage renders its original score.
  const clock = useMemo(() => ({ ...left, durationMs: Math.max(left.durationMs, right.durationMs), actors: [...left.actors, ...right.actors] }), [left, right]);
  const p = usePlayback(clock); const readyClock = useRef<MotionScoreV1 | null>(null);
  useEffect(() => { if (dock) { p.seek(dock.time.current); readyClock.current = clock; } }, [clock, p.seek, !!dock]);
  useLayoutEffect(() => { if (dock && readyClock.current === clock) dock.time.current = Math.min(p.elapsedMs, right.durationMs); }, [p.elapsedMs, dock?.time, right.durationMs, clock]); const keys = useMemo(() => comparisonKeyTimes(left, right), [left, right]);
  const diff = useMemo(() => compareScores(left, right), [left, right]);
  const changes = useMemo(() => numericOpen ? scoreChangeDetails(left, right) : [], [left, right, numericOpen]);
  const region = useRef<HTMLElement>(null);
  useEffect(() => {
    const element = region.current!;
    element.addEventListener('toggle', p.pause, true);
    return () => element.removeEventListener('toggle', p.pause, true);
  }, [p.pause]);
  const panes = <div className={"score-comparison-panes" + (dock ? " docked-comparison-panes" : "")}>{[{ score: left, label: leftLabel }, { score: right, label: rightLabel }].map(({ score, label }, index) => <figure id={id + '-take-' + index} key={index} hidden={!!dock && visibleTake !== index} className={visibleTake === index ? 'selected-take' : ''}>
      <div className="stage-surround"><Stage score={score} elapsedMs={Math.min(p.elapsedMs, score.durationMs)} /></div>
      <figcaption><strong>{label}</strong><span>{(Math.min(p.elapsedMs, score.durationMs) / 1000).toFixed(2)} / {(score.durationMs / 1000).toFixed(2)} s{p.elapsedMs >= score.durationMs ? ' · End frame' : ''}</span></figcaption>
    </figure>)}</div>;
  const finished = p.elapsedMs >= clock.durationMs;
  return <section className={"score-comparison" + (dock ? " docked-comparison" : "")} aria-label="Score comparison" ref={region}>
    <div className="comparison-transport"><div className="controls"><button className="primary" aria-label={p.playing ? 'Pause comparison' : p.frameMode ? finished ? 'Replay comparison frames' : 'Next comparison keyframe' : finished ? 'Replay comparison' : 'Play comparison'} onClick={p.playing ? p.pause : p.frameMode ? finished ? () => p.seek(0) : () => p.step(1) : p.play}>{p.playing ? 'Pause' : p.frameMode ? finished ? 'Replay frames' : 'Next keyframe' : finished ? 'Replay pair' : 'Play pair'}</button><button aria-label="Reset comparison" onClick={() => p.seek(0)}>Reset</button></div><p className="comparison-status" role="status">{p.playing ? 'Playing' : finished ? 'Finished' : 'Paused'}</p></div>
    <div className="comparison-takes" role="group" aria-label="Visible comparison take">{['first', 'second'].map((name, index) => <button key={name} aria-pressed={visibleTake === index} aria-controls={id + '-take-' + index} onClick={() => { p.pause(); setVisibleTake(index); }} aria-label={'Show ' + name + ' take'}>{index === 0 ? 'First take' : 'Second take'}</button>)}</div>
    <p className="comparison-phone-help">Same moment. Switching pauses.</p>{dock && <button className="quiet" onClick={dock.onViewStage}>View comparison stage</button>}
    {dock ? dock.stageHost && createPortal(panes, dock.stageHost) : panes}
    <label htmlFor={id}>Comparison timeline · {(p.elapsedMs / 1000).toFixed(2)} / {(clock.durationMs / 1000).toFixed(2)} s</label><input id={id} type="range" min={0} max={clock.durationMs} step={1} value={p.elapsedMs} aria-valuetext={(p.elapsedMs / 1000).toFixed(2) + ' of ' + (clock.durationMs / 1000).toFixed(2) + ' seconds'} onChange={event => p.seek(Number(event.target.value))} />
    {children}
    <details><summary>Frame and key controls</summary><p className="secondary">{p.frameMode ? 'Keyframe mode. Step through the keyframes or move the timeline.' : 'Both takes use the same elapsed time.'} A shorter take holds its end frame.</p><div className="controls"><button onClick={() => p.seek([...keys].reverse().find(time => time < p.elapsedMs) ?? 0)}>Previous comparison key</button><button onClick={() => p.seek(keys.find(time => time > p.elapsedMs) ?? clock.durationMs)}>Next comparison key</button><button onClick={() => p.setFrameMode(!p.frameMode)}>{p.frameMode ? 'Enable comparison animation' : 'Comparison frame by frame'}</button></div></details>
    <details onToggle={event => setNumericOpen(event.currentTarget.open)}><summary>Numeric changes</summary><p>Second minus first duration: {diff.durationChangeMs} ms.</p>{diff.compatibleActors ? <p>{diff.changedFields} exact transform or easing fields changed at {diff.changedKeys} shared actor keyframes. {diff.addedKeys} actor keyframes added; {diff.removedKeys} removed.</p> : <p>The actor roster or paint order differs. Keyframe field counts are not comparable.</p>}<p className="secondary">These counts compare stored fields at matching actor times. They do not measure meaning, quality or improvement.</p>{numericOpen && diff.compatibleActors && <ChangeDetails changes={changes} seek={p.seek} leftLabel={leftLabel} rightLabel={rightLabel} />}</details>
  </section>;
}
