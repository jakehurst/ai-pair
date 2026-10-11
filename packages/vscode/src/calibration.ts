// The reading speed calibration (#109, specs/Calibration.tla): the programmer reads a passage
// against the clock, and the rate it gives becomes the rate of every say pause. The phases are
// the spec's: idle; armed, the passage announced and waiting for go; reading, the passage shown and
// the clock running; storing, x typed and the rate being written. Playback is held with the
// calibrate pause reason while a calibration is under way, and released only once the stored rate
// has reached the player (AwaitStore in the spec).

import { readingChars } from '@ai-pair/core';
import type { Passage } from './passage';

/** Where a reading speed calibration is: not running, waiting for go, timing the passage, or saving the result. */
export type Phase = 'idle' | 'armed' | 'reading' | 'storing';

/** What the panel shows: the passage announced, the passage itself, or the result. */
export type CalibrationView =
  | { phase: 'idle' }
  | { phase: 'armed'; title: string }
  | { phase: 'reading'; title: string; text: string; notice?: string }
  | { phase: 'done'; msPerChar: number; wordsPerMinute: number };

/** What the flow needs from VS Code: the clock, the pause, the store, and the panel. */
export interface CalibrationHost {
  now(): number;
  pause(): void;
  resume(): void;
  /** Writes the rate to the settings; resolves once the player reads it, which is when the pause may end. */
  store(msPerChar: number): Promise<void>;
  show(view: CalibrationView): void;
}

/** Returns the passage's words over the minutes it took, rounded. */
export function wordsPerMinute(text: string, elapsedMs: number): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.round(words / (elapsedMs / 60_000));
}

/** Measures the reading speed: times the programmer reading a passage, and stores the result in the settings. */
export class Calibration {
  phase: Phase = 'idle';
  private startedAt = 0;

  constructor(
    private readonly host: CalibrationHost,
    private passage: Passage,
  ) {}

  /** Arms a calibration, for the command, or for the agent's calibrate tool with a passage of its own. Refused while one is under way, or for an empty passage. specs/Calibration.tla, `Arm` and `Supply`. */
  arm(passage?: Passage): boolean {
    if (this.phase !== 'idle') return false;
    if (passage) {
      if (readingChars(passage.text) === 0) return false;
      this.passage = passage;
    }
    this.phase = 'armed';
    this.host.pause();
    this.host.show({ phase: 'armed', title: this.passage.title });
    return true;
  }

  /** Takes a reply while a calibration is under way: go shows the passage and starts the clock, x stops it, anything else cancels. False when it is not for the calibration. specs/Calibration.tla, `Go`. */
  reply(text: string): boolean {
    const word = text.trim().toLowerCase();
    if (this.phase === 'armed' && word === 'go') {
      this.phase = 'reading';
      this.startedAt = this.host.now();
      this.host.show({ phase: 'reading', ...this.passage });
      return true;
    }
    if (this.phase === 'reading' && word === 'x') {
      void this.finish(this.host.now() - this.startedAt);
      return true;
    }
    if (this.phase === 'armed' || this.phase === 'reading') {
      this.cancel();
      return true;
    }
    return false;
  }

  /** Finishes the reading, on x: the rate is written, and only once the player reads it does the pause end (AwaitStore): specs/Calibration.tla, `Finish`, then `ApplyRate`. */
  private async finish(elapsedMs: number): Promise<void> {
    this.phase = 'storing';
    const text = this.passage.text;
    const msPerChar = elapsedMs / readingChars(text);
    await this.host.store(msPerChar);
    this.phase = 'idle';
    this.host.show({ phase: 'done', msPerChar, wordsPerMinute: wordsPerMinute(text, elapsedMs) });
    this.host.resume();
  }

  /** Cancels the calibration, on any other reply, the panel's view going away, or the session ending: back to idle, nothing stored (specs/Calibration.tla, `Cancel`). */
  cancel(): void {
    if (this.phase !== 'armed' && this.phase !== 'reading') return;
    this.phase = 'idle';
    this.host.show({ phase: 'idle' });
    this.host.resume();
  }
}
