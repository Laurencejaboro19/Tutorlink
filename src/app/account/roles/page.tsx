import { redirect } from "next/navigation";

export default async function RolesRedirect() {
  redirect("/account");
}
