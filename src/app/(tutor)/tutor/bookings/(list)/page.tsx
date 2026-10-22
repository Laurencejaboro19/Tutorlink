import { BookingList, BookingTabs } from "@/components/booking-list";
import { PageHeader } from "@/components/ui";
import { requireTutor } from "@/lib/auth";
import { countTutorBookings, listTutorBookings, type BookingTab } from "@/server/booking-queries";

export const metadata = { title: "Bookings" };
export const dynamic = "force-dynamic";

const TABS: BookingTab[] = ["upcoming", "past", "all", "needs_action"];

export default async function TutorBookingsPage({ searchParams }: PageProps<"/tutor/bookings">) {
  const user = await requireTutor();
  const sp = await searchParams;
  const tab = (TABS as string[]).includes(String(sp.tab)) ? (sp.tab as BookingTab) : "upcoming";
  const page = Math.max(1, Number(typeof sp.page === "string" && /^\d+$/.test(sp.page) ? sp.page : 1));
  const [list, counts] = await Promise.all([listTutorBookings(user.id, tab, page), countTutorBookings(user.id)]);
  return (
    <>
      <PageHeader title="Bookings" description="Acknowledge new bookings quickly — response time is part of your ranking." />
      <BookingTabs
        base="/tutor/bookings"
        active={tab}
        tabs={[
          { key: "upcoming", label: "Upcoming", count: counts.upcoming },
          { key: "past", label: "Past" },
          { key: "all", label: "All" },
          { key: "needs_action", label: "Needs action", count: counts.pendingAck + counts.endedUnmarked },
        ]}
      />
      <BookingList
        rows={list.rows}
        page={list.page}
        pageCount={list.pageCount}
        hrefFor={(p) => `/tutor/bookings?tab=${tab}&page=${p}`}
        detailBase="/tutor/bookings"
        side="tutor"
        emptyTitle={tab === "upcoming" ? "No upcoming sessions" : tab === "needs_action" ? "Nothing needs your attention" : "No bookings yet"}
        emptyDescription={tab === "upcoming" ? "Students find you through search once your profile is listed and a package is published." : undefined}
      />
    </>
  );
}
