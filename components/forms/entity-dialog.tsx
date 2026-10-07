"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

interface EntityDialogProps {
  title: string;
  description?: string;
  trigger: React.ReactNode;
  children: (close: () => void) => React.ReactNode;
}

/** Modal with focus trapping and Escape handling from Radix. The form is only mounted while open. */
export function EntityDialog({ title, description, trigger, children }: EntityDialogProps) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <Dialog.Content
          {...(description ? {} : { "aria-describedby": undefined })}
          className="border-border-strong bg-surface fixed top-1/2 left-1/2 z-50 max-h-[90dvh] w-[min(94vw,40rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border p-5 shadow-2xl"
        >
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-base font-semibold">{title}</Dialog.Title>
              {description && (
                <Dialog.Description className="text-muted mt-1 text-sm">
                  {description}
                </Dialog.Description>
              )}
            </div>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close">
                <X />
              </Button>
            </Dialog.Close>
          </div>
          {children(() => setOpen(false))}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
