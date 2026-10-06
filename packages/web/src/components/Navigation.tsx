// Shell navigation (requirements §5.1, §5.3, §5.7, §7; collection board, left
// column). Two groups of text links, Explore and Analyze, under sentence case
// group labels; the active page has a 3 px left rule in the accent color
// (ink) and bold ink text on the chassis background. The links take the
// chrome link tier of linkTier.ts.
// An item whose product the manifest does not declare is not a link: it is a
// focusable, aria-disabled entry with a tooltip (title and a visible element
// on hover and focus) stating that the release does not include the product.
// While the manifest loads, every item is a link.
import { useManifest } from '../data/manifest';
import { absentProductTooltip, activeItem, hasProduct, navigation } from '../navigation';
import type { NavItem } from '../navigation';
import { useRouter } from '../router';
import { strings } from '../strings';
import { CHROME_LINK } from '../linkTier';
import { Link } from './Link';

const itemBase = 'block py-nav-item-padding-y';
const itemIdle = `${itemBase} px-nav-item-padding-x text-nav-ink`;
const itemActive = [
  itemBase,
  'pr-nav-item-padding-x pl-[calc(var(--spacing-nav-item-padding-x)-var(--shape-active-rule))]',
  'border-l-(length:--shape-active-rule) border-accent bg-background font-bold text-ink',
].join(' ');
const itemDisabled = `${itemBase} peer cursor-default px-nav-item-padding-x text-text-label`;
const disabledActive = `${itemActive} peer cursor-default`;
const tooltip = [
  'pointer-events-none invisible absolute top-full right-nav-item-padding-x left-nav-item-padding-x z-20',
  'bg-ink px-2 py-1 text-small leading-body text-on-ink',
  'peer-hover:visible peer-focus:visible',
].join(' ');

function DisabledItem({ item, tip, isActive }: { item: NavItem; tip: string; isActive: boolean }) {
  const tipId = `nav-tip-${item.id}`;
  return (
    <>
      <span
        tabIndex={0}
        aria-disabled="true"
        aria-describedby={tipId}
        title={tip}
        className={isActive ? disabledActive : itemDisabled}
        {...(isActive ? { 'aria-current': 'page' as const } : {})}
      >
        {item.label}
      </span>
      <span id={tipId} role="tooltip" className={tooltip}>
        {tip}
      </span>
    </>
  );
}

export function Navigation() {
  const { pathname, route } = useRouter();
  const manifest = useManifest();
  // An unknown path under a known prefix (/genes/protein/x) marks nothing.
  const active = route.page === 'notFound' ? undefined : activeItem(pathname);
  return (
    <nav aria-label={strings.navigationLabel} className="flex flex-col">
      {navigation.map((group, index) => {
        const labelId = `nav-group-${group.id}`;
        return (
          <div key={group.id} role="group" aria-labelledby={labelId}>
            <span
              id={labelId}
              className={`block px-nav-item-padding-x pb-1.5 text-micro font-bold tracking-label text-text-label ${index > 0 ? 'pt-4' : ''}`}
            >
              {group.label}
            </span>
            <ul>
              {group.items.map((item) => {
                const isActive = item.id === active?.id;
                const tip =
                  manifest !== undefined &&
                  item.product !== undefined &&
                  !hasProduct(manifest, item.product)
                    ? absentProductTooltip(item.product, manifest.release_id)
                    : undefined;
                return (
                  <li key={item.id} className="relative">
                    {tip !== undefined ? (
                      <DisabledItem item={item} tip={tip} isActive={isActive} />
                    ) : (
                      <Link
                        to={item.href}
                        className={`${isActive ? itemActive : itemIdle} ${CHROME_LINK}`}
                        {...(isActive ? { 'aria-current': 'page' as const } : {})}
                      >
                        {item.label}
                      </Link>
                    )}
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
