import { type ReactNode } from 'react';

export function DashboardPanel({
  title,
  code,
  children,
  className = '',
}: {
  title: string;
  code?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      <header className="panel-head">
        <div className="panel-heading-lockup">
          <span className="panel-index" aria-hidden="true" />
          <h2 className="panel-title">{title}</h2>
        </div>
        {code && <span className="panel-code">{code}</span>}
      </header>
      {children}
    </section>
  );
}

export function PanelBody({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`panel-body ${className}`}>{children}</div>;
}
