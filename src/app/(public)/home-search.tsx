"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Select } from "@/components/ui";

export function HomeSearch({ states, subjects }: { states: { id: number; name: string }[]; subjects: { id: number; name: string; category: string }[] }) {
  const router = useRouter();
  const [subject, setSubject] = useState("");
  const [state, setState] = useState("");
  const [format, setFormat] = useState("any");
  return (
    <form
      className="tl-card grid gap-2 p-2 sm:grid-cols-[1fr_1fr_auto_auto]"
      onSubmit={(e) => {
        e.preventDefault();
        const q = new URLSearchParams();
        if (subject) q.set("subject", subject);
        if (state) q.set("state", state);
        if (format !== "any") q.set("format", format);
        router.push(`/tutors?${q.toString()}`);
      }}
      role="search"
      aria-label="Find a tutor"
    >
      <Select aria-label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} className="border-0 bg-ink-50">
        <option value="">Any subject</option>
        {subjects.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </Select>
      <Select aria-label="State" value={state} onChange={(e) => setState(e.target.value)} className="border-0 bg-ink-50">
        <option value="">Any state</option>
        {states.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </Select>
      <Select aria-label="Format" value={format} onChange={(e) => setFormat(e.target.value)} className="border-0 bg-ink-50">
        <option value="any">In person or online</option>
        <option value="physical">In person</option>
        <option value="online">Online</option>
      </Select>
      <Button type="submit" size="md">
        Search
      </Button>
    </form>
  );
}
