# Optional React Console

React 19.2.8 + TypeScript 7.0.2 + Vite 8.2.2; Node 26.8.1 and npm 12.0.2.
See [toolchain declarations](../README.md#local-development), run `make ui-install` then `make ui`.
Dev proxy forwards `/api` requests to the controller loopback address, eliminating the need for broad CORS rules.
The current interface displays genuine system and rule state; no fabricated attack metrics.

Production builds output to `control-plane/internal/console/dist` for Go binary embedding. When running
the standalone controller binary, external asset directories are not required. Vite serves as the local dev/HMR server;
shutting down the controller or UI does not impact the active NGINX data plane.

Extension forms use the control-plane manifest catalog. Local fallback defaults are not the authority for server validation. Observability extensions include Prometheus, OpenTelemetry Metrics, OpenTelemetry Logs and Standard Stream Logs; see [their runtime behavior](../docs/observability.md).

`npm run build` runs TypeScript checks and Vite. There is currently no `npm run lint` script in [package.json](package.json).
