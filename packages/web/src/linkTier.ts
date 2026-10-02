// Link tiers (requirements §5.4; checklist G3). Links in running text are
// underlined at rest (the base `a` rule in index.css); links inside tables,
// chips, pills, counters and the facet rail use QUIET_LINK, underlined on
// hover and keyboard focus only.
//
// Navigation items, footer links, panel titles and the text controls drawn as
// links ("+ add filter", "expand", "All N classes", the pager) take
// CHROME_LINK, which requirements 0.7 §5.4 puts in the hover-and-focus tier,
// as the maintainer chose at the size check of the Instrument design change.
// RUNNING_LINK underlines at rest.

/** Underline on hover and on keyboard focus only. */
export const QUIET_LINK = 'link-quiet';

/** Underline at rest, for link-like controls that are not anchors. */
export const RUNNING_LINK = 'link-running';

/** The tier of navigation items, footer links and text controls drawn as links. */
export const CHROME_LINK: typeof QUIET_LINK | typeof RUNNING_LINK = QUIET_LINK;
