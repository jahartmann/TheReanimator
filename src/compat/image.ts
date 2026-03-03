/**
 * Compat shim for 'next/image'.
 * Renders a plain <img> element instead of Next.js's optimized Image component.
 */
import React from 'react';

interface ImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  fill?: boolean;
  priority?: boolean;
  quality?: number;
  placeholder?: 'blur' | 'empty';
  blurDataURL?: string;
  sizes?: string;
  loader?: (props: { src: string; width: number; quality?: number }) => string;
}

export default function Image({
  src,
  alt,
  width,
  height,
  fill,
  priority: _priority,
  quality: _quality,
  placeholder: _placeholder,
  blurDataURL: _blurDataURL,
  loader: _loader,
  ...props
}: ImageProps): React.ReactElement {
  const style: React.CSSProperties = fill
    ? { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', ...props.style }
    : props.style || {};

  return React.createElement('img', {
    src,
    alt,
    width: fill ? undefined : width,
    height: fill ? undefined : height,
    ...props,
    style,
  });
}
