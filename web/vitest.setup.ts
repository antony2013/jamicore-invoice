import { vi } from "vitest";

/**
 * Per-file setup: S3 is ALWAYS mocked in tests — no real or LocalStack
 * calls. Any test needing S3 behavior overrides these mocks explicitly.
 */
vi.mock("@/lib/s3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/s3")>();
  return {
    ...actual,
    generatePresignedUploadUrl: vi.fn(async () => "https://s3.test/upload"),
    generatePresignedViewUrl: vi.fn(async () => "https://s3.test/view"),
    generatePresignedReportUploadUrl: vi.fn(async () => "https://s3.test/report-upload"),
    inspectUploadObject: vi.fn(async () => ({
      exists: true,
      size: 2048,
      contentType: "application/pdf",
      magicOk: true,
    })),
    deleteObjectFromS3: vi.fn(async () => true),
    putObjectToS3: vi.fn(async () => undefined),
  };
});
