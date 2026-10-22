import { AppHeader, SiteFooter } from "@/components/shell";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { listStates, locationLabel } from "@/server/reference";
import { AccountForms } from "./account-forms";

export const metadata = { title: "Account settings" };

export default async function AccountPage() {
  const user = await requireUser({ allowIncompleteOnboarding: true });
  const [states, loc] = await Promise.all([listStates(), locationLabel(user)]);
  return (
    <>
      <AppHeader user={user} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6">
        <PageHeader title="Account settings" description={user.email} />
        <div className="space-y-6">
          <Card>
            <CardHeader title="Roles" description="One account can learn and teach." />
            <div className="flex flex-wrap gap-2 px-5 pb-5">
              {user.isStudent && <Badge tone="brand">Student</Badge>}
              {user.isTutor && <Badge tone="teal">Tutor</Badge>}
              {user.adminRole && <Badge tone="warning">Admin · {user.adminRole}</Badge>}
              {user.emailVerifiedAt ? <Badge tone="success">Email verified</Badge> : <Badge tone="warning">Email not verified</Badge>}
            </div>
          </Card>
          <AccountForms states={states} user={{ displayName: user.displayName, phone: user.phone, stateId: user.stateId, lgaId: user.lgaId, cityId: user.cityId, isStudent: user.isStudent, isTutor: user.isTutor }} locationText={loc} />
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
