import { BaseModal } from "@/components/ui/BaseModal";
import { useUser } from "@kova/react";
import SettingsAccountTab from "./SettingsAccountTab";

interface ProfileEditorModalProps {
  onClose: () => void;
}

export default function ProfileEditorModal({
  onClose,
}: ProfileEditorModalProps) {
  const { isLoaded: isUserLoaded } = useUser();

  return (
    <BaseModal onClose={onClose}>
      <div
        className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/56 p-4 backdrop-blur-[2px] md:p-6"
        onClick={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <section
          role="dialog"
          aria-modal="true"
          aria-label="Edit profile"
          tabIndex={-1}
          className="relative overflow-hidden rounded-[30px] border border-rm-border bg-[#09090d] shadow-[0_36px_110px_rgba(0,0,0,0.52)] animate-in zoom-in-95 duration-200 md:rounded-[32px]"
          style={{
            width: "min(1240px, calc(100vw - 32px))",
            height: "min(860px, calc(100dvh - 32px))",
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <SettingsAccountTab
            authUserLoaded={isUserLoaded}
            asModal
            onClose={onClose}
          />
        </section>
      </div>
    </BaseModal>
  );
}
