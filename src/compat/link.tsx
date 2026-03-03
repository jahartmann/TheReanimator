/**
 * Compat shim for 'next/link'.
 * Next.js Link accepts `href`; React Router Link accepts `to`.
 * This wrapper bridges the two so Sidebar and other components navigate correctly.
 */
import React from 'react';
import { Link as RouterLink, LinkProps } from 'react-router-dom';

type NextLinkProps = Omit<LinkProps, 'to'> & {
  href: string;
  [key: string]: any;
};

export default function Link({ href, children, ...rest }: NextLinkProps) {
  // Strip next-specific props that RR doesn't understand
  const { prefetch: _prefetch, replace, ...routerRest } = rest;
  return (
    <RouterLink to={href ?? '/'} replace={replace === true} {...routerRest}>
      {children}
    </RouterLink>
  );
}

export { Link };
