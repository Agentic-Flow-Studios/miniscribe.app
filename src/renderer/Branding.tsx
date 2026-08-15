import { HStack } from '@astryxdesign/core/HStack';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';

/**
 * The studio mark. Three strokes flowing into one — drawn rather than shipped
 * as an asset so it inherits the theme's colour and stays crisp at any density,
 * and so the renderer bundle gains nothing to load.
 */
export function FlowMark({ size = 16 }: { size?: number }): React.ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M3 6c5 0 5 12 10 12s5-12 8-12" opacity={0.55} />
      <path d="M3 12c5 0 5 6 10 6" opacity={0.8} />
      <circle cx="19" cy="16" r="2.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

/**
 * Studio credit, at the foot of the side nav.
 *
 * It belongs to the app rather than to whichever transcript happens to be open,
 * so it sits in the nav rail's footer — outside every page's scroll region and
 * unchanged as the user moves between pages. Muted and two lines tall: the
 * transcript is what the user came for.
 */
export function BrandCredit(): React.ReactNode {
  return (
    <VStack gap={1} paddingBlock={1}>
      <HStack gap={1.5} vAlign="center">
        <Text type="supporting" size="2xs" color="accent">
          <FlowMark size={14} />
        </Text>
        <Text type="supporting" size="xsm" color="secondary">
          By{' '}
          <Text type="inherit" weight="semibold" color="primary">
            Agentic Flow Studios
          </Text>
        </Text>
      </HStack>
      <Text type="supporting" size="xsm" color="disabled">
        Transcribed on this device — no audio ever leaves it.
      </Text>
    </VStack>
  );
}
