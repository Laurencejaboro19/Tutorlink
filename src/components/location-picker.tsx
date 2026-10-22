"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Field, Select } from "./ui";
import { FieldError } from "./action-form";

type Opt = { id: number; name: string };

/**
 * Dependent State → LGA → City selects. Options are fetched from /api/locations;
 * the server re-validates the triple on submit (see resolveLocation).
 */
export function LocationPicker({
  states,
  initial,
  names = { stateId: "stateId", lgaId: "lgaId", cityId: "cityId" },
  labels = { stateId: "State", lgaId: "Local Government Area (LGA)", cityId: "City / town" },
  required = true,
  cityOptional = false,
}: {
  states: Opt[];
  initial?: { stateId?: number | null; lgaId?: number | null; cityId?: number | null };
  names?: { stateId: string; lgaId: string; cityId: string };
  labels?: { stateId: string; lgaId: string; cityId: string };
  required?: boolean;
  cityOptional?: boolean;
}) {
  const [stateId, setStateId] = useState<number>(initial?.stateId ?? 0);
  const [lgaId, setLgaId] = useState<number>(initial?.lgaId ?? 0);
  const [cityId, setCityId] = useState<number>(initial?.cityId ?? 0);
  const [lgaOpts, setLgaOpts] = useState<Opt[]>([]);
  const [cityOpts, setCityOpts] = useState<Opt[]>([]);
  const [loading, setLoading] = useState<"lga" | "city" | null>(null);
  const req = useRef(0);

  const loadLgas = useCallback(async (sid: number) => {
    const id = ++req.current;
    if (!sid) return;
    setLoading("lga");
    try {
      const rows: Opt[] = await fetch(`/api/locations?state=${sid}`).then((r) => r.json());
      if (id === req.current) setLgaOpts(rows);
    } finally {
      if (id === req.current) setLoading(null);
    }
  }, []);

  const loadCities = useCallback(async (lid: number) => {
    const id = ++req.current;
    if (!lid) return;
    setLoading("city");
    try {
      const rows: Opt[] = await fetch(`/api/locations?lga=${lid}`).then((r) => r.json());
      if (id === req.current) setCityOpts(rows);
    } finally {
      if (id === req.current) setLoading(null);
    }
  }, []);

  // Hydrate option lists for pre-selected values (edit forms).
  useEffect(() => {
    const sid = initial?.stateId ?? 0;
    const lid = initial?.lgaId ?? 0;
    if (!sid) return;
    let cancelled = false;
    const t = setTimeout(() => {
      if (cancelled) return;
      void loadLgas(sid).then(() => (lid && !cancelled ? loadCities(lid) : undefined));
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [initial?.stateId, initial?.lgaId, loadLgas, loadCities]);

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <Field label={labels.stateId} name={names.stateId} required={required}>
        <Select
          id={names.stateId}
          name={names.stateId}
          value={stateId || ""}
          onChange={(e) => {
            const v = Number(e.target.value);
            setStateId(v);
            setLgaId(0);
            setCityId(0);
            setLgaOpts([]);
            setCityOpts([]);
            void loadLgas(v);
          }}
          required={required}
        >
          <option value="">Select state</option>
          {states.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
        <FieldError name={names.stateId} />
      </Field>
      <Field label={labels.lgaId} name={names.lgaId} required={required}>
        <Select
          id={names.lgaId}
          name={names.lgaId}
          value={lgaId || ""}
          onChange={(e) => {
            const v = Number(e.target.value);
            setLgaId(v);
            setCityId(0);
            setCityOpts([]);
            void loadCities(v);
          }}
          disabled={!stateId || loading === "lga"}
          required={required}
        >
          <option value="">{loading === "lga" ? "Loading…" : "Select LGA"}</option>
          {lgaOpts.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
        <FieldError name={names.lgaId} />
      </Field>
      <Field label={labels.cityId} name={names.cityId} required={required && !cityOptional}>
        <Select id={names.cityId} name={names.cityId} value={cityId || ""} onChange={(e) => setCityId(Number(e.target.value))} disabled={!lgaId || loading === "city"} required={required && !cityOptional}>
          <option value="">{loading === "city" ? "Loading…" : cityOptional ? "Whole LGA" : "Select city / town"}</option>
          {cityOpts.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
        <FieldError name={names.cityId} />
      </Field>
    </div>
  );
}
