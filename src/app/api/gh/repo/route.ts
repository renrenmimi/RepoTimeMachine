import { fail, hasToken, ok, readRepoRef } from '@/lib/api/route-helpers';
import type { RepoPayload } from '@/lib/api/contract';
import { fetchRepoMeta, REVALIDATE } from '@/lib/github/service';

export const runtime = 'nodejs';

export async function GET(request: Request): Promise<Response> {
  try {
    const params = new URL(request.url).searchParams;
    const ref = readRepoRef(params);
    const meta = await fetchRepoMeta(ref);
    const payload: RepoPayload = { meta, tokenConfigured: hasToken() };
    return ok(payload, REVALIDATE.repo);
  } catch (error) {
    return fail(error);
  }
}
