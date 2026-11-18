// Parts of a job run at the same time on workers, as many as the computer can take: at most one a processor (less one
// for the windows), and a part handed out only when the memory free would still cover what it needs. Not fixed: the
// pool measures the computer before each part it hands out. Works the same with web workers (the engine window) and
// Node's worker threads (the tests, the command line), each adapted to a WorkerLike.

/** What the pool asks of the computer. */
export interface Machine {
  /** processors the system offers */
  processors(): number;
  /** bytes of memory free now */
  freeMemory(): number;
}

export interface Request {
  id: number;
  job: string;
  input: unknown;
}

export type Reply = { id: number; ok: true; output: unknown } | { id: number; ok: false; error: string };

/** A worker as the pool uses one. */
export interface WorkerLike {
  send(msg: Request, transfer?: Transferable[]): void;
  onReply(fn: (r: Reply) => void): void;
  onFail(fn: (e: Error) => void): void;
  stop(): void;
}

/** A part to run: its job's name on the worker, its input, the memory it needs (bytes, estimated from its size). */
export interface Part<I = unknown> {
  job: string;
  input: I;
  bytes: number;
  /** buffers handed to the worker (not copied) */
  transfer?: Transferable[];
  /** what it is, for the build's view of the workers */
  label?: string;
}

export interface PoolStatus {
  /** workers there are, and how many it may have now */
  workers: number;
  limit: number;
  /** parts running, each with what it is and since when (ms) */
  running: { label: string; since: number }[];
  waiting: number;
  /** bytes free when last measured */
  memoryFree: number;
}

export interface PoolOptions {
  /** bytes always left free (default 512 MB) */
  reserve?: number;
  /** at most this many workers, whatever the computer has */
  max?: number;
  now?: () => number;
}

interface Slot {
  worker: WorkerLike;
  busy: Running | null;
}

interface Running {
  id: number;
  part: Part;
  since: number;
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
}

export const RESERVE = 512 * 2 ** 20;

export class Pool {
  private slots: Slot[] = [];
  private queue: Running[] = [];
  private next = 1;
  private memoryFree = 0;
  private closed = false;

  constructor(
    private readonly spawn: () => WorkerLike,
    private readonly machine: Machine,
    private readonly opts: PoolOptions = {},
  ) {}

  /** Workers it may have now: one a processor, less one; at least one. */
  limit(): number {
    const cpu = Math.max(1, this.machine.processors() - 1);
    return Math.max(1, Math.min(cpu, this.opts.max ?? cpu));
  }

  run<O = unknown>(part: Part): Promise<O> {
    if (this.closed) return Promise.reject(new Error('the pool is closed'));
    return new Promise<O>((resolve, reject) => {
      const now = this.opts.now?.() ?? Date.now();
      this.queue.push({ id: this.next++, part, since: now, resolve: resolve as (v: unknown) => void, reject });
      this.pump();
    });
  }

  /** Parts run, their outputs in their order. */
  all<O = unknown>(parts: Part[]): Promise<O[]> {
    return Promise.all(parts.map((p) => this.run<O>(p)));
  }

  status(): PoolStatus {
    return {
      workers: this.slots.length,
      limit: this.limit(),
      running: this.slots.flatMap((s) =>
        s.busy ? [{ label: s.busy.part.label ?? s.busy.part.job, since: s.busy.since }] : [],
      ),
      waiting: this.queue.length,
      memoryFree: this.memoryFree,
    };
  }

  close(): void {
    this.closed = true;
    for (const s of this.slots) s.worker.stop();
    for (const r of [...this.queue, ...this.slots.flatMap((s) => (s.busy ? [s.busy] : []))])
      r.reject(new Error('the pool is closed'));
    this.slots = [];
    this.queue = [];
  }

  /** Parts handed out while the computer can take them. */
  private pump(): void {
    while (this.queue.length) {
      const busy = this.slots.filter((s) => s.busy);
      if (busy.length >= this.limit()) return;
      const r = this.queue[0] as Running;
      // (what the parts running may still take, as well as what is free now)
      this.memoryFree = this.machine.freeMemory();
      const claimed = busy.reduce((a, s) => a + (s.busy?.part.bytes ?? 0), 0);
      const reserve = this.opts.reserve ?? RESERVE;
      if (busy.length && this.memoryFree - claimed - r.part.bytes < reserve) return;
      let slot = this.slots.find((s) => !s.busy);
      if (!slot) slot = this.add();
      this.queue.shift();
      slot.busy = { ...r, since: this.opts.now?.() ?? Date.now() };
      slot.worker.send({ id: r.id, job: r.part.job, input: r.part.input }, r.part.transfer);
    }
  }

  private add(): Slot {
    const worker = this.spawn();
    const slot: Slot = { worker, busy: null };
    worker.onReply((reply) => {
      const r = slot.busy;
      if (!r || r.id !== reply.id) return;
      slot.busy = null;
      if (reply.ok) r.resolve(reply.output);
      else r.reject(new Error(reply.error));
      this.pump();
    });
    worker.onFail((e) => {
      // (a worker that died: its part failed, a new one in its place)
      const r = slot.busy;
      this.slots = this.slots.filter((s) => s !== slot);
      worker.stop();
      r?.reject(e);
      this.pump();
    });
    this.slots.push(slot);
    return slot;
  }
}

/** The buffers of the typed arrays in an output (its own or one level in), to hand back without copying. */
export function buffersIn(v: unknown): Transferable[] {
  const out = new Set<ArrayBuffer>();
  const add = (x: unknown) => {
    if (ArrayBuffer.isView(x) && x.buffer instanceof ArrayBuffer) out.add(x.buffer);
  };
  add(v);
  if (v && typeof v === 'object') for (const x of Object.values(v)) add(x);
  return [...out];
}

/** A worker's side: its jobs by name, each answered on the port it is given. */
export function serve(
  jobs: Record<string, (input: never) => unknown>,
  port: { onMessage(fn: (m: Request) => void): void; post(r: Reply, transfer: Transferable[]): void },
): void {
  port.onMessage(async (m) => {
    try {
      const job = jobs[m.job];
      if (!job) throw new Error(`no job ${m.job}`);
      const output = await job(m.input as never);
      port.post({ id: m.id, ok: true, output }, buffersIn(output));
    } catch (e) {
      port.post({ id: m.id, ok: false, error: e instanceof Error ? e.message : String(e) }, []);
    }
  });
}
