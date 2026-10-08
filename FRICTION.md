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

## 4. Playground event simulation isn't mentioned in the API docs, and only makes live-view events

- **Date:** 2026-10-08
- **Area:** Ring Developer Playground, Ring MCP docs, Event History and Image Download APIs
- **Task:** `pnpm ring:smoke` and `pnpm ring:capture`: read recent events and download one snapshot.
- **Steps taken:** Listed devices (one "Playground Device", DoorbellPro, online). Called `GET /v1/history/devices/{id}/events` with and without `event_types=motion.human,ding`, and requested an image. Searched the Ring MCP docs for how to generate Playground events. Then used the Playground's "Simulate live view event" buttons (Package, Vehicle, Motion) and repeated the calls.
- **Expected:** Docs explaining how to produce test events and media; simulated "Motion" producing a `motion` event.
- **Actual:** Before simulating, history was `{"data": []}` and image download returned `416 MEDIA_NOT_FOUND`. The simulate buttons aren't mentioned in the API docs or the MCP server. Each button starts a WHEP live view playing a pre-recorded clip, and history records it as `on_demand`, never `motion` or `ding`, whichever button is pressed. There's no way to produce the motion or doorbell events an app actually reacts to.
- **Severity:** Medium (the rhythm engine needs human-motion and doorbell events)
- **Workaround:** Live-view events give real event IDs, timestamps and a downloadable recorded frame. The 14-day baseline uses replayed events labelled REPLAYED.
- **Suggestion:** Document the simulate buttons, and have "Motion" (plus a "Doorbell press") emit real `motion` / `ding` history events and webhooks.

## 5. Event names and subtypes differ between Event History and webhooks

- **Date:** 2026-10-08
- **Area:** Ring Partner API docs (Event History, Notifications)
- **Task:** Define one internal "activity signal" from both history polling and webhooks.
- **Steps taken:** Read the Event History and Notifications docs through the Ring MCP server.
- **Expected:** One event vocabulary across both delivery paths.
- **Actual:** Webhooks use `motion_detected` (with a `subType` such as `human`) and `button_press`. History uses `motion`, `on_demand` and `ding`, and the documented history response has no subtype field: `motion.human` exists only as an `event_types` filter. A client that wants "human motion" from history has to encode the subtype in its query. Confirmed against real data: history events carry no subtype attribute, only an undocumented `cv_detections` relationship (entry 7).
- **Severity:** Medium
- **Workaround:** Map history types to the webhook vocabulary in one place in `ring-partner-kit`, and filter by `event_type` in code (entry 7).
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

## 7. Undocumented `cv_detections` relationship, and `event_types` filter not applied

- **Date:** 2026-10-08
- **Area:** Ring Event History API
- **Task:** Parse real history events after simulating live views in the Playground.
- **Steps taken:** `GET /v1/history/devices/{id}/events`, with and without `event_types=motion.human,ding`; parsed with a schema written from the docs.
- **Expected:** Events shaped like the documented example, and the filtered call returning only human motion and doorbell events.
- **Actual:** Every event has a `cv_detections` relationship whose `data` is a list (empty for live views) and a `meta.riid` field; neither is documented. The strict schema rejected the list. The filtered call returned the same three `on_demand` events as the unfiltered one, so the filter was ignored.
- **Severity:** Medium (a filter that silently returns everything would make every live view look like human activity)
- **Workaround:** Accept to-one and to-many relationships, keep schemas loose, and always check `event_type` in code rather than trusting the filter.
- **Suggestion:** Document `cv_detections` (it looks like where motion subtypes live) and `meta.riid`, and return `400` for unsupported filters instead of ignoring them.

## 8. Undocumented `422 GRECO_NO_VALID_KEY` from image download

- **Date:** 2026-10-08
- **Area:** Ring Image Download API
- **Task:** Download one doorstep frame for the snapshot check.
- **Steps taken:** `latest_in_range` over the last 24 hours, then `at_timestamp` at the start of the newest live-view event; followed each `303` to the pre-signed URL.
- **Expected:** Both return the same recorded frame, or `416` if there is none. The device reports `e2e_encryption.enabled: false`.
- **Actual:** `at_timestamp` returned a 39 KB JPEG (`X-Media-Origin: recording`). `latest_in_range` returned `422 GRECO_NO_VALID_KEY` ("No valid Greco key available for decryption"). The docs list `422` only as `CORRUPT_RECORDING`, and nothing explains "Greco" keys or why an unencrypted device's media needs one.
- **Severity:** Medium
- **Workaround:** Request frames with `at_timestamp` at a known event time; treat any decryption error as verdict `unavailable`.
- **Suggestion:** Document `GRECO_NO_VALID_KEY`, what causes it, and whether `latest_in_range` is expected to work on Playground devices.
