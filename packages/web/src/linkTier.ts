// Link tiers (requirements §5.4; checklist G3). Links in running text are
// underlined at rest (the base `a` rule in index.css); links inside tables,
// chips, pills, counters and the facet rail use QUIET_LINK, underlined on
// hover and keyboard focus only.
//
// The navigation items, the footer links and the text controls drawn as
// links ("+ add filter", "expand", "All N classes", the pager) are not named
// by the rule. They take CHROME_LINK, the one place where their tier is set:
// the quiet tier until the maintainer decides at the size check of the
// Instrument design change; RUNNING_LINK underlines them at rest.

/** Underline on hover and on keyboard focus only. */
export const QUIET_LINK = 'link-quiet';

/** Underline at rest, for link-like controls that are not anchors. */
export const RUNNING_LINK = 'link-running';

/** The tier of navigation items, footer links and text controls drawn as links. */
export const CHROME_LINK: typeof QUIET_LINK | typeof RUNNING_LINK = QUIET_LINK;
