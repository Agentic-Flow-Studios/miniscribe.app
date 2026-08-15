import { AppShell } from '@astryxdesign/core/AppShell';
import { Button } from '@astryxdesign/core/Button';
import { HStack } from '@astryxdesign/core/HStack';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { NavIcon } from '@astryxdesign/core/NavIcon';
import {
  SideNav,
  SideNavHeading,
  SideNavItem,
  SideNavSection,
} from '@astryxdesign/core/SideNav';
import { VStack } from '@astryxdesign/core/VStack';
import { ExternalLink, ListMusic, Mic, Minus, Settings, X } from 'lucide-react';
import { BrandCredit, FlowMark } from './Branding';

export type NavPage = 'recordings' | 'recording';

interface AppLayoutProps {
  /** Which nav item reads as current. The recording detail lives under Recordings. */
  activePage: NavPage;
  /** True while a recording or a transcription job is in flight. */
  isBusy: boolean;
  onGoToRecordings: () => void;
  onNewRecording: () => void;
  onOpenModelsModal: () => void;
  onSwitchToMiniMode: () => void;
  onMinimizeWindow: () => void;
  onCloseWindow: () => void;
  children: React.ReactNode;
}

/**
 * The main window's frame: a full-height nav rail on the left, a draggable
 * window bar across the top of the content, and the page itself below it.
 *
 * The window is frameless (`frame: false` in main.ts), so the bar is the only
 * thing the user can grab to move the window and the only place minimise and
 * close can live. Everything inside it is marked `no-drag` — a button inside a
 * drag region swallows its own clicks.
 */
export function AppLayout({
  activePage,
  isBusy,
  onGoToRecordings,
  onNewRecording,
  onOpenModelsModal,
  onSwitchToMiniMode,
  onMinimizeWindow,
  onCloseWindow,
  children,
}: AppLayoutProps): React.ReactNode {
  return (
    <AppShell
      height="fill"
      variant="elevated"
      contentPadding={0}
      sideNav={
        <SideNav
          header={
            <SideNavHeading
              heading="Miniscribe"
              subheading="Local meeting capture"
              icon={<NavIcon icon={<FlowMark size={16} />} />}
            />
          }
          footer={
            <VStack gap={3}>
              <Button
                label="Record"
                icon={<Icon icon={Mic} />}
                variant="primary"
                width="100%"
                isDisabled={isBusy}
                clickAction={onNewRecording}
                tooltip="Set up a new recording — pick your sources, then start it"
              />
              <BrandCredit />
            </VStack>
          }
        >
          <SideNavSection title="Main" isHeaderHidden>
            <SideNavItem
              label="Recordings"
              icon={ListMusic}
              isSelected={activePage === 'recordings' || activePage === 'recording'}
              onClick={onGoToRecordings}
            />
            <SideNavItem label="Settings" icon={Settings} onClick={onOpenModelsModal} />
          </SideNavSection>
        </SideNav>
      }
    >
      <VStack height="100%" minHeight={0} gap={0}>
        <HStack
          width="100%"
          vAlign="center"
          hAlign="end"
          gap={2}
          paddingInline={2}
          paddingBlock={1}
          style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        >
          <HStack
            gap={1}
            vAlign="center"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            <Button
              label="Mini Widget"
              icon={<Icon icon={ExternalLink} />}
              variant="ghost"
              size="sm"
              clickAction={onSwitchToMiniMode}
              tooltip="Switch to floating compact widget"
            />
            <IconButton
              label="Minimize"
              icon={<Icon icon={Minus} />}
              variant="ghost"
              size="sm"
              onClick={onMinimizeWindow}
            />
            <IconButton
              label="Close"
              icon={<Icon icon={X} />}
              variant="ghost"
              size="sm"
              onClick={onCloseWindow}
            />
          </HStack>
        </HStack>

        {/* Flex-sized, not height:100% — the latter is 100% of the shell in
            ADDITION to the window bar above it, which pushes the page past the
            bottom of the window. */}
        <VStack minHeight={0} gap={0} style={{ flex: 1 }}>
          {children}
        </VStack>
      </VStack>
    </AppShell>
  );
}
