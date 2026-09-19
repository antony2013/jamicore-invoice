import { redirect } from "next/navigation";

/**
 * Root route: the web portal starts at sign-in.
 * (The old Slice-1 client testbench lived here during development and has
 * been removed — mobile app + API tests cover that flow now.)
 */
export default function Home() {
  redirect("/login");
}
