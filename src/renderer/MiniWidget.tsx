import { useState, useEffect } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { HStack } from '@astryxdesign/core/HStack';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Popover } from '@astryxdesign/core/Popover';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { Clock, Cpu, ExternalLink, GripVertical, Mic, MicOff, MoreVertical, Pin, Square, Volume2, X } from 'lucide-react';
import type { TrackKind } from '../capture-types';
import { InputPanel, inputPanelHeight } from './InputPanel';
import { Meters } from './Meters';
import type { AudioInputs } from './use-audio-inputs';

interface MiniWidgetProps {
  isRecording: boolean;
  isBusy: boolean;
  mic: boolean;
  setMic: (val: boolean) => void;
  system: boolean;
  setSystem: (val: boolean) => void;
  diarize: boolean;
  setDiarize: (val: boolean) => void;
  inputs: AudioInputs;
  delayStartSeconds: number;
  setDelayStartSeconds: (sec: number) => void;
  countdown: number | null;
  openTracks: TrackKind[];
  levels: React.RefObject<Record<TrackKind, number>>;
  statusText: string;
  onToggleRecord: () => void;
  onOpenRecordingsList: () => void;
  onExpandMainApp: () => void;
  onOpenModelsModal: () => void;
  isAlwaysOnTop: boolean;
  onToggleAlwaysOnTop: () => void;
  onCloseWindow?: () => void;
}

export function MiniWidget({
  isRecording,
  isBusy,
  mic,
  setMic,
  system,
  setSystem,
  diarize,
  setDiarize,
  inputs,
  delayStartSeconds,
  setDelayStartSeconds,
  countdown,
  openTracks,
  levels,
  statusText,
  onToggleRecord,
  onOpenRecordingsList,
  onExpandMainApp,
  onOpenModelsModal,
  isAlwaysOnTop,
  onToggleAlwaysOnTop,
  onCloseWindow,
}: MiniWidgetProps): React.ReactNode {
  /** Height the delay and overflow menus need — the height the widget used
   *  before the input panel started asking for more. */
  const MENU_POPOVER_HEIGHT = 290;

  const [micPopoverOpen, setMicPopoverOpen] = useState(false);
  const [delayPopoverOpen, setDelayPopoverOpen] = useState(false);
  const [menuPopoverOpen, setMenuPopoverOpen] = useState(false);

  const isPopoverOpen = micPopoverOpen || delayPopoverOpen || menuPopoverOpen;
  // The widget is 76px tall at rest and its popovers are DOM, not OS menus, so
  // the window has to grow to the height of whichever panel is open or the
  // panel is simply clipped off the top of the screen.
  const popoverHeight = micPopoverOpen
    ? inputPanelHeight(inputs.devices.length)
    : MENU_POPOVER_HEIGHT;

  useEffect(() => {
    if (window.api?.windowSetPopoverOpen) {
      void window.api.windowSetPopoverOpen(isPopoverOpen, popoverHeight);
    }
  }, [isPopoverOpen, popoverHeight]);

  // The panel meters every device itself. A single-device test left running
  // from the main window would be a second open of the same hardware, which on
  // Windows is how one of the two ends up silent.
  const stopTest = inputs.test.stop;
  useEffect(() => {
    if (micPopoverOpen) stopTest();
  }, [micPopoverOpen, stopTest]);

  const statusLabel = isRecording
    ? 'Recording'
    : countdown !== null
    ? `Starting in ${countdown}s`
    : isBusy
    ? 'Processing'
    : 'Miniscribe Ready';

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        boxSizing: 'border-box',
        padding: '12px 16px 14px 16px',
        backgroundColor: 'transparent',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
        alignItems: 'center',
        userSelect: 'none',
        overflow: 'visible',
      }}
    >
      {/* Mini Widget Control Card - Subtle Layered Elevation Shadow */}
      <div
        style={{
          width: '100%',
          boxSizing: 'border-box',
          padding: '4px 8px',
          backgroundColor: 'var(--color-surface-elevated, #1c1c1e)',
          color: 'var(--color-text-primary, #ffffff)',
          border: '1px solid rgba(255, 255, 255, 0.16)',
          borderRadius: '14px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          boxShadow: '0 4px 16px rgba(0, 0, 0, 0.25), 0 1px 4px rgba(0, 0, 0, 0.3)',
          backdropFilter: 'blur(20px)',
        }}
      >
        <HStack width="100%" vAlign="center" hAlign="between" gap={1.5}>
          {/* 1. Drag Control handle */}
          <div
            style={
              {
                WebkitAppRegion: 'drag',
                display: 'flex',
                alignItems: 'center',
                cursor: 'grab',
                padding: '6px 4px',
                color: 'var(--color-text-muted, #8e8e93)',
                borderRadius: '4px',
              } as React.CSSProperties
            }
            title="Drag to move"
          >
            <GripVertical size={16} />
          </div>

          {/* 2. Big Record Button (rounded) */}
          <div style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            <button
              type="button"
              disabled={isBusy}
              onClick={onToggleRecord}
              style={{
                width: '42px',
                height: '42px',
                borderRadius: '50%',
                border: isRecording ? '2.5px solid #ff453a' : '2.5px solid rgba(255, 255, 255, 0.25)',
                backgroundColor: isRecording ? '#ff3b30' : countdown !== null ? '#ff9500' : '#e02424',
                color: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: isBusy ? 'not-allowed' : 'pointer',
                boxShadow: isRecording
                  ? '0 0 16px rgba(255, 59, 48, 0.6)'
                  : '0 2px 6px rgba(0, 0, 0, 0.3)',
                transition: 'all 0.2s ease',
                outline: 'none',
              }}
              title={
                isRecording
                  ? 'Stop recording'
                  : countdown !== null
                  ? `Starting in ${countdown}s...`
                  : delayStartSeconds > 0
                  ? `Start recording (Delay ${delayStartSeconds}s)`
                  : 'Start recording'
              }
            >
              {countdown !== null ? (
                <span style={{ fontSize: '16px', fontWeight: 'bold' }}>{countdown}</span>
              ) : isRecording ? (
                <Square size={16} fill="#ffffff" />
              ) : (
                <div
                  style={{
                    width: '14px',
                    height: '14px',
                    borderRadius: '50%',
                    backgroundColor: '#ffffff',
                  }}
                />
              )}
            </button>
          </div>

          {/* Middle Status / Meter Summary */}
          <VStack gap={0.5} style={{ flex: 1, minWidth: 0, paddingInline: '2px' }}>
            <HStack gap={1} vAlign="center" hAlign="between">
              <HStack gap={1} vAlign="center">
                <StatusDot
                  label={statusLabel}
                  variant={isRecording ? 'accent' : isBusy ? 'accent' : 'neutral'}
                  isPulsing={isRecording}
                />
                <Text type="label" size="sm" weight="semibold">
                  {statusLabel}
                </Text>
              </HStack>
              {/* One line, always. Status text is a sentence from the ASR
                  pipeline; letting it wrap grows the widget past the window it
                  lives in and shoves the meters out of view. */}
              {statusText && statusText !== 'Ready.' && statusText !== 'Miniscribe ready' && statusText !== 'Miniscribe ready.' && (
                <Text type="supporting" size="sm" color="secondary" maxLines={1}>
                  {statusText}
                </Text>
              )}
            </HStack>

            {/* Compact: two labelled ProgressBars are taller than the whole
                76px widget, which is what used to push the layout apart the
                moment recording started. */}
            {isRecording && (
              <Meters
                isRecording={isRecording}
                openTracks={openTracks}
                levels={levels}
                variant="compact"
              />
            )}
          </VStack>

          {/* Right Controls: Mic, Delay Start, Triple Dots Menu */}
          <HStack gap={0.5} vAlign="center" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            {/* 3. Mic / Input Toggle Popover */}
            <Popover
              isOpen={micPopoverOpen}
              onOpenChange={setMicPopoverOpen}
              placement="above"
              alignment="start"
              content={
                <InputPanel
                  inputs={inputs}
                  mic={mic}
                  setMic={setMic}
                  system={system}
                  setSystem={setSystem}
                  diarize={diarize}
                  setDiarize={setDiarize}
                  isRecording={isRecording}
                  isOpen={micPopoverOpen}
                />
              }
            >
              <IconButton
                label="Audio inputs"
                icon={
                  <Icon
                    icon={mic ? Mic : MicOff}
                    color={mic || system ? 'primary' : 'secondary'}
                  />
                }
                variant={mic || system ? 'secondary' : 'ghost'}
                size="sm"
                tooltip="Configure microphone & system audio inputs"
              />
            </Popover>

            {/* 4. Delay Start Popover */}
            <Popover
              isOpen={delayPopoverOpen}
              onOpenChange={setDelayPopoverOpen}
              placement="above"
              alignment="start"
              content={
                <VStack padding={3} gap={2} width={220} hAlign="start">
                  <Text type="label" weight="semibold">
                    Delay Recording Start
                  </Text>
                  <VStack gap={1} width="100%" hAlign="start">
                    {[0, 3, 5, 10, 15].map((sec) => (
                      <Button
                        key={sec}
                        label={sec === 0 ? 'Instant (No delay)' : `${sec} seconds delay`}
                        variant={delayStartSeconds === sec ? 'primary' : 'ghost'}
                        size="sm"
                        width="100%"
                        style={{ justifyContent: 'flex-start' }}
                        clickAction={() => {
                          setDelayStartSeconds(sec);
                          setDelayPopoverOpen(false);
                        }}
                      />
                    ))}
                  </VStack>
                </VStack>
              }
            >
              <div style={{ position: 'relative' }}>
                <IconButton
                  label="Delay start"
                  icon={<Icon icon={Clock} color={delayStartSeconds > 0 ? 'accent' : 'secondary'} />}
                  variant={delayStartSeconds > 0 ? 'secondary' : 'ghost'}
                  size="sm"
                  tooltip={`Delay start: ${delayStartSeconds > 0 ? `${delayStartSeconds}s` : 'Instant'}`}
                />
                {delayStartSeconds > 0 && (
                  <span
                    style={{
                      position: 'absolute',
                      top: '-3px',
                      right: '-3px',
                      backgroundColor: 'var(--color-brand-primary, #0a84ff)',
                      color: '#fff',
                      borderRadius: '8px',
                      padding: '0 4px',
                      fontSize: '9px',
                      fontWeight: 'bold',
                      pointerEvents: 'none',
                    }}
                  >
                    {delayStartSeconds}s
                  </span>
                )}
              </div>
            </Popover>

            {/* Dedicated Expand to Main Window Icon Button */}
            <IconButton
              label="Expand to Main Window"
              icon={<Icon icon={ExternalLink} />}
              variant="ghost"
              size="sm"
              tooltip="Expand to Main Window"
              onClick={onExpandMainApp}
            />

            {/* 5. Vertical Triple Dots Popover Menu */}
            <Popover
              isOpen={menuPopoverOpen}
              onOpenChange={setMenuPopoverOpen}
              placement="above"
              alignment="start"
              content={
                <VStack padding={2} gap={1} width={200} hAlign="start">
                  <Button
                    label="Recordings List"
                    icon={<Icon icon={Volume2} />}
                    variant="ghost"
                    size="sm"
                    width="100%"
                    style={{ justifyContent: 'flex-start' }}
                    clickAction={() => {
                      setMenuPopoverOpen(false);
                      onOpenRecordingsList();
                    }}
                  />
                  <Button
                    label="Expand to Main Window"
                    icon={<Icon icon={ExternalLink} />}
                    variant="ghost"
                    size="sm"
                    width="100%"
                    style={{ justifyContent: 'flex-start' }}
                    clickAction={() => {
                      setMenuPopoverOpen(false);
                      onExpandMainApp();
                    }}
                  />
                  <Button
                    label="Speech Models..."
                    icon={<Icon icon={Cpu} />}
                    variant="ghost"
                    size="sm"
                    width="100%"
                    style={{ justifyContent: 'flex-start' }}
                    clickAction={() => {
                      setMenuPopoverOpen(false);
                      onOpenModelsModal();
                    }}
                  />
                  <Button
                    label={isAlwaysOnTop ? 'Always on Top: ON' : 'Always on Top: OFF'}
                    icon={<Icon icon={Pin} />}
                    variant="ghost"
                    size="sm"
                    width="100%"
                    style={{ justifyContent: 'flex-start' }}
                    clickAction={onToggleAlwaysOnTop}
                  />
                </VStack>
              }
            >
              <IconButton
                label="More options"
                icon={<Icon icon={MoreVertical} />}
                variant="ghost"
                size="sm"
                tooltip="Menu & Recordings"
              />
            </Popover>

            {/* 6. Close App Button */}
            <IconButton
              label="Close App"
              icon={<Icon icon={X} />}
              variant="ghost"
              size="sm"
              tooltip="Close App"
              onClick={onCloseWindow}
            />
          </HStack>
        </HStack>
      </div>
    </div>
  );
}
