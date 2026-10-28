import { useCallback, useEffect, useRef, useState } from 'react';
import type { MotionScoreV1 } from '../shared/score.js';

export function unionKeyTimes(score: MotionScoreV1): number[] { return [...new Set(score.actors.flatMap(a => a.keyframes.map(k => k.tMs)))].sort((a, b) => a - b); }
export function adjacentKey(score: MotionScoreV1, time: number, direction: -1 | 1) { const keys = unionKeyTimes(score); return direction > 0 ? keys.find(t => t > time) ?? score.durationMs : keys.slice().reverse().find(t => t < time) ?? 0; }

export class PlaybackTraversal {
  private started = false;
  private eligible = true;
  start(eligible = true) { if (this.started) return false; this.started = true; this.eligible = eligible; return true; }
  reset() { this.started = false; }
  complete() { if (!this.started) return false; this.started = false; return this.eligible; }
}

export type PlaybackTransition = { reason: 'play' | 'pause' | 'replay' | 'step' | 'seek' | 'mode' | 'complete' | 'select' | 'visibility'; positionMs: number; playing: boolean; mode: 'motion' | 'frame_step' };

export function usePlayback(score: MotionScoreV1 | undefined, options: { onTransition?: (state: PlaybackTransition) => void; speed?: number; onStart?: (mode: 'motion' | 'frame_step') => void; onComplete?: (mode: 'motion' | 'frame_step') => void } = {}) {
  const [elapsedMs, setElapsed] = useState(0); const [playing, setPlaying] = useState(false);
  const [requiresReplay, setRequiresReplay] = useState(false);
  const [frameMode, setFrameMode] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const current = useRef(0); const raf = useRef<number | null>(null); const start = useRef(0); const offset = useRef(0); const callbacks = useRef(options); callbacks.current = options;
  const traversal = useRef(new PlaybackTraversal()); const active = useRef(false); const duration = useRef(score?.durationMs ?? 0); duration.current = score?.durationMs ?? 0;
  const modeRef = useRef(frameMode); modeRef.current = frameMode;
  const observe = useCallback((reason: PlaybackTransition['reason']) => callbacks.current.onTransition?.({ reason, positionMs: current.current, playing: active.current, mode: modeRef.current ? 'frame_step' : 'motion' }), []);
  const pause = useCallback(() => { const wasActive = active.current; active.current = false; if (raf.current !== null) cancelAnimationFrame(raf.current); raf.current = null; setPlaying(false); if (wasActive) observe('pause'); }, [observe]);
  const seek = useCallback((value: number) => { pause(); traversal.current.reset(); current.current = Math.min(score?.durationMs ?? 0, Math.max(0, value)); setElapsed(current.current); setRequiresReplay(current.current > 0); observe('seek'); }, [pause, score?.durationMs]);
  const animate = useCallback((timestamp: number) => {
    if (!active.current || document.hidden) { pause(); return; }
    const next = Math.min(duration.current, offset.current + (timestamp - start.current) * (callbacks.current.speed ?? 1));
    current.current = next; setElapsed(next);
    if (next >= duration.current) { pause(); observe('complete'); if (traversal.current.complete()) callbacks.current.onComplete?.('motion'); }
    else raf.current = requestAnimationFrame(animate);
  }, [pause]);
  const play = useCallback(() => {
    if (!score || document.hidden || active.current) return;
    if (current.current >= duration.current) { traversal.current.reset(); current.current = 0; setElapsed(0); setRequiresReplay(false); }
    if (frameMode) { if (traversal.current.start(current.current === 0)) callbacks.current.onStart?.('frame_step'); observe('play'); return; }
    offset.current = current.current; start.current = performance.now(); active.current = true; setPlaying(true); if (traversal.current.start(current.current === 0)) callbacks.current.onStart?.('motion'); observe('play'); raf.current = requestAnimationFrame(animate);
  }, [animate, frameMode, score]);
  const replay = useCallback(() => { if (!score) return; pause(); traversal.current.reset(); current.current = 0; setElapsed(0); setRequiresReplay(false); if (document.hidden) return; if (!frameMode) { offset.current = 0; start.current = performance.now(); active.current = true; setPlaying(true); } if (traversal.current.start()) callbacks.current.onStart?.(frameMode ? 'frame_step' : 'motion'); observe('replay'); if (!frameMode) raf.current = requestAnimationFrame(animate); }, [pause, frameMode, animate, score]);
  const step = useCallback((direction: -1 | 1) => { if (!score) return; pause(); if (direction > 0 && current.current < score.durationMs && traversal.current.start(current.current === 0)) callbacks.current.onStart?.('frame_step'); const next = adjacentKey(score, current.current, direction); current.current = next; setElapsed(next); observe('step'); if (next === score.durationMs && direction > 0 && traversal.current.complete()) callbacks.current.onComplete?.('frame_step'); }, [pause, score]);
  const changeMode = useCallback((value: boolean) => { pause(); traversal.current.reset(); setRequiresReplay(current.current > 0 && current.current < duration.current); modeRef.current = value; setFrameMode(value); observe('mode'); }, [pause]);
  useEffect(() => { pause(); traversal.current.reset(); current.current = 0; setElapsed(0); setRequiresReplay(false); observe('select'); }, [score, pause, observe]);
  useEffect(() => {
    const visibility = () => { if (document.hidden) pause(); observe('visibility'); };
    const media = window.matchMedia('(prefers-reduced-motion: reduce)'); const preference = () => changeMode(media.matches);
    document.addEventListener('visibilitychange', visibility); media.addEventListener('change', preference);
    return () => { document.removeEventListener('visibilitychange', visibility); media.removeEventListener('change', preference); if (raf.current !== null) cancelAnimationFrame(raf.current); active.current = false; };
  }, [pause, changeMode]);
  useEffect(() => { pause(); }, [options.speed, pause]);
  return { elapsedMs, playing, frameMode, requiresReplay, play, pause, replay, step, seek, setFrameMode: changeMode };
}
