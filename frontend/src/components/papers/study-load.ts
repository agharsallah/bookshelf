/**
 * What every study tab loads first (frontmatter only): the best version of its artifact
 * (approved, else the newest draft), the `derive` request that makes it, and — when it
 * does not exist yet — a job for that request already under way.
 */
import type { ArtifactListItem, ArtifactType } from '../../lib/api/types/artifacts';
import type { JobCreate, JobPublic } from '../../lib/api/types/jobs';
import { pickBest, type Chosen } from '../../lib/documents/artifacts';
import { paperArtifacts, recentJobs } from './load';
import { liveJobFor } from './queue';
import { deriveRequest } from './study-labels';

export interface StudyArtifact {
  best: Chosen<ArtifactListItem> | null;
  request: JobCreate;
  /** Only looked up when nothing exists yet. */
  job: JobPublic | null;
}

export async function loadStudyArtifact(documentId: string, type: ArtifactType, skill: string): Promise<StudyArtifact> {
  const request = deriveRequest(documentId, skill);
  const best = pickBest(await paperArtifacts(documentId, type), type, null);
  return { best, request, job: best ? null : liveJobFor(await recentJobs(documentId), request) };
}
