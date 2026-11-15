import type { SpeechAudioEvent, SpeechOutput } from './speech_service';
import type { OutputChoice, OutputDevice, OutputUnavailableReason } from './speech_output_types';

export interface OutputDiscovery {
  supported: boolean;
  devices: OutputDevice[];
  reason?: OutputUnavailableReason;
}

export interface NativeDriver {
  available(): boolean;
  play(name: string, wav: Uint8Array, event: (kind: SpeechAudioEvent['event']) => void): boolean;
  control(action: 'pause' | 'resume' | 'stop'): void;
}

/** A native driver for the system default output (macOS #82, Linux #84). */
export interface SystemDriver extends NativeDriver {
  supported(): Promise<boolean>;
}

type Route = OutputChoice | { kind: 'system'; driver: SystemDriver };

interface RouterOptions {
  driver: NativeDriver;
  /** Plays the default choice natively when its helper is supported; the browser is the fallback. */
  system?: SystemDriver;
  discover(): Promise<OutputDiscovery>;
  choice(): OutputChoice;
  defaultOutput: SpeechOutput;
  currentPage(): number | undefined;
  audioEvent(event: SpeechAudioEvent): void;
}

/** Reserves one selected route per generation; native failure never falls back. */
export class SpeechOutputRouter implements SpeechOutput {
  private epoch = 0;
  private request = 0;
  private reservation?: { id: number; choice: Route; epoch: number };
  private active?: { id: number; pageId: number; epoch: number; driver: NativeDriver };
  private browser?: { id: number; pageId: number; retiring: boolean };

  constructor(private readonly options: RouterOptions) {}

  async prepare(id: number): Promise<boolean> {
    const epoch = this.epoch;
    // specs/OutputAdmission.tla, Check: only the latest request may reserve.
    const request = ++this.request;
    const selected = this.options.choice();
    let choice: Route = selected;
    this.reservation = undefined;
    // specs/AudioOutput.tla, Reserve: no route starts while a child is owned.
    if (!this.idle()) return false;
    const system = this.options.system;
    if (selected.kind === 'default' && system !== undefined && (await system.supported())) {
      // specs/AudioOutput.tla, Reserve("sys"): a verified helper plays the default, never the browser.
      if (epoch !== this.epoch || request !== this.request || !this.idle()) return false;
      choice = { kind: 'system', driver: system };
    } else if (selected.kind === 'native') {
      let catalog: OutputDiscovery;
      try {
        catalog = await this.options.discover();
      } catch {
        return false;
      }
      if (
        epoch !== this.epoch ||
        request !== this.request ||
        !this.idle() ||
        !catalog.supported ||
        !catalog.devices.some(
          (device) => device.available && device.choice.backend === selected.backend && device.choice.name === selected.name,
        )
      ) {
        return false;
      }
    }
    this.reservation = { id, choice, epoch };
    return true;
  }

  play(id: number, wav: Uint8Array, durationMs: number): number | undefined {
    const reservation = this.reservation;
    // specs/OutputAdmission.tla, Play: an old generation cannot consume a new reservation.
    if (reservation === undefined || reservation.id !== id || reservation.epoch !== this.epoch) return undefined;
    this.reservation = undefined;
    if (!this.idle()) return undefined;
    if (reservation.choice.kind === 'default') {
      const pageId = this.options.defaultOutput.play(id, wav, durationMs);
      if (pageId !== undefined) this.browser = { id, pageId, retiring: false };
      return pageId;
    }
    const pageId = this.options.currentPage();
    if (pageId === undefined) return undefined;
    const driver = reservation.choice.kind === 'system' ? reservation.choice.driver : this.options.driver;
    const name = reservation.choice.kind === 'system' ? '' : reservation.choice.name;
    const active = { id, pageId, epoch: this.epoch, driver };
    this.active = active;
    const accepted = driver.play(name, wav, (event) => {
      queueMicrotask(() => {
        if (this.active !== active || active.epoch !== this.epoch) return;
        if (event !== 'started') this.active = undefined;
        this.options.audioEvent({ id, pageId, event });
      });
    });
    if (!accepted) {
      this.active = undefined;
      return undefined;
    }
    return pageId;
  }

  control(id: number, pageId: number, action: 'pause' | 'resume' | 'stop'): void {
    const active = this.active;
    if (active?.id === id && active.pageId === pageId) {
      if (action === 'stop') this.active = undefined;
      active.driver.control(action);
    } else {
      if (action === 'stop' && this.browser?.id === id && this.browser.pageId === pageId) this.browser.retiring = true;
      this.options.defaultOutput.control(id, pageId, action);
    }
  }

  status(id: number, state: 'preparing' | 'speaking' | 'paused' | 'unavailable' | 'idle', message?: string): void {
    this.options.defaultOutput.status(id, state, message);
  }

  localDiagnostic: SpeechOutput['localDiagnostic'] = (phase, reason) => {
    this.options.defaultOutput.localDiagnostic?.(phase, reason);
  };

  /** Accepts a retirement acknowledgement only for the requested stop. */
  browserRetired(id: number, pageId: number): void {
    // specs/OutputHandoff.tla, Ack: stale pages and units cannot release ownership.
    if (this.browser?.retiring === true && this.browser.id === id && this.browser.pageId === pageId) this.browser = undefined;
  }

  /** Releases browser ownership when the page has stopped or been disposed. */
  pageClosed(pageId: number): void {
    if (this.browser?.pageId === pageId) this.browser = undefined;
  }

  invalidate(): void {
    this.epoch++;
    this.reservation = undefined;
    if (this.active !== undefined) this.active.driver.control('stop');
    this.active = undefined;
  }

  /** True when no native process of either driver nor a browser clip is owned. */
  idle(): boolean {
    return this.options.driver.available() && (this.options.system?.available() ?? true) && this.browser === undefined;
  }
}
