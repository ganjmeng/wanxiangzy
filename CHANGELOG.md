# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project aims to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html) for public releases.

## [Unreleased]

### Added

- Open-source README and Chinese README.
- Architecture, configuration, contribution, security, and code-of-conduct documentation.
- `npm run admin:create` command for creating or granting the first admin through the Supabase Admin API.
- GitHub issue forms, pull request template, CODEOWNERS, Dependabot, EditorConfig, and Git attributes.
- Apache-2.0 license and third-party asset notice.

### Changed

- Production deployment documentation now reflects the local-build workflow and manual-only GitHub Actions fallback.
- Deployment scripts no longer contain a default production host, private-key path, or version-specific Node.js path.
- Python maintenance scripts now resolve the repository root relative to their own location.

### Security

- Removed local tooling configuration from version control and added stricter secret-file ignore rules.
