# Security policy

Follow the [Fortemate security policy](https://github.com/fortemate/.github/blob/main/SECURITY.md).
Report vulnerabilities privately to security@fortemate.com, or use GitHub private
vulnerability reporting when available. Do not post credentials or exploit
details in public issues.

There is no released runtime or supported production version yet. The current
handler is validated offline; no deployment or live-registration claim is made.

Verification v2 requires the pending key. Optional legacy readiness accepts only
fresh signed no-version requests; it is disabled by default and never enables
unsigned registration. Configure explicit body, tree, concurrency, cache, and
deadline limits; the library provides no production tuning defaults.

Callbacks must honor the abort signal. The handler rejects late results, but
JavaScript cannot forcibly stop noncooperative work. Unsettled dispatch retains a
bounded cache slot. Process-local deduplication is not distributed exactly-once
execution or durable replay protection.

Implementation must authenticate original request bytes, validate untrusted
payloads, bound input and execution, and redact secrets. CI must use synthetic
fixtures and mocked networking. Local secrets belong only in ignored files;
verify with `git check-ignore` before writing one.

Never register bots, rotate credentials, or call live services during imports,
builds, or tests.
