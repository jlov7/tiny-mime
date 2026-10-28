# Private workspace backup and restore

## From Rehearsal

In Rehearsal, open **Versions**, then **Back up or restore saved work** while operator tools are unlocked. **Download private workspace backup** starts a browser download of a JSON file. Check your browser downloads before treating the copy as saved. It includes saved scores, private titles and notes, version history and removal records. Unsaved edits are excluded. Keep the file private. It excludes participant records, meanings, provider settings, credentials and other application databases. If a scene cannot load, the backup controls remain available directly in Rehearsal.

To restore, choose that JSON file and select **Preview restore**. Review the counts of new and already present versions. Select **Restore saved work** to add missing records to the current workspace. Existing records are never replaced, deleted or given new identities. Conflicts, including an old backup of work removed locally, refuse the whole restore. A changed workspace requires a new preview when additions remain. An exact repeated import reports that the backup is already present, including after app restart.

Restore refreshes the saved library without leaving Rehearsal or resetting the current stage, numeric fork, title, notes or import text. Unsaved work stays unsaved. If the response is lost, retry the same file; a successful earlier restore will be recognized from the saved identities.

On a new empty workspace, a backup restores its recorded state. It cannot include deletions made on another copy after that backup.

The JSON format has exactly `format:"tiny-mime-private-workspace"`, `version:1`, `content` and `contentHash`. Content has ordered `rows` and `removals` with the existing immutable save/removal identities. The canonical SHA-256 hash detects changed content; it does not authenticate who created the file. The server checks strict JSON, closed shapes, finite numbers, every active score, hashes, notes, timestamps, lineage and removal consistency before preview and commit. The file is bounded to 32 MiB, 10,000 saved identities, 10,000 removal receipts, 64 active versions and 128 KiB per active candidate. Combined workspace limits are checked before insertion in one immediate transaction. SQLite files and filesystem paths are not accepted by these endpoints.

## Command-line recovery

These commands preserve operator-saved rehearsal versions between restarts or when moving to another local application data directory. They run without starting the app, opening a listener or calling a provider.

A backup contains only `rehearsal-workspace.sqlite`: saved scores, private titles and notes, version lineage, save request identities, and removal receipts. It does not copy other application databases, participant records, provider configuration, credentials, capture files or exports. Treat the backup as private operator data. It is not a public inspection packet.

Use the pinned Node version and installed dependencies from the normal local setup. Every path must be absolute. Use existing directories owned by your account with permissions `0700`; files must be private regular files. Symlink paths, existing output files and nonempty restore directories are rejected. The commands do not read environment configuration.

The default source directory is `~/Library/Application Support/TinyMime`. If you
already launch with a custom `TM_DATA_DIR`, use that absolute directory instead.
Keep the backup folder and restored data directory outside the extracted app
folder. Create them with permissions `0700` before running the commands.

For example, after replacing the destination paths with your own private folders:

```sh
npm run workspace:backup -- --data-dir "$HOME/Library/Application Support/TinyMime" --out '/absolute/private-backups/workspace.sqlite'
npm run workspace:restore -- --backup '/absolute/private-backups/workspace.sqlite' --data-dir '/absolute/new-empty-app-data'
```

Stop the app and close any other SQLite editors before backup. Backup acquires a new application data lock and refuses every preexisting lock, including a stale one. It reads only the workspace database and optional WAL into private staging, verifies their identity, metadata and bytes remain stable, then uses SQLite's backup API on the staged copy to include committed WAL changes. It never opens original files with SQLite or reads/copies SHM; SQLite regenerates coordination files inside staging. The original database, WAL and SHM bytes remain untouched. The application lock coordinates Tiny Mime only, so it does not establish safety against arbitrary external SQLite writers. Backup publishes a new file with permissions `0600` after validation. Do not copy just a live database file yourself.

Stop the app before restoring. Restore accepts only an empty, preexisting private application data directory. It never merges with or overwrites existing data. It temporarily takes the normal application data lock, creates the expected tables in a separate private staging directory, inserts validated records transactionally, and publishes the new database only after another validation. Restore does not execute schema from the input backup. Only files created by these commands are removed during staging cleanup.

After restore, launch with the restored data directory explicitly:

```sh
TM_DATA_DIR='/absolute/new-empty-app-data' npm run local
```

Use that same `TM_DATA_DIR` on later launches. An ordinary `npm run local` opens
the default directory instead. The app creates any other required databases
through its usual setup. Saved versions keep their original identities and tray
ordering. Exact save and removal retries retain their earlier outcomes. Removal
remains permanent: a tombstone preserves the save identity and digest, not the
removed title, notes or score.

Each command writes one JSON receipt with status, output path, counts and the SHA-256 hash of the resulting file. The counts distinguish active candidates, tombstones and removal receipts. Titles, notes, scores and raw errors do not appear in command output. A rejected command exits with status 1 and a fixed error code. Invalid arguments use `ARGUMENTS_INVALID`; unsafe paths or invalid workspaces use `WORKSPACE_REJECTED`.

Restore checks SQLite integrity, the exact current table and index schema, closed record shapes, scene rosters, active score and save digests, notes and timestamps, identities, the 64-active-version cap, insertion order and lineage, and one removal receipt per tombstone. It rejects unknown tables, views, triggers and indexes. It loads a bounded, read-only copy of the backup into memory and never loads extensions. Each database file is limited to 32 MiB, with at most 10,000 saved identities and 10,000 removal receipts. Busy waits are limited to one second; backup progress and record validation have a 10-second deadline. Exceeding these limits refuses the operation without replacing existing files.

These are technical preservation checks. Live-provider qualification, physical-device testing, human comprehension, enjoyment, scene calibration, semantic fidelity, comparative effect and public-release readiness remain NOT RUN.
