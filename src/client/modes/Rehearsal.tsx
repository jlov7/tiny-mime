import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { MotionScoreV1 } from '../../shared/score.js';
import { validateScore } from '../../shared/validateScore.js';
import { sampleScore } from '../../shared/sampleScore.js';
import { request } from '../api.js';
import { Stage } from '../Stage.js';
import { usePlayback, unionKeyTimes } from '../usePlayback.js';
import type { ScoreError, ScoreErrorCode, ValidationResult } from '../../shared/score.js';
import { CandidateWorkbench } from '../workbench/CandidateWorkbench.js';
import { locateScoreError } from '../workbench/draft.js';
import { getCandidate, type Candidate } from '../workspaceApi.js';
import { getShowcases, type DirectingExample } from '../showcaseApi.js';
import { rehearsalEntry } from '../routes.js';
import { CandidateLibrary } from '../workbench/CandidateLibrary.js';
import { WorkspaceTransfer } from '../workbench/WorkspaceTransfer.js';

const scoreHelp: Record<ScoreErrorCode, string> = { PARSE: 'Use valid JSON.', BYTES: 'Keep the score within the 65,536-byte limit.', DEPTH: 'Remove excessive nesting.', DUPLICATE_KEY: 'Remove the repeated property.', UNKNOWN_KEY: 'Remove properties outside MotionScoreV1.', SCHEMA: 'Use the required numeric fields and supported shape values.', ROSTER: 'Keep the selected scene’s actor IDs, order, shapes and colours.', TIMELINE: 'Start at 0, end at the clip duration and keep at least 250 ms between keys.', BOUNDS: 'Keep transforms within the allowed stage, rotation and scale limits.', SPEED: 'Slow this segment or reduce its movement.', CONTACT: 'Move the actors farther apart throughout this segment.', CONTACT_UNCERTAIN: 'Increase clearance so non-contact can be proved continuously.' };

export function Rehearsal({ references }: { references: any[] }) {
  const [entry] = useState(() => rehearsalEntry(location.search)); const entryConsumed = useRef(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [examples, setExamples] = useState<DirectingExample[] | null>(null);
  const [examplesError, setExamplesError] = useState(false); const [examplesAttempt, setExamplesAttempt] = useState(0);
  useEffect(() => { let active = true; const controller = new AbortController(); setExamples(null); setExamplesError(false); getShowcases(controller.signal).then(values => { if (active) setExamples(values); }).catch(() => { if (active) { setExamples([]); setExamplesError(true); } }); return () => { active = false; controller.abort(); }; }, [loadAttempt, examplesAttempt]);
  const [catalogue, setCatalogue] = useState<any[]>([]); const [selection, setSelection] = useState({ sceneId: '', take: 'first' as 'first' | 'second', candidateId: null as string | null });
  const selected = selection.sceneId;
  const [record, setRecord] = useState<any>(null); const [prepared, setPrepared] = useState<DirectingExample | null>(null); const [referenceId, setReferenceId] = useState('');
  const [width, setWidth] = useState(820); const [speed, setSpeed] = useState(1); const [tracks, setTracks] = useState(false); const [details, setDetails] = useState(false); const [target, setTarget] = useState(false);
  const [candidate, setCandidate] = useState<Candidate | null>(null); const [workbenchDirty, setWorkbenchDirty] = useState(false); const [workbenchEpoch, setWorkbenchEpoch] = useState(0); const [libraryRevision, setLibraryRevision] = useState(0); const [forkTitle, setForkTitle] = useState<string | undefined>();
  const desk = useRef<HTMLDivElement>(null); const [compactDesk, setCompactDesk] = useState(false);
  useEffect(() => { const element = desk.current; if (!element) return; const observer = new ResizeObserver(([entry]) => setCompactDesk(entry.contentRect.width < 1050)); observer.observe(element); return () => observer.disconnect(); }, []);
  const [stageHost, setStageHost] = useState<HTMLDivElement | null>(null); const [docked, setDocked] = useState(false);
  const noteCapture = useRef<((atMs: number) => void) | null>(null);
  const editCapture = useRef<((atMs: number) => void) | null>(null); const stageRegion = useRef<HTMLElement>(null);
  const [importKind, setImportKind] = useState('Imported'); const clock = useRef(0); const rawInput = useRef<HTMLTextAreaElement>(null);
  const [errorContext, setErrorContext] = useState(''); const [focusTime, setFocusTime] = useState<{ atMs: number; sequence: number } | null>(null);
  const [raw, setRaw] = useState(''); const [validation, setValidation] = useState<any>(null); const [imported, setImported] = useState<MotionScoreV1 | null>(null); const [error, setError] = useState('');
  const [notice, setNotice] = useState<{ text: string } | null>(null); const noticeTarget = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (notice) noticeTarget.current?.focus(); }, [notice]);
  const [loading, setLoading] = useState(true); const [validating, setValidating] = useState(false); const importEpoch = useRef(0);
  useEffect(() => {
    let active = true; setError('');
    async function loadCatalogue() {
      try {
        const data = await request('/api/operator/scenes');
        if (!active) return;
        setCatalogue(data.records);
        if (entryConsumed.current) return;
        const saved = entry?.candidate ? await getCandidate(entry.candidate) : null;
        if (!active || entryConsumed.current) return;
        const requested = saved?.sceneId ?? entry?.scene;
        const first = data.records.find((r: any) => r.sceneId === requested && r.contentStatus !== 'deferred_contact')?.sceneId ?? data.records.find((r: any) => r.contentStatus !== 'deferred_contact')?.sceneId;
        if (!first || (saved && first !== saved.sceneId)) throw new Error('SCENE_UNAVAILABLE');
        entryConsumed.current = true;
        setSelection({ sceneId: first, take: entry?.take ?? 'first', candidateId: saved?.candidateId ?? null });
      } catch { if (active && !entryConsumed.current) { setLoading(false); setError(entry?.candidate ? 'This saved version could not open. Retry, find another saved version, or choose an authored scene.' : 'The rehearsal catalogue could not load. Retry the local connection or unlock operator tools.'); } }
    }
    void loadCatalogue(); return () => { active = false; };
  }, [loadAttempt]);
  const preparedExamples = selection.take === 'second' && !selection.candidateId ? examples : null;
  useEffect(() => {
    if (!selected || (selection.take === 'second' && !selection.candidateId && preparedExamples === null)) return;
    let active = true; const controller = new AbortController(); importEpoch.current++;
    setValidating(false); setLoading(true); setRecord(null); setPrepared(null); setNotice(null); setImported(null); setCandidate(null); setForkTitle(undefined); setWorkbenchDirty(false); setRaw(''); setErrorContext(''); setFocusTime(null); clock.current = 0; setTarget(false); setValidation(null); setError('');
    async function loadScore() {
      try {
        const data = await request(`/api/operator/scenes/${selected}/score`, undefined, controller.signal);
        const saved = selection.candidateId ? await getCandidate(selection.candidateId, data.score.actors) : null;
        const example = !saved && selection.take === 'second' ? preparedExamples?.find(example => example.id === selected) : null;
        if (saved && saved.sceneId !== selected) throw new Error('INVALID_CANDIDATE');
        if (!saved && selection.take === 'second' && (!example || example.left.scoreHash !== data.scoreHash)) throw new Error('PREPARED_TAKE_UNAVAILABLE');
        if (!active) return;
        setRecord(data); setPrepared(example ?? null);
        if (saved) { setCandidate(saved); setImported(saved.score); setImportKind('Saved candidate'); setNotice({ text: 'Saved candidate loaded for rehearsal.' }); }
        setLoading(false);
      } catch { if (active) { setLoading(false); setError(selection.take === 'second' ? 'The prepared second take could not load. Retry, or choose the authored first take.' : 'This draft could not load. Retry the local connection.'); } }
    }
    void loadScore(); return () => { active = false; controller.abort(); importEpoch.current++; };
  }, [selection, loadAttempt, preparedExamples]);
  const reference = references.find(r => r.id === referenceId); const baseScore = selection.take === 'second' && !selection.candidateId ? prepared?.right.score : record?.score;
  const score = reference?.variants[0].score ?? imported ?? baseScore;
  const activeValidation = useMemo(() => score ? validateScore(JSON.stringify(score), score.actors.map(({ id, shape, color }: any) => ({ id, shape, color }))) : null, [score]);
  const activeHash = activeValidation?.ok ? activeValidation.scoreHash : null;
  const sceneScore = imported ?? baseScore;
  const sceneValidation = useMemo(() => sceneScore && record ? validateScore(JSON.stringify(sceneScore), record.score.actors) : null, [sceneScore, record]);
  const dirty = workbenchDirty || !!raw.trim() || (!!imported && candidate?.scoreHash !== (sceneValidation?.ok ? sceneValidation.scoreHash : null));
  function confirmReplace() { return !dirty || window.confirm('Discard unsaved rehearsal edits, import text and notes? Saved candidate versions are kept.'); }
  useEffect(() => { if (!dirty) return; const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn); }, [dirty]);
  const meaning = catalogue.find(m => m.sceneId === selected);
  function chooseSource(take: 'first' | 'second') {
    if (!confirmReplace()) return;
    entryConsumed.current = true; setReferenceId(''); setWorkbenchEpoch(n => n + 1);
    history.replaceState(null, '', '/rehearsal?scene=' + selected + (take === 'second' ? '&take=second' : ''));
    setSelection({ sceneId: selected, take, candidateId: null });
  }
  function restoreAuthored() { chooseSource('first'); }
  async function acceptScore(next: MotionScoreV1, kind: string, title?: string): Promise<boolean> {
    if (!record || validating) return false;
    const epoch = importEpoch.current; const sceneId = selected;
    const result = validateScore(JSON.stringify(next), record.score.actors);
    setNotice(null); setValidation(result.ok || kind === 'Edited' ? null : result); if (!result.ok) return false;
    setValidating(true); setError('');
    try {
      const server = await request<ValidationResult>('/api/operator/scores/validate', { requestId: crypto.randomUUID(), sceneId, score: result.score });
      if (epoch !== importEpoch.current) return false;
      const checked = server.ok ? validateScore(JSON.stringify(server.score), record.score.actors) : server;
      setValidation(kind === 'Edited' ? null : checked);
      if (checked.ok) { const atMs = kind === 'Edited' ? Math.min(checked.score.durationMs, Math.max(0, Math.round(clock.current))) : 0; setNotice({ text: kind === 'Imported' ? 'Imported score is now in rehearsal.' : 'Edited score is now in rehearsal.' }); setImported(checked.score); setImportKind(kind); setForkTitle(title); setReferenceId(''); setFocusTime(previous => ({ atMs, sequence: (previous?.sequence ?? 0) + 1 })); setTarget(false); setErrorContext(''); setWorkbenchDirty(false); setWorkbenchEpoch(n => n + 1); return true; }
    } catch { if (epoch === importEpoch.current) setError('Validation could not reach the local server. Your import was kept. Try again.'); }
    finally { if (epoch === importEpoch.current) setValidating(false); }
    return false;
  }
  async function validateImport() {
    if (!record || validating) return;
    const result = validateScore(raw, record.score.actors);
    setNotice(null); setValidation(result.ok ? null : result); if (!result.ok) return;
    if (workbenchDirty && !window.confirm('Discard unsaved candidate notes and numeric edits to rehearse this import? Saved versions are kept.')) return;
    await acceptScore(result.score, 'Imported');
  }
  function loadCandidate(next: Candidate) {
    if (!confirmReplace()) return false;
    if (next.sceneId !== selected) return false;
    importEpoch.current++; setValidating(false); setNotice({ text: 'Saved candidate loaded for rehearsal.' }); setCandidate(next); setImported(next.score); setImportKind('Saved candidate'); setForkTitle(undefined); setReferenceId(''); setFocusTime(null); clock.current = 0; setTarget(false); setRaw(''); setValidation(null); setErrorContext(''); setWorkbenchDirty(false); setWorkbenchEpoch(n => n + 1); history.replaceState(null, '', '/rehearsal?candidate=' + next.candidateId); return true;
  }
  function showError(issue: ScoreError) {
    const location = locateScoreError(raw, issue); const textarea = rawInput.current;
    textarea?.focus(); textarea?.setSelectionRange(location.start, location.end);
    setErrorContext(location.context);
    if (location.atMs !== undefined) setFocusTime({ atMs: location.atMs, sequence: Date.now() });
  }
  function inspectDraft(next: MotionScoreV1, issue: ScoreError) {
    const text = JSON.stringify(next, null, 2);
    if (raw.trim() && raw !== text && !window.confirm('Replace the current import text with this edit fork for inspection? The fork is kept either way.')) return;
    const location = locateScoreError(text, issue);
    setRaw(text); setValidation(validateScore(text, record.score.actors)); setErrorContext(location.context);
    if (location.atMs !== undefined) setFocusTime({ atMs: location.atMs, sequence: Date.now() });
    requestAnimationFrame(() => { const textarea = rawInput.current; const panel = textarea?.closest('details'); if (panel) panel.open = true; textarea?.focus(); textarea?.setSelectionRange(location.start, location.end); });
  }
  function seekTo(atMs: number, showStage = false) {
    setFocusTime(previous => ({ atMs, sequence: (previous?.sequence ?? 0) + 1 }));
    if (showStage) requestAnimationFrame(() => { stageRegion.current?.scrollIntoView({ block: 'start' }); stageRegion.current?.focus({ preventScroll: true }); });
  }
  return <main className="rehearsal" data-score-hash={activeHash ?? undefined}>
    <div className="room-heading"><div><h1>Rehearsal room.</h1><p className="intro">Choose a take. Inspect a moment, make a revision and compare.</p></div>
    {error && <p role="alert" className="error">{error} <a href="/operator-unlock?next=%2Frehearsal">Unlock operator tools</a></p>}
    {error && !record && <button onClick={() => setLoadAttempt(n => n + 1)}>Retry rehearsal</button>}
    {loading && <p role="status">Loading the authored draft…</p>}
    <div className="toolbar scene-toolbar">
      <label>Scene<select aria-label="Scene" disabled={!catalogue.length} value={selected} onChange={e => { if (!confirmReplace()) { e.currentTarget.value = selected; return; } entryConsumed.current = true; importEpoch.current++; setSelection({ sceneId: e.target.value, take: 'first', candidateId: null }); history.replaceState(null, '', '/rehearsal?scene=' + e.target.value); setReferenceId(''); setWorkbenchEpoch(n => n + 1); }}>
        {catalogue.map(m => <option key={m.sceneId} value={m.sceneId} disabled={m.contentStatus === 'deferred_contact'}>{m.sceneId} · {m.title}{m.contentStatus === 'deferred_contact' ? ' · Deferred: requires contact' : ''}</option>)}
      </select></label>
      {(examples?.some(example => example.id === selected) || selection.take === 'second') && <div className="controls rehearsal-sources" role="group" aria-label="Authored source take"><button aria-label="Authored first take" aria-pressed={!imported && !reference && selection.take === 'first'} onClick={() => chooseSource('first')}>First take</button><button disabled={!examples?.some(example => example.id === selected)} aria-label="Prepared second take" aria-pressed={!imported && !reference && selection.take === 'second'} onClick={() => chooseSource('second')}>Second take</button></div>}
    </div>
    </div>
    {record && examplesError && <p role="alert">Prepared takes could not load. Your active score and edits are kept. <button onClick={() => setExamplesAttempt(value => value + 1)}>Retry prepared takes</button></p>}
    {!record && !loading && <WorkspaceTransfer onRestored={() => setLibraryRevision(value => value + 1)} />}
    {!record && !loading && <CandidateLibrary currentId={null} refreshKey={String(libraryRevision)} />}
    {notice && !reference && <p ref={noticeTarget} className="activation-notice" role="status" tabIndex={-1}>{notice.text}</p>}
    <div className={"directing-desk" + (compactDesk ? " compact-desk" : "")} ref={desk}>
      <div className="directing-stage">
    {activeHash && <section className="active-rehearsal" aria-label="Active rehearsal stage" ref={stageRegion} tabIndex={-1}><div hidden={docked}><RehearsalPlayer suspended={docked} key={activeHash + referenceId} score={score} reference={reference} width={width} speed={speed} tracks={tracks} clock={clock} focusTime={focusTime} onNote={atMs => noteCapture.current?.(atMs)} onEdit={atMs => editCapture.current?.(atMs)} /></div><div className="directing-stage-host" ref={setStageHost} hidden={!docked} /></section>}
      </div>
    {record && sceneValidation?.ok && <div hidden={!!reference}><CandidateWorkbench preparedExample={examples?.find(example => example.id === selected) ?? null} active={!reference} stageHost={stageHost} onDock={setDocked} libraryRevision={libraryRevision} workspaceTools={<WorkspaceTransfer onRestored={() => setLibraryRevision(value => value + 1)} />} key={`${selected}-${workbenchEpoch}`} sceneId={selected} authored={record.score} scoreSource={candidate?.scoreHash === sceneValidation.scoreHash ? 'operator_saved_score' : imported ? 'imported_score' : 'authored_fixture'} score={sceneValidation.score} scoreHash={sceneValidation.scoreHash} candidate={candidate} initialTitle={forkTitle} time={clock} noteCapture={noteCapture} editCapture={editCapture} onSeek={seekTo} onDirty={setWorkbenchDirty} onLoad={loadCandidate} onApply={(next, title) => acceptScore(next, 'Edited', title)} onInspect={inspectDraft} onSaved={saved => { setNotice(null); setLibraryRevision(value => value + 1); setCandidate(saved); history.replaceState(null, '', '/rehearsal?candidate=' + saved.candidateId); }} onRemoved={id => { setNotice(null); setLibraryRevision(value => value + 1); if (candidate?.candidateId === id) { setCandidate(null); setImportKind('Edited'); history.replaceState(null, '', '/rehearsal?scene=' + selected); } }} /></div>}
    </div>
    <details className="rehearsal-settings"><summary>Rehearsal settings</summary><div className="toolbar"><label>Stage preview<select value={width} onChange={e => setWidth(Number(e.target.value))}><option value={820}>Desktop 820 px</option><option value={358}>Phone 358 px</option><option value={288}>Narrow phone 288 px</option></select></label><label>Playback speed<select value={speed} onChange={e => setSpeed(Number(e.target.value))}><option value={1}>1× rehearsal playback</option><option value={0.5}>0.5× rehearsal playback</option></select></label></div></details>
    <p className="provenance">{reference ? `Test fixture · ${reference.id} · ${reference.title} · matched motion reference` : imported ? `${importKind} score · local validation · unreviewed` : selection.take === 'second' ? 'Prepared authored second take · fixed directing alternative · no adaptation' : 'Authored first take'}{!reference && !imported && selection.take === 'first' && record ? ` · ${record.authorship.authoringMethod === 'spec_transcribed' ? 'Transcribed from the beat guide' : 'Agent-assisted draft'}` : ''} · Human review and calibration: NOT RUN</p>
    <div className="controls"><button onClick={() => setTracks(!tracks)} aria-pressed={tracks}>Show tracks</button><button onClick={() => setDetails(!details)} aria-pressed={details}>Show validator details</button><button disabled={!!reference} onClick={() => setTarget(!target)} aria-expanded={target}>View target</button><button disabled={!record} onClick={restoreAuthored}>Restore authored draft</button></div>
    {target && !reference && meaning && <section className="annotation"><h2>{meaning.title}</h2><p>{meaning.target}</p><ol>{meaning.coreEvent.map((event: any, i: number) => <li key={i}>{typeof event === 'string' ? event : event.assertion ?? JSON.stringify(event)}</li>)}</ol></section>}
    {details && activeHash && <section className="annotation"><h2>Validated numeric score</h2><p>Strict schema, timing, rates, roster and continuous pair clearance passed. This certifies motion safety, not meaning.</p><dl><dt>Score hash</dt><dd className="hash">{activeHash}</dd><dt>Geometry</dt><dd>svg-shapes-v1</dd><dt>Clearance certificate</dt><dd>noncontact-v1 · strictly above 129.000001 units</dd><dt>Authorship</dt><dd>{reference ? 'Test fixture' : imported ? `${importKind} score · unreviewed` : selection.take === 'second' ? 'Prepared authored directing alternative; human review not_run' : `${record.authorship.authoringMethod}; human review ${record.authorship.humanReview}`}</dd></dl></section>}
    {record && !reference && !imported && selection.take === 'first' && <p><a className="button" href={`/creator/capture?scene=${selected}`}>Use authored scene in creator capture</a></p>}

    <section className="section"><h2>Matched motion references</h2><p>Each pair shares its setup. The same clock drives both panes. Frame steps include every key in either pane.</p><label>Comparison<select value={referenceId} onChange={e => { importEpoch.current++; setValidating(false); setTarget(false); setReferenceId(e.target.value); }}><option value="">Scene only</option>{references.map(r => <option key={r.id} value={r.id}>{r.id} · {r.title}</option>)}</select></label></section>
    <details className="section"><summary>Import a score for local validation</summary><p>Import never changes the frozen bank. Use the selected scene’s cast. A clip lasts 6–10 seconds, with 2–3 actors and no contact.</p><label>MotionScoreV1 JSON<textarea ref={rawInput} value={raw} onChange={e => { setRaw(e.target.value); setValidation(null); setErrorContext(''); }} disabled={validating} aria-describedby={validation && !validation.ok ? 'import-errors' : undefined} spellCheck={false} rows={8} /></label><button disabled={!record || !raw.trim() || validating} onClick={validateImport}>{validating ? 'Validating score…' : 'Validate score'}</button>{validation && !validation.ok && <ul id="import-errors" role="status" className="validator-errors">{validation.errors.map((e: ScoreError, i: number) => <li key={i}><button type="button" onClick={() => showError(e)}>{scoreHelp[e.code] ?? 'Check the score contract.'} <code>{e.code} {e.path}</code></button></li>)}</ul>}{errorContext && <p className="validation-location" role="status">{errorContext}. The relevant JSON is selected above.</p>}</details>
  </main>;
}
function RehearsalPlayer({ suspended, score, reference, width, speed, tracks, clock, focusTime, onNote, onEdit }: { suspended: boolean; score: MotionScoreV1; reference: any; width: number; speed: number; tracks: boolean; clock: React.RefObject<number>; focusTime: { atMs: number; sequence: number } | null; onNote: (atMs: number) => void; onEdit: (atMs: number) => void }) {
  const p = usePlayback(score, { speed }); const times = [...new Set<number>((reference?.variants ?? [{ score }]).flatMap((v: { score: MotionScoreV1 }) => unionKeyTimes(v.score)))].sort((a, b) => a - b); const frame = sampleScore(score, p.elapsedMs);
  const [visibleVariant, setVisibleVariant] = useState(0);
  useEffect(() => { setVisibleVariant(0); }, [reference?.id]);
  const [loopStart, setLoopStart] = useState(0); const [loopEnd, setLoopEnd] = useState(score.durationMs); const [loop, setLoop] = useState(false); const [loopPlaying, setLoopPlaying] = useState(false);
  useLayoutEffect(() => { if (suspended) { p.pause(); setLoopPlaying(false); } }, [suspended, p.pause]);
  const loopValid = Number.isInteger(loopStart) && Number.isInteger(loopEnd) && loopStart >= 0 && loopEnd <= score.durationMs && loopEnd - loopStart >= 250;
  const pRef = useRef(p); pRef.current = p; if (!suspended) clock.current = p.elapsedMs;
  useEffect(() => { if (focusTime) { setLoopPlaying(false); clock.current = focusTime.atMs; p.seek(focusTime.atMs); } }, [focusTime, p.seek]);
  useEffect(() => { setLoopPlaying(false); }, [speed, loopStart, loopEnd, loop, p.frameMode]);
  useEffect(() => {
    const stop = () => { if (document.hidden) setLoopPlaying(false); }; document.addEventListener('visibilitychange', stop);
    return () => document.removeEventListener('visibilitychange', stop);
  }, []);
  useEffect(() => {
    if (!loopPlaying || !loopValid || p.frameMode) return;
    const begin = performance.now(); const offset = pRef.current.elapsedMs >= loopStart && pRef.current.elapsedMs < loopEnd ? pRef.current.elapsedMs : loopStart; let raf = 0;
    const tick = (now: number) => { if (document.hidden) { setLoopPlaying(false); return; } pRef.current.seek(loopStart + ((offset - loopStart + (now - begin) * speed) % (loopEnd - loopStart))); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf);
  }, [loopPlaying, loopValid, loopStart, loopEnd, speed, p.frameMode]);
  function seek(value: number) { setLoopPlaying(false); p.seek(value); }
  function togglePlay() { if (loopPlaying || p.playing) { setLoopPlaying(false); p.pause(); } else if (p.frameMode) seek(times.find(t => t > p.elapsedMs) ?? score.durationMs); else if (loop && loopValid) { p.pause(); setLoopPlaying(true); } else p.play(); }
  const preview = useRef<HTMLDivElement>(null); const [actualWidth, setActualWidth] = useState(0);
  useEffect(() => { const stage = preview.current?.querySelector(reference ? '.selected-take svg.stage' : 'svg.stage'); if (!stage) return; const observer = new ResizeObserver(entries => setActualWidth(entries[0].contentRect.width)); observer.observe(stage); return () => observer.disconnect(); }, [score, visibleVariant, reference]);
  return <>
    {reference && <div className="comparison-takes" role="group" aria-label="Visible motion reference">{reference.variants.map((v: any, index: number) => <button key={index} aria-pressed={visibleVariant === index} onClick={() => { setLoopPlaying(false); p.pause(); setVisibleVariant(index); }}>Show reference {index + 1}</button>)}</div>}
    <div ref={preview} className={'rehearsal-frames' + (reference ? ' comparison' : '')} style={{ '--preview-width': `${width}px` } as React.CSSProperties}>
      {(reference?.variants ?? [{ name: '', score }]).map((v: any, i: number) => <div key={i} className={'preview' + (visibleVariant === i ? ' selected-take' : '')}><div className="stage-surround"><Stage score={v.score} elapsedMs={p.elapsedMs} /></div>{v.name && <p>{v.name}</p>}</div>)}
    </div>
    <div className="controls"><button className="primary" disabled={p.frameMode ? p.elapsedMs >= score.durationMs : loop && !loopValid} onClick={togglePlay}>{p.playing || loopPlaying ? 'Pause' : p.frameMode ? 'Next frame' : 'Play'}</button><button onClick={() => seek(0)}>Reset</button><button onClick={() => { setLoopPlaying(false); p.setFrameMode(!p.frameMode); }}>{p.frameMode ? 'Play animation' : 'Frame by frame'}</button>{!reference && <><button onClick={() => { const atMs = Math.round(p.elapsedMs); seek(atMs); onNote(atMs); }} aria-describedby="note-capture-help">Note this frame</button><button onClick={() => { const atMs = Math.round(p.elapsedMs); seek(atMs); onEdit(atMs); }}>Edit this moment</button></>}</div>
    {!reference && <p id="note-capture-help" className="secondary">Pause here to note this exact frame.</p>}
    <label className="scrub">Timeline · {Math.round(p.elapsedMs)} / {score.durationMs} ms<input type="range" aria-valuetext={`${(p.elapsedMs / 1000).toFixed(2)} of ${(score.durationMs / 1000).toFixed(2)} seconds`} min={0} max={score.durationMs} step={1} value={p.elapsedMs} onChange={e => seek(Number(e.target.value))} /></label>
    <details><summary>Frame and key controls</summary><div className="controls"><button onClick={() => seek([...times].reverse().find(t => t < p.elapsedMs) ?? 0)}>Previous keyframe</button><button onClick={() => seek(times.find(t => t > p.elapsedMs) ?? score.durationMs)}>Next keyframe</button></div></details>
    {!reference && <details><summary>Loop a rehearsal interval</summary><div className="loop-controls"><label>Loop start (ms)<input type="number" min={0} max={score.durationMs - 250} step={1} value={Number.isFinite(loopStart) ? loopStart : ''} onChange={e => { p.pause(); setLoopPlaying(false); setLoopStart(e.target.value === '' ? NaN : Number(e.target.value)); }} /></label><label>Loop end (ms)<input type="number" min={250} max={score.durationMs} step={1} value={Number.isFinite(loopEnd) ? loopEnd : ''} onChange={e => { p.pause(); setLoopPlaying(false); setLoopEnd(e.target.value === '' ? NaN : Number(e.target.value)); }} /></label><label><input type="checkbox" checked={loop} disabled={!loopValid && !loop} onChange={e => { p.pause(); setLoopPlaying(false); setLoop(e.target.checked); }} /> Loop selected interval</label></div>{!loopValid && <p role="status">Choose an interval inside this clip, at least 250 ms long.</p>}<p className="secondary">Press Play to start. Reduced motion uses manual frame steps.</p></details>}
    <p className="secondary">Actual stage width {Math.round(actualWidth)} CSS px. Physical-device testing: NOT RUN.</p>
    {tracks && <div className="tracks"><h2>Actor tracks and sampled transforms</h2><div className="table-scroll"><table><thead><tr><th>Actor</th><th>x</th><th>y</th><th>Rotation</th><th>Scale x / y</th></tr></thead><tbody>{frame.map(f => <tr key={f.id}><th>{f.id}</th><td>{f.x.toFixed(2)}</td><td>{f.y.toFixed(2)}</td><td>{f.rotationDeg.toFixed(2)}°</td><td>{f.scaleX.toFixed(2)} / {f.scaleY.toFixed(2)}</td></tr>)}</tbody></table></div><div className="track-lines">{score.actors.map(a => <figure key={a.id}><svg viewBox="0 0 1000 700" role="img" aria-label={`Numeric path for actor ${a.id}`}><polyline points={a.keyframes.map(k => `${k.x},${k.y}`).join(' ')} fill="none" stroke="#555A53" strokeWidth={6} />{a.keyframes.map(k => <circle key={k.tMs} cx={k.x} cy={k.y} r={8} fill="#2B675A" />)}</svg><figcaption>Actor {a.id} · {a.keyframes.length} keys</figcaption></figure>)}</div></div>}
  </>;
}
