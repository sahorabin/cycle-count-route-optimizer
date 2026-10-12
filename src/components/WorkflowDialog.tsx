import { useTranslation } from "../i18n/useTranslation";
import { useEffect, useId, useRef, type ReactNode } from "react";

/** Native modal provides focus containment, Escape dismissal and focus restoration. */
export function WorkflowDialog({ title, children, actions, onClose, showClose = false }: {
  title: string; children: ReactNode; actions: ReactNode; onClose: () => void; showClose?: boolean;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement as HTMLElement | null;
    dialog.showModal();
    return () => { dialog.close(); previous?.focus(); };
  }, []);
  return <dialog ref={ref} className="workflow-dialog" aria-labelledby={id} onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <header><h2 id={id}>{title}</h2>{showClose && <button type="button" className="modal-close" aria-label={t("modal.close")} onClick={onClose}><span aria-hidden="true">×</span></button>}</header>
    <div className="workflow-dialog__body">{children}</div>
    <footer>{actions}</footer>
  </dialog>;
}
