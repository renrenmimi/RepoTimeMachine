import { fail, ok, readBranch, readProbePath, readRepoRef } from '@/lib/api/route-helpers';
import type { ProbePayload } from '@/lib/api/contract';
import { probeFirstCommitForPath, REVALIDATE } from '@/lib/github/service';

export const runtime = 'nodejs';

/**
 * "When did this path first appear?" answered by GitHub's path-scoped commit
 * listing. Used by the milestone heuristics to pin an event to one commit
 * without downloading every commit's diff.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const params = new URL(request.url).searchParams;
    const ref = readRepoRef(params);
    const branch = readBranch(params);
    const filePath = readProbePath(params);
    const result = await probeFirstCommitForPath(ref, branch, filePath);
    const payload: ProbePayload = { path: filePath, firstSha: result.firstSha, incomplete: result.incomplete };
    return ok(payload, REVALIDATE.probe);
  } catch (error) {
    return fail(error);
  }
}
