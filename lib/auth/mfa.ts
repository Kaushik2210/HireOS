import { z } from "zod";

/** The six digits an authenticator app shows. Spaces are tolerated: apps often group them. */
export const totpCodeSchema = z
  .string()
  .transform((v) => v.replace(/\s+/g, ""))
  .pipe(z.string().regex(/^\d{6}$/, "Enter the 6-digit code from your authenticator app"));

export const verifyCodeSchema = z.object({ code: totpCodeSchema });
export type VerifyCodeInput = z.input<typeof verifyCodeSchema>;

export const confirmEnrollSchema = z.object({
  factorId: z.uuid(),
  code: totpCodeSchema,
});
export type ConfirmEnrollInput = z.input<typeof confirmEnrollSchema>;

/** What the setup screen needs to show: scan the picture, or type the key. */
export interface EnrollmentDetails {
  factorId: string;
  /** A data: image of the QR code. */
  qrImage: string;
  /** The same secret as text, for apps that cannot scan. */
  secret: string;
}

export type MfaStatus = "off" | "on";
