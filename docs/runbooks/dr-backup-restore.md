# Runbook — DR: backup & restore (Phase 0)

> **Scope:** Disaster-recovery procedure for the ProBooks data tier modelled in
> `infra/` (RDS Postgres 16 + S3 documents). **Residency:** every step stays in
> `ca-central-1` — **no cross-region copy** is ever performed (INV-AUDIT-5 /
> PIPEDA). This is a _forward-looking_ runbook: there is no live AWS account in
> Phase 0 (synth-only, `docs/phase-0-plan.md` J.2). It documents the procedure
> the modelled infrastructure supports so it is ready when the account lands.

## 1. What is protected, and how

| Asset                              | Mechanism (modelled in `infra/`)                                       | RPO                    | RTO target |
| ---------------------------------- | ---------------------------------------------------------------------- | ---------------------- | ---------- |
| Postgres (tenant + financial data) | RDS **Multi-AZ** + automated backups, **14-day** retention -> **PITR** | ≤ 5 min (PITR)         | ≤ 60 min   |
| Documents (S3)                     | **Versioning** enabled; CMK-encrypted; block-all-public                | last write (versioned) | ≤ 15 min   |
| Encryption keys                    | Customer-managed **KMS** keys, rotation on                             | n/a                    | n/a        |
| DB credentials                     | **Secrets Manager** generated secret                                   | n/a                    | n/a        |

All backups, snapshots, and replicas remain in `ca-central-1`. **Never** enable
a cross-region read replica, cross-region snapshot copy, or S3 Cross-Region
Replication — these violate INV-AUDIT-5.

## 2. Failure modes & responses

### 2.1 Single-AZ failure (the common case)

RDS is **Multi-AZ**: AWS fails over to the standby automatically (typically
60–120 s). No manual action; the writer endpoint is unchanged. Verify via the
app `/health/ready` probe (it pings both `app_user` and `service_role`).

### 2.2 Data corruption / bad migration / accidental write

Use **point-in-time recovery** to a _new_ instance, then cut over:

1. Identify the last-known-good timestamp (T). Audit hash-chain verification
   (`audit.service.verify()`) helps bound when tampering/corruption began.
2. Restore to a new instance **in `ca-central-1`** at time T:
   ```
   aws rds restore-db-instance-to-point-in-time \
     --source-db-instance-identifier probooks-postgres \
     --target-db-instance-identifier probooks-postgres-restore \
     --restore-time T \
     --no-publicly-accessible \
     --db-subnet-group-name <isolated-subnet-group> \
     --region ca-central-1
   ```
3. Re-apply post-T migrations only if they are known-good (Prisma
   `migrate deploy`). Re-attach the same KMS key + Secrets Manager secret.
4. Run RLS verification (`verifyRlsEnabled`) and a cross-tenant probe smoke test
   before cutover (defense-in-depth: confirm RLS is ENABLED + FORCED).
5. Repoint the app to the restored endpoint; keep the original instance
   (deletion protection is ON) until the restore is validated.

### 2.3 Document loss / corruption (S3)

Versioning is enabled — restore a prior version:

```
aws s3api list-object-versions --bucket <documents-bucket> --prefix <key> --region ca-central-1
aws s3api copy-object --bucket <documents-bucket> --key <key> \
  --copy-source <documents-bucket>/<key>?versionId=<good-version> --region ca-central-1
```

No deletes are destructive at the app layer (financial records are
retention-governed — INV-AUDIT-3); S3 versioning is the infra backstop.

### 2.4 KMS key compromise

Keys rotate automatically. On suspected compromise, schedule the affected key
for rotation/replacement, re-encrypt via envelope re-wrap, and audit
`kms:Decrypt` CloudTrail events. Do **not** copy ciphertext or keys cross-region.

## 3. Restore validation checklist (before declaring recovery complete)

- [ ] Restored instance is in `ca-central-1`, **not** publicly accessible.
- [ ] `StorageEncrypted` true with the ProBooks CMK.
- [ ] RLS ENABLED + FORCED on every tenant-scoped table (`verifyRlsEnabled`).
- [ ] Cross-tenant probe returns 0 rows / 404 (INV-TEN-1/2).
- [ ] `service_role` has **no** grant on `period_summaries` (INV-TEN-3).
- [ ] Audit hash chain verifies clean from genesis (INV-AUDIT-1/2).
- [ ] App `/health/ready` is 200 on both DB connections.
- [ ] Deletion protection re-enabled on the promoted instance.

## 4. Drill cadence

DR restore drill: at minimum **quarterly** once live. Record T, RTO achieved,
and any checklist failures. Keep deletion protection ON between drills.
