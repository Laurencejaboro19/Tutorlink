import Link from "next/link";
import { BookingList, BookingTabs } from "@/components/booking-list";
import { PageHeader, buttonClass } from "@/components/ui";
import { requireStudent } from "@/lib/auth";
import { countStudentBookings, listStudentBookings, type BookingTab } from "@/server/booking-queries";

export const metadata = { title: "My sessions" };
export const dynamic = "force-dynamic";

const TABS: BookingTab[] = ["upcoming", "past", "needs_action"];

export default async function StudentBookingsPage({ searchParams }: PageProps<"/dashboard/bookings">) {
  const user = await requireStudent();
  const sp = await searchParams;
  const tab = (TABS as string[]).includes(String(sp.tab)) ? (sp.tab as BookingTab) : "upcoming";
  const page = Math.max(1, Number(typeof sp.page === "string" && /^\d+$/.test(sp.page) ? sp.page : 1));
  const [list, counts] = await Promise.all([listStudentBookings(user.id, tab, page), countStudentBookings(user.id)]);
  return (
    <>
      <PageHeader
        title="My sessions"
        description="Pay for pending bookings, join confirmed sessions and review completed ones."
        action={
          <Link href="/tutors" className={buttonClass("primary", "sm")}>
            Find a tutor
          </Link>
        }
      />
      <BookingTabs
        base="/dashboard/bookings"
        active={tab}
        tabs={[
          { key: "upcoming", label: "Upcoming", count: counts.upcoming },
          { key: "past", label: "Past" },
          { key: "needs_action", label: "Needs action", count: counts.needsAction },
        ]}
      />
      <BookingList
        rows={list.rows}
        page={list.page}
        pageCount={list.pageCount}
        hrefFor={(p) => `/dashboard/bookings?tab=${tab}&page=${p}`}
        detailBase="/dashboard/bookings"
        side="student"
        emptyTitle={tab === "upcoming" ? "No upcoming sessions" : tab === "past" ? "No past sessions yet" : "Nothing needs your attention"}
        emptyDescription={tab === "upcoming" ? "Book a session with a verified tutor near you or online." : tab === "needs_action" ? "Unpaid bookings, ended sessions and missing reviews show up here." : undefined}
        emptyAction={
          tab === "upcoming" ? (
            <Link href="/tutors" className={buttonClass("primary", "sm")}>
              Browse tutors
            </Link>
          ) : undefined
        }
      />
    </>
  );
}
