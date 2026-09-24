# Security policy

Follow the [Fortemate security policy](https://github.com/fortemate/.github/blob/main/SECURITY.md).
Report vulnerabilities privately to security@fortemate.com, or use GitHub private
vulnerability reporting when available. Do not post credentials or exploit
details in public issues.

There is no released runtime or supported production version yet.

Implementation must authenticate original request bytes, validate untrusted
payloads, bound input and execution, and redact secrets. CI must use synthetic
fixtures and mocked networking. Local secrets belong only in ignored files;
verify with `git check-ignore` before writing one.

Never register bots, rotate credentials, or call live services during imports,
builds, or tests.
