// Buttons (requirements §7, components; collection board, set bar actions).
// Primary is ink with white text, secondary is outlined on the panel color,
// both with 2 px corners and no shadow. The link variant is a text control
// in the accent color (ink), for actions that read as links on the boards
// ("+ add filter", "expand", "All N classes", the pager), with the chrome
// link tier of linkTier.ts.
import type { ComponentPropsWithRef } from 'react';
import { CHROME_LINK } from '../linkTier';

export type ButtonVariant = 'primary' | 'secondary' | 'link';

const base = 'rounded-control px-3 py-1.75 text-control font-bold disabled:cursor-default';

export const buttonClass: Readonly<Record<ButtonVariant, string>> = {
  primary: `${base} border border-ink bg-ink text-on-ink disabled:border-text-label disabled:bg-text-label`,
  secondary: `${base} border border-control-border bg-panel text-ink disabled:text-text-label`,
  link: `text-control text-accent hover:text-accent-hover disabled:text-text-label ${CHROME_LINK}`,
};

export interface ButtonProps extends ComponentPropsWithRef<'button'> {
  variant?: ButtonVariant;
}

export function Button({ variant = 'secondary', className, type, ...rest }: ButtonProps) {
  const classes =
    className === undefined ? buttonClass[variant] : `${buttonClass[variant]} ${className}`;
  return <button type={type ?? 'button'} className={classes} {...rest} />;
}
