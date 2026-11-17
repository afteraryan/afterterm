// The life of one `afterterm chat start` request in main (AFT-126), with every outside
// effect passed in, so the tests drive it with a fake clock and fakes.
//
// asked -> (Aryan clicks Start) -> opening -> (Claude Code is idle and quiet) -> typed
//       -> (the transcript holds a user message) -> started
// Decline, 10 minutes with no answer, or a step that never comes all end it, and the
// prompt is dropped from memory the moment a request ends, whatever the outcome.

import {
  REQUEST_TTL_MS, claudeCommand, isEffort, isModel, pasteText, requestView,
  type ChatOutcome, type ChatRequest, type ChatRequestView, type Effort,
} from './chat-start.ts';

/** How long Claude Code may take to open and settle before the prompt is typed. */
export const READY_TIMEOUT_MS = 120_000;
/** How long after the prompt is typed its message must be in the transcript. */
export const DELIVER_TIMEOUT_MS = 60_000;
/** The terminal must be this quiet after Claude Code says idle before anything is typed. */
export const QUIET_MS = 800;
/** The wait between the end of the paste and Enter, so Enter is not part of the paste. */
export const ENTER_DELAY_MS = 400;
export const POLL_MS = 500;
/** How long the renderer has to make the thread after Start. */
export const OPEN_TIMEOUT_MS = 30_000;

export interface StarterDeps {
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  /**
   * The request bar: show this request, or show it again with a new end time when it
   * reaches the front. `fresh` is true only the first time, when a toast may go out.
   */
  show(view: ChatRequestView, fresh: boolean): void;
  /** The Start window and its toast: this request is over. */
  close(id: string): void;
  /** Claude Code's record for this session: its status, or null while there is none. */
  recordStatus(sessionId: string): string | null;
  /** When the thread's terminal last printed anything, or null when it has no PTY. */
  lastOutputAt(tabId: string): number | null;
  /** Writes to the thread's PTY; false when it has none. */
  write(tabId: string, data: string): boolean;
  /** Whether the session's transcript holds a message from the user. */
  hasUserMessage(sessionId: string, folder: string): boolean;
  /** The name afterterm shows for the thread. */
  threadName(tabId: string): Promise<string>;
  log(line: string): void;
}

interface Pending {
  req: ChatRequest;
  /** When it reached the front of the waiting requests; its 10 minutes run from here. */
  frontSince: number | null;
  finish: (o: ChatOutcome) => void;
  expiry: unknown;
  stage: 'asked' | 'opening' | 'typed';
  tabId?: string;
  timer?: unknown;
}

export class ChatStarter {
  private pending = new Map<string, Pending>();
  /** Requests waiting for Aryan, oldest first: the bar shows them in this order. */
  private waitingOrder: string[] = [];
  private deps: StarterDeps;
  constructor(deps: StarterDeps) { this.deps = deps; }

  /** A new request; the promise settles when it ends, however it ends. */
  ask(req: ChatRequest): Promise<ChatOutcome> {
    return new Promise((resolve) => {
      const p: Pending = {
        req,
        frontSince: null,
        stage: 'asked',
        expiry: null,
        finish: (o) => {
          if (!this.pending.has(req.id)) return;
          this.pending.delete(req.id);
          this.leaveWaiting(req.id);
          this.deps.clearTimer(p.expiry);
          if (p.timer) this.deps.clearTimer(p.timer);
          // The prompt goes with the request: nothing holds it after this.
          p.req = { ...p.req, prompt: '' };
          this.deps.close(req.id);
          this.deps.log(`[chat-start] ${req.id} ${o.kind}${o.kind === 'failed' ? ': ' + o.reason : ''}`);
          resolve(o);
        },
      };
      this.pending.set(req.id, p);
      this.waitingOrder.push(req.id);
      this.deps.log(`[chat-start] ${req.id} asked: ${req.projectName}, ${req.model}${req.effort ? ', ' + req.effort : ''}`);
      this.deps.show(requestView(req, null), true);
      this.armFront();
    });
  }

  // The front request's 10 minutes start when it reaches the front (AFT-135), so the
  // ones waiting behind it never run out unseen.
  private armFront(): void {
    const id = this.waitingOrder[0];
    const p = id ? this.pending.get(id) : undefined;
    if (!p || p.frontSince !== null) return;
    p.frontSince = this.deps.now();
    p.expiry = this.deps.setTimer(() => { if (p.stage === 'asked') p.finish({ kind: 'expired' }); }, REQUEST_TTL_MS);
    this.deps.show(requestView(p.req, p.frontSince), false);
  }
  private leaveWaiting(id: string): void {
    const i = this.waitingOrder.indexOf(id);
    if (i < 0) return;
    this.waitingOrder.splice(i, 1);
    this.armFront();
  }

  /** The views of every request still waiting for Aryan (a reloaded window asks again). */
  waiting(): ChatRequestView[] {
    return this.waitingOrder.map((id) => this.pending.get(id)!).filter((p) => p && p.stage === 'asked').map((p) => requestView(p.req, p.frontSince));
  }

  decline(id: string): void {
    const p = this.pending.get(id);
    if (p && p.stage === 'asked') p.finish({ kind: 'declined' });
  }

  /**
   * Aryan clicked Start, perhaps with another model or effort. Returns the line the
   * new thread's shell runs and where, or null when the request is gone or the
   * choice is not valid.
   */
  approve(id: string, model: string, effort: Effort | null): { command: string; folder: string; projectId: string } | null {
    const p = this.pending.get(id);
    if (!p || p.stage !== 'asked') return null;
    if (!isModel(model) || (effort !== null && !isEffort(effort))) return null;
    const command = claudeCommand(p.req.sessionId, model, effort);
    if (!command) return null;
    p.req = { ...p.req, model, effort };
    p.stage = 'opening';
    this.deps.clearTimer(p.expiry);
    this.leaveWaiting(id);
    p.timer = this.deps.setTimer(() => p.finish({ kind: 'failed', reason: 'afterterm did not open the thread' }), OPEN_TIMEOUT_MS);
    return { command, folder: p.req.folder, projectId: p.req.projectId };
  }

  /** The renderer made the thread; from here main waits for Claude Code and types. */
  opened(id: string, tabId: string): void {
    const p = this.pending.get(id);
    if (!p || p.stage !== 'opening' || p.tabId) return;
    if (p.timer) this.deps.clearTimer(p.timer);
    p.tabId = tabId;
    const startedAt = this.deps.now();
    const waitReady = () => {
      if (!this.pending.has(id)) return;
      const now = this.deps.now();
      const last = this.deps.lastOutputAt(tabId);
      if (last === null && now - startedAt > 10_000) return p.finish({ kind: 'failed', reason: 'the new thread has no terminal (it was closed or put to sleep)' });
      const idle = this.deps.recordStatus(p.req.sessionId) === 'idle';
      if (idle && last !== null && now - last >= QUIET_MS) return type();
      if (now - startedAt > READY_TIMEOUT_MS) {
        return p.finish({ kind: 'failed', reason: 'Claude Code did not become ready in 2 minutes (a question may be on its screen, such as trusting the folder)' });
      }
      p.timer = this.deps.setTimer(waitReady, POLL_MS);
    };
    const type = () => {
      if (!this.deps.write(tabId, pasteText(p.req.prompt))) return p.finish({ kind: 'failed', reason: 'the new thread has no terminal' });
      p.timer = this.deps.setTimer(() => {
        if (!this.pending.has(id)) return;
        if (!this.deps.write(tabId, '\r')) return p.finish({ kind: 'failed', reason: 'the new thread has no terminal' });
        p.stage = 'typed';
        const typedAt = this.deps.now();
        // The prompt is no longer needed once it is typed; only the transcript check remains.
        p.req = { ...p.req, prompt: '' };
        const waitDelivered = () => {
          if (!this.pending.has(id)) return;
          if (this.deps.hasUserMessage(p.req.sessionId, p.req.folder)) {
            void this.deps.threadName(tabId).then(
              (name) => p.finish({ kind: 'started', name, projectName: p.req.projectName, model: p.req.model, effort: p.req.effort }),
              () => p.finish({ kind: 'started', name: '(unnamed)', projectName: p.req.projectName, model: p.req.model, effort: p.req.effort }),
            );
            return;
          }
          if (this.deps.now() - typedAt > DELIVER_TIMEOUT_MS) return p.finish({ kind: 'failed', reason: 'it was typed, but Claude Code never sent it (look at the new thread)' });
          p.timer = this.deps.setTimer(waitDelivered, POLL_MS);
        };
        p.timer = this.deps.setTimer(waitDelivered, POLL_MS);
      }, ENTER_DELAY_MS);
    };
    p.timer = this.deps.setTimer(waitReady, POLL_MS);
  }

  /** The renderer could not make the thread. */
  openFailed(id: string, reason: string): void {
    const p = this.pending.get(id);
    if (p && p.stage === 'opening') p.finish({ kind: 'failed', reason });
  }

  /** afterterm is quitting: every request ends. */
  endAll(): void {
    for (const p of [...this.pending.values()]) p.finish({ kind: 'failed', reason: 'afterterm was closed' });
  }
}
