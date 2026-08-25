import { fail, ok, readRepoRef } from '@/lib/api/route-helpers';
import type { TagsPayload } from '@/lib/api/contract';
import { fetchTags, REVALIDATE } from '@/lib/github/service';

export const runtime = 'nodejs';

export async function GET(request: Request): Promise<Response> {
  try {
    const params = new URL(request.url).searchParams;
    const ref = readRepoRef(params);
    const tags = await fetchTags(ref);
    const payload: TagsPayload = { tags };
    return ok(payload, REVALIDATE.tags);
  } catch (error) {
    return fail(error);
  }
}
