// Same-origin link through the router (requirements §5.3, §5.9). The href
// keeps the current query string, so route changes preserve the genome set,
// unless `query` is given: a link that is itself a filter passes its own
// query ("" for none). Plain left clicks navigate in place; clicks with a
// modifier key, another button, or a target keep the browser's behavior.
import type { AnchorHTMLAttributes, MouseEvent } from 'react';
import { hrefFor, useRouter } from '../router';

export interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  /** The target path, for example "/genomes/KPN0001". */
  to: string;
  /** The query for the target, replacing the current one; omit to keep it. */
  query?: string;
}

/** Whether a click on an anchor should be handled by the router. */
export function isPlainLeftClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  if (event.defaultPrevented || event.button !== 0) return false;
  if (event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return false;
  const target = event.currentTarget.getAttribute('target');
  if (target !== null && target !== '' && target !== '_self') return false;
  return !event.currentTarget.hasAttribute('download');
}

export function Link({ to, query, onClick, ...rest }: LinkProps) {
  const { search, navigate } = useRouter();
  const href = hrefFor(to, search, query);
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (!isPlainLeftClick(event)) return;
    event.preventDefault();
    // The href already holds the resolved query; pass it explicitly so that
    // an empty one clears the current query.
    const hashMark = href.indexOf('#');
    const hash = hashMark >= 0 ? href.slice(hashMark) : '';
    const bare = hashMark >= 0 ? href.slice(0, hashMark) : href;
    const mark = bare.indexOf('?');
    navigate(`${mark >= 0 ? bare.slice(0, mark) : bare}${hash}`, {
      replaceQuery: mark >= 0 ? bare.slice(mark) : '',
    });
  };
  return <a {...rest} href={href} onClick={handleClick} />;
}
