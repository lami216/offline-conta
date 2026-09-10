"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "./i18n/provider";
import { validateRequiredDateRange, type DateRangeIssue } from "./date-range-validation";

const messages = {
  ar: {
    missing: "حدد تاريخ البداية والنهاية أولاً، أو اضغط «عرض الكل».",
    invalid: "حدد فترة زمنية صحيحة أولاً، أو اضغط «عرض الكل».",
    reversed: "تاريخ البداية يجب ألا يتجاوز تاريخ النهاية.",
  },
  fr: {
    missing: "Sélectionnez d’abord les dates de début et de fin, ou utilisez « Tout afficher ».",
    invalid: "Sélectionnez d’abord une période valide, ou utilisez « Tout afficher ».",
    reversed: "La date de début ne doit pas dépasser la date de fin.",
  },
} as const;

/**
 * CompactDateRange is shared by reports, inventory and account-history views.
 * After "show all" those controls intentionally have blank dates. This capture
 * guard prevents a later Apply click from reaching a feature handler until a
 * complete range is entered, so no invalid empty-date request/state can escape.
 */
export default function DateRangeActionGuard() {
  const { locale } = useI18n();
  const [issue, setIssue] = useState<DateRangeIssue | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    const clearNotice = () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = null;
      setIssue(null);
    };
    const showIssue = (next: DateRangeIssue) => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      setIssue(next);
      timer.current = window.setTimeout(() => {
        setIssue(null);
        timer.current = null;
      }, 3600);
    };
    const captureApply = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("button.date-apply") : null;
      if (!target) return;
      const range = target.closest<HTMLElement>(".compact-date-range");
      if (!range) return;
      const fields = [...range.querySelectorAll<HTMLInputElement>('input[type="date"]')];
      if (fields.length < 2) return;
      const nextIssue = validateRequiredDateRange(fields[0].value, fields[1].value);
      if (!nextIssue) {
        clearNotice();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      const focusTarget = nextIssue === "missing" ? fields.find(field => !field.value) ?? fields[0] : fields[0];
      focusTarget.focus();
      showIssue(nextIssue);
    };

    document.addEventListener("click", captureApply, true);
    return () => {
      document.removeEventListener("click", captureApply, true);
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);

  if (!issue) return null;
  const language = locale === "fr" ? "fr" : "ar";
  return (
    <div
      role="alert"
      aria-live="assertive"
      style={{
        position: "fixed",
        zIndex: 10000,
        top: 72,
        left: "50%",
        transform: "translateX(-50%)",
        width: "min(92vw, 620px)",
        padding: "12px 16px",
        border: "1px solid #d9a3a3",
        borderRadius: 10,
        background: "#fff6f6",
        color: "#7c2020",
        boxShadow: "0 10px 30px rgba(0,0,0,.14)",
        textAlign: "center",
        fontWeight: 700,
      }}
    >
      {messages[language][issue]}
    </div>
  );
}
