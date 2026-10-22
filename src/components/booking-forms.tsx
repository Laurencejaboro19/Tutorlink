"use client";

import { useState } from "react";
import { ActionForm, FieldError, SubmitButton } from "./action-form";
import { Alert, Button, Field, Input, Textarea } from "./ui";
import { formatNgn } from "@/lib/money";
import { acknowledgeBookingAction, cancelBookingAction, markCompletedAction, reportNoShowAction, setMeetingLinkAction, submitReviewAction } from "@/server/booking-actions";

type Role = "student" | "tutor";

export function CancelBookingForm({ bookingId, role, quote, paid }: { bookingId: string; role: Role; quote: { refundPct: number; refundNgn: string; creditReturnNgn: string }; paid: boolean }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        Cancel session
      </Button>
    );
  }
  return (
    <ActionForm action={cancelBookingAction} submitLabel="Confirm cancellation" submitVariant="danger" className="rounded-[var(--radius-md)] border border-red-200 p-4">
      <input type="hidden" name="bookingId" value={bookingId} />
      <input type="hidden" name="role" value={role} />
      {!paid ? (
        <Alert tone="info" title="Nothing has been paid yet">
          Cancelling releases the held slot{Number(quote.creditReturnNgn) > 0 ? ` and returns ${formatNgn(quote.creditReturnNgn)} of credits` : ""}. No refund is needed.
        </Alert>
      ) : role === "student" ? (
        <Alert tone={quote.refundPct === 100 ? "info" : "warning"} title={`Refund: ${quote.refundPct}% of what you paid`}>
          {quote.refundPct > 0 ? (
            <>
              You will get {formatNgn(quote.refundNgn)} back to your payment method{Number(quote.creditReturnNgn) > 0 ? ` and ${formatNgn(quote.creditReturnNgn)} returned as credits` : ""}. Refunds are reviewed by our team and usually take 3–7 working days.
            </>
          ) : (
            "The session is about to start, so no refund applies."
          )}
        </Alert>
      ) : (
        <Alert tone="warning" title="Cancelling counts against your ranking">
          The student is refunded 100% and this cancellation lowers your completion rate. Cancel only if you really cannot make it.
        </Alert>
      )}
      <Field label="Reason" name="reason" required>
        <Textarea id="reason" name="reason" required minLength={5} maxLength={500} className="min-h-[80px]" placeholder="Tell the other person why" />
        <FieldError name="reason" />
      </Field>
      <button type="button" className="mt-3 text-sm text-ink-600 underline" onClick={() => setOpen(false)}>
        Keep the session
      </button>
    </ActionForm>
  );
}

export function ReportNoShowForm({ bookingId, role }: { bookingId: string; role: Role }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        Report a problem / no-show
      </Button>
    );
  }
  return (
    <ActionForm action={reportNoShowAction} submitLabel="Submit report" submitVariant="danger" className="rounded-[var(--radius-md)] border border-amber-200 p-4">
      <input type="hidden" name="bookingId" value={bookingId} />
      <input type="hidden" name="role" value={role} />
      <p className="mb-3 text-sm text-ink-700">The session will be placed under review. Our team decides the outcome and any refund.</p>
      <Field label="What happened?" name="details" required>
        <Textarea id="details" name="details" required minLength={10} maxLength={1000} className="min-h-[90px]" />
        <FieldError name="details" />
      </Field>
      <button type="button" className="mt-3 text-sm text-ink-600 underline" onClick={() => setOpen(false)}>
        Never mind
      </button>
    </ActionForm>
  );
}

export function MarkCompletedForm({ bookingId, role }: { bookingId: string; role: Role }) {
  return (
    <ActionForm action={markCompletedAction} hideSubmit>
      <input type="hidden" name="bookingId" value={bookingId} />
      <input type="hidden" name="role" value={role} />
      <SubmitButton variant="secondary">Mark as completed</SubmitButton>
    </ActionForm>
  );
}

export function AcknowledgeForm({ bookingId }: { bookingId: string }) {
  return (
    <ActionForm action={acknowledgeBookingAction} hideSubmit>
      <input type="hidden" name="bookingId" value={bookingId} />
      <SubmitButton>Acknowledge booking</SubmitButton>
    </ActionForm>
  );
}

export function MeetingLinkForm({ bookingId, current }: { bookingId: string; current: string | null }) {
  return (
    <ActionForm action={setMeetingLinkAction} submitLabel={current ? "Update link" : "Save link"} submitVariant="outline">
      <input type="hidden" name="bookingId" value={bookingId} />
      <Field label="Meeting link" name="meetingLink" required help="Google Meet, Zoom, WhatsApp call link, etc. The student sees it on their booking.">
        <Input id="meetingLink" name="meetingLink" type="url" inputMode="url" required defaultValue={current ?? ""} placeholder="https://meet.google.com/abc-defg-hij" />
        <FieldError name="meetingLink" />
      </Field>
    </ActionForm>
  );
}

export function ReviewForm({ bookingId }: { bookingId: string }) {
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  return (
    <ActionForm action={submitReviewAction} submitLabel="Publish review">
      <input type="hidden" name="bookingId" value={bookingId} />
      <fieldset>
        <legend className="tl-label">Your rating</legend>
        <div className="flex gap-1" role="radiogroup" aria-label="Star rating">
          {[1, 2, 3, 4, 5].map((n) => (
            <label key={n} className="cursor-pointer" onMouseEnter={() => setHover(n)} onMouseLeave={() => setHover(0)}>
              <input type="radio" name="rating" value={n} className="sr-only" checked={rating === n} onChange={() => setRating(n)} aria-label={`${n} star${n === 1 ? "" : "s"}`} />
              <svg width="32" height="32" viewBox="0 0 20 20" className={n <= (hover || rating) ? "fill-amber-400" : "fill-ink-200"} aria-hidden="true">
                <path d="M10 1.5l2.6 5.4 5.9.8-4.3 4.1 1.1 5.9L10 14.9l-5.3 2.8 1.1-5.9L1.5 7.7l5.9-.8z" />
              </svg>
            </label>
          ))}
        </div>
        <p className="tl-help">{rating ? ["", "Poor", "Fair", "Good", "Very good", "Excellent"][rating] : "Tap a star"}</p>
        <FieldError name="rating" />
      </fieldset>
      <Field label="Comment" name="comment" help="Optional. What went well, what could improve. Published on the tutor's profile.">
        <Textarea id="comment" name="comment" maxLength={1000} className="min-h-[90px]" />
        <FieldError name="comment" />
      </Field>
    </ActionForm>
  );
}
