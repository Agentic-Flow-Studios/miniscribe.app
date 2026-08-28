import React from 'react';
import { HStack } from '@astryxdesign/core/HStack';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import MiniscribeLogo from '../../assets/miniscribe_logo.svg';

export interface FlowMarkProps {
  /** Total outer dimension (width & height in px) */
  size?: number;
  /** Custom fill color override for the soundwave logo mark */
  color?: string;
  /** Whether to frame the logo mark inside a styled rounded square tile */
  withTile?: boolean;
  /** Corner radius for the tile container (defaults to 12px) */
  tileRadius?: number | string;
  /** Background color for the tile container */
  tileBackground?: string;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * The official Miniscribe logo mark loaded directly from assets/miniscribe_logo.svg
 * as a native React Component via build-time SVG transformation.
 */
export function FlowMark({
  size = 48,
  color,
  withTile = true,
  tileRadius = 12,
  tileBackground,
  className,
  style,
}: FlowMarkProps): React.ReactNode {
  const iconSize = withTile ? Math.round(size * 0.62) : size;

  const logoNode = (
    <MiniscribeLogo
      width={iconSize}
      height={iconSize}
      style={{
        display: 'block',
        color: color,
      }}
    />
  );

  if (withTile) {
    return (
      <span
        className={className}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: size,
          height: size,
          borderRadius: typeof tileRadius === 'number' ? `${tileRadius}px` : tileRadius,
          backgroundColor: tileBackground || 'var(--color-surface-elevated, var(--color-background-subtle, rgba(0, 0, 0, 0.05)))',
          border: '1px solid var(--color-border, rgba(0, 0, 0, 0.08))',
          boxShadow: '0 2px 6px rgba(0, 0, 0, 0.08)',
          flexShrink: 0,
          ...style,
        }}
      >
        {logoNode}
      </span>
    );
  }

  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        flexShrink: 0,
        ...style,
      }}
    >
      {logoNode}
    </span>
  );
}

/**
 * Studio credit, at the foot of the side nav.
 */
export function BrandCredit(): React.ReactNode {
  const version = typeof process !== 'undefined' && process.env?.APP_VERSION ? process.env.APP_VERSION : 'v1.0.0';

  return (
    <VStack gap={1} paddingBlock={1}>
      <HStack gap={1.5} vAlign="center" hAlign="between" width="100%">
        <Text type="supporting" size="xsm" color="secondary">
          By{' '}
          <a
            href="https://agentic-flow.studio"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: 'inherit',
              textDecoration: 'none',
              cursor: 'pointer',
            }}
          >
            <Text type="inherit" weight="semibold" color="primary">
              Agentic Flow Studios
            </Text>
          </a>
        </Text>
        <Text type="supporting" size="2xs" color="disabled" style={{ fontFamily: 'monospace', opacity: 0.7 }}>
          {version}
        </Text>
      </HStack>
    </VStack>
  );
}
