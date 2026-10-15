---
name: cloud-security
description: Review cloud security posture from infrastructure code and configs (AWS, GCP, Azure) - IAM least privilege, public exposure, encryption, logging, network segmentation - with prioritized fixes.
triggers: aws, gcp, azure, iam, s3 bucket, cloud security, security group, terraform security, cloudformation, least privilege, public bucket, kms
---
Work from the infrastructure code and exported configs in the repository (Terraform, CloudFormation, CDK, Pulumi, Bicep, Kubernetes, policy JSON). Do not change live cloud resources; propose code changes.

1. **Inventory**: accounts and projects, identities (users, roles, service accounts), data stores, network entry points, and CI/CD deploy credentials.
2. **Identity**: wildcard actions or resources (`"Action": "*"`), long-lived access keys, roles assumable by too many principals, missing MFA conditions for humans, CI using static keys instead of OIDC, unused but powerful permissions.
3. **Exposure**: public buckets and objects, 0.0.0.0/0 on admin ports (22, 3389, databases), public database endpoints, unauthenticated functions or API gateways, overly broad CORS on storage.
4. **Data protection**: encryption at rest (KMS keys with rotation), TLS in transit, backups and versioning, object lock for critical logs.
5. **Detection**: audit logging (CloudTrail or equivalent) on in all regions and protected from deletion, threat detection services enabled, alerting on root or owner usage.
6. **Run scanners if installed**: `checkov -d .`, `tfsec`, `trivy config .`; cloud-account scanners such as `prowler` only if the user explicitly provides access.
7. **Report** each issue with the resource, `path:line`, risk and a concrete IaC fix, ordered by exploitability and blast radius.
