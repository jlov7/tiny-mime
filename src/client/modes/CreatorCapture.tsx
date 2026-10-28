import { useEffect, useRef, useState } from 'react';
import type { PublicRound } from '../../shared/api.js';
import { checkedRound, HttpFailure, request } from '../api.js';
import { RecoveryStore } from '../recoveryStore.js';
import { useLocalConnection } from '../useLocalConnection.js';

type CaptureSummary = { timelineBasis: 'observed_creator_trace' | 'score_reconstruction'; canShortenWait: boolean; serverGenerationMs: number | null; actualWaitMs: number | null; canIncludeGuessText: boolean; versions: Record<string, string | null>; operationalOutcome: { clientTimeout: boolean; clockUncertain: boolean; lateRecovery: boolean } };
export function CreatorCapture({ summary }: { summary?: CaptureSummary }) {
  const id = new URLSearchParams(location.search).get('round'); const [round, setRound] = useState<PublicRound | null>(null); const [scenes, setScenes] = useState<any[]>([]); const [scene, setScene] = useState(''); const [own, setOwn] = useState(false); const [include, setInclude] = useState(false); const [shortened, setShortened] = useState(false); const [shortMs, setShortMs] = useState(0); const [status, setStatus] = useState(''); const [busy, setBusy] = useState(true); const [download, setDownload] = useState<string | null>(null);
  const [pendingCreation, setPendingCreation] = useState(false); const [unlockRequired, setUnlockRequired] = useState(false); const { offline, recheck } = useLocalConnection(); const exportEpoch = useRef(0); const [resume, setResume] = useState<{ href: string | null; label: string } | null>(null);
  useEffect(() => () => { exportEpoch.current++; }, []);
  async function checkOperatorAccess(error: unknown) {
    if (!(error instanceof HttpFailure) || ![401, 403].includes(error.status)) return false;
    try { await request('/api/operator/status'); }
    catch (e) {
      if (e instanceof HttpFailure && e.status === 401 && e.code === 'UNAUTHENTICATED') { setUnlockRequired(true); return true; }
    }
    return false;
  }
  function invalidateExport() { exportEpoch.current++; setDownload(null); setStatus(''); }
  function resumeRound(r: PublicRound, store: RecoveryStore) {
    setPendingCreation(true);
    if (r.mode === 'study') { setResume({ href: null, label: 'Return to your study page' }); setStatus('This round belongs to a study. Reopen its original study page to continue. Its saved request is unchanged.'); return; }
    if (store.read('recovery')?.roundId !== r.roundId) store.write('recovery', { version: 1, roundId: r.roundId, clientTimeout: false, clockUncertain: false, timeoutEventId: null, clockUncertainEventId: null });
    setResume({ href: '/play', label: 'Resume the pending round' }); setStatus('Finish or exit the pending round in Play before starting another demonstration.');
  }
  function openDemonstration(snapshot: PublicRound, store: RecoveryStore, recordTiming = false) {
    const r = checkedRound(snapshot); if (r.mode !== 'private_play' || store.read('mutation')) { resumeRound(r, store); return; }
    if (store.read('recovery')?.roundId !== r.roundId) store.write('recovery', { version: 1, roundId: r.roundId, clientTimeout: false, clockUncertain: false, timeoutEventId: null, clockUncertainEventId: null });
    if (recordTiming) { try { sessionStorage.setItem('tm.creator-trace-start', r.roundId); } catch { /* Missing timing is labelled as reconstruction at export. */ } }
    store.clear('creation'); location.assign('/play');
  }
  async function recoverCreation() {
    setBusy(true);
    try {
      const store = new RecoveryStore(sessionStorage); const c = store.read('creation'); const m = store.read('mutation'); const r = store.read('recovery'); setResume(null);
      if (c?.mode === 'study') { setPendingCreation(true); setResume({ href: c.studySessionId ? '/study?session=' + c.studySessionId : null, label: 'Return to your study page' }); setStatus('A study request needs checking on its original study page. Capture has kept it unchanged.'); return; }
      if (m) { setPendingCreation(true); resumeRound(checkedRound(await request<PublicRound>(`/api/rounds/${m.roundId}`)), store); return; }
      if (!c) {
        if (r) { try { const snapshot = checkedRound(await request<PublicRound>(`/api/rounds/${r.roundId}`)); if (!['revealed', 'abandoned'].includes(snapshot.state)) { resumeRound(snapshot, store); return; } } catch (e) { if (!(e instanceof HttpFailure) || ![404, 410].includes(e.status)) throw e; } }
        setPendingCreation(false); setStatus(''); return;
      }
      setPendingCreation(true); openDemonstration(await request<PublicRound>(`/api/round-requests/${c.requestId}`), store);
    } catch (e) {
      const store = new RecoveryStore(sessionStorage);
      if (e instanceof HttpFailure && e.status === 404 && store.read('creation') && !store.read('mutation')) { store.clear('creation'); setPendingCreation(false); setStatus('The creation was not accepted. Select the intended scene and start explicitly.'); }
      else { setPendingCreation(true); setStatus('The pending request could not be checked. Return to its original Play or Study page before starting another demonstration.'); }
    } finally { setBusy(false); }
  }
  useEffect(() => {
    if (id) { setBusy(true); request<PublicRound>(`/api/rounds/${id}`).then(r => setRound(checkedRound(r))).catch(() => setStatus('This round is unavailable or belongs to another session.')).finally(() => setBusy(false)); }
    else { void recoverCreation(); request('/api/operator/scenes').then(data => { const available = data.records.filter((r: any) => r.contentStatus !== 'deferred_contact'); setScenes(available); const requested = new URLSearchParams(location.search).get('scene'); setScene(available.find((r: any) => r.sceneId === requested)?.sceneId ?? available[0]?.sceneId ?? ''); }).catch(async e => { if (await checkOperatorAccess(e)) setStatus('Unlock operator tools to create a demonstration.'); else setStatus('The authored scenes could not be loaded. Reload this page to try again.'); }); }
  }, [id]);
  useEffect(() => () => { if (download) URL.revokeObjectURL(download); }, [download]);
  async function demonstration() {
    if (busy || offline) return;
    setBusy(true); setStatus('');
    try {
      const store = new RecoveryStore(sessionStorage); if (store.read('creation') || store.read('mutation')) { await recoverCreation(); return; }
      const session = await request<{ activeRoundId: string | null }>('/api/session', {});
      if (session.activeRoundId) { const active = checkedRound(await request<PublicRound>('/api/rounds/' + session.activeRoundId)); if (!['revealed', 'abandoned'].includes(active.state)) { resumeRound(active, store); return; } }
      const requestId = crypto.randomUUID(); store.write('creation', { version: 1, requestId, mode: 'private_play', executionMode: 'fixture', studySessionId: null, createdWallMs: Date.now() }); setPendingCreation(true);
      const r = await request<PublicRound>('/api/operator/creator-rounds', { requestId, sceneId: scene, creatorOwned: true, executionMode: 'fixture' }); openDemonstration(r, store, true);
    } catch (e) { setPendingCreation(true); setStatus(await checkOperatorAccess(e) ? 'Unlock operator tools, then check the saved creation request before starting again.' : 'The demonstration result is uncertain. Check the result before starting again.'); } finally { setBusy(false); }
  }
  async function capture() {
    if (busy || offline) return;
    const epoch = ++exportEpoch.current; setBusy(true); setStatus(''); setDownload(null);
    try {
      const receipt = await request('/api/operator/captures', { requestId: crypto.randomUUID(), roundId: id, includeGuessText: include, timing: shortened ? 'shortened_wait' : 'original', shortenedWaitMs: shortened ? shortMs : null });
      const response = await fetch(`/api/operator/captures/${receipt.captureId}`, { cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.timeout(10000) }); if (!response.ok) throw new HttpFailure(response.status, 'UNAVAILABLE');
      const blob = await response.blob(); if (blob.size !== receipt.byteLength) throw new Error('DOWNLOAD');
      if (epoch !== exportEpoch.current) return;
      const url = URL.createObjectURL(blob); setDownload(url); setStatus('Export ready · tiny-mime-replay.zip · self-contained HTML/SVG and JSON');
    } catch (e) { if (await checkOperatorAccess(e)) { if (epoch === exportEpoch.current) setStatus('Unlock operator tools, then review your export options before trying again.'); } else if (epoch === exportEpoch.current) setStatus('Export failed. Check that both takes and guesses are complete and that you have permission for the text. Try export again.' + (e instanceof HttpFailure && e.requestId ? ' Local request reference: ' + e.requestId + '.' : '')); } finally { if (epoch === exportEpoch.current) setBusy(false); }
  }
  return <main className="capture"><h1>Keep the whole performance.</h1><p className="context">Creator capture · local only</p><p className="intro">Keep the scores, their sources and clearly labelled timing.</p><p>Export creates a local HTML replay bundle. Publishing requires a separate decision.</p>
    {offline && <div role="status"><p>The local server cannot be reached. Check the app’s terminal, then try again. No action will be sent automatically.</p><button onClick={recheck}>Check local connection</button></div>}
    {unlockRequired && <section className="annotation" aria-label="Operator access"><h2>Operator access has expired or is locked.</h2><p>Use the fresh launch secret in the local terminal to unlock this room again. Your saved request is unchanged. No action will be sent automatically.</p><a tabIndex={0} className="button primary" href={'/operator-unlock?next=' + encodeURIComponent(id || !scene ? location.pathname + location.search : '/creator/capture?scene=' + scene)}>Unlock operator tools</a></section>}
    {resume && <p>{resume.href ? <a tabIndex={0} className="button primary" href={resume.href}>{resume.label}</a> : <button onClick={() => history.back()}>{resume.label}</button>}</p>}
    {!id ? <section className="section"><h2>Start a permitted example</h2><label>Authored scene<select value={scene} onChange={e => setScene(e.target.value)}>{scenes.map(r => <option value={r.sceneId} key={r.sceneId}>{r.title}</option>)}</select></label><label className="choice"><input type="checkbox" checked={own} onChange={e => setOwn(e.target.checked)} />My own demonstration text</label><p className="secondary">This fixture demonstration makes no provider calls. Supply your own guesses.</p><button className="primary" disabled={!own || !scene || busy || pendingCreation || offline} onClick={demonstration}>Start creator demonstration</button>{pendingCreation && !resume && <button onClick={recoverCreation} disabled={busy || offline}>Check creation result</button>}</section> : round && <>
      <section className="section"><h2>{round.state === 'revealed' ? round.reveal?.target : 'Finish the round before capture.'}</h2>{round.acts.map(act => <div className="capture-act" key={act.attempt}><h3>Take {act.attempt} · {act.source === 'mock_fixture' ? 'Test fixture' : act.source === 'runtime_generated' ? 'Generated second take' : 'Authored first take'}</h3><p className="hash">{act.scoreHash}</p>{act.authorship && <p>{act.authorship.authoringMethod} · Human review: {act.authorship.humanReview}</p>}</div>)}{round.guesses.map(g => <div className="submitted" key={g.attempt}><h3>Your {g.attempt === 1 ? 'first' : 'second'} guess</h3><p>{g.text}</p></div>)}</section>
      {round.mode === 'private_play' && round.state !== 'abandoned' && <p><a tabIndex={0} className="button" href="/play">{round.state === 'revealed' ? 'Return to the completed round' : 'Resume this round in Play'}</a></p>}
      <section className="section"><h2>Export options</h2>{round.state === 'revealed' && round.guesses.length < 2 && <><p>Replay export requires both takes and two complete guesses. This round was revealed early.</p><p><a className="button" href="/creator/capture">Set up a new creator demonstration</a></p></>}{summary && <><p>{summary.actualWaitMs === null ? 'Original viewing timing is unavailable.' : 'Observed waiting: ' + summary.actualWaitMs + ' ms.'} Server generation duration: {summary.serverGenerationMs === null ? 'unavailable' : summary.serverGenerationMs + ' ms'}.</p><p>{summary.operationalOutcome.clientTimeout ? 'Waiting timed out. ' : ''}{summary.operationalOutcome.clockUncertain ? 'Timing was interrupted. ' : ''}{summary.operationalOutcome.lateRecovery ? 'The next take was recovered explicitly. ' : ''}Replay reconstructs the scores and preserves these observations.</p><dl>{Object.entries(summary.versions).map(([name, version]) => <div key={name}><dt>{name}</dt><dd>{version ?? 'Not configured'}</dd></div>)}</dl></>}<label className="choice"><input type="checkbox" checked={include} disabled={busy || !summary?.canIncludeGuessText} onChange={e => { if (busy) return; invalidateExport(); setInclude(e.target.checked); }} />Include authorized guess text</label><p className="secondary">Off by default. Only creator-owned text or separately authorized publication material can be included. Study consent does not grant publication permission.</p><label className="choice"><input type="checkbox" checked={shortened} disabled={busy || !summary?.canShortenWait} onChange={e => { if (busy) return; invalidateExport(); setShortened(e.target.checked); }} />Create a labelled shortened-wait replay</label>{shortened && <label>Exported wait in milliseconds<input type="number" min={0} max={summary?.actualWaitMs ?? 0} value={shortMs} disabled={busy} onChange={e => { if (busy) return; invalidateExport(); setShortMs(Number(e.target.value)); }} /></label>}<p>{summary?.timelineBasis === 'observed_creator_trace' ? 'Creator timing is preserved by default, including pauses, frame steps and replay order. Scores remain unchanged.' : 'This export reconstructs each unchanged score at 1× speed, uses server generation duration and chosen 1.5-second text holds. It does not reproduce the original viewing timeline.'}</p>{summary?.timelineBasis === 'observed_creator_trace' && !summary.canShortenWait && <p>Shortening the wait is unavailable because it would remove recorded playback.</p>}<button className="primary" disabled={busy || offline || round.state !== 'revealed' || round.guesses.length !== 2 || (shortened && (!Number.isInteger(shortMs) || shortMs < 0 || shortMs > (summary?.actualWaitMs ?? 0)))} onClick={capture}>{busy ? 'Creating export…' : status.startsWith('Export failed') ? 'Try export again' : 'Create local replay bundle'}</button>
      </section></>}
    {status && <p role="status">{status}</p>}{download && <a tabIndex={0} className="button primary" href={download} download="tiny-mime-replay.zip">Save tiny-mime-replay.zip</a>}
    <p className="secondary">Human comprehension, semantic fidelity, live generation and physical-device qualification remain NOT RUN. A selected example does not establish typical results.</p>
  </main>;
}
