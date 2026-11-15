// One webview-owned audio unit. The caller authorizes its page and unit first.

export type AudioEvent = 'started' | 'ended' | 'failed';
export type AudioAction = 'pause' | 'resume' | 'stop';

export interface AudioClip {
  audio: {
    play(): Promise<void>;
    pause(): void;
    addEventListener(type: 'ended' | 'error', listener: () => void): unknown;
  };
  revoke(): void;
}

export interface AudioReport {
  id: number;
  pageId: number;
  event: AudioEvent;
}

/** Maximum 40 seconds of 24 kHz mono PCM plus 600 ms and its WAV header. */
export const MAX_WAV_BYTES = 1_948_844;
const MAX_WAV_BASE64 = 2_598_460;

/** Decodes only a bounded WAV payload; the browser validates the actual media. */
export function decodeWav(encoded: string): Uint8Array {
  if (encoded.length === 0 || encoded.length > MAX_WAV_BASE64) throw new Error('Invalid speech audio size');
  const decoded = atob(encoded);
  if (decoded.length === 0 || decoded.length > MAX_WAV_BYTES) throw new Error('Invalid speech audio size');
  // atob returns one byte per Latin-1 code unit.
  // oxlint-disable-next-line unicorn/prefer-code-point
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

/** Owns at most one clip and rejects stale pages or cancelled unit IDs. */
export class SpeechAudio {
  private currentPage = 0;
  private latest = 0;
  private current = 0;
  private clip?: AudioClip;
  private paused = false;
  /** The browser refused to start the clip until a user gesture (#77). */
  private blocked = false;
  private playAttempt = 0;

  constructor(
    private readonly make: (base64: string) => AudioClip,
    private readonly report: (event: AudioReport) => void,
  ) {}

  /** Changes the page epoch and disposes its previous clip. */
  page(pageId: number): void {
    if (!Number.isSafeInteger(pageId) || pageId <= 0 || pageId === this.currentPage) return;
    this.stop();
    this.currentPage = pageId;
    this.latest = 0;
  }

  /** Permits a new monotonic unit, never a cancelled earlier unit. */
  begin(id: number, pageId: number): void {
    if (this.currentPage === 0 || pageId !== this.currentPage || !Number.isSafeInteger(id) || id <= this.latest) return;
    this.stop();
    this.latest = id;
    this.current = id;
  }

  /** Accepts one clip for the authorized unit and starts it unless paused. */
  audio(id: number, pageId: number, base64: string, paused: boolean): void {
    // specs/SpeechPage.tla, Audio: stale units and pages cannot start audio.
    if (id !== this.current || id === 0 || pageId !== this.currentPage || this.clip !== undefined) return;
    let clip: AudioClip;
    try {
      clip = this.make(base64);
    } catch {
      this.current = 0;
      this.report({ id, pageId, event: 'failed' });
      return;
    }
    this.clip = clip;
    this.paused = paused;
    clip.audio.addEventListener('ended', () => {
      if (this.current !== id || this.currentPage !== pageId || this.clip !== clip) return;
      this.stop();
      this.report({ id, pageId, event: 'ended' });
    });
    clip.audio.addEventListener('error', () => {
      if (this.current !== id || this.currentPage !== pageId || this.clip !== clip) return;
      this.stop();
      this.report({ id, pageId, event: 'failed' });
    });
    if (!paused) this.play(id, pageId, clip);
  }

  /** Pauses, resumes or stops only the named current unit. */
  control(id: number, pageId: number, action: AudioAction): void {
    if (id !== this.current || id === 0 || pageId !== this.currentPage) return;
    if (action === 'stop') {
      this.stop();
    } else if (action === 'pause') {
      this.playAttempt++;
      this.paused = true;
      this.blocked = false;
      this.clip?.audio.pause();
    } else if (this.paused) {
      this.paused = false;
      if (this.clip) this.play(id, pageId, this.clip);
    }
  }

  /**
   * Starts the clip the browser refused before any gesture; called during a
   * click or keypress in the panel, so the browser lets it play.
   */
  gesture(): void {
    // specs/SpeechPage.tla, Gesture: only the current, unpaused unit starts.
    if (!this.blocked || this.paused || this.clip === undefined) return;
    this.blocked = false;
    this.play(this.current, this.currentPage, this.clip);
  }

  /** Silences a named unit and confirms it cannot still be playing. */
  retire(id: number, pageId: number): boolean {
    // specs/OutputHandoff.tla, Ack: acknowledge only the same page and unit.
    if (!Number.isSafeInteger(id) || id <= 0 || pageId !== this.currentPage) return false;
    if (this.current === id) {
      this.stop();
      return true;
    }
    return this.current === 0 && id <= this.latest;
  }

  /** Synchronously silences and invalidates the unit. */
  stop(): void {
    // specs/SpeechPage.tla, Interrupt and Replace: never revive stopped audio.
    this.current = 0;
    this.paused = false;
    this.blocked = false;
    const clip = this.clip;
    this.clip = undefined;
    if (clip) {
      clip.audio.pause();
      clip.revoke();
    }
  }

  private play(id: number, pageId: number, clip: AudioClip): void {
    const attempt = ++this.playAttempt;
    let started: Promise<void>;
    try {
      started = clip.audio.play();
    } catch {
      this.stop();
      this.report({ id, pageId, event: 'failed' });
      return;
    }
    void started.then(
      () => {
        if (attempt === this.playAttempt && this.current === id && this.currentPage === pageId && this.clip === clip && !this.paused) {
          this.report({ id, pageId, event: 'started' });
        }
      },
      (error: unknown) => {
        if (attempt !== this.playAttempt || this.current !== id || this.currentPage !== pageId || this.clip !== clip) return;
        // specs/SpeechPage.tla, Audio with allowed = FALSE: keep the clip for
        // the next gesture; the host's start timeout still bounds the wait.
        if (error instanceof DOMException && error.name === 'NotAllowedError') {
          this.blocked = true;
          return;
        }
        this.stop();
        this.report({ id, pageId, event: 'failed' });
      },
    );
  }
}
