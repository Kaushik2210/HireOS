"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import {
  confirmEnrollmentAction,
  disableMfaAction,
  startEnrollmentAction,
} from "@/features/account/mfa-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormMessage, Input } from "@/components/ui/form-field";
import type { EnrollmentDetails, MfaStatus } from "@/lib/auth/mfa";

/** Set up, use and remove an authenticator app. Every step is checked again on the server. */
export function MfaSection({ status }: { status: MfaStatus }) {
  const router = useRouter();
  const codeId = useId();
  const [pending, startTransition] = useTransition();
  const [enrolling, setEnrolling] = useState<EnrollmentDetails | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reset = () => {
    setEnrolling(null);
    setCode("");
    setError(null);
  };

  const start = () =>
    startTransition(async () => {
      setError(null);
      setNotice(null);
      const result = await startEnrollmentAction();
      if (!result.ok) return setError(result.error);
      setEnrolling(result.details);
    });

  const confirm = () =>
    startTransition(async () => {
      if (!enrolling) return;
      setError(null);
      const result = await confirmEnrollmentAction({ factorId: enrolling.factorId, code });
      if (!result.ok) return setError(result.fieldErrors?.code?.[0] ?? result.error);
      reset();
      setNotice(result.message ?? "Two-step sign-in is on.");
      router.refresh();
    });

  const turnOff = () =>
    startTransition(async () => {
      setError(null);
      const result = await disableMfaAction({ code });
      if (!result.ok) return setError(result.fieldErrors?.code?.[0] ?? result.error);
      reset();
      setNotice(result.message ?? "Two-step sign-in is off.");
      router.refresh();
    });

  const codeField = (
    <div className="flex max-w-xs flex-col gap-1.5">
      <label htmlFor={codeId} className="text-sm font-medium">
        6-digit code
      </label>
      <Input
        id={codeId}
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={7}
        placeholder="123456"
        value={code}
        onChange={(e) => setCode(e.target.value)}
      />
    </div>
  );

  return (
    <div className="flex flex-col gap-3">
      {error && <FormMessage tone="error">{error}</FormMessage>}
      {notice && !enrolling && <FormMessage tone="info">{notice}</FormMessage>}

      {enrolling ? (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            confirm();
          }}
        >
          <ol className="text-muted flex list-decimal flex-col gap-2 pl-5">
            <li>Open an authenticator app (any app that supports one-time codes).</li>
            <li>Scan this picture, or type the key below into the app.</li>
            <li>Enter the 6-digit code the app shows, to finish.</li>
          </ol>
          {/* A data: image: the policy allows it, and nothing is fetched from anywhere. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={enrolling.qrImage}
            alt="QR code for your authenticator app"
            width={176}
            height={176}
            className="rounded-md bg-white p-2"
          />
          <p>
            <span className="text-muted">Setup key: </span>
            <code className="bg-surface-raised rounded px-1.5 py-0.5 font-mono text-xs break-all select-all">
              {enrolling.secret}
            </code>
          </p>
          <p className="text-muted">
            Keep this key somewhere safe. If you lose your device it is the only way to bring the
            codes back, and HireOS cannot reset them for you.
          </p>
          {codeField}
          <div className="flex gap-2">
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? "Checking…" : "Turn on"}
            </Button>
            <Button type="button" variant="ghost" onClick={reset} disabled={pending}>
              Cancel
            </Button>
          </div>
        </form>
      ) : status === "on" ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            turnOff();
          }}
        >
          <p>
            <Badge variant="success">On</Badge>{" "}
            <span className="text-muted">
              Signing in asks for a code from your authenticator app after your password.
            </span>
          </p>
          <p className="text-muted">To turn it off, enter a current code.</p>
          {codeField}
          <div>
            <Button type="submit" disabled={pending}>
              {pending ? "Checking…" : "Turn off"}
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-muted">
            Add a second step to signing in: after your password, a 6-digit code from an
            authenticator app on your phone. A stolen password alone is then not enough.
          </p>
          <div>
            <Button type="button" variant="primary" onClick={start} disabled={pending}>
              {pending ? "Preparing…" : "Set up two-step sign-in"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
