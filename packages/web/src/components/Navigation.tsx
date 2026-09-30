// Shell navigation (requirements §5.1, §5.3, §7; collection board, left
// column). Two groups of text links, Explore and Analyze; the active page has
// a 3 px left rule in the accent color, semibold ink on the paper background.
import { activeItem, navigation } from '../navigation';
import { strings } from '../strings';

const itemBase = 'block py-nav-item-padding-y no-underline';
const itemIdle = `${itemBase} px-nav-item-padding-x text-nav-ink`;
const itemActive = [
  itemBase,
  'pr-nav-item-padding-x pl-[calc(var(--spacing-nav-item-padding-x)-var(--shape-active-rule))]',
  'border-l-(length:--shape-active-rule) border-accent bg-background font-semibold text-ink',
].join(' ');

export function Navigation({ pathname }: { pathname: string }) {
  const active = activeItem(pathname);
  return (
    <nav aria-label={strings.navigationLabel} className="flex flex-col">
      {navigation.map((group, index) => {
        const labelId = `nav-group-${group.id}`;
        return (
          <div key={group.id} role="group" aria-labelledby={labelId}>
            <span
              id={labelId}
              className={`block px-nav-item-padding-x pb-1.5 text-micro font-semibold uppercase tracking-label text-text-label ${index > 0 ? 'pt-4' : ''}`}
            >
              {group.label}
            </span>
            <ul>
              {group.items.map((item) => {
                const isActive = item.id === active?.id;
                return (
                  <li key={item.id}>
                    <a
                      href={item.href}
                      className={isActive ? itemActive : itemIdle}
                      {...(isActive ? { 'aria-current': 'page' as const } : {})}
                    >
                      {item.label}
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
