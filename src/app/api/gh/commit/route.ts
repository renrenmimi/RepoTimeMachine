import { fail, ok, readRepoRef, readSha } from '@/lib/api/route-helpers';
import type { CommitDetailPayload } from '@/lib/api/contract';
import { fetchCommitDetail, REVALIDATE } from '@/lib/github/service';

export const runtime = 'nodejs';

export async function GET(request: Request): Promise<Response> {
  try {
    const params = new URL(request.url).searchParams;
    const ref = readRepoRef(params);
    const sha = readSha(params);
    const detail = await fetchCommitDetail(ref, sha);
    const payload: CommitDetailPayload = { detail };
    return ok(payload, REVALIDATE.commitDetail);
  } catch (error) {
    return fail(error);
  }
}
