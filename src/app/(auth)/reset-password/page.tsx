import { ResetForm } from "./reset-form";

export const metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage({ searchParams }: PageProps<"/reset-password">) {
  const sp = await searchParams;
  const token = typeof sp.token === "string" ? sp.token : "";
  return (
    <>
      <h1 className="text-2xl font-bold text-ink-900">Choose a new password</h1>
      <ResetForm token={token} />
    </>
  );
}
