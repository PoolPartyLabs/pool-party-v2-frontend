# hookrisk

Executable risk assessment for Uniswap v4 hooks: Slither detectors (Python,
`detectors/`, AGPL), a twin-pool differential harness (Foundry, `harness/`),
and a TypeScript CLI (`cli/`) that reconciles engines, scores against the
Uniswap Foundation's Hooks Security Framework and emits a manifest.

## Start here

- Hackathon state, decisions and open items: `docs/hackathon/RESUME.md`.
- Narrative and evidence: `docs/hackathon/HACKATHON.md`, `docs/hackathon/evidence/`.
- Demo: `docs/hackathon/DEMO_RUNBOOK.md`, `docs/hackathon/demo.sh`.
- Architecture, scoring, invariants, detectors, error codes: `docs/*.md`.

## Commands

```bash
make setup            # venv + Slither plugin, pinned Solidity deps, CLI build
make test             # harness (forge), CLI (node --test), corpus gates, detector tests
make check-generated  # hooks_spec.py and TROUBLESHOOTING.md must match their sources
make docs             # regenerate docs/TROUBLESHOOTING.md after editing errors/catalog.json
./scripts/doctor.sh   # what this machine can run
cd corpus && forge build && HOOKRISK_SLITHER_BIN=$PWD/../.venv/bin/slither \
  node ../cli/dist/cli.js scan src/good/CleanHook.sol:CleanHook --verbose   # end-to-end smoke
```

Exit codes: 0 gate passed, 2 gate failed (a result), 10–70 hookrisk could not
run (catalogue code), 64 bad command line.

## Conventions

- Comments explain why; the code base's style is a short rationale per
  non-obvious decision. Match it.
- The CLI has one runtime dependency (`ajv`). Do not add more without a
  reason written down.
- Error paths fail loudly with an `HR-Exxx` code from `errors/catalog.json`.
  A tool that reports nothing looks exactly like success; never let a
  failure read as clean.
- Every behaviour change gets a test. Planted-defect fixtures under
  `harness/src/hooks/` and `corpus/src/{bad,good,legacy}` prove detectors and
  invariants fire and stay silent.
- The manifest schema (`schema/hook-risk.schema.json`) and the engine metadata
  schema (`schema/engine-metadata.schema.json`) are strict. Emitting a new
  field means adding it to the schema, then running a real scan: `make test`
  does not run one.
- Python and TypeScript talk only through the versioned `hookrisk` metadata
  block; change both sides and their tests together.

## Working in parallel

Parallel changes go in worktrees with disjoint file ownership (see the agent
split in `docs/hackathon/notes-*.md`), merged by an integrator who wires
`cli/src/cli.ts` and the schemas. Keep `.claude/worktrees/` out of the tree
(it is excluded locally in `.git/info/exclude`).
