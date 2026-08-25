import { fail, ok, readRepoRef, readSha } from '@/lib/api/route-helpers';
import type { TreePayload } from '@/lib/api/contract';
import { fetchTree, REVALIDATE } from '@/lib/github/service';

export const runtime = 'nodejs';

export async function GET(request: Request): Promise<Response> {
  try {
    const params = new URL(request.url).searchParams;
    const ref = readRepoRef(params);
    const sha = readSha(params);
    const tree = await fetchTree(ref, sha);
    const payload: TreePayload = { tree };
    return ok(payload, REVALIDATE.tree);
  } catch (error) {
    return fail(error);
  }
}
