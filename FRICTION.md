# Friction log

Snags hit while building Paperboy with the Ring Partner API, AWS and supporting tools, logged as they happen. Newest entries go at the bottom.

Each entry records the date (IST), task, steps taken, expected and actual results, severity (low, medium or high), workaround and a suggestion.

---

## 1. `corepack enable` fails on Node 26

- **Date:** 2026-10-04
- **Area:** Tooling
- **Task:** Install pnpm before scaffolding the workspace.
- **Steps taken:** `brew install node`, then `corepack enable && corepack prepare pnpm@latest --activate`.
- **Expected:** Corepack activates pnpm.
- **Actual:** The command fails. Corepack is no longer bundled with Node 25 and later, and Homebrew installed Node 26.
- **Severity:** Low
- **Workaround:** `brew install pnpm`, and pin `"packageManager"` in `package.json` to the installed version.
- **Suggestion:** Setup guides that assume corepack should name a maximum Node version or show the standalone pnpm install.

## 2. Bedrock Converse refused on a new AWS account with an unhelpful error

- **Date:** 2026-10-07
- **Area:** AWS Bedrock (Amazon Nova Lite, `us-east-1`)
- **Task:** One-line Converse smoke test before building the snapshot check.
- **Steps taken:** `aws bedrock-runtime converse` with `amazon.nova-lite-v1:0`, then with the `us.amazon.nova-lite-v1:0` inference profile. Checked `GetFoundationModelAvailability`.
- **Expected:** Nova models are enabled automatically, so the call returns "OK".
- **Actual:** The first attempt failed with "Your account is currently being verified". Later attempts failed with `ValidationException: Operation not allowed`, and model availability shows `authorizationStatus: NOT_AUTHORIZED`. IAM is not the cause. Neither error says what to do next or how long to wait.
- **Severity:** High (blocks the snapshot check, milestone M4)
- **Workaround:** Pending. Raised with AWS; building against a stubbed Bedrock client until access is granted.
- **Suggestion:** When a new account isn't yet allowed to call a model, return an error that names the cause (account verification) and points to where to check status or request access, instead of a generic `ValidationException`.

## 3. Playground token expires before a session even starts

- **Date:** 2026-10-04
- **Area:** Ring Developer Playground
- **Task:** Run the device check and start the first build session.
- **Steps taken:** Generated a token in the Playground, ran setup steps, then opened the coding session.
- **Expected:** A token that lasts a working session.
- **Actual:** The token lasts about 30 minutes and had expired before the first session began. Every session starts with a manual trip to the Playground for a fresh token.
- **Severity:** Medium
- **Workaround:** `pnpm ring:smoke` runs first each session and prints one clear line asking for a new token when it gets a `401`.
- **Suggestion:** Offer a longer-lived Playground token (for example 8 hours), or a Playground refresh token, for hackathon and prototyping use.

## 4. Playground event simulation isn't mentioned in the API docs

- **Date:** 2026-10-08
- **Area:** Ring Developer Playground, Ring MCP docs, Event History and Image Download APIs
- **Task:** `pnpm ring:smoke` and `pnpm ring:capture`: read recent events and download one snapshot.
- **Steps taken:** Listed devices (one "Playground Device", DoorbellPro, online). Called `GET /v1/history/devices/{id}/events` with and without `event_types=motion.human,ding`. Called `POST /v1/devices/{id}/media/image/download` with `latest_in_range` over the last 24 hours, then followed the `303` to the pre-signed URL. Searched the Ring MCP docs for how to generate Playground events.
- **Expected:** Docs explaining how to produce test events and media on the Playground device.
- **Actual:** With nothing simulated yet, history returns `{"data": []}` for every filter. The image request is accepted (`303`), but the download returns `416 MEDIA_NOT_FOUND`. The Playground page has a "simulate motion" button, but the API docs and the MCP server never mention it, so the empty responses looked like a dead end until the button was found by hand. Whether simulated motion produces history events and a downloadable image is still to be checked.
- **Severity:** Medium (the rhythm engine and snapshot check both depend on events and images)
- **Workaround:** Use the Playground's simulate-motion button, then re-run `ring:smoke` and `ring:capture`.
- **Suggestion:** Document Playground event simulation in the Event History and Image Download pages, and index it in the MCP server.

## 5. Event names and subtypes differ between Event History and webhooks

- **Date:** 2026-10-08
- **Area:** Ring Partner API docs (Event History, Notifications)
- **Task:** Define one internal "activity signal" from both history polling and webhooks.
- **Steps taken:** Read the Event History and Notifications docs through the Ring MCP server.
- **Expected:** One event vocabulary across both delivery paths.
- **Actual:** Webhooks use `motion_detected` (with a `subType` such as `human`) and `button_press`. History uses `motion`, `on_demand` and `ding`, and the documented history response has no subtype field: `motion.human` exists only as an `event_types` filter. A client that wants "human motion" from history has to encode the subtype in its query. Not yet confirmed against real data, because Playground history was empty (entry 4).
- **Severity:** Medium
- **Workaround:** Poll history with `event_types=motion.human,ding` and map results to the webhook vocabulary in one place in `ring-partner-kit`.
- **Suggestion:** Return `sub_type` on history events and publish a table mapping history types to webhook types.

## 6. Small differences between the docs and live responses

- **Date:** 2026-10-08
- **Area:** Ring Partner API docs
- **Task:** Confirm documented shapes against captured fixtures (`fixtures/ring/`).
- **Steps taken:** `pnpm ring:capture`, then compared each response with the MCP docs.
- **Expected:** Live responses match the documented examples.
- **Actual:**
  - Empty history responses have no `links` object at all; the docs say `links.next` may be present even when `data` is empty.
  - The pre-signed image URL is on `download-ap-northeast-1.prod.phoenix.devices.amazon.dev`, not the documented `media.api.amazonvision.com`. Anyone who allow-lists outbound hosts would be blocked.
  - The docs don't say which scope image download needs. It turns out a Playground token with only `ava.v1:read` is accepted for this `POST`.
- **Severity:** Low
- **Workaround:** Treat `links` as optional, follow the `Location` header whatever its host, and rely on captured fixtures over doc examples.
- **Suggestion:** Generate doc examples from live responses, and list the required scope on each endpoint.
