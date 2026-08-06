# Contributing to GrayMatter Lite

GrayMatter Lite welcomes focused fixes, tests, documentation, KnowledgePack
improvements, local-model integrations, and portability work.

## Development loop

```bash
git clone https://github.com/ValkyrLabs/GrayMatter.git
cd GrayMatter
./vaix generate
./vaix test
```

Keep changes at their canonical source:

- API and generated behavior: `templates/graymatter-light-bootstrap/api.hbs.yaml`
- Lite backend/dashboard: `templates/graymatter-light-bootstrap/local-server`
- MCP: `mcp-server`
- client scripts: `scripts`
- public docs: `README.md` and `docs`

The mirrored `plugins/graymatter` release surface must stay byte-for-byte
aligned where the release tests require it. Never bypass generated RBAC/ACL,
weaken KnowledgePack validation, commit secrets, or turn blended profile mode
into a write path.

Before opening a pull request, run `./vaix test` and describe the exact source,
runtime, and user-visible behavior you verified. Keep pull requests narrow.

Use GitHub Discussions for design proposals before undertaking a large schema,
security, or compatibility change. Report security issues privately according
to `SECURITY.md`.

By contributing, you agree that your contribution is licensed under
AGPL-3.0-only with the rest of this repository.
