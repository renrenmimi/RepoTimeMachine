import { TimeMachine } from '@/components/TimeMachine';

/**
 * The shell is static: it renders and paints before any GitHub request is made,
 * and the client component fills it in once the address bar has been read.
 */
export default function HomePage() {
  return <TimeMachine />;
}
