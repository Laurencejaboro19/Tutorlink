"use client";

import { useEffect, useState } from "react";
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

  useEffect(() => {
    if (!stateId) {
      setLgaOpts([]);
      return;
    }
    let alive = true;
    setLoading("lga");
    fetch(`/api/locations?state=${stateId}`)
      .then((r) => r.json())
      .then((rows: Opt[]) => {
        if (!alive) return;
        setLgaOpts(rows);
        if (!rows.some((r) => r.id === lgaId)) setLgaId(0);
      })
      .finally(() => alive && setLoading(null));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateId]);

  useEffect(() => {
    if (!lgaId) {
      setCityOpts([]);
      return;
    }
    let alive = true;
    setLoading("city");
    fetch(`/api/locations?lga=${lgaId}`)
      .then((r) => r.json())
      .then((rows: Opt[]) => {
        if (!alive) return;
        setCityOpts(rows);
        if (!rows.some((r) => r.id === cityId)) setCityId(0);
      })
      .finally(() => alive && setLoading(null));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lgaId]);

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <Field label={labels.stateId} name={names.stateId} required={required}>
        <Select id={names.stateId} name={names.stateId} value={stateId || ""} onChange={(e) => setStateId(Number(e.target.value))} required={required}>
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
        <Select id={names.lgaId} name={names.lgaId} value={lgaId || ""} onChange={(e) => setLgaId(Number(e.target.value))} disabled={!stateId || loading === "lga"} required={required}>
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
