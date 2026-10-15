---
name: docs-writing
description: Write or improve technical documentation - READMEs, API references, setup guides, architecture decision records, changelogs and code comments - accurate to the actual code.
triggers: readme, documentation, write docs, document this, adr, architecture decision, changelog, docstring, jsdoc, tutorial
---
1. **Verify before you write.** Every command, flag, path, environment variable and code sample must match the real code: read the source, and run the commands when possible. Wrong docs are worse than none.
2. **Know the reader**: a newcomer installing it, a user looking up an option, or a maintainer making a decision. Write for that one reader.
3. **README structure**: what it is and why (2 sentences), a copy-pasteable quick start, common tasks, configuration reference, troubleshooting, how to contribute. Lead with the most common path.
4. **API docs**: each endpoint or function with its purpose, parameters (type, required, default), return value, errors, and one realistic example.
5. **ADRs**: context, the decision, alternatives considered with trade-offs, and consequences. Short and dated.
6. **Style**: short sentences, active voice, concrete examples, consistent terminology, no marketing language. Code comments explain why, not what.
7. Update related docs (links, tables of contents, changelog) so nothing contradicts the change.
