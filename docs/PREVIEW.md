# Offline preview

Generate the shareable file locally with the pinned Node toolchain and installed dependencies:

```sh
node --import tsx scripts/public-preview.ts
```

Open `artifacts/releases/tiny-mime-preview.html` directly in a browser. It needs no Node process, server, account, API key or internet connection. The accompanying `tiny-mime-preview-manifest.json` records the exact HTML hash, version, authored provenance, qualification limits and both score hashes for each pair. The command prints only artifact basenames and hashes. It refuses to overwrite different content, and permits an identical repeated export. Move a previous local export aside before generating a changed version.

The preview contains the three existing authored timing pairs: TM01, TM09 and TM04. Each scene starts with its authored first take at zero, paused. Play it or step through its own keyframes. Choose **Reflect on first take**, keep your interpretation to yourself, then choose **Continue to second take**. The prepared second take starts at zero and waits for explicit play or stepping. No thought or response selects or changes it.

Choose **Reveal intention and notes** to read the fixed interpretation, intention and directing choices. **Skip to written reveal** is available throughout the encounter. Neither route collects a response or gives correctness feedback. After every reveal, **Finish for now** ends the encounter without claiming that all scenes were viewed. **Next scene** is optional when another scene is available. **Return to first scene** resets even if the first scene is still selected. Changing scenes resets playback and disclosure. Intentional scene changes focus the first-take heading; initial loading retains your existing focus. From the written notes, forward Tab reaches the next-scene or finish action. Inspection focuses its primary playback control, and returning focuses the first-take heading so forward Tab reaches playback.

**Inspect both takes together** opens the secondary synchronized comparison. Both clips use one clock here; a shorter clip holds its final pose. On phones, **First take** and **Second take** switch the visible performance at the same paused time. Desktop shows both. **Return to first take** leaves inspection and restarts the current scene paused, with notes concealed. The app also retains the numeric comparison tools.

**Playback controls** expose reset, timeline, previous/next key and the motion choice for an individual take. Inspection retains its **Frame and key controls**. Reduced motion defaults to keyframe stepping; **Next keyframe** advances and **Replay frames** resets after the last key. Full-motion playback offers **Replay take** or **Replay pair** after completion. Hiding the tab pauses; restoring it, navigating and revealing notes never start playback. Space or K plays outside a native control, arrow keys step, Home and End seek, and Escape pauses. Space on a native details summary opens its group without playing. This is a visual task without a nonvisual equivalent.

This is an authored illustration, not adaptive AI, an interactive guessing game or an empirical result. Human comprehension, enjoyment, scene calibration, comparative effect, live-provider and physical-device qualification remain **NOT RUN**. The preview does not load a provider, record responses, use browser storage, submit forms or make network requests. Its hashed content security policy blocks connections and external assets. It embeds only the validated scores and fixed explanatory text for these three public examples, not the meaning catalogue, study allocations, provider configuration, operator data or other bank scenes.

The export is deterministic. Scores pass the existing strict structural, timing, roster, speed and continuous-contact validation before the engine-owned SVG player receives numeric transforms. The player embeds the existing pure sampler, rather than a separate animation framework. Generation is local preparation; it does not publish or upload the files.

Check only this surface with:

```sh
npm exec vitest run tests/unit/public-preview.test.ts
npm exec playwright test tests/browser/public-preview.spec.ts
```

The browser check opens the generated HTML with `file:` in Chromium, Firefox and WebKit. It needs no application listener or provider. Emulated narrow-screen and reduced-motion checks are software evidence, not physical-device or human qualification.
