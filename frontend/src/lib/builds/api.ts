/**
 * Builds API calls (docs/BUILDS.md §4), through an injected client: `serverApi()` in page
 * frontmatter, `browserApi` in islands, a fake in tests. `ref` is a paper's id or slug.
 */
import type { ApiClient } from '../api/client';
import type {
  BuildApprove,
  BuildContextView,
  BuildContinue,
  BuildCreate,
  BuildOptionsInput,
  BuildPlan,
  BuildPlanVersion,
  BuildPreset,
  BuildPublic,
  BuildSummary,
  BuildTarget,
  BuildVisibility,
  ContextPreview,
  Preflight,
  RepoChoice,
  TargetInspection,
} from '../api/types/builds';

type Reader = Pick<ApiClient, 'get'>;
type Poster = Pick<ApiClient, 'post'>;
type Putter = Pick<ApiClient, 'put'>;
type Deleter = Pick<ApiClient, 'delete'>;

const build = (id: string) => `builds/${encodeURIComponent(id)}`;
const paperBuilds = (ref: string) => `papers/${encodeURIComponent(ref)}/builds`;

export function listPresets(api: Reader): Promise<BuildPreset[]> {
  return api.get<BuildPreset[]>('builds/presets');
}

/** What would stop a build of this paper now; `local` skips the GitHub checks. */
export function preflight(api: Reader, document: string, visibility: BuildVisibility): Promise<Preflight> {
  return api.get<Preflight>('builds/preflight', { query: { document, visibility } });
}

/** The paper's builds, newest first. */
export function listBuilds(api: Reader, ref: string): Promise<BuildSummary[]> {
  return api.get<BuildSummary[]>(paperBuilds(ref));
}

/** Queue the plan (409 with the failing checks when preflight says no). */
export function createBuild(api: Poster, ref: string, body: BuildCreate): Promise<BuildPublic> {
  return api.post<BuildPublic>(paperBuilds(ref), body);
}

export function getBuild(api: Reader, id: string): Promise<BuildPublic> {
  return api.get<BuildPublic>(build(id));
}

/** Your own edit of the plan (only while `planned`). */
export function putPlan(api: Putter, id: string, plan: BuildPlan): Promise<BuildPublic> {
  return api.put<BuildPublic>(`${build(id)}/plan`, { plan });
}

/** Every plan the build has had (§7b), newest first. */
export function listPlanVersions(api: Reader, id: string): Promise<BuildPlanVersion[]> {
  return api.get<BuildPlanVersion[]>(`${build(id)}/plans`);
}

/** Make an earlier version the current plan again (only while `planned`). */
export function restorePlanVersion(api: Poster, id: string, version: number): Promise<BuildPublic> {
  return api.post<BuildPublic>(`${build(id)}/plans/${version}/restore`);
}

export function replan(api: Poster, id: string, feedback: string): Promise<BuildPublic> {
  return api.post<BuildPublic>(`${build(id)}/replan`, { feedback });
}

export function approve(api: Poster, id: string, body: BuildApprove = {}): Promise<BuildPublic> {
  return api.post<BuildPublic>(`${build(id)}/approve`, body);
}

export function stop(api: Poster, id: string): Promise<BuildPublic> {
  return api.post<BuildPublic>(`${build(id)}/stop`);
}

export function continueBuild(api: Poster, id: string, body: BuildContinue): Promise<BuildPublic> {
  return api.post<BuildPublic>(`${build(id)}/continue`, body);
}

/** Forget the build; its GitHub repository stays. */
export async function remove(api: Deleter, id: string): Promise<void> {
  await api.delete<unknown>(build(id));
}

/** The paper brief in sections and the references worth adding (§7); `linkPaper` shapes its header. */
export function getContextPreview(api: Reader, ref: string, linkPaper: boolean): Promise<ContextPreview> {
  return api.get<ContextPreview>(`${paperBuilds(ref)}/context`, { query: { link_paper: linkPaper } });
}

/** The files, kickoff and tools a build with these options would get: the form's preview. */
export function renderContext(api: Poster, ref: string, options: BuildOptionsInput): Promise<BuildContextView> {
  return api.post<BuildContextView>(`${paperBuilds(ref)}/context/render`, { options });
}

/** What this build actually received (its workspace once seeded, else rendered). */
export function getBuildContext(api: Reader, id: string): Promise<BuildContextView> {
  return api.get<BuildContextView>(`${build(id)}/context`);
}

/** Repositories you and your orgs have on GitHub (§7c), filtered by `q`; at most 100. */
export function listRepos(api: Reader, q: string): Promise<RepoChoice[]> {
  return api.get<RepoChoice[]>('builds/repos', { query: { q } });
}

/** What a build into this repository would meet: problems, branches, the folder, the survey. */
export function inspectTarget(api: Poster, target: BuildTarget): Promise<TargetInspection> {
  return api.post<TargetInspection>('builds/target/inspect', target);
}
