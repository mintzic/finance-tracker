export function sameOrigin(request: Request) {
  if (request.headers.get('origin') !== new URL(request.url).origin) {
    throw new Response('Invalid request origin', { status: 403 });
  }
}
