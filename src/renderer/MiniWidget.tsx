import { useState, useEffect } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { HStack } from '@astryxdesign/core/HStack';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Popover } from '@astryxdesign/core/Popover';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { Clock, Cpu, ExternalLink, GripVertical, Mic, MicOff, MoreVertical, Pause, Pin, Play, Square, Volume2, X } from 'lucide-react';
import { RecordDot } from './RecordGlyph';
import type { TrackKind } from '../capture-types';
import { InputPanel, inputPanelHeight } from './InputPanel';
import { Meters } from './Meters';
import { RecordingTimer } from './RecordingTimer';
import type { AudioInputs } from './use-audio-inputs';

interface MiniWidgetProps {
  isRecording: boolean;
  /** Recording, but not writing. Devices stay open so resuming is instant. */
  isPaused: boolean;
  onTogglePause: () => void;
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
  /** Seconds of audio captured so far, sampled by the timer. */
  recordedSeconds: React.RefObject<number>;
  onToggleRecord: () => void;
  onOpenRecordingsList: () => void;
  onExpandMainApp: () => void;
  onOpenModelsModal: () => void;
  isAlwaysOnTop: boolean;
  onToggleAlwaysOnTop: () => void;
  onCloseWindow?: () => void;
}

/**
 * Height of the transport slot, and so of the card's content row.
 *
 * The record button is the tallest control in the widget, and it exists only
 * when nothing is recording. Sizing the slot to it means the card keeps one
 * height across the whole session rather than snapping shorter the moment the
 * button is replaced by two small ones.
 */
const TRANSPORT_HEIGHT = 46;

/**
 * A native OS tooltip.
 *
 * The design system's tooltip is a DOM node, and a DOM node cannot leave the
 * window: in a 94px-tall widget it is drawn ON the control it describes, where
 * it covers half the bar. The OS draws this one outside the window entirely.
 */
function Hint({ text, children }: { text: string; children: React.ReactNode }): React.ReactNode {
  return (
    <span title={text} style={{ display: 'inline-flex', alignItems: 'center' }}>
      {children}
    </span>
  );
}

/** Shared shape of the transport buttons: record, pause, stop. */
const CIRCLE_BUTTON: React.CSSProperties = {
  flexShrink: 0,
  borderRadius: '50%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
  transition: 'all 0.2s ease',
  outline: 'none',
};

export function MiniWidget({
  isRecording,
  isPaused,
  onTogglePause,
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
  recordedSeconds,
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
    ? isPaused
      ? 'Paused'
      : 'Recording'
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
        padding: '14px 18px 16px 18px',
        backgroundColor: 'transparent',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
        alignItems: 'center',
        userSelect: 'none',
        overflow: 'visible',
      }}
    >
      {/* Mini Widget Control Card */}
      <div
        style={{
          width: '100%',
          boxSizing: 'border-box',
          padding: '8px 12px',
          // One height, recording or not — see TRANSPORT_HEIGHT.
          minHeight: `${TRANSPORT_HEIGHT + 16}px`,
          backgroundColor: 'var(--color-background-card)',
          color: 'var(--color-text-primary)',
          border: '1px solid var(--color-border)',
          borderRadius: '14px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          boxShadow: 'var(--shadow-med, 0 4px 16px rgba(15, 23, 42, 0.12))',
          backdropFilter: 'blur(20px)',
        }}
      >
        <HStack width="100%" vAlign="center" hAlign="between" gap={2}>
          {/* 1. Drag Control handle */}
          <div
            style={
              {
                WebkitAppRegion: 'drag',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: `${TRANSPORT_HEIGHT}px`,
                cursor: 'grab',
                paddingInline: '2px',
                color: 'var(--color-text-secondary)',
                borderRadius: '4px',
              } as React.CSSProperties
            }
            title="Drag to move"
          >
            <GripVertical size={16} />
          </div>

          {/* 2. Transport.
              At rest there is one thing to do, so there is one big button. Once
              a session is running the record button has nothing left to mean —
              it is already recording — so it gives way to the two controls that
              do: pause, and stop. */}
          <div
            style={
              {
                WebkitAppRegion: 'no-drag',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                // Fixed to the tallest thing it will ever hold — the record
                // button. Two small icon buttons occupy the same box, so the
                // card does not shrink the moment recording starts and the
                // whole widget stops changing height under the pointer.
                height: `${TRANSPORT_HEIGHT}px`,
                minWidth: `${TRANSPORT_HEIGHT}px`,
              } as React.CSSProperties
            }
          >
            {isRecording ? (
              // The same size and weight as the mic, delay and close controls
              // on the other side of the widget. A 42px filled disc for stop
              // shouted louder than anything else on a bar that is mostly a
              // status readout — the red on the glyph is enough to find it.
              <>
                <Hint text={isPaused ? 'Resume recording' : 'Pause — nothing is captured while paused'}>
                  <IconButton
                    label={isPaused ? 'Resume recording' : 'Pause recording'}
                    icon={<Icon icon={isPaused ? Play : Pause} size="sm" color="primary" />}
                    variant="ghost"
                    size="sm"
                    isDisabled={isBusy}
                    onClick={onTogglePause}
                  />
                </Hint>
                <Hint text="Stop recording and transcribe">
                  <IconButton
                    label="Stop recording"
                    icon={<Icon icon={Square} size="sm" color="error" />}
                    variant="ghost"
                    size="sm"
                    isDisabled={isBusy}
                    onClick={onToggleRecord}
                  />
                </Hint>
              </>
            ) : (
            <button
              type="button"
              disabled={isBusy}
              onClick={onToggleRecord}
              style={{
                ...CIRCLE_BUTTON,
                // A circle, not a pill: it is one action with one mark, and the
                // pill's horizontal padding is what made it read as squashed.
                // The ring IS the outer circle of the record glyph, so the
                // button draws it rather than filling with colour.
                width: '46px',
                height: '46px',
                border: '2px solid var(--color-border)',
                backgroundColor: 'var(--color-background-card)',
                color: 'var(--color-text-primary)',
                cursor: isBusy ? 'not-allowed' : 'pointer',
                boxShadow: '0 2px 6px rgba(0, 0, 0, 0.15)',
              }}
              // The button's only content is a shape, so the name has to be
              // stated: a screen reader would otherwise announce "button".
              aria-label="Start recording"
              title={
                countdown !== null
                  ? `Starting in ${countdown}s...`
                  : delayStartSeconds > 0
                  ? `Start recording (Delay ${delayStartSeconds}s)`
                  : 'Start recording'
              }
            >
              {countdown !== null ? (
                <span style={{ fontSize: '17px', fontWeight: 700 }}>{countdown}</span>
              ) : (
                <RecordDot size={20} />
              )}
            </button>
            )}
          </div>

          {/* Middle Status / Meter Summary */}
          {/* What a floating recorder is for: whether it is running, how long
              it has been running, and whether sound is going in. Everything
              else the session has to say — what it is transcribing, what it
              saved, what failed — belongs in the main window, where there is
              room to read it and where the action was taken. */}
          <VStack gap={0.5} style={{ flex: 1, minWidth: 0, paddingInline: '2px' }}>
            <HStack gap={1} vAlign="center" hAlign="between">
              <HStack gap={1} vAlign="center">
                <StatusDot
                  label={statusLabel}
                  variant={isRecording && !isPaused ? 'accent' : isBusy ? 'accent' : 'neutral'}
                  isPulsing={isRecording && !isPaused}
                />
                <Text type="label" size="sm" weight="semibold">
                  {statusLabel}
                </Text>
              </HStack>

              {isRecording && (
                <RecordingTimer seconds={recordedSeconds} isRunning={!isPaused} />
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
          {/* Every control here is one ghost icon button of one size, centred
              in the same box height as the transport — mixed button sizes and
              filled plates were what made the row read as unaligned. */}
          <HStack
            gap={0.5}
            vAlign="center"
            style={
              {
                WebkitAppRegion: 'no-drag',
                height: `${TRANSPORT_HEIGHT}px`,
              } as React.CSSProperties
            }
          >
            {/* 3. Mic / Input Toggle Popover */}
            <Popover
              isOpen={micPopoverOpen}
              onOpenChange={setMicPopoverOpen}
              placement="above"
              alignment="start"
              // The panel is a dialog of controls rather than a menu of
              // choices, so it keeps role="dialog" and gets a name. Without one
              // a screen reader announces "dialog" and nothing else.
              label="Audio inputs"
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
              <Hint text="Configure microphone & system audio inputs">
                <IconButton
                  label="Audio inputs"
                  // Selected state is carried by the icon's own strokes, not by a
                  // filled plate behind them: a row of tinted squares on a 92px
                  // bar reads as clutter, and the widget floats over other
                  // people's windows where every filled block competes.
                  icon={
                    <Icon
                      icon={mic ? Mic : MicOff}
                      size="sm"
                      color={mic || system ? 'accent' : 'secondary'}
                    />
                  }
                  variant="ghost"
                  size="sm"
                />
              </Hint>
            </Popover>

            {/* 4. Delay Start Popover */}
            <Popover
              isOpen={delayPopoverOpen}
              onOpenChange={setDelayPopoverOpen}
              placement="above"
              alignment="start"
              label="Delay recording start"
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
              <div
                style={{ position: 'relative' }}
                title={`Delay start: ${delayStartSeconds > 0 ? `${delayStartSeconds}s` : 'Instant'}`}
              >
                <IconButton
                  label="Delay start"
                  icon={
                    <Icon
                      icon={Clock}
                      size="sm"
                      color={delayStartSeconds > 0 ? 'accent' : 'secondary'}
                    />
                  }
                  variant="ghost"
                  size="sm"
                />
                {delayStartSeconds > 0 && (
                  <span
                    style={{
                      position: 'absolute',
                      top: '-3px',
                      right: '-3px',
                      backgroundColor: 'var(--color-accent)',
                      color: '#ffffff',
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
            <Hint text="Expand to Main Window">
              <IconButton
                label="Expand to Main Window"
                icon={<Icon icon={ExternalLink} size="sm" color="secondary" />}
                variant="ghost"
                size="sm"
                onClick={onExpandMainApp}
              />
            </Hint>

            {/* 5. Vertical Triple Dots Popover Menu */}
            <Popover
              isOpen={menuPopoverOpen}
              onOpenChange={setMenuPopoverOpen}
              placement="above"
              alignment="start"
              label="Miniscribe menu"
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
              <Hint text="Menu & Recordings">
                <IconButton
                  label="More options"
                  icon={<Icon icon={MoreVertical} size="sm" color="secondary" />}
                  variant="ghost"
                  size="sm"
                />
              </Hint>
            </Popover>

            {/* 6. Close App Button */}
            <Hint text="Close App">
              <IconButton
                label="Close App"
                icon={<Icon icon={X} size="sm" color="secondary" />}
                variant="ghost"
                size="sm"
                onClick={onCloseWindow}
              />
            </Hint>
          </HStack>
        </HStack>
      </div>
    </div>
  );
}
