import AdminReportsView from "@/components/AdminReportsView";

/**
 * Trash is its own route so the side menu can link to it (and highlight it).
 */
export default function AdminReportsTrashPage() {
  return <AdminReportsView initialTab="trash" />;
}
