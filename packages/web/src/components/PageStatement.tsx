// A page that consists of a heading and a short statement, optionally with a
// link: the placeholder of pages still to come, the absence statement of an
// optional product (requirements §5.7) and the not-found page (§6.11).
import type { ReactNode } from 'react';

export function PageStatement({
  title,
  statement,
  children,
}: {
  title: string | undefined;
  statement: string | undefined;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2 px-page-padding-x py-page-padding-y">
      {title !== undefined && <h1 className="font-sans text-panel-title font-bold">{title}</h1>}
      {statement !== undefined && <p className="text-text-secondary">{statement}</p>}
      {children}
    </div>
  );
}
