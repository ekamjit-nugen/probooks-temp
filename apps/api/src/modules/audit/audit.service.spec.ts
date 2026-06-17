/**
 * AuditService unit tests (STANDARDS §19.1/§19.2; INV-AUDIT-1/2). The repository
 * is a typed in-memory fake (NOT the DB — that is exercised by the e2e specs).
 * Proves: who comes from context (not the caller), occurredAt defaults to the
 * clock, the parent tx is threaded through, and verify() raises on tamper.
 */
import type { Permission, TenantId, UserId } from "@probooks/shared";

import type { TenantContext } from "../../core/tenant-context/tenant-context";
import { TenantContextService } from "../../core/tenant-context/tenant-context.service";

import { AuditChainTamperError } from "./audit.errors";
import type {
  AppendAuditRow,
  AppendedAuditRow,
  AuditRepository,
} from "./audit.repository";
import { AuditService } from "./audit.service";
import { GENESIS_PREV_HASH } from "./hash-chain/hash-chain";
import type {
  ChainVerificationResult,
  StoredAuditRow,
} from "./hash-chain/hash-chain.verifier";

function firmContext(): TenantContext {
  return {
    tenantId: "00000000-0000-7000-8000-000000000001" as TenantId,
    userId: "00000000-0000-7000-8000-0000000000aa" as UserId,
    userRole: "firm_admin",
    permissions: new Set<Permission>(),
  };
}

class FakeAuditRepository {
  readonly appended: AppendAuditRow[] = [];
  rows: StoredAuditRow[] = [];

  append = jest.fn((row: AppendAuditRow): Promise<AppendedAuditRow> => {
    this.appended.push(row);
    return Promise.resolve({
      id: "00000000-0000-7000-8000-0000000000ff",
      position: 1,
      prevHash: GENESIS_PREV_HASH,
      entryHash: "a".repeat(64),
    });
  });

  listInOrder = jest.fn(
    (): Promise<StoredAuditRow[]> => Promise.resolve(this.rows),
  );
}

describe("AuditService", () => {
  let context: TenantContextService;
  let repo: FakeAuditRepository;
  let service: AuditService;
  const fixedNow = new Date("2026-06-05T09:30:00.000Z");

  beforeEach(() => {
    context = new TenantContextService();
    repo = new FakeAuditRepository();
    service = new AuditService(
      repo as unknown as AuditRepository,
      context,
      () => fixedNow,
    );
  });

  it("[INV-AUDIT-1] attributes who from context, not from the caller", async () => {
    await context.runWithContext(firmContext(), () =>
      service.record({
        action: "period.processed",
        entityType: "period",
        entityId: "00000000-0000-7000-8000-0000000000bb",
        beforeState: { state: "open" },
        afterState: { state: "processed" },
      }),
    );

    const written = repo.appended[0];
    expect(written?.actorUserId).toBe("00000000-0000-7000-8000-0000000000aa");
    expect(written?.actorRole).toBe("firm_admin");
  });

  it("defaults occurredAt to the clock when omitted", async () => {
    await context.runWithContext(firmContext(), () =>
      service.record({
        action: "flag.cleared",
        entityType: "flag",
        entityId: null,
        beforeState: null,
        afterState: { cleared: true },
      }),
    );

    expect(repo.appended[0]?.occurredAt).toEqual(fixedNow);
  });

  it("honours an explicit occurredAt", async () => {
    const occurredAt = new Date("2026-01-01T00:00:00.000Z");
    await context.runWithContext(firmContext(), () =>
      service.record({
        action: "flag.cleared",
        entityType: "flag",
        entityId: null,
        beforeState: null,
        afterState: null,
        occurredAt,
      }),
    );

    expect(repo.appended[0]?.occurredAt).toEqual(occurredAt);
  });

  it("threads the caller's transaction through to the repository", async () => {
    const tx = {} as Parameters<AuditRepository["append"]>[1];
    await context.runWithContext(firmContext(), () =>
      service.record(
        {
          action: "period.processed",
          entityType: "period",
          entityId: null,
          beforeState: null,
          afterState: null,
        },
        tx,
      ),
    );

    expect(repo.append).toHaveBeenCalledWith(expect.anything(), tx);
  });

  it("verify() resolves when the chain is intact", async () => {
    repo.rows = [];
    await expect(
      context.runWithContext(firmContext(), () => service.verify()),
    ).resolves.toBeUndefined();
  });

  it("[INV-AUDIT-2] verify() throws AuditChainTamperError naming the bad position", async () => {
    // A row whose entry_hash cannot be the genesis-linked recomputation.
    repo.rows = [
      {
        position: 1,
        prevHash: GENESIS_PREV_HASH,
        entryHash: "b".repeat(64),
        tenantId: "00000000-0000-7000-8000-000000000001",
        actorUserId: null,
        actorRole: null,
        action: "x",
        entityType: "y",
        entityId: null,
        beforeState: null,
        afterState: null,
        occurredAt: "2026-06-05T09:30:00.000Z",
      },
    ];

    const result: Promise<ChainVerificationResult | void> =
      context.runWithContext(firmContext(), () => service.verify());

    await expect(result).rejects.toBeInstanceOf(AuditChainTamperError);
    await expect(result).rejects.toMatchObject({ position: 1 });
  });
});
