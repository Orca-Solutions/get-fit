# Project scaffold

Provider-neutral operating scaffold for Claude and Codex. Copy it into a project and fill in PROJECT_BRIEF.md, WORKING_RECORD.md, the commands and project-specific sections in both matching agent entry points, and docs/README.md. Replace this README with the project's purpose, setup, usage, and verification instructions.

- SOFTWARE_OPERATING_GUIDE.md: shared operating policy and human decision gates.
- PR_WORKFLOW.md: draft PRs, independent verification, merge preparation, and human merge ownership.
- CLAUDE.md / AGENTS.md: identical standing instructions, discovered by Claude / Codex respectively. Update both together.
- docs/AGENT_ROLES.md: shared researcher, implementer, reviewer, and architect contracts.
- .claude/agents/ and .claude/settings.json: Claude-specific adapters and settings. Codex uses its supported delegation tools with the shared role contracts; these files do not configure Codex.
- HANDOFF_TEMPLATES.md: provider-neutral task, review, working-record, and merge-brief prompts.

The workflow applies to documentation and maintenance PRs as well as feature work. Configure GitHub protections separately; copying these files does not enforce repository permissions.

## Local and remote use

The default .gitignore preserves the existing policy of keeping operating documents and tool configuration private. Both entry points and their shared references are present locally but are not delivered by a Git clone. For remote workers, supply these instructions through the tool's supported project/session mechanism, or deliberately authorize tracking the required files. Track project state files so workers can see the approved scope and working record. Do not infer that unavailable adapters or independent reviewers ran.
