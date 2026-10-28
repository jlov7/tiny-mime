import { useEffect, useRef, useState } from 'react';
import { listCandidates, type CandidateSummary } from '../workspaceApi.js';

export function CandidateLibrary({ currentId, refreshKey }: { currentId: string | null; refreshKey: string }) {
  const [open, setOpen] = useState(false); const [versions, setVersions] = useState<CandidateSummary[]>([]);
  const [query, setQuery] = useState(''); const [scene, setScene] = useState(''); const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading'); const [attempt, setAttempt] = useState(0);
  const epoch = useRef(0);
  useEffect(() => {
    if (!open) return;
    const current = ++epoch.current; let active = true; setState('loading');
    listCandidates().then(values => { if (active && current === epoch.current) { setVersions(values); setState('ready'); } }).catch(() => { if (active && current === epoch.current) setState('error'); });
    return () => { active = false; };
  }, [open, refreshKey, attempt]);
  const matching = versions.filter(version => (!scene || version.sceneId === scene) && `${version.title} ${version.sceneId}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <details className="saved-library" onToggle={event => setOpen(event.currentTarget.open)}><summary>Find saved work</summary>
    {state === 'loading' ? <p role="status">Loading saved work…</p> : state === 'error' ? <p role="alert">Saved work could not load. <button onClick={() => setAttempt(value => value + 1)}>Retry saved work</button></p> : <>
      <div className="toolbar"><label>Find a saved version<input type="search" value={query} maxLength={80} onChange={event => setQuery(event.target.value)} /></label><label>Saved scene<select value={scene} onChange={event => setScene(event.target.value)}><option value="">All scenes</option>{[...new Set(versions.map(version => version.sceneId))].sort().map(id => <option key={id}>{id}</option>)}</select></label></div>
      <p className="secondary">{matching.length} of {versions.length} saved versions. Opening a version returns to its exact score and notes. Unsaved changes require confirmation before leaving.</p>
      {!versions.length ? <p>No saved work yet. Save a named candidate below to keep a directing decision.</p> : !matching.length ? <p>No saved versions match. Clear the search or choose another scene.</p> : <ul className="saved-library-list">{matching.map(version => <li key={version.candidateId}><div><strong>{version.title}</strong><p className="secondary">{version.sceneId} · {version.noteCount} notes · <time dateTime={version.createdAt}>{new Date(version.createdAt).toLocaleString()}</time>{currentId === version.candidateId ? ' · Current version' : ''}</p></div><a className="button" href={'/rehearsal?candidate=' + version.candidateId} aria-current={currentId === version.candidateId ? 'page' : undefined}>Open {version.title} ({version.sceneId})</a></li>)}</ul>}
    </>}
  </details>;
}
