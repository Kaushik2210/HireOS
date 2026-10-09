"use client";

import { setNonce } from "get-nonce";
import { useEffect } from "react";

/**
 * The dialog library adds a style element when it locks page scrolling. Under a nonce-based
 * Content Security Policy that element is blocked unless it carries the page's nonce, so the
 * nonce is handed to the library here.
 */
export function CspNonce({ nonce }: { nonce: string | undefined }) {
  useEffect(() => {
    if (nonce) setNonce(nonce);
  }, [nonce]);
  return null;
}
