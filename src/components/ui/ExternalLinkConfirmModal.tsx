import { BaseModal } from "@/components/ui/BaseModal";
import { X } from "lucide-react";

export interface PendingExternalLink {
  url: string;
  hostname: string;
}

export function ExternalLinkConfirmModal({
  pending,
  trustDomain,
  onTrustDomainChange,
  onClose,
  onConfirm,
}: {
  pending: PendingExternalLink;
  trustDomain: boolean;
  onTrustDomainChange: (value: boolean) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <BaseModal onClose={onClose} aria-label="Leaving Ralph Meet">
      <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
        <button
          type="button"
          aria-label="Close external link confirmation"
          className="absolute inset-0 cursor-default"
          tabIndex={-1}
          data-base-modal-backdrop="true"
          onClick={onClose}
        />
        <section className="relative w-full max-w-[510px] rounded-2xl border border-rm-border bg-rm-bg-primary p-6 text-rm-text-primary shadow-2xl">
          <button
            type="button"
            aria-label="Close external link confirmation"
            className="absolute right-4 top-4 rounded-lg p-1.5 text-rm-text-muted transition-colors hover:bg-rm-bg-hover hover:text-rm-text-primary"
            onClick={onClose}
          >
            <X className="h-5 w-5" />
          </button>

          <h2 className="pr-8 text-xl font-extrabold tracking-tight">
            Leaving Ralph Meet
          </h2>
          <p className="mt-1 text-sm text-rm-text-muted">
            This link is taking you to the following website
          </p>

          <div className="mt-5 max-h-24 overflow-auto rounded-xl border border-rm-border bg-rm-bg-surface/70 px-4 py-3 text-sm leading-5 text-rm-text-secondary [overflow-wrap:anywhere]">
            {pending.url}
          </div>

          <label className="mt-3 flex cursor-pointer items-center gap-3 text-sm text-rm-text-secondary">
            <input
              type="checkbox"
              checked={trustDomain}
              onChange={(event) => onTrustDomainChange(event.target.checked)}
              className="h-5 w-5 rounded border-rm-border bg-rm-bg-surface accent-primary"
            />
            <span>Trust {pending.hostname} links from now on</span>
          </label>

          <div className="mt-6 flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="min-h-11 flex-1 rounded-xl border border-rm-border bg-rm-bg-surface px-4 py-2.5 text-sm font-bold text-rm-text-secondary transition-colors hover:bg-rm-bg-hover hover:text-rm-text-primary active:scale-[0.98]"
            >
              Go Back
            </button>
            <button
              type="button"
              onClick={onConfirm}
              className="min-h-11 flex-1 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-primary/20 transition-colors hover:bg-primary/90 active:scale-[0.98]"
            >
              Visit Site
            </button>
          </div>
        </section>
      </div>
    </BaseModal>
  );
}
