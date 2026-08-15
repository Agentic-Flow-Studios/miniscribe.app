import { Divider } from '@astryxdesign/core/Divider';
import { HStack } from '@astryxdesign/core/HStack';
import { Icon } from '@astryxdesign/core/Icon';
import { Item } from '@astryxdesign/core/Item';
import { Switch } from '@astryxdesign/core/Switch';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { Mic, MicOff, Volume2 } from 'lucide-react';
import { InputLevelMeter } from './InputLevelMeter';
import { SYSTEM_DEFAULT_INPUT, type AudioInputs } from './use-audio-inputs';
import { useInputLevels } from './use-input-levels';

interface InputPanelProps {
  inputs: AudioInputs;
  mic: boolean;
  setMic: (val: boolean) => void;
  system: boolean;
  setSystem: (val: boolean) => void;
  diarize: boolean;
  setDiarize: (val: boolean) => void;
  isRecording: boolean;
  /** The panel is on screen. Monitoring every device is not free, so it only
   *  runs while someone is looking at it. */
  isOpen: boolean;
}

/** Wide enough for a real Windows device name plus its meter, narrow enough to
 *  hang off a 440px widget without covering the screen. */
export const INPUT_PANEL_WIDTH = 380;

/** One compact Item, near enough. Used to size both the scroll box and the
 *  widget window the panel hangs off. */
const ROW_HEIGHT = 36;
/** Past this the list scrolls. A widget that grows taller than a dialog to list
 *  eight webcams has stopped being a widget. */
const MAX_VISIBLE_ROWS = 5;

/**
 * How tall the mini widget must grow to show this panel, given the device
 * count. The widget window is only 76px tall at rest, so it has to be told.
 */
export function inputPanelHeight(deviceCount: number): number {
  const rows = Math.min(deviceCount + 1, MAX_VISIBLE_ROWS); // +1: system default
  return 250 + rows * ROW_HEIGHT;
}

function SectionLabel({ children }: { children: string }): React.ReactNode {
  return (
    <Text type="label" size="sm" color="secondary" weight="semibold">
      {children}
    </Text>
  );
}

/**
 * Everything about what gets captured, in one panel: the source toggles, the
 * microphone to use, and a live meter per device.
 *
 * The meters are the point. Device names on Windows are near-useless for
 * telling hardware apart ("Microphone (2- USB Audio Device)"), so the way to
 * find the right input is to talk and watch which row moves. That only works if
 * every device is metered at once, which is what useInputLevels does while this
 * panel is open.
 */
export function InputPanel({
  inputs,
  mic,
  setMic,
  system,
  setSystem,
  diarize,
  setDiarize,
  isRecording,
  isOpen,
}: InputPanelProps): React.ReactNode {
  // Not while recording: the take owns the devices, and on Windows a second
  // open of the same microphone can fail outright.
  const isMonitoring = isOpen && mic && !isRecording;
  const { levels, unavailable } = useInputLevels(inputs.devices, isMonitoring);

  const rows = [
    { id: SYSTEM_DEFAULT_INPUT, label: 'System default' },
    ...inputs.devices,
  ];

  return (
    <VStack padding={3} gap={2} width={INPUT_PANEL_WIDTH} hAlign="start">
      <HStack width="100%" vAlign="center" hAlign="between" gap={2}>
        <SectionLabel>MICROPHONE</SectionLabel>
        <Switch
          label="Capture microphone"
          isLabelHidden
          value={mic}
          onChange={setMic}
          isDisabled={isRecording}
          size="sm"
        />
      </HStack>

      {mic ? (
        <VStack width="100%" gap={1}>
          <VStack
            width="100%"
            gap={0}
            isScrollable={rows.length > MAX_VISIBLE_ROWS}
            style={{ maxHeight: `${MAX_VISIBLE_ROWS * ROW_HEIGHT}px` }}
          >
            {rows.map((row) => {
              const isMissing = unavailable.includes(row.id);
              return (
                <Item
                  key={row.id}
                  label={row.label}
                  labelLines={1}
                  density="compact"
                  isSelected={inputs.micDeviceId === row.id}
                  isDisabled={isRecording}
                  onClick={() => inputs.chooseMic(row.id)}
                  startContent={
                    <Icon
                      icon={isMissing ? MicOff : Mic}
                      size="sm"
                      color={inputs.micDeviceId === row.id ? 'accent' : 'secondary'}
                    />
                  }
                  endContent={
                    isMissing ? (
                      <Text type="supporting" size="sm" color="disabled">
                        in use
                      </Text>
                    ) : (
                      <InputLevelMeter
                        levels={levels}
                        deviceId={row.id}
                        isIdle={!isMonitoring}
                      />
                    )
                  }
                />
              );
            })}
          </VStack>

          {!inputs.hasLabels && inputs.devices.length > 0 ? (
            <Text type="supporting" size="sm" color="secondary">
              Device names appear once Miniscribe has held microphone access.
            </Text>
          ) : null}

          <Text type="supporting" size="sm" color="secondary">
            {isRecording
              ? 'Levels are shown on the widget while recording.'
              : 'Talk, and pick the row that moves.'}
          </Text>
        </VStack>
      ) : null}

      <Divider />

      <HStack width="100%" vAlign="center" hAlign="between" gap={2}>
        <HStack gap={1.5} vAlign="center">
          <Icon icon={Volume2} size="sm" color={system ? 'accent' : 'secondary'} />
          <Text type="label">System audio (them)</Text>
        </HStack>
        <Switch
          label="Capture system audio"
          isLabelHidden
          value={system}
          onChange={setSystem}
          isDisabled={isRecording}
          size="sm"
        />
      </HStack>

      <Divider />

      <HStack width="100%" vAlign="center" hAlign="between" gap={2}>
        <Text type="label">Separate speakers</Text>
        <Switch
          label="Separate speakers when transcribing"
          isLabelHidden
          value={diarize}
          onChange={setDiarize}
          size="sm"
        />
      </HStack>
    </VStack>
  );
}
