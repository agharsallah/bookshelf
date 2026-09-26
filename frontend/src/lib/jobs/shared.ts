/**
 * One `/jobs/stream` connection per URL, shared by every island on the page.
 *
 * A document page has several islands that follow jobs (the pipeline timeline, the
 * outline's study buttons, the book-wide ones); each opening its own `EventSource`
 * tripled the polling for nothing. Subscribers here share one connection
 * (./connection.ts), opened by the first and closed with the last. The server sends its
 * snapshot only when a connection opens, so a late subscriber is replayed what the
 * channel has seen: every job's latest version, the queue status, and whether it is open.
 */
import type { JobPublic, QueueStatus } from '../api/types/jobs';
import { connectJobStream, type ConnectionEvent, type JobStreamConnection } from './connection';
import { isNewer } from './stream';

export interface JobStreamListener {
  onJob: (job: JobPublic) => void;
  onQueue: (queue: QueueStatus) => void;
  onStatus: (event: ConnectionEvent) => void;
}

interface Channel {
  listeners: Set<JobStreamListener>;
  jobs: Map<string, JobPublic>;
  queue: QueueStatus | null;
  open: boolean;
  close: () => void;
}

type Connect = (options: JobStreamConnection) => () => void;

const channels = new Map<string, Channel>();

/** Listen to the stream at `url`; returns the unsubscribe function. */
export function subscribeJobStream(url: string, listener: JobStreamListener, connect: Connect = connectJobStream): () => void {
  let channel = channels.get(url);
  if (!channel) {
    const created: Channel = {
      listeners: new Set(),
      jobs: new Map(),
      queue: null,
      open: false,
      close: () => undefined,
    };
    channels.set(url, created);
    created.close = connect({
      url,
      onJob: (job) => {
        if (!isNewer(job, created.jobs.get(job.id))) return;
        created.jobs.set(job.id, job);
        created.listeners.forEach((l) => l.onJob(job));
      },
      onQueue: (queue) => {
        created.queue = queue;
        created.listeners.forEach((l) => l.onQueue(queue));
      },
      onStatus: (event) => {
        created.open = event === 'open';
        created.listeners.forEach((l) => l.onStatus(event));
      },
    });
    channel = created;
  } else {
    channel.jobs.forEach((job) => listener.onJob(job));
    if (channel.queue) listener.onQueue(channel.queue);
    if (channel.open) listener.onStatus('open');
  }
  channel.listeners.add(listener);
  const joined = channel;
  return () => {
    joined.listeners.delete(listener);
    if (joined.listeners.size > 0) return;
    joined.close();
    channels.delete(url);
  };
}
