import {
  fail,
  ok,
  readCompareLabels,
  readComparePair,
  readRepoRef,
} from '@/lib/api/route-helpers';
import type { ComparePayload } from '@/lib/api/contract';
import { fetchCompare, REVALIDATE } from '@/lib/github/service';

export const runtime = 'nodejs';

/**
 * The net difference between two points of a repository.
 *
 * One GitHub request for a live repository, none for the built-in demo. The
 * result is addressed by two shas, so it never changes and is cached for a day.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const params = new URL(request.url).searchParams;
    const ref = readRepoRef(params);
    const { base, head } = readComparePair(params);
    const labels = readCompareLabels(params);
    const compare = await fetchCompare(ref, base, head, labels);
    const payload: ComparePayload = { compare };
    return ok(payload, REVALIDATE.compare);
  } catch (error) {
    return fail(error);
  }
}
