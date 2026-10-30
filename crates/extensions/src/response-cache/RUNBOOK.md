# Response Cache Operational Runbook

## 1. Enabling the Response Cache Extension

Deploy a configuration with `"renderer": "response-cache"` in your Aurora Gateway NodeSpec:

```json
{
  "instance_id": "cache-default",
  "key": "builtin/response-cache",
  "version": 1,
  "renderer": "response-cache",
  "config_json": "{\"enabled\":true,\"default_ttl_secs\":300,\"max_memory_mb\":512,\"allowed_methods\":[\"GET\",\"HEAD\"]}"
}
```

---

## 2. Diagnostics & Verification

### Verifying Cache Hits via Curl

1. Initial request (Cache Miss):
   ```bash
   curl -i -H "Accept-Encoding: gzip, br, zstd" http://localhost:8080/api/users
   ```
   Inspect upstream headers.

2. Immediate subsequent request (Cache Hit):
   ```bash
   curl -i -H "Accept-Encoding: gzip, br, zstd" http://localhost:8080/api/users
   ```
   Expected response headers:
   ```http
   HTTP/1.1 200 OK
   Content-Type: application/json
   Content-Encoding: zstd
   Vary: Accept-Encoding
   X-Cache: HIT
   Age: 2
   ```

3. Client Cache Bypass:
   ```bash
   curl -i -H "Cache-Control: no-cache" http://localhost:8080/api/users
   ```
   Bypasses in-memory cache and fetches fresh data from upstream.

---

## 3. Troubleshooting

### Problem: Responses are not being cached
- Verify upstream response status code is within `allowed_status_codes` (e.g. 200).
- Check upstream response `Cache-Control` header. If upstream sends `no-store` or `private`, Aurora strictly respects RFC 7234 and will not cache it.
- Check payload size: responses exceeding `max_body_bytes` (default 10MB) are bypassed to avoid memory exhaustion.
- Verify HTTP method: only methods listed in `allowed_methods` (default `GET`, `HEAD`) are eligible.

### Problem: High Memory Usage
- Adjust `max_memory_mb` to a lower threshold (e.g. 128MB or 256MB).
- Ensure `cache_key_query_params` is configured to ignore dynamic tracking query parameters (`utm_*`, `fbclid`), avoiding cache fragmentation.
