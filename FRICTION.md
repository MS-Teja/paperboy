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
