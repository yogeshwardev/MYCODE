---
name: hardening
description: Harden deployment and infrastructure config - Dockerfiles, Kubernetes manifests, nginx/web servers, CI/CD pipelines, cloud IaC - against common misconfigurations.
triggers: harden, dockerfile, kubernetes, k8s, helm, nginx, terraform, iac, ci security, github actions security, cis benchmark
---
Review the config files that exist in the repo and fix or report concrete misconfigurations. Explain each change in one line.

**Containers (Dockerfile)**: pin base images by version (ideally digest), use minimal/distroless images, multi-stage builds so build tools don't ship, run as a non-root `USER`, no secrets in `ENV`/`ARG`/layers, `COPY` specific paths (with a `.dockerignore`), add a `HEALTHCHECK`, avoid `curl | sh`.

**Kubernetes**: `securityContext` with `runAsNonRoot: true`, `readOnlyRootFilesystem: true`, `allowPrivilegeEscalation: false`, drop all capabilities; resource requests/limits; no `hostNetwork`/`hostPID`/privileged; NetworkPolicies default-deny; secrets from Secret objects or an external store (not plain env in manifests); least-privilege ServiceAccounts/RBAC; image pull by digest.

**Web server / app headers**: TLS 1.2+ only with modern ciphers, HSTS, CSP, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, frame protection; hide server version banners; request size and timeout limits; rate limiting on auth endpoints; no directory listing.

**CI/CD (GitHub Actions etc.)**: least-privilege `permissions:` per workflow, pin third-party actions to commit SHAs, never expose secrets to `pull_request_target` from forks, no untrusted input interpolated into `run:` scripts (`${{ github.event.* }}` -> pass via env), protected branches/environments for deploys, OIDC instead of long-lived cloud keys.

**Cloud IaC (Terraform/CloudFormation)**: no public buckets or 0.0.0.0/0 on admin ports, encryption at rest, logging/auditing enabled, least-privilege IAM (no `*:*`), MFA for privileged access. Use `checkov`, `tfsec`/`trivy config` or `kube-score` if installed.

Validate after changing (build the image, `kubectl apply --dry-run=client`, `nginx -t`, `terraform validate`) when the tools exist. Never weaken existing controls to make something work.
