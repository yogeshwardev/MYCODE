---
name: explain-codebase
description: Explain how a codebase or feature works - architecture, main modules, data flow, entry points and where to make a given change - for onboarding or planning.
triggers: explain, how does, walk me through, architecture, overview, onboard, understand the code, where is, what does this
---
1. **Survey fast.** Start from the repository map, the README and the manifest files. For big codebases, use `delegate` to send parallel researchers into the major areas.
2. **Find the entry points**: main or CLI entry, server bootstrap, route registration, job schedulers, event consumers, exported library APIs.
3. **Trace one real request or command end to end** through the layers (e.g. route, handler, service, repository, database), citing `path:line` at each hop.
4. **Explain**:
   - a short summary of what the system does;
   - the architecture as a Mermaid diagram plus a module table (module, responsibility, key files);
   - the data model and where state lives;
   - cross-cutting concerns: config, auth, errors, logging, tests;
   - the conventions a contributor must follow;
   - for a specific question, exactly where to make the change and what else it touches.
5. Separate what you verified in the code from what you infer, and keep it as short as the question allows.
