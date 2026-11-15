import { createLocalAudioAdapter } from '../../audio-native/src/factory';
import type { AudioAdapter, AudioEvent, AudioOwner } from '../../audio-native/src';
import type { NativeDriver } from './speech_output_router';

type Outcome = 'started' | 'ended' | 'failed';
interface Job {
  owner: AudioOwner;
  callback(event: Outcome): void;
  stopped: boolean;
  terminal: boolean;
}

/**
 * Plays the system default output natively, so speech needs no gesture in the
 * panel page: the packaged CoreAudio helper on macOS (#82), PipeWire's default
 * sink on Linux (#84). One job stays owned until the helper has stopped,
 * including after a stop or a failure.
 */
export class SystemOutputDriver implements NativeDriver {
  private job?: Job;
  private count = 0;

  constructor(private readonly adapter: AudioAdapter) {
    adapter.onEvent((event) => {
      this.onEvent(event);
    });
  }

  /**
   * Resolves true only when the helper reports a default output now. The router
   * asks before each line, since a PipeWire default sink can come and go.
   */
  async supported(): Promise<boolean> {
    try {
      return (await this.adapter.capabilities()).defaultOutput;
    } catch {
      return false;
    }
  }

  /** True only after every earlier job has been retired by the helper. */
  available(): boolean {
    return this.job === undefined;
  }

  /** Starts one job on the system default; its name is unused. */
  play(name: string, wav: Uint8Array, callback: Job['callback']): boolean {
    void name;
    if (this.job !== undefined) return false;
    this.count++;
    const job: Job = {
      owner: { connectionEpoch: 'legacy', jobId: String(this.count), pageEpoch: 0 },
      callback,
      stopped: false,
      terminal: false,
    };
    this.job = job;
    // specs/AudioOutput.tla, Reserve("sys") and Start: admit the default, then open it.
    void this.adapter
      .admit(job.owner, { kind: 'default' })
      .then(async (lease) => {
        await this.adapter.play(lease, wav);
      })
      .catch(() => {
        this.finish(job, 'failed');
      });
    return true;
  }

  /** Pauses, resumes or stops the current job; a stop keeps ownership until retirement. */
  control(action: 'pause' | 'resume' | 'stop'): void {
    const job = this.job;
    if (job === undefined || job.stopped) return;
    if (action === 'stop') {
      job.stopped = true;
      this.retire(job);
    } else {
      void this.adapter[action](job.owner).catch(() => {});
    }
  }

  private onEvent(event: AudioEvent): void {
    const job = this.job;
    if (job === undefined || event.owner.jobId !== job.owner.jobId || job.stopped || job.terminal) return;
    if (event.type === 'started') job.callback('started');
    else this.finish(job, event.type === 'ended' ? 'ended' : 'failed');
  }

  private finish(job: Job, outcome: Exclude<Outcome, 'started'>): void {
    if (this.job !== job || job.terminal) return;
    job.terminal = true;
    this.retire(job, outcome);
  }

  /** Releases the job only after the helper has stopped (`RetirementCompletes`). */
  private retire(job: Job, outcome?: Exclude<Outcome, 'started'>): void {
    void this.adapter
      .stop(job.owner)
      .catch(() => {})
      .then(() => {
        if (this.job === job) this.job = undefined;
        if (outcome !== undefined && !job.stopped) job.callback(outcome);
      });
  }
}

/** Platforms whose default output can play natively: a packaged helper, or PipeWire. */
const SYSTEM_PLATFORMS: ReadonlySet<string> = new Set(['darwin', 'linux']);

/**
 * Returns the system-output driver on a local macOS or Linux desktop; elsewhere
 * none. Over a remote connection the extension runs on the remote host, whose
 * speakers are not the programmer's (#84).
 */
export function systemOutputDriver(
  extensionRoot: string,
  localDesktop: boolean,
  platform: string = process.platform,
): SystemOutputDriver | undefined {
  return localDesktop && SYSTEM_PLATFORMS.has(platform) ? new SystemOutputDriver(createLocalAudioAdapter(extensionRoot)) : undefined;
}
