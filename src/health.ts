import http, { type Server } from 'node:http';

export interface HealthChecks {
  ws: () => boolean;
  db: () => boolean;
}

/**
 * Liveness: 200 only when the Socket Mode WS is connected AND SELECT 1 succeeds.
 * Binds all interfaces deliberately — kubelet httpGet probes connect to the pod IP,
 * so a 127.0.0.1 bind would break liveness. The endpoint is unauthenticated but
 * exposes only ok/unhealthy; in-cluster exposure is acceptable.
 */
export function createHealthServer(checks: HealthChecks, port: number): Server {
  const server = http.createServer((req, res) => {
    if (req.url === '/healthz') {
      const ok = checks.ws() && checks.db();
      res.writeHead(ok ? 200 : 503, { 'content-type': 'text/plain' });
      res.end(ok ? 'ok' : 'unhealthy');
      return;
    }
    res.writeHead(404);
    res.end();
  });
  // Slow-client hygiene: drop connections that don't complete quickly.
  server.requestTimeout = 5_000;
  server.headersTimeout = 5_000;
  server.listen(port);
  return server;
}
