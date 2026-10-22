"use client";

import { useState } from "react";
import { Button } from "./ui";

/** Copies `text` to the clipboard and confirms in text (not colour only). */
export function CopyButton({ text, label = "Copy", copiedLabel = "Copied!", variant = "outline", size = "md", className }: { text: string; label?: string; copiedLabel?: string; variant?: "primary" | "secondary" | "outline" | "ghost"; size?: "sm" | "md" | "lg"; className?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("failed");
    }
    setTimeout(() => setState("idle"), 2000);
  };
  return (
    <Button type="button" variant={variant} size={size} onClick={copy} className={className} aria-live="polite">
      {state === "copied" ? copiedLabel : state === "failed" ? "Select & copy manually" : label}
    </Button>
  );
}
