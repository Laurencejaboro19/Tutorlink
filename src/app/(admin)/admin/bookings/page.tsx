import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/ui";
import { bookingStatusEnum } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { formatNgn } from "@/lib/money";
import { listBookings } from "@/server/admin";
import { AdminPagination, enumOptions, FilterBar, FilterField, FilterInput, FilterSelect, pageNum, ResultCount, StatusBadge, str, TableWrap, When } from "../_components/table";

export const metadata = { title: "Bookings · Admin" };
export const dynamic = "force-dynamic";

export default async function AdminBookingsPage({ searchParams }: PageProps<"/admin/bookings">) {
  await requireAdmin();
  const sp = await searchParams;
  const f = { status: str(sp, "status"), from: str(sp, "from"), to: str(sp, "to"), tutor: str(sp, "tutor"), student: str(sp, "student") };
  const data = await listBookings({ ...f, page: pageNum(sp) });
  return (
    <>
      <PageHeader title="Bookings" description="Every session on the platform. Disputed sessions need a decision." />
      <FilterBar action="/admin/bookings">
        <FilterField label="Status" name="status">
          <FilterSelect name="status" value={f.status} options={enumOptions(bookingStatusEnum.enumValues)} />
        </FilterField>
        <FilterField label="Session from" name="from">
          <FilterInput name="from" value={f.from} type="date" />
        </FilterField>
        <FilterField label="Session to" name="to">
          <FilterInput name="to" value={f.to} type="date" />
        </FilterField>
        <FilterField label="Tutor email" name="tutor">
          <FilterInput name="tutor" value={f.tutor} />
        </FilterField>
        <FilterField label="Student email" name="student">
          <FilterInput name="student" value={f.student} />
        </FilterField>
      </FilterBar>
      <ResultCount total={data.total} page={data.page} pageCount={data.pageCount} />
      {data.rows.length === 0 ? (
        <EmptyState title="No bookings match" />
      ) : (
        <TableWrap>
          <thead>
            <tr>
              <th>Session</th>
              <th>Status</th>
              <th>Student</th>
              <th>Tutor</th>
              <th>Format</th>
              <th className="text-right">Price</th>
              <th className="text-right">Due</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.booking.id}>
                <td>
                  <Link href={`/admin/bookings/${r.booking.id}`} className="font-semibold text-brand-600 hover:underline">
                    <When d={r.booking.startsAt} />
                  </Link>
                  <div className="text-xs text-ink-400">{r.booking.id.slice(0, 8)}</div>
                </td>
                <td>
                  <StatusBadge status={r.booking.status} />
                </td>
                <td>
                  <div>{r.studentName}</div>
                  <div className="text-xs text-ink-500">{r.studentEmail}</div>
                </td>
                <td>
                  <div>{r.tutorName}</div>
                  <div className="text-xs text-ink-500">{r.tutorEmail}</div>
                </td>
                <td className="capitalize">{r.booking.format}</td>
                <td className="text-right tabular-nums">{formatNgn(r.booking.priceNgn)}</td>
                <td className="text-right tabular-nums">{formatNgn(r.booking.amountDueNgn)}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
      <AdminPagination base="/admin/bookings" params={f} page={data.page} pageCount={data.pageCount} />
    </>
  );
}
