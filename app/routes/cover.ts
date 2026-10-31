import type { Route } from './+types/cover';
import { sqlite } from '../db/connection.server';
import { withProfile } from '../lib/profiles.server';

export function loader({ request }: Route.LoaderArgs) {
  return withProfile(request, () => loadCover(request));
}
function loadCover(request: Request) {
  const cover = sqlite.prepare('SELECT version,mime,image FROM workspace_cover WHERE id=1').get() as
    { version: string; mime: string; image: Buffer } | undefined;

  if (!cover || new URL(request.url).searchParams.get('v') !== cover.version) {
    throw new Response('Cover not found', { status: 404 });
  }

  return new Response(new Uint8Array(cover.image), {
    headers: {
      'Content-Type': cover.mime,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
