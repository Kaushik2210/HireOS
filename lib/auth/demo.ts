/**
 * Demo mode gives every visitor an isolated sandbox: an anonymous id kept in a cookie.
 * It carries no authority, because demo mode has no real accounts or real data.
 */
export const DEMO_COOKIE = "hireos_demo";
export const DEMO_FALLBACK_ID = "demo-anonymous";

const DEMO_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isValidDemoId(value: string | undefined | null): value is string {
  return typeof value === "string" && DEMO_ID_PATTERN.test(value);
}

export function demoUserId(cookieValue: string | undefined | null): string {
  return isValidDemoId(cookieValue) ? `demo-${cookieValue}` : DEMO_FALLBACK_ID;
}
