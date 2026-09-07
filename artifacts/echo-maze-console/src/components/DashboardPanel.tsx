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
        <h2 className="panel-title">{title}</h2>
        {code && <span className="panel-code">{code}</span>}
      </header>
      {children}
    </section>
  );
}

export function PanelBody({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`panel-body ${className}`}>{children}</div>;
}
