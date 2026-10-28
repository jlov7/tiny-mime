import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { MotionScoreV1, ScoreError } from '../../shared/score.js';
import { validateScore } from '../../shared/validateScore.js';
import { ScoreComparison } from '../components/ScoreComparison.js';
import { downloadInspection, getCandidate, listCandidates, removeCandidate, saveCandidate, type Candidate, type CandidateNote, type CandidateSummary } from '../workspaceApi.js';
import { HttpFailure } from '../request.js';
import { editKeyframe, numericFields, undoEdit, type EditHistory } from './draft.js';
import { CandidateLibrary } from './CandidateLibrary.js';
import { request } from '../request.js';
import type { DirectingExample } from '../showcaseApi.js';

const compactFieldLabels = { tMs: 'Time (ms)', x: 'X position', y: 'Y position', rotationDeg: 'Rotation (°)', scaleX: 'Scale X', scaleY: 'Scale Y' };
const fieldLabels = { tMs: 'Time (ms)', x: 'Horizontal position (x)', y: 'Vertical position (y)', rotationDeg: 'Rotation (degrees)', scaleX: 'Horizontal scale', scaleY: 'Vertical scale' };

type Props = {
  sceneId: string; authored: MotionScoreV1; scoreSource?: 'authored_fixture' | 'operator_saved_score' | 'imported_score'; score: MotionScoreV1; scoreHash: string; candidate: Candidate | null; initialTitle?: string;
  time: React.RefObject<number>; noteCapture: React.RefObject<((atMs: number) => void) | null>; editCapture: React.RefObject<((atMs: number) => void) | null>; onSeek: (atMs: number, showStage?: boolean) => void; onDirty: (dirty: boolean) => void; onLoad: (candidate: Candidate) => boolean;
  preparedExample: DirectingExample | null; active: boolean; stageHost: HTMLElement | null; onDock: (active: boolean) => void; libraryRevision: number; workspaceTools: React.ReactNode;
  onApply: (score: MotionScoreV1, title: string) => Promise<boolean>; onInspect: (score: MotionScoreV1, issue: ScoreError) => void; onSaved: (candidate: Candidate) => void; onRemoved: (candidateId: string) => void;
};
export function CandidateWorkbench({ sceneId, authored, scoreSource = 'imported_score', score, scoreHash, candidate, initialTitle, time, noteCapture, editCapture, onSeek, onDirty, onLoad, onApply, onInspect, onSaved, onRemoved, stageHost, onDock, libraryRevision, workspaceTools, preparedExample, active }: Props) {
  const [panel, setPanel] = useState<'revise' | 'compare' | 'notes' | 'versions'>('revise');
  const noteId = useId(); const [candidates, setCandidates] = useState<CandidateSummary[]>([]); const [listError, setListError] = useState(false);
  const [title, setTitle] = useState(initialTitle ?? candidate?.title ?? '');
  const initialNotes = candidate?.scoreHash === scoreHash ? candidate.notes : [];
  const [notes, setNotes] = useState<CandidateNote[]>(initialNotes); const [noteText, setNoteText] = useState('');
  const [noteFrame, setNoteFrame] = useState<{ atMs: number; scoreHash: string } | null>(null);
  const notePanel = useRef<HTMLElement>(null); const noteInput = useRef<HTMLTextAreaElement>(null);
  const [captureFocus, setCaptureFocus] = useState<'notes' | 'edit' | null>(null);
  useLayoutEffect(() => {
    noteCapture.current = atMs => {
      setNoteFrame({ atMs, scoreHash });
      setPanel('notes');
      setCaptureFocus('notes');
    };
    return () => { noteCapture.current = null; };
  }, [noteCapture, scoreHash]);
  const [history, setHistory] = useState<EditHistory | null>(null); const [actor, setActor] = useState(0); const [keyIndex, setKeyIndex] = useState(0);
  const [forkPreview, setForkPreview] = useState(false); const editPanel = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    editCapture.current = atMs => {
      if (!history) { setKeyIndex(Math.max(0, score.actors[actor].keyframes.findLastIndex(key => key.tMs <= atMs))); setHistory({ score: structuredClone(score), undo: [] }); }
      setPanel('revise'); setForkPreview(false);
      setCaptureFocus('edit');
    };
    return () => { editCapture.current = null; };
  }, [editCapture, history, score, actor]);
  useLayoutEffect(() => {
    if (!captureFocus) return;
    const target = captureFocus === 'notes' ? noteInput.current : editPanel.current?.querySelector<HTMLInputElement>('.numeric-fields input:not(:disabled)');
    target?.focus({ preventScroll: true });
    (captureFocus === 'edit' ? editPanel.current : target)?.scrollIntoView({ block: 'nearest' });
    setCaptureFocus(null);
  }, [captureFocus]);
  const comparisonOpen = panel === 'compare'; const [comparisonId, setComparisonId] = useState(''); const [comparison, setComparison] = useState<Candidate | null>(null);
  const [preparedComparison, setPreparedComparison] = useState<DirectingExample['right'] | null>(null);
  const comparisonPanel = useRef<HTMLElement>(null); const [focusComparison, setFocusComparison] = useState(false);
  const [error, setError] = useState(''); const [status, setStatus] = useState(''); const [busy, setBusy] = useState(false);
  const refreshEpoch = useRef(0); const alive = useRef(true); const loadEpoch = useRef(0); const comparisonEpoch = useRef(0);
  const pendingRemovals = useRef(new Map<string, string>());
  const pendingSave = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const roster = authored.actors.map(({ id, shape, color }) => ({ id, shape, color }));
  const sourceNotesDirty = JSON.stringify(notes) !== JSON.stringify(initialNotes) || !!noteText;
  const unchangedSaved = candidate?.scoreHash === scoreHash && title.trim() === candidate.title && JSON.stringify(notes) === JSON.stringify(candidate.notes);
  const dirty = history !== null || title.trim() !== (candidate?.title ?? '') || sourceNotesDirty;
  useLayoutEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  useEffect(() => { alive.current = true; void refresh(); return () => { alive.current = false; loadEpoch.current++; comparisonEpoch.current++; }; }, []);
  useEffect(() => { if (libraryRevision > 0) void refresh(); }, [libraryRevision]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  async function refresh() {
    const epoch = ++refreshEpoch.current;
    try { const values = await listCandidates(); if (alive.current && epoch === refreshEpoch.current) { setCandidates(values); setListError(false); } }
    catch { if (alive.current && epoch === refreshEpoch.current) setListError(true); }
  }
  async function load(id: string) {
    const epoch = ++loadEpoch.current; setBusy(true); setError('');
    try { const next = await getCandidate(id, roster); if (!alive.current || epoch !== loadEpoch.current) return; if (next.sceneId !== sceneId) throw new Error('INVALID_CANDIDATE'); onLoad(next); }
    catch { if (alive.current && epoch === loadEpoch.current) setError('This candidate could not load. Your current draft was kept.'); }
    finally { if (alive.current && epoch === loadEpoch.current) setBusy(false); }
  }
  async function chooseComparison(id: string) {
    const epoch = ++comparisonEpoch.current; setComparisonId(id); setComparison(null); setPreparedComparison(null); setError('');
    if (!id || id === 'authored') return;
    try {
      if (id === 'prepared') {
        const example = preparedExample;
        if (!alive.current || epoch !== comparisonEpoch.current) return;
        const bank = validateScore(JSON.stringify(authored), roster);
        if (!example || !bank.ok || example.left.scoreHash !== bank.scoreHash) throw new Error('INVALID_PREPARED_BASELINE');
        setPreparedComparison(example.right);
      } else {
        const next = await getCandidate(id, roster); if (!alive.current || epoch !== comparisonEpoch.current) return; if (next.sceneId !== sceneId) throw new Error('INVALID_CANDIDATE'); setComparison(next);
      }
    } catch { if (alive.current && epoch === comparisonEpoch.current) { setComparisonId(''); setFocusComparison(false); setError('The comparison could not load. Choose a baseline to try again.'); } }
  }
  async function save(asSource = false) {
    if (busy || (history && !asSource) || !title.trim() || noteText.trim() || unchangedSaved) return;
    setBusy(true); setError(''); setStatus('');
    const input = { sceneId, title: title.trim(), score, parentCandidateId: candidate?.candidateId ?? null, notes };
    const fingerprint = JSON.stringify(input);
    if (pendingSave.current?.fingerprint !== fingerprint) pendingSave.current = { fingerprint, requestId: crypto.randomUUID() };
    try {
      const saved = await saveCandidate({ ...input, requestId: pendingSave.current.requestId }, roster);
      if (!alive.current) return;
      if (saved.sceneId !== sceneId || saved.scoreHash !== scoreHash) throw new Error('INVALID_CANDIDATE');
      setTitle(saved.title); setNotes(saved.notes); setNoteText(''); setNoteFrame(null); pendingSave.current = null; onSaved(saved); setStatus(asSource ? 'Source version saved. Your numeric fork is kept.' : 'Saved a new immutable candidate version.'); void refresh();
    } catch { if (alive.current) setError('Save could not complete. Your draft is kept. Retry the same save; the tray holds at most 64 versions.'); }
    finally { if (alive.current) setBusy(false); }
  }
  async function remove(saved: CandidateSummary) {
    if (busy || !window.confirm(`Permanently remove saved version “${saved.title}” (${saved.candidateId.slice(0, 8)}) and its saved notes? Your current draft and other saved versions are kept.`)) return;
    setBusy(true); setError(''); setStatus('');
    let requestId = pendingRemovals.current.get(saved.candidateId);
    if (!requestId) { requestId = crypto.randomUUID(); pendingRemovals.current.set(saved.candidateId, requestId); }
    try {
      await removeCandidate(saved.candidateId, requestId);
      if (!alive.current) return;
      refreshEpoch.current++; setCandidates(values => values.filter(value => value.candidateId !== saved.candidateId));
      if (comparisonId === saved.candidateId) { comparisonEpoch.current++; setComparisonId(''); setComparison(null); }
      if (candidate?.candidateId === saved.candidateId) pendingSave.current = null;
      onRemoved(saved.candidateId); pendingRemovals.current.delete(saved.candidateId);
      setStatus('Saved version removed. Your current draft was kept. Save it as a new version when needed.'); void refresh();
    } catch (failure) {
      if (alive.current) setError(failure instanceof HttpFailure && failure.code === 'LIMITED' ? 'This version has saved child versions. Remove child versions first. Your current draft was kept.' : 'Removal could not complete. Your current draft was kept. Retry this removal to confirm its result.');
    } finally { if (alive.current) setBusy(false); }
  }
  async function exportCandidate() {
    if (!candidate || candidate.scoreHash !== scoreHash || dirty || busy) return;
    setBusy(true); setError('');
    try { await downloadInspection(candidate.candidateId); }
    catch { if (alive.current) setError('The inspection ZIP could not download. Try again.'); }
    finally { if (alive.current) setBusy(false); }
  }
  const edited = history ? validateScore(JSON.stringify(history.score), roster) : null;
  const selectedKey = history?.score.actors[actor].keyframes[keyIndex];
  const sceneCandidates = candidates.filter(c => c.sceneId === sceneId);
  const baseline = comparisonId === 'authored' ? authored : comparisonId === 'prepared' ? preparedComparison?.score : comparison?.score;
  const baselineLabel = comparisonId === 'authored' ? 'Authored draft' : comparisonId === 'prepared' ? 'Prepared second take' : comparison?.title ?? 'Saved baseline';
  const parent = candidate?.parentCandidateId ? sceneCandidates.find(version => version.candidateId === candidate.parentCandidateId) : null;
  useEffect(() => {
    if (!focusComparison || !baseline || !comparisonOpen) return;
    const frame = requestAnimationFrame(() => { comparisonPanel.current?.querySelector<HTMLButtonElement>('.score-comparison button')?.focus(); setFocusComparison(false); });
    return () => cancelAnimationFrame(frame);
  }, [focusComparison, baseline, comparisonOpen]);
  const docked = active && ((panel === 'compare' && !!baseline) || (panel === 'revise' && forkPreview && !!edited?.ok));
  const wasDocked = useRef(false);
  useLayoutEffect(() => {
    if (!docked && wasDocked.current && active) onSeek(Math.min(score.durationMs, Math.max(0, Math.round(time.current))));
    wasDocked.current = docked; onDock(docked);
  }, [docked, onDock]);
  useLayoutEffect(() => () => onDock(false), [onDock]);
  function compareParent() {
    if (!candidate?.parentCandidateId || busy) return;
    setPanel('compare'); setFocusComparison(true); void chooseComparison(candidate.parentCandidateId);
  }
  function startFork() {
    const atMs = Math.min(score.durationMs, Math.max(0, Math.round(time.current)));
    const keys = score.actors[actor].keyframes;
    setKeyIndex(Math.max(0, keys.findLastIndex(key => key.tMs <= atMs)));
    setHistory({ score: structuredClone(score), undo: [] }); onSeek(atMs);
  }
  async function exportPair() {
    if (!baseline || busy) return;
    setBusy(true); setError('');
    try {
      await request('/api/operator/status');
      if (!alive.current) return;
      const checked = validateScore(JSON.stringify(baseline), roster);
      if (!checked.ok) throw new Error('INVALID_COMPARISON');
      const { downloadPairInspection } = await import('../inspection/pairInspection.js');
      if (!alive.current) return;
      downloadPairInspection({ score: checked.score, scoreHash: checked.scoreHash, source: comparisonId === 'authored' || comparisonId === 'prepared' ? 'authored_fixture' : 'operator_saved_score' }, { score, scoreHash, source: scoreSource });
    } catch { if (alive.current) setError('The pair inspection could not download. Check operator access and try again.'); }
    finally { if (alive.current) setBusy(false); }
  }
  return <section className="section candidate-workbench" aria-label="Candidate workbench" data-editing={!!history}>
    {!history && <h2>Directing desk</h2>}
    <div className="desk-current">{history ? <><h2 aria-live="polite">{edited?.ok ? 'Unsaved numeric fork' : 'Invalid fork'}</h2>{title && <span className="fork-source-title">{title}</span>}</> : <><strong>{candidate?.scoreHash === scoreHash ? 'Saved version' : dirty || scoreSource !== 'authored_fixture' ? 'Unsaved revision' : 'Active take'}</strong><span>{title || (scoreSource === 'authored_fixture' ? preparedExample?.right.scoreHash === scoreHash ? 'Prepared second take' : 'Authored first take' : 'Untitled revision')}</span><p className="secondary">{dirty ? 'Unsaved title or notes.' : candidate?.scoreHash === scoreHash ? 'This version is saved.' : 'The authored bank stays fixed.'}</p></>}</div>
    <div className="desk-panels" role="group" aria-label="Directing task">{(['revise', 'compare', 'notes', 'versions'] as const).map(name => <button key={name} id={noteId + '-button-' + name} aria-pressed={panel === name} aria-controls={noteId + '-panel-' + name} onClick={() => { setPanel(name); setForkPreview(false); }}>{name[0].toUpperCase() + name.slice(1)}</button>)}</div>
    {candidate && <div className="candidate-context">{candidate.scoreHash !== scoreHash && <p>Based on: <strong>{candidate.title}</strong></p>}<p className="secondary">{candidate.parentCandidateId ? `Parent: ${parent?.title ?? candidate.parentCandidateId.slice(0, 8)}` : 'First saved snapshot.'} {candidate.scoreHash !== scoreHash && 'Saved notes remain attached to that earlier score.'}</p>{candidate.parentCandidateId && <button disabled={busy} onClick={compareParent}>Compare with parent</button>}</div>}
    {error && <p role="alert" className="error">{error}</p>}{status && <p role="status">{status}</p>}
    <section className="desk-panel" id={noteId + '-panel-versions'} aria-labelledby={noteId + '-button-versions'} hidden={panel !== 'versions'}>
      <h3>Saved candidates and version history ({sceneCandidates.length})</h3>
      <CandidateLibrary currentId={candidate?.scoreHash === scoreHash ? candidate.candidateId : null} refreshKey={`${candidate?.candidateId ?? ''}:${libraryRevision}`} />
      {workspaceTools}
      {!listError && <p className="secondary">Saved tray: {candidates.length}/64 versions across all scenes. Remove versions with no saved children to free space.</p>}
      {listError && <p role="alert">The candidate tray could not load. <button onClick={refresh}>Retry candidate tray</button></p>}
      {!listError && !sceneCandidates.length && <p>No saved candidates for this scene.</p>}
      <ol className="candidate-tray">{sceneCandidates.map(c => <li key={c.candidateId}>
        <strong>{c.title}</strong>{candidate?.candidateId === c.candidateId && candidate.scoreHash === scoreHash && <span className="version-current">Current version</span>} <time dateTime={c.createdAt}>{new Date(c.createdAt).toLocaleString()}</time>
        <p className="hash">Hash: {c.scoreHash}</p><p className="secondary">Version {c.candidateId.slice(0, 8)}{c.parentCandidateId ? ` · revision of ${sceneCandidates.find(version => version.candidateId === c.parentCandidateId)?.title ?? c.parentCandidateId.slice(0, 8)}` : ' · first snapshot'} · {c.noteCount} notes · Unreviewed</p>
        <button disabled={busy} onClick={() => load(c.candidateId)}>Load {c.title} ({c.candidateId.slice(0, 8)})</button>
        <button disabled={busy} onClick={() => remove(c)}>Remove {c.title} ({c.candidateId.slice(0, 8)})</button>
      </li>)}</ol>
    </section>
    <section className="desk-panel" id={noteId + '-panel-compare'} aria-labelledby={noteId + '-button-compare'} hidden={panel !== 'compare'} ref={comparisonPanel}><h3>Compare this score</h3><label>Compare with<select aria-label="Compare with" value={comparisonId} onChange={e => chooseComparison(e.target.value)} disabled={busy}><option value="">Choose comparison</option><option value="authored">Authored draft</option>{preparedExample && <option value="prepared">Prepared second take</option>}{sceneCandidates.map(c => <option key={c.candidateId} value={c.candidateId}>{c.title} · {c.candidateId.slice(0, 8)}</option>)}</select></label>
      {active && comparisonOpen && baseline && <ScoreComparison dock={{ stageHost, time, onViewStage: () => onSeek(Math.round(time.current), true) }} left={baseline} right={score} leftLabel={baselineLabel} rightLabel="Active revision · unreviewed"><div className="controls"><button disabled={busy} onClick={exportPair}>Download pair inspection ZIP</button><span className="secondary">Scores and playback only. Private titles and notes are excluded.</span></div></ScoreComparison>}
    </section>
    <section className="desk-panel" id={noteId + '-panel-revise'} aria-labelledby={noteId + '-button-revise'} hidden={panel !== 'revise'} ref={editPanel}>{!history && <><h3>Revise a moment</h3><p>Edit a stored key. Cast, easing and key count stay fixed. Validate the fork before applying it.</p></>}
      {!history ? <button disabled={busy} onClick={startFork}>Start edit fork</button> : <>
        <div className="toolbar numeric-key-selector"><label>Edit actor<select aria-label="Edit actor" value={actor} onChange={e => { setActor(Number(e.target.value)); setKeyIndex(0); }}>{history.score.actors.map((a, i) => <option key={a.id} value={i}>{a.id}</option>)}</select></label><label>Edit keyframe<select aria-label="Edit keyframe" value={keyIndex} onChange={e => setKeyIndex(Number(e.target.value))}>{history.score.actors[actor].keyframes.map((k, i) => <option key={i} value={i}>Key {i + 1} · {k.tMs} ms</option>)}</select></label></div>
        <p className="numeric-actor secondary" aria-live="polite">Editing actor {history.score.actors[actor].id}: {history.score.actors[actor].color} {history.score.actors[actor].shape}.</p>
        <div className="numeric-fields">{numericFields.map(field => <label key={field}>{compactFieldLabels[field]}<input type="number" aria-label={`Keyframe ${fieldLabels[field]}`} value={Number.isFinite(selectedKey![field]) ? selectedKey![field] : ''} step={field === 'tMs' ? 1 : .01} disabled={busy || (field === 'tMs' && (keyIndex === 0 || keyIndex === history.score.actors[actor].keyframes.length - 1))} onChange={e => { const next = editKeyframe(history, actor, keyIndex, field, e.target.value === '' ? NaN : Number(e.target.value), roster); setHistory(next.history); }} /></label>)}</div>
        <div className="controls numeric-main-actions">{edited?.ok && <button aria-pressed={forkPreview} disabled={busy} onClick={() => setForkPreview(value => !value)}>{forkPreview ? 'Return to source stage' : 'Preview valid fork'}</button>}<button className="primary" disabled={busy || !edited?.ok || sourceNotesDirty} onClick={async () => { if (!edited?.ok || sourceNotesDirty) return; onSeek(Math.round(time.current)); setBusy(true); try { await onApply(edited.score, title); } finally { if (alive.current) setBusy(false); } }}>Validate and rehearse fork</button></div>
        <div className="controls"><button disabled={busy || !Number.isFinite(selectedKey!.tMs) || selectedKey!.tMs < 0 || selectedKey!.tMs > score.durationMs} onClick={() => onSeek(selectedKey!.tMs, true)}>Inspect selected key</button><button disabled={busy || !history.undo.length} onClick={() => setHistory(undoEdit(history))}>Undo edit ({history.undo.length}/30)</button><button disabled={busy} onClick={() => { setHistory(null); setForkPreview(false); }}>Discard edit fork</button></div>
        {sourceNotesDirty && <div className="fork-notes-warning"><p>Keep your source notes before applying a different score. Add or clear any draft note, give the source a title and save it. Your numeric fork stays open.</p><button disabled={busy || !title.trim() || !!noteText.trim() || unchangedSaved} onClick={() => void save(true)}>Save source notes and keep fork</button></div>}
        {edited?.ok && <>{active && forkPreview && panel === 'revise' && <ScoreComparison dock={{ stageHost, time, onViewStage: () => onSeek(Math.round(time.current), true) }} left={score} right={edited.score} leftLabel="Active source" rightLabel="Unsaved numeric fork" />}</>}
        {edited && !edited.ok && <div role="status"><p>This fork is invalid and cannot play, save or export.</p><ul>{edited.errors.map((e, i) => <li key={i}><button onClick={() => onInspect(history.score, e)}>Inspect <code>{e.code} {e.path}</code> in raw JSON</button></li>)}</ul></div>}
        <details className="numeric-help"><summary>Numeric editing guide</summary><p>Position uses the 1,000 × 700 stage. Scale 1 is original size. Rotation is in degrees. Cast, easing and key count stay fixed; first and last key times are fixed. The stage keeps the source until you preview or apply a valid fork.</p></details>
      </>}
    </section>
    <section className="desk-panel" id={noteId + '-panel-notes'} aria-labelledby={noteId + '-button-notes'} hidden={panel !== 'notes'} ref={notePanel}><h3>Notes and save</h3><p>Notes belong to this exact score. Capture a frame or enter a note to pause at that moment. Titles and notes stay private and are excluded from inspection downloads.</p><p className="hash">Score hash: {scoreHash}</p>
      <label>Candidate title<input value={title} maxLength={80} disabled={busy} onChange={e => setTitle(e.target.value)} /></label>
      <ol>{notes.map((note, i) => <li key={i}><button type="button" className="quiet" disabled={busy} onClick={() => onSeek(note.atMs)}>Go to {note.atMs} ms</button> {note.text} <button disabled={busy} aria-label={`Remove note ${i + 1}`} onClick={() => setNotes(notes.filter((_, index) => index !== i))}>Remove</button></li>)}</ol>
      {noteFrame && <p id={`${noteId}-frame`} className="note-frame">Note frame: <strong>{noteFrame.atMs} ms</strong> · fixed while you type. <button type="button" className="quiet" disabled={busy} onClick={() => onSeek(noteFrame.atMs)}>Return to note frame</button></p>}
      <label htmlFor={noteId}>Rehearsal note</label><textarea ref={noteInput} id={noteId} aria-describedby={noteFrame ? `${noteId}-frame` : undefined} rows={2} maxLength={240} value={noteText} disabled={busy || notes.length >= 12} onFocus={() => { const atMs = Math.min(score.durationMs, Math.max(0, Math.round(time.current))); if (!noteFrame) setNoteFrame({ atMs, scoreHash }); onSeek(atMs); }} onChange={e => setNoteText(e.target.value)} /><button disabled={busy || !noteText.trim() || notes.length >= 12 || noteFrame?.scoreHash !== scoreHash} onClick={() => { if (!noteFrame || noteFrame.scoreHash !== scoreHash) return; setNotes([...notes, { atMs: noteFrame.atMs, text: noteText.trim() }]); setNoteText(''); setNoteFrame(null); }}>Add captured note ({notes.length}/12)</button>
      <div className="controls"><button disabled={busy || !!history || !title.trim() || !!noteText.trim() || unchangedSaved} onClick={() => void save()}>Save new candidate version</button><button disabled={busy || !candidate || candidate.scoreHash !== scoreHash || dirty} onClick={exportCandidate}>Download candidate inspection ZIP</button></div>
      {unchangedSaved && !dirty && <p className="secondary">This exact version is already saved. Change its title, notes or score to save a new revision.</p>}
      {noteText.trim() && <p className="secondary">Add or clear the note before saving.</p>}{history && <p className="secondary">Apply or discard the edit fork before saving.</p>}
    </section>
    <button className="desk-return quiet" onClick={() => { setPanel('revise'); setForkPreview(false); onSeek(Math.round(time.current), true); }}>Return to stage</button>
  </section>;
}
