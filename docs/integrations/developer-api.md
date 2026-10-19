# Service Center developer API and webhooks — version `2026-11-01`

F17 stage D. This is the contract an approved integration builds against. It is separate from the first-party `/api/v1` API used by the web and mobile apps, which does not accept API keys.

## Scope

- **Read-only, organization-level.** An administrator (owner/admin) issues a key for one organization with explicit scopes:
  - `plans.read`: service types, plus **published** plans with their times and order.
  - `songs.read`: the song library (neither archived nor merged songs).
- **Excluded:** people, assignments, contact data, notes, item descriptions, files, media, chat, draft and archived plans. No scope grants them.
- **Not included in this version:** write endpoints, per-person OAuth, and webhook events other than publication changes.

## Authentication

```http
GET /api/external/v1/organization HTTP/1.1
Host: api.example.org
Authorization: Bearer sck_<16 hex>_<43 base64url>
```

- The key is shown **once**, when it is created. Only a SHA-256 hash of its secret part is stored.
- A key works only while all of these hold. Each one is checked again on **every request**:
  - it is not revoked;
  - it has not expired;
  - its issuer is still an active owner/admin of the organization. Demoting or deactivating the issuer stops every key that person issued.
- Errors:

| Status | `code` | Meaning |
|---|---|---|
| 401 | `invalid_api_key` | Missing, malformed or unknown key |
| 401 | `api_key_inactive` | Revoked, expired, or the issuer is no longer an administrator |
| 403 | `insufficient_scope` | The key lacks the scope for this endpoint |
| 422 | `unprocessable` / `invalid_cursor` | Bad query parameters or cursor |
| 429 | `rate_limited` | Per-key limit reached; wait `Retry-After` seconds |

The error body is `{ "error": "<message>", "code": "<code>" }`.

## Rate limits and headers

- Each key has a per-minute limit: 60 by default, configurable from 1 to 600. Requests are counted in the database, so the limit holds across API instances.
- A wrong secret does not use up the real key's quota.
- Every response carries these headers:
  - `Service-Center-Api-Version: 2026-11-01`
  - `Cache-Control: no-store`
  - `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` (seconds until the window resets)
- A `429` response adds `Retry-After`.

## Pagination

- List endpoints take `limit` (1–100, default 50) and `cursor`, and return:

  ```json
  { "data": [ ... ], "next_cursor": "eyJpZCI6Ii4uLiJ9" }
  ```

- Pass `next_cursor` back as `cursor` to get the next page. It is `null` on the last page.
- Cursors are opaque, keyset-based and stable while rows are added. Order:
  - plans: `service_date`, then `id`;
  - service types and songs: `id`.

## Endpoints

### `GET /api/external/v1/organization`

Works with any scope.

```json
{ "data": { "id": "aaaaaaaa-0000-4000-8000-000000000001", "name": "Riverside Community Church", "timezone": "America/Toronto" } }
```

### `GET /api/external/v1/service-types` (`plans.read`)

```json
{ "data": [ { "id": "bbbbbbbb-…", "name": "Sunday Service", "description": null, "updated_at": "2026-10-01T12:00:00+00:00" } ], "next_cursor": null }
```

### `GET /api/external/v1/plans?from=…&to=…[&service_type_id=…]` (`plans.read`)

- `from` and `to` are ISO-8601 instants with an offset.
- The range is half-open, `[from, to)`, and at most 366 days.
- Only published plans are returned.

```json
{
  "data": [
    { "id": "6f1c…", "service_type_id": "bbbbbbbb-…", "title": "Sunday 10am", "service_date": "2029-03-04T15:00:00.000Z",
      "location": "Main hall", "updated_at": "2026-10-19T08:40:00+00:00" }
  ],
  "next_cursor": "eyJpZCI6IjZmMWMuLi4iLCJkYXRlIjoiMjAyOS0wMy0wNFQxNTowMDowMC4wMDBaIn0"
}
```

### `GET /api/external/v1/plans/{id}` (`plans.read`)

- Returns `404` when the plan is missing, unpublished, or belongs to another organization. You cannot tell these cases apart.
- Item descriptions and plan notes are never included.

```json
{
  "data": {
    "id": "6f1c…", "service_type_id": "bbbbbbbb-…", "title": "Sunday 10am", "service_date": "2029-03-04T15:00:00.000Z",
    "location": "Main hall", "updated_at": "2026-10-19T08:40:00+00:00",
    "times": [ { "id": "…", "kind": "service", "name": "10am", "starts_at": "2029-03-04T15:00:00+00:00", "ends_at": "2029-03-04T16:00:00+00:00" } ],
    "items": [ { "id": "…", "type": "song", "title": "Song title", "position": 2, "length_seconds": 240, "song_id": "…" } ]
  }
}
```

### `GET /api/external/v1/songs[?q=…]` (`songs.read`)

`q` is a case-insensitive substring match on the title. Wildcards are treated as literal characters.

```json
{ "data": [ { "id": "…", "title": "Song title", "author": "…", "ccli_number": "1234567", "default_key": "G", "themes": [], "updated_at": "…" } ], "next_cursor": null }
```

`ccli_number` is library metadata only. It is **not** proof of a license or entitlement.

## Webhooks

### Events

| `type` | When |
|---|---|
| `plan.published` | A plan's status becomes `published` |
| `plan.unpublished` | A published plan goes back to `draft` or is `archived` |
| `plan.deleted` | A published plan is deleted |
| `webhook.test` | An administrator pressed **Send test** |

- Draft plans never produce events.
- Events are recorded in the **same transaction** as the change. If nothing subscribes to an event type, no event is recorded.
- Payloads are **thin**: they carry identifiers only. Read the details through the API with your key.

```http
POST /your/endpoint HTTP/1.1
content-type: application/json
user-agent: ServiceCenter-Webhooks/1
webhook-id: evt_5d0c8e9b0f9a4f6c9a2f1c3d4e5f6a7b
webhook-timestamp: 1792400000
webhook-signature: v1,K5oZfzN95Z9UVu1EsfQmfVNQhnkZ2pj9o9NDN/H/pI4=

{"id":"evt_5d0c8e9b0f9a4f6c9a2f1c3d4e5f6a7b","type":"plan.published","api_version":"2026-11-01",
 "created_at":"2026-10-19T08:51:00.000+00:00","organization_id":"aaaaaaaa-…",
 "data":{"plan_id":"6f1c…","service_type_id":"bbbbbbbb-…"}}
```

### Verifying a delivery ([Standard Webhooks](https://www.standardwebhooks.com))

1. Take the **raw** request body. Do not re-serialize the JSON.
2. Compute `base64(HMAC-SHA256(key, "<webhook-id>.<webhook-timestamp>.<body>"))`, where `key` is the base64-decoded part of your signing secret after `whsec_`.
3. Accept the request if any space-separated `v1,<sig>` entry in `webhook-signature` matches. Compare in constant time.
4. Reject the request if `webhook-timestamp` is more than **5 minutes** from your clock. This stops replays.
5. Deduplicate on `webhook-id`. Retries reuse the same id, and the same event can arrive more than once.

Any Standard Webhooks library can do steps 1–4. Our implementation is checked against the specification's reference test vector.

### Delivery behaviour

- **Success:** any `2xx` answer. The response body is never read or stored.
- **Retries:** any other answer (including `4xx`, `429` and `5xx`), a timeout (15 s) or a connection failure is retried with the same `webhook-id`.
  - Up to 8 attempts, with jittered backoff of roughly 5 s, 5 min, 30 min, 2 h, 5 h, 10 h, 14 h and 20 h.
  - A `Retry-After` header is honoured, up to 24 h.
- **`410 Gone`:** the endpoint is paused immediately.
- **Redirects (`3xx`):** never followed. The delivery fails; update the URL instead.
- **Repeated failures:** five deliveries in a row that fail permanently pause the endpoint.
- **Ordering:** not guaranteed. Use `created_at` and re-read the plan.
- **Destination policy:**
  - `https` only.
  - No credentials in the URL.
  - The host is resolved at registration and again before **every** send. If any resolved address is loopback, private, link-local/metadata, CGNAT, multicast or another reserved range, the delivery is refused.
  - The connection is pinned to the address that was checked.
- **History:** kept for 30 days. Administrators see each delivery's attempts, status codes and timings in Settings, and can retry a failed or cancelled delivery. The retry uses the same event id.

## Revocation and its limits

- **Revoking a key:** the next request fails with `401 api_key_inactive`.
- **Revoking or pausing an endpoint:** cancels deliveries that are still waiting and records no new events for it. History is kept.
- **Physical limits:**
  - Data an integration has already fetched, and webhooks it has already received, cannot be recalled.
  - A delivery that is mid-flight when you revoke may still arrive once.
