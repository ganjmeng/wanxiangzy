# Documentation Index

This directory contains the current architecture, configuration, operations, testing, and historical audit documents for Pixel Diffusion.

## Start Here

| Document | Purpose |
| --- | --- |
| [Configuration](CONFIGURATION.md) | Environment variables, Supabase facts, storage, queue, billing, and production validation |
| [Admin bootstrap](admin-bootstrap.md) | Create or grant the first administrator without manual registration |
| [Supabase migration order](supabase-migration-order.md) | Required base SQL and timestamped migration sequence |

## Architecture and Platform

| Document | Purpose |
| --- | --- |
| [Architecture](ARCHITECTURE.md) | Runtime components, request flow, generation lifecycle, storage, and trust boundaries |
| [AI model control plane](ai-model-control-plane.md) | Provider configuration, routing, capacity, fallback, and publication rules |
| [AI toolbox provider integration](ai-toolbox-provider-integration.md) | Matting, upscale, generative edit, and provider gateway integration |
| [Internationalization](i18n.md) | Locale structure, message conventions, and RTL support |
| [Production generation queue](production-generation-queue.md) | PostgreSQL outbox, BullMQ, fencing, recovery, and load testing |
| [Production upload data plane](production-upload-data-plane.md) | Browser-to-OSS uploads, signed policies, CORS, and bucket rules |
| [Provider result to OSS pipeline](provider-result-oss-pipeline.md) | Remote provider result persistence, streaming, validation, and failure handling |
| [OSS mirror cloud pull](oss-mirror-cloud-pull.md) | Cloud-side OSS mirror trigger, deployment order, and rollback |
| [OSS remote stream worker](oss-remote-stream-worker.md) | Streaming provider results into OSS with bounded workers |
| [Try-on reference operations](tryon-reference-ops-runbook.md) | Reference categories, scene data, publication, verification, and incident recovery |

## Operations and Release

| Document | Purpose |
| --- | --- |
| [Release checklist](release-checklist.md) | Local build, migration gate, deployment, smoke test, and rollback procedure |
| [Backup and restore](backup-restore.md) | Database and object-storage backup scope, restore steps, and verification |
| [BullMQ load recovery test](bullmq-load-recovery-test.md) | Queue load, restart, failure recovery, and acceptance checks |

## Historical Snapshots

These documents describe dated audit results and remediation work. They are retained for traceability and are not the current production state.

| Document | Status |
| --- | --- |
| [Production readiness audit - 2026-06-16](production-readiness-audit-2026-06-16.md) | Historical snapshot |
| [Production readiness remediation notes - 2026-06-16](production-readiness-remediation-notes-2026-06-16.md) | Historical remediation record |

## Documentation Maintenance

- Add every new document to this index.
- Keep commands, environment-variable names, and file paths aligned with the current `main` branch.
- Mark dated audits or remediation records as historical instead of rewriting them as current guidance.
- Run `npm run check:docs` before opening a documentation pull request.
