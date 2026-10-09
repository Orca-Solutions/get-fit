# Documentation

| Document | What it covers | Read it before |
|---|---|---|
| [SPEC.md](SPEC.md) | The product: screens and flows, the data model, storage and sync, stack and code layout, open items. | Changing a screen or a record shape. |
| [periodization.md](periodization.md) | The training rules the plan generator implements (zones, slots, rotation, balance targets, core wave, progression), with sources. | Touching `packages/core/src/generator` or `packages/core/src/program.ts`. |
| [exercise-database.md](exercise-database.md) | Where the exercise catalog comes from, its schema, the movements in it, and how it's built. | Editing `packages/core/scripts/curation.ts`. |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Running the app and sync server in production: hosting, domain, backups, rollout, rollback, updates, security. | Deploying or operating a server. |
| [api/](api/README.md) | API reference for the core package (`@orca-solutions/get-fit-core`) and the sync server's HTTP API. | Building on the core or talking to the server. |

Project records at the repo root:

- [PROJECT_BRIEF.md](../PROJECT_BRIEF.md): purpose, scope and acceptance criteria.
- [WORKING_RECORD.md](../WORKING_RECORD.md): current state, verification and open items.
- [CHANGELOG.md](../CHANGELOG.md): notable changes to the app and releases of the core package.
