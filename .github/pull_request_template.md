## Summary

Describe the problem, the root cause, and the change.

## Scope

- [ ] The change is narrowly scoped.
- [ ] Unrelated refactors or formatting changes are excluded.
- [ ] User-visible behavior and operational impact are documented.

## Verification

- [ ] `npm run test`
- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm run check:release`
- [ ] Additional focused verification is described below.

## Risk Review

- [ ] No secrets, production data, customer media, or private endpoints are included.
- [ ] Authentication, authorization, RLS, billing, queue, and storage boundaries were reviewed where relevant.
- [ ] Database migrations are ordered and include recovery guidance.
- [ ] Runtime configuration examples and documentation are updated.
