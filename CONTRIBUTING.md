# Contributing to Pixel Diffusion

Thank you for helping improve Pixel Diffusion. This project handles authentication, billing, media storage, and long-running AI jobs, so changes must be easy to review and safe to operate.

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Before You Start

- Search existing issues and pull requests before opening a new one.
- For security vulnerabilities, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.
- For large product, schema, queue, provider-routing, or deployment changes, open an issue first and describe the operational impact.
- Never include real credentials, customer data, generated user media, database exports, or private URLs in code, tests, logs, screenshots, or issues.

## Development Setup

1. Install Node.js 22 and npm 10+.
2. Fork and clone the repository.
3. Install dependencies:

   ```bash
   npm ci
   ```

4. Create a local environment file:

   ```bash
   cp .env.local.example .env.local
   ```

5. Configure only the services required for your change. See [docs/CONFIGURATION.md](docs/CONFIGURATION.md) for details.
6. Initialize Supabase using [docs/supabase-migration-order.md](docs/supabase-migration-order.md) when your change needs database behavior.

## Branches and Commits

Use a short, descriptive branch name such as:

```text
feat/provider-retry-policy
fix/upload-size-validation
docs/self-hosting-guide
```

Use Conventional Commit-style messages where practical:

```text
feat(worker): add provider timeout classification
fix(upload): reject mismatched content types
docs(readme): clarify local Redis setup
test(queue): cover duplicate outbox delivery
```

Keep commits focused. Do not mix formatting-only changes with logic changes unless the formatting is required by the toolchain.

## Testing Requirements

Run the smallest relevant test while developing, then run the complete release gate before requesting review:

```bash
npm run test
npm run lint
npm run typecheck
npm run check:release
```

For database, queue, billing, media, or provider-routing changes, include focused regression tests and document any validation that cannot be performed locally.

For UI changes, include screenshots or a short recording and verify keyboard navigation, loading, empty, error, mobile, and dark-mode states where relevant.

## Pull Request Checklist

- The change is narrowly scoped and explains the problem and root cause.
- Tests cover the changed behavior or the PR explains why a test is not practical.
- `npm run check:release` passes locally, or the PR documents the failing gate and evidence.
- Database migrations are ordered, forward-only where required, and include rollback or recovery guidance.
- Queue, billing, auth, storage, and provider changes describe their failure and retry behavior.
- No secrets, production identifiers, customer data, or downloaded user media are included.
- Documentation and `.env.local.example` are updated when configuration changes.
- The contribution is compatible with the Apache-2.0 license.

## Database Changes

- Add new timestamped SQL files under `supabase/migrations/` instead of editing an already-applied migration.
- Update `docs/supabase-migration-order.md` when ordering changes.
- Preserve RLS and service-role boundaries.
- Keep credit, generation, outbox, and settlement operations idempotent.
- Include post-migration verification SQL for new functions or tables.

## Security and Privacy

- Treat all provider keys, Supabase service-role keys, OSS credentials, Stripe secrets, and processor secrets as production credentials.
- Never weaken SSRF, host allowlist, upload, signature, or authentication checks to make a test pass.
- Redact credentials and personal data from logs and issue attachments.
- Revoke any credential immediately if it is committed, even if the commit is later removed.

## License

By contributing, you agree that your contribution may be distributed under the repository's [Apache License 2.0](LICENSE).
