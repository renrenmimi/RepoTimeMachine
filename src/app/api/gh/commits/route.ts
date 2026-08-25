import { fail, ok, readBranch, readPage, readRepoRef } from '@/lib/api/route-helpers';
import type { CommitsPayload } from '@/lib/api/contract';
import { COMMITS_PER_PAGE, fetchCommitPage, REVALIDATE } from '@/lib/github/service';

export const runtime = 'nodejs';

export async function GET(request: Request): Promise<Response> {
  try {
    const params = new URL(request.url).searchParams;
    const ref = readRepoRef(params);
    const branch = readBranch(params);
    const page = readPage(params);
    const result = await fetchCommitPage(ref, branch, page);
    const payload: CommitsPayload = {
      commits: result.commits,
      page,
      perPage: COMMITS_PER_PAGE,
      hasOlder: result.hasOlder,
      totalCommits: result.totalCommits,
      branch,
    };
    return ok(payload, REVALIDATE.commits);
  } catch (error) {
    return fail(error);
  }
}
