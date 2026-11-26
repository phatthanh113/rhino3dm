import type { ReactNode } from "react";

export function Modal({
  title,
  children,
  actions,
  on_close,
}: {
  title: string;
  children: ReactNode;
  actions: ReactNode;
  on_close: () => void;
}) {
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          on_close();
        }
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {children}
        <div className="modal-actions">{actions}</div>
      </div>
    </div>
  );
}
