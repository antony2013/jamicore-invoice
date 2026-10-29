import StaffReportsView from "@/components/StaffReportsView";

/**
 * Trash is its own route so the side menu can link to it (and highlight it).
 */
export default function StaffReportsTrashPage() {
  return <StaffReportsView initialTab="trash" />;
}
