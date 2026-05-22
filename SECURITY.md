# Security

Vigilon executes local tools and shell commands through an Agent runtime. Treat it as a developer tool that can read and modify files inside the configured workspace.

## Reporting

For now, report security issues privately to the repository owner before public disclosure. Do not open a public issue with exploit details or secrets.

## v0.1.0 Boundary

- Secrets should be provided through environment variables such as `DEEPSEEK_API_KEY`; do not commit `.env` files.
- Runtime transcripts and local state are written under `.vigilon/`, which is ignored by Git.
- The macOS sandbox and command safety policy are defense-in-depth controls, not a guarantee that arbitrary commands are safe.
- Review requested tool actions before approving them in `ask` permission mode.
