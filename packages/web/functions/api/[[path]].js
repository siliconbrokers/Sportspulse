/**
 * Cloudflare Pages Function — API proxy
 * Forwards all /api/* requests to the Railway backend.
 * Set API_BACKEND_URL in Cloudflare Pages environment variables.
 * e.g. https://sportspulse.up.railway.app
 */
export async function onRequest(context) {
  const { request, env } = context;

  const backendUrl = env.API_BACKEND_URL;
  if (!backendUrl) {
    return new Response(
      JSON.stringify({ error: 'API_BACKEND_URL not configured' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const url = new URL(request.url);
  const target = `${backendUrl.replace(/\/$/, '')}${url.pathname}${url.search}`;

  return fetch(target, {
    method: request.method,
    headers: request.headers,
    body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
  });
}
