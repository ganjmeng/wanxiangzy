# Security Policy

## Supported Versions

Security fixes are applied to the latest `main` branch and the latest tagged release. Older releases may receive documentation-only guidance when a fix cannot be safely backported.

| Version | Supported |
| --- | --- |
| Latest `main` | Yes |
| Latest tagged release | Yes |
| Older releases | Best effort |

## Reporting a Vulnerability

Do not report security vulnerabilities in a public issue, discussion, pull request, or social media post.

Use GitHub's private vulnerability reporting flow:

1. Open the repository's **Security** tab.
2. Select **Report a vulnerability**.
3. Include the affected component, impact, reproduction steps, and the smallest safe proof of concept.
4. Remove real credentials, personal data, customer media, and production identifiers from the report.

If private reporting is unavailable, contact the maintainer privately using the contact method listed on [@ganjmeng's GitHub profile](https://github.com/ganjmeng).

## What to Include

- A concise description of the vulnerability and affected versions.
- Preconditions and an impact assessment.
- Reproduction steps or a minimal proof of concept.
- Relevant logs with secrets and personal data redacted.
- Any suggested fix or mitigation.
- Whether the issue has been disclosed elsewhere.

## Response Expectations

Maintainers will make a best effort to acknowledge reports promptly, validate the issue, coordinate a fix, and publish an advisory when appropriate. This is a community project and does not provide a commercial security SLA.

Please allow maintainers time to investigate and release a fix before public disclosure. Credit will be provided when requested and when it does not conflict with user privacy or legal requirements.

## Security Scope

High-priority areas include:

- Authentication, authorization, session handling, and role escalation.
- Supabase service-role access, RLS bypasses, and SQL injection.
- Credit debit, settlement, refund, and Stripe webhook integrity.
- SSRF, DNS rebinding, and remote media fetch allowlists.
- Upload signing, content-type validation, path traversal, and OSS policy boundaries.
- BullMQ, outbox, worker fencing, replay, and duplicate execution.
- Provider credential encryption and administrator secret handling.
- Command injection or unsafe shell usage in deployment and maintenance scripts.
- Sensitive data exposure in logs, traces, release artifacts, or browser storage.

## Secret Handling

If a credential is committed or exposed:

1. Revoke or rotate the credential first. Deleting the commit is not sufficient.
2. Remove the value from the current tree and, when necessary, from repository history.
3. Review provider and infrastructure audit logs for unauthorized use.
4. Update `.env.local.example` with a non-secret placeholder only.
5. Document the remediation without republishing the credential.

## Safe Harbor

Good-faith research that follows this policy, avoids privacy violations, does not degrade service, and does not access data beyond what is necessary to demonstrate the issue will be treated as authorized security testing for this project.
