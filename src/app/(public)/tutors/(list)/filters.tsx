"use client";

import Link from "next/link";
import { useState } from "react";
import { LocationPicker } from "@/components/location-picker";
import { Button, Checkbox, Field, Input, Select } from "@/components/ui";

type Opt = { id: number; name: string };

const LEVELS = [
  { value: "primary", label: "Primary" },
  { value: "junior_secondary", label: "Junior secondary (JSS)" },
  { value: "senior_secondary", label: "Senior secondary (SSS)" },
  { value: "tertiary", label: "University / Polytechnic" },
  { value: "adult", label: "Adult & professional" },
];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export type FilterValues = {
  subject?: number;
  level?: string;
  exam?: number;
  format?: "physical" | "online" | "any";
  state?: number;
  lga?: number;
  city?: number;
  minPrice?: string;
  maxPrice?: string;
  minRating?: number;
  verified?: boolean;
  available?: number;
  sort?: string;
};

/**
 * Plain GET form: every filter becomes a URL search param so results are shareable and the
 * page stays server-rendered. Location selects are populated via /api/locations.
 */
export function TutorFilters({ states, subjects, exams, values }: { states: Opt[]; subjects: (Opt & { category: string })[]; exams: Opt[]; values: FilterValues }) {
  const [more, setMore] = useState(Boolean(values.exam || values.minPrice || values.maxPrice || values.minRating || values.verified || values.available !== undefined));
  const cats = Array.from(new Set(subjects.map((s) => s.category)));
  return (
    <form method="get" action="/tutors" className="tl-card p-4 sm:p-5" role="search" aria-label="Filter tutors">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Subject" name="subject">
          <Select id="subject" name="subject" defaultValue={values.subject ?? ""}>
            <option value="">Any subject</option>
            {cats.map((c) => (
              <optgroup key={c} label={c}>
                {subjects
                  .filter((s) => s.category === c)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </Select>
        </Field>
        <Field label="Level" name="level">
          <Select id="level" name="level" defaultValue={values.level ?? ""}>
            <option value="">Any level</option>
            {LEVELS.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Format" name="format">
          <Select id="format" name="format" defaultValue={values.format ?? "any"}>
            <option value="any">In person or online</option>
            <option value="physical">In person</option>
            <option value="online">Online</option>
          </Select>
        </Field>
        <Field label="Sort by" name="sort">
          <Select id="sort" name="sort" defaultValue={values.sort ?? "recommended"}>
            <option value="recommended">Recommended</option>
            <option value="rating">Highest rated</option>
            <option value="price_asc">Price: low to high</option>
            <option value="price_desc">Price: high to low</option>
            <option value="newest">Newest tutors</option>
          </Select>
        </Field>
      </div>
      <div className="mt-4">
        <p className="mb-1.5 text-sm font-medium text-ink-700">Location</p>
        <LocationPicker
          states={states}
          initial={{ stateId: values.state, lgaId: values.lga, cityId: values.city }}
          names={{ stateId: "state", lgaId: "lga", cityId: "city" }}
          labels={{ stateId: "State", lgaId: "LGA", cityId: "City / town" }}
          required={false}
          cityOptional
        />
        <p className="tl-help">For in-person lessons choose at least your LGA. Online tutors are never limited by location.</p>
      </div>
      <button type="button" className="mt-4 text-sm font-semibold text-brand-600 hover:underline" onClick={() => setMore((m) => !m)} aria-expanded={more} aria-controls="more-filters">
        {more ? "Fewer filters" : "More filters"}
      </button>
      <div id="more-filters" className={more ? "mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4" : "hidden"}>
        <Field label="Exam focus" name="exam">
          <Select id="exam" name="exam" defaultValue={values.exam ?? ""}>
            <option value="">Any exam</option>
            {exams.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Min price (₦)" name="minPrice">
          <Input id="minPrice" name="minPrice" inputMode="numeric" defaultValue={values.minPrice ?? ""} placeholder="e.g. 2000" />
        </Field>
        <Field label="Max price (₦)" name="maxPrice">
          <Input id="maxPrice" name="maxPrice" inputMode="numeric" defaultValue={values.maxPrice ?? ""} placeholder="e.g. 20000" />
        </Field>
        <Field label="Minimum rating" name="minRating">
          <Select id="minRating" name="minRating" defaultValue={values.minRating ?? ""}>
            <option value="">Any rating</option>
            <option value="3">3 stars and up</option>
            <option value="4">4 stars and up</option>
            <option value="5">5 stars only</option>
          </Select>
        </Field>
        <Field label="Available on" name="available">
          <Select id="available" name="available" defaultValue={values.available ?? ""}>
            <option value="">Any day</option>
            {WEEKDAYS.map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex items-end pb-2">
          <Checkbox name="verified" value="1" defaultChecked={values.verified} label="Identity verified tutors only" />
        </div>
      </div>
      <div className="mt-5 flex flex-col gap-2 sm:flex-row">
        <Button type="submit" className="sm:w-auto">
          Search tutors
        </Button>
        <Link href="/tutors" className="inline-flex h-11 items-center justify-center rounded-[var(--radius-md)] px-4 text-[15px] font-semibold text-ink-600 hover:bg-ink-100">
          Clear all
        </Link>
      </div>
    </form>
  );
}
