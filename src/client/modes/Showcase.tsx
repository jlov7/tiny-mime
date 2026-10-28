import { useEffect, useState } from 'react';
import { AuthoredEncounter } from '../components/AuthoredEncounter.js';
import { getShowcases, type DirectingExample } from '../showcaseApi.js';
export function Showcase() {
  const [examples, setExamples] = useState<DirectingExample[]>([]); const [selected, setSelected] = useState(''); const [error, setError] = useState(''); const [attempt, setAttempt] = useState(0); const [focusScene, setFocusScene] = useState(false);
  useEffect(() => {
    const controller = new AbortController(); setError(''); setExamples([]);
    getShowcases(controller.signal).then(examples => {
      if (!controller.signal.aborted) { setExamples(examples); setSelected(examples[0].id); }
    }).catch(() => { if (!controller.signal.aborted) setError('The directing examples could not load. Check operator access and try again.'); });
    return () => controller.abort();
  }, [attempt]);
  function selectScene(id: string) { setFocusScene(true); setSelected(id); }
  const example = examples.find(item => item.id === selected);
  return <main className="showcase"><div className="showcase-heading"><div><h1>A matter of timing.</h1><p className="intro">Watch the first take. Think, then see the second.</p><p className="showcase-truth secondary">Two authored takes. No AI calls or adaptation.</p></div>{example && <label className="showcase-selector"><span>Scene {examples.indexOf(example) + 1} of {examples.length}</span><select aria-label="Directing example" value={selected} onChange={event => selectScene(event.target.value)}>{examples.map((item, index) => <option key={item.id} value={item.id}>Scene {index + 1}</option>)}</select></label>}</div>
    {error ? <><p role="alert" className="error">{error}</p><button onClick={() => setAttempt(value => value + 1)}>Retry directing examples</button></> : !example ? <p role="status">Loading directing examples…</p> : <><AuthoredEncounter key={example.id} focusOnMount={focusScene} left={example.left.score} right={example.right.score} onNext={examples.indexOf(example) < examples.length - 1 ? () => selectScene(examples[examples.indexOf(example) + 1]!.id) : undefined} onReturn={() => selectScene(examples[0]!.id)} notes={<><h3>{example.title}</h3><p><strong>Fixed example interpretation:</strong> {example.exampleGuess}</p><p><strong>Scene intention:</strong> {example.intention}</p><p>{example.explanation}</p></>} rehearsalActions={<div className="controls"><a className="button" href={'/rehearsal?scene=' + example.id + '&take=first'}>Rehearse first take</a><a className="button" href={'/rehearsal?scene=' + example.id + '&take=second'}>Rehearse second take</a></div>} /></>}
    <details className="showcase-limits"><summary>About these authored examples</summary><p>Both takes and the example interpretations were prepared in advance. No visitor response is collected. These prepared variations illustrate directing choices, not demonstrated improvements. The visual task has no nonvisual equivalent.</p><p className="secondary">Human comprehension, enjoyment, scene calibration, semantic fidelity, comparative effect, assistive-technology, live-provider and physical-device qualification: NOT RUN.</p></details><p><a className="button primary" href={example ? '/rehearsal?scene=' + encodeURIComponent(example.id) : '/rehearsal'}>Open rehearsal</a> <a className="button" href="/play">Try a fixture round</a></p>
  </main>;
}
