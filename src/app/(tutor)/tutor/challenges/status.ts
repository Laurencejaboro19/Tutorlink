import type { Tone } from "@/components/ui";
import type { Challenge } from "@/server/challenges";

export function statusTone(s: Challenge["status"]): Tone {
  return s === "published" ? "success" : s === "in_review" ? "warning" : s === "rejected" ? "danger" : s === "archived" ? "neutral" : "brand";
}
