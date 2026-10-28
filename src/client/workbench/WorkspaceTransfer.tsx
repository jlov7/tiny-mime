import { useRef, useState } from 'react';
import { HttpFailure } from '../request.js';
import { downloadWorkspaceBackup, previewWorkspaceRestore, restoreWorkspace, workspaceBackupMaxBytes, type WorkspaceRestorePreview } from '../workspaceApi.js';

function failureText(error: unknown) {
  const code = error instanceof HttpFailure ? error.code : '';
  const text = code === 'STALE' ? 'Saved work changed after preview. Preview the file again before restoring.' : code === 'IDEMPOTENCY_CONFLICT' ? 'This backup conflicts with saved or removed work. Nothing was restored.' : code === 'LIMITED' ? 'This restore would exceed the workspace limits. Nothing was restored.' : code === 'FORBIDDEN' || code === 'UNAUTHENTICATED' ? 'Unlock operator tools, then retry. Your rehearsal edits are kept.' : code === 'INVALID_INPUT' ? 'This file is not a valid private workspace backup. Nothing was restored.' : 'The operation could not be confirmed. Your rehearsal edits are kept. Retry with the same file to check the result.';
  return text + (error instanceof HttpFailure && error.requestId ? ` Request ID: ${error.requestId}` : '');
}
export function WorkspaceTransfer({ onRestored }: { onRestored: () => void }) {
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); const [error, setError] = useState('');
  const [file, setFile] = useState<File | null>(null); const [preview, setPreview] = useState<WorkspaceRestorePreview | null>(null);
  const payload = useRef<unknown>(null); const fileEpoch = useRef(0);
  async function download() {
    setBusy(true); setMessage(''); setError('');
    try { await downloadWorkspaceBackup(); setMessage('Backup download started. Check your browser downloads and keep the file private.'); }
    catch (failure) { setError(failureText(failure)); } finally { setBusy(false); }
  }
  async function inspect() {
    if (!file || busy) return;
    const epoch = fileEpoch.current; setBusy(true); setMessage(''); setError(''); setPreview(null); payload.current = null;
    try {
      if (!file.size || file.size > workspaceBackupMaxBytes) { setError('Choose a private workspace JSON backup up to 32 MiB.'); return; }
      const raw = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
      const result = await previewWorkspaceRestore(raw);
      if (epoch === fileEpoch.current) { payload.current = JSON.parse(raw); setPreview(result); }
    } catch (failure) { if (epoch === fileEpoch.current) setError(failureText(failure)); } finally { setBusy(false); }
  }
  async function restore() {
    if (!preview || !payload.current || busy) return;
    setBusy(true); setMessage(''); setError('');
    try {
      const result = await restoreWorkspace(payload.current, preview.workspaceHash);
      onRestored(); setPreview(null); payload.current = null;
      setMessage(result.status === 'already_present' ? 'This backup is already present. Saved work refreshed. Your current rehearsal and unsaved edits are kept.' : `Restored ${result.additions.candidates} saved ${result.additions.candidates === 1 ? 'version' : 'versions'}. Saved work refreshed. Your current rehearsal and unsaved edits are kept.`);
    } catch (failure) { setError(failureText(failure)); if (failure instanceof HttpFailure && failure.code === 'STALE') { setPreview(null); payload.current = null; } }
    finally { setBusy(false); }
  }
  return <details className="workspace-transfer"><summary>Back up or restore saved work</summary>
    <p>This private backup includes saved scores, titles, notes and version history, plus records of removed versions. Unsaved edits are excluded. Keep the file somewhere private.</p>
    <button disabled={busy} onClick={() => void download()}>Download private workspace backup</button>
    <div className="workspace-restore"><label>Choose private workspace backup<input type="file" accept=".json,application/json" disabled={busy} onChange={event => { fileEpoch.current++; setFile(event.target.files?.[0] ?? null); setPreview(null); payload.current = null; setMessage(''); setError(''); }} /></label>
      <button disabled={!file || busy} onClick={() => void inspect()}>Preview restore</button>
    </div>
    {preview && <div className="workspace-restore-preview" aria-label="Workspace restore preview">
      <p aria-live="polite">{preview.incoming.candidates} saved {preview.incoming.candidates === 1 ? 'version' : 'versions'} in this backup. Add {preview.additions.candidates}; {preview.alreadyPresent.candidates} already present. After restore: {preview.resulting.candidates}/64 saved versions.</p>
      <p>Existing versions are kept. Removal history is included to keep locally removed versions removed.</p>
      <button disabled={busy} onClick={() => void restore()}>Restore saved work</button>
    </div>}
    {busy && <p role="status">Working with the private backup…</p>}
    {message && <p role="status">{message}</p>}{error && <p role="alert" className="error">{error}</p>}
  </details>;
}
