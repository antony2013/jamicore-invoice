import ExcelJS from "exceljs";

/**
 * Build the office work-product Excel report for one invoice.
 * One "Summary" sheet (who/what/when/amounts/status timeline) + one
 * "Timeline" sheet (full audit trail). Returns the .xlsx bytes.
 */
export type ReportInvoiceInput = {
  id: string;
  status: string;
  priority: string;
  category?: string | null;
  categoryDetail?: string | null;
  clientNote?: string | null;
  pageNotes?: string[] | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  ocrData?: {
    amount?: number | string | null;
    invoiceNo?: string | null;
    vendor?: string | null;
    date?: string | null;
  } | null;
  clientName?: string | null;
  clientUsername?: string | null;
  outletName?: string | null;
  assignedStaffName?: string | null;
  uploadedByName?: string | null;
  timeline: Array<{ status: string; note?: string | null; timestamp: Date | string; actorName?: string | null }>;
};

const fmtDate = (d: Date | string) => {
  const dt = d instanceof Date ? d : new Date(d);
  return Number.isNaN(dt.getTime()) ? String(d ?? "") : dt.toLocaleString();
};

export async function buildInvoiceReportXlsx(inv: ReportInvoiceInput): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "JamiCore Invoice System";
  wb.created = new Date();

  const summary = wb.addWorksheet("Summary");
  summary.columns = [
    { header: "Field", key: "field", width: 22 },
    { header: "Value", key: "value", width: 60 },
  ];
  summary.getRow(1).font = { bold: true };
  const rows: Array<[string, string]> = [
    ["Client", inv.clientName ?? ""],
    ["Client user ID", inv.clientUsername ?? ""],
    ["Outlet / branch", inv.outletName ?? "Unspecified"],
    ["Uploaded by", inv.uploadedByName ?? "Owner"],
    ["Invoice no", inv.ocrData?.invoiceNo ?? ""],
    ["Vendor", inv.ocrData?.vendor ?? ""],
    ["Date on invoice", inv.ocrData?.date ?? ""],
    ["Amount", inv.ocrData?.amount != null ? String(inv.ocrData.amount) : ""],
    ["Category", inv.categoryDetail || inv.category || ""],
    ["Priority", inv.priority],
    ["Status", inv.status],
    ["Assigned to", inv.assignedStaffName ?? "Unassigned"],
    ["Client note", inv.clientNote ?? ""],
    ["Page notes", (inv.pageNotes || []).filter(Boolean).join(" | ")],
    ["Uploaded at", fmtDate(inv.createdAt)],
    ["Last update", fmtDate(inv.updatedAt)],
  ];
  for (const [field, value] of rows) summary.addRow({ field, value });

  const timeline = wb.addWorksheet("Timeline");
  timeline.columns = [
    { header: "When", key: "when", width: 24 },
    { header: "Status", key: "status", width: 16 },
    { header: "By", key: "by", width: 24 },
    { header: "Note", key: "note", width: 60 },
  ];
  timeline.getRow(1).font = { bold: true };
  for (const t of inv.timeline) {
    timeline.addRow({
      when: fmtDate(t.timestamp),
      status: t.status,
      by: t.actorName ?? "",
      note: t.note ?? "",
    });
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
