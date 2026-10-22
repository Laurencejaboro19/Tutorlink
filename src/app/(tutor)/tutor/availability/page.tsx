import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { tutorProfiles } from "@/db/schema";
import { Alert, Badge, Card, CardHeader, PageHeader } from "@/components/ui";
import { requireTutor } from "@/lib/auth";
import { minutesToLabel } from "@/lib/time";
import { listAvailability, listServiceAreas, MAX_SERVICE_AREAS } from "@/server/availability";
import { listStates } from "@/server/reference";
import { AddAreaForm, AddWindowForm, RemoveAreaButton, RemoveWindowButton } from "./availability-forms";

export const metadata = { title: "Availability & service areas" };
export const dynamic = "force-dynamic";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default async function AvailabilityPage() {
  const user = await requireTutor();
  const [profile, windows, areas, states] = await Promise.all([db.query.tutorProfiles.findFirst({ where: eq(tutorProfiles.userId, user.id) }), listAvailability(user.id), listServiceAreas(user.id), listStates()]);
  const formats = { physical: !!profile?.offersPhysical, online: !!profile?.offersOnline };
  return (
    <>
      <PageHeader title="Availability & service areas" description="Students can only book start times inside your weekly windows. Times are West Africa Time." />
      <div className="space-y-6">
        <Card>
          <CardHeader title="Weekly availability" description="Add recurring windows in 30-minute steps. Windows must not overlap on the same day." />
          <div className="px-5 pb-5">
            {!formats.physical && !formats.online ? (
              <Alert tone="warning">
                Enable at least one teaching format under{" "}
                <Link href="/tutor/profile" className="font-semibold underline">
                  Profile & verification
                </Link>{" "}
                before adding availability.
              </Alert>
            ) : (
              <AddWindowForm formats={formats} />
            )}
            <div className="mt-6">
              {windows.length === 0 ? (
                <p className="text-sm text-ink-500">No windows yet. Students cannot book you until you add at least one.</p>
              ) : (
                <table className="tl-table">
                  <caption className="sr-only">Availability windows</caption>
                  <thead>
                    <tr>
                      <th scope="col">Day</th>
                      <th scope="col">Time</th>
                      <th scope="col">Format</th>
                      <th scope="col">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {windows.map((w) => (
                      <tr key={w.id}>
                        <td className="font-medium text-ink-900">{WEEKDAYS[w.weekday]}</td>
                        <td>
                          {minutesToLabel(w.startMinute)} – {w.endMinute === 1440 ? "midnight" : minutesToLabel(w.endMinute)}
                        </td>
                        <td>
                          <Badge tone="neutral">{w.format === "hybrid" ? "In person or online" : w.format === "online" ? "Online" : "In person"}</Badge>
                        </td>
                        <td className="text-right">
                          <RemoveWindowButton id={w.id} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="In-person service areas" description={`Where you travel to for in-person sessions. Up to ${MAX_SERVICE_AREAS} areas; ${areas.length} added.`} />
          <div className="px-5 pb-5">
            {!formats.physical ? (
              <Alert tone="neutral">
                You currently teach online only. Enable in-person sessions under{" "}
                <Link href="/tutor/profile" className="font-semibold underline">
                  Profile & verification
                </Link>{" "}
                to add service areas.
              </Alert>
            ) : areas.length >= MAX_SERVICE_AREAS ? (
              <Alert tone="warning">You have reached the maximum of {MAX_SERVICE_AREAS} service areas. Remove one to add another.</Alert>
            ) : (
              <AddAreaForm states={states} />
            )}
            <ul className="mt-6 divide-y divide-ink-100">
              {areas.length === 0 ? (
                <li className="text-sm text-ink-500">No service areas yet{formats.physical ? " — in-person bookings need at least one" : ""}.</li>
              ) : (
                areas.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span className="text-ink-900">
                      {a.city ? `${a.city}, ` : ""}
                      {a.lga} LGA, {a.state}
                      {!a.city && <span className="text-ink-400"> (whole LGA)</span>}
                    </span>
                    <RemoveAreaButton id={a.id} />
                  </li>
                ))
              )}
            </ul>
          </div>
        </Card>
      </div>
    </>
  );
}
