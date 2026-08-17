import { useMemo } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { HStack } from '@astryxdesign/core/HStack';
import { Icon } from '@astryxdesign/core/Icon';
import { ProgressBar } from '@astryxdesign/core/ProgressBar';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { AudioLines, CircleAlert, CircleCheck, ExternalLink, RefreshCw, Square } from 'lucide-react';
import { SYSTEM_DEFAULT_INPUT, type AudioInputs } from './use-audio-inputs';

interface AudioInputPickerProps {
  inputs: AudioInputs;
  /** Locked while a recording is running: the graph is already attached. */
  isDisabled?: boolean;
  /** Hide the visible label where a neighbouring control already says "microphone". */
  isLabelHidden?: boolean;
  width?: number | string;
}

/**
 * Which microphone "you" means, and proof that it works.
 *
 * Always at least one option — the system default — so the control reads the
 * same on a laptop with one built-in mic as on a desk with three. Device names
 * are withheld by Chromium until the page has held a mic permission once, so
 * the reveal button trades a momentary silent grant for a list the user can
 * actually tell apart.
 *
 * The test opens the chosen device and shows what it hears. It is the only way
 * to find out that a mic is muted at the hardware switch, or that "Headset" is
 * really the webcam, BEFORE a meeting is recorded silently.
 */
export function AudioInputPicker({
  inputs,
  isDisabled = false,
  isLabelHidden = false,
  width = '100%',
}: AudioInputPickerProps): React.ReactNode {
  const test = inputs.test;

  const options = useMemo(
    () => [
      { value: SYSTEM_DEFAULT_INPUT, label: 'System default' },
      ...inputs.devices.map((device) => ({ value: device.id, label: device.label })),
    ],
    [inputs.devices],
  );

  const isListening = test.state === 'listening' || test.state === 'starting';

  const handleOpenPrivacySettings = () => {
    void window.api?.systemOpenPrivacySettings?.('microphone');
  };

  return (
    <VStack gap={2} hAlign="start" width="100%">
      <HStack gap={1.5} vAlign="end" wrap="wrap" width="100%">
        <Selector
          label="Microphone"
          isLabelHidden={isLabelHidden}
          size="sm"
          width={width}
          options={options}
          value={inputs.micDeviceId}
          onChange={inputs.chooseMic}
          isDisabled={isDisabled || inputs.permissionStatus === 'denied'}
          disabledMessage={isDisabled ? 'Stop the recording to switch microphone.' : undefined}
        />
        <Button
          label={isListening ? 'Stop test' : 'Test Mic'}
          icon={<Icon icon={isListening ? Square : AudioLines} />}
          variant={isListening ? 'secondary' : 'ghost'}
          size="sm"
          isDisabled={isDisabled || inputs.permissionStatus === 'denied'}
          isLoading={test.state === 'starting'}
          clickAction={isListening ? test.stop : test.start}
          tooltip={
            isDisabled
              ? undefined
              : 'Listen to this microphone for 15 seconds without recording anything'
          }
        />
      </HStack>

      {inputs.permissionStatus === 'denied' ? (
        <VStack
          gap={1.5}
          width="100%"
          padding={3}
          style={{
            backgroundColor: 'var(--color-background-muted)',
            border: '1px solid var(--color-error)',
            borderRadius: '6px',
          }}
        >
          <HStack gap={1.5} vAlign="center">
            <Icon icon={CircleAlert} size="sm" color="error" />
            <Text type="body" weight="medium" style={{ color: 'var(--color-error)' }}>
              Microphone access blocked
            </Text>
          </HStack>
          <Text type="supporting" size="sm" color="secondary">
            {inputs.permissionError ||
              'Miniscribe cannot access your microphone. Please enable microphone permissions in your Windows Privacy Settings.'}
          </Text>
          <HStack gap={2} vAlign="center" paddingBlock={0.5}>
            <Button
              label="Open Windows Microphone Settings"
              icon={<Icon icon={ExternalLink} />}
              variant="primary"
              size="sm"
              style={{ borderRadius: '9999px', backgroundColor: 'var(--color-accent)' }}
              clickAction={handleOpenPrivacySettings}
            />
            <Button
              label="Retry"
              icon={<Icon icon={RefreshCw} />}
              variant="ghost"
              size="sm"
              clickAction={() => void inputs.requestPermission()}
            />
          </HStack>
        </VStack>
      ) : !inputs.hasLabels && inputs.devices.length > 0 ? (
        <HStack gap={2} vAlign="center" wrap="wrap">
          <Button
            label="Grant Permission & Reveal Device Names"
            icon={<Icon icon={RefreshCw} />}
            variant="ghost"
            size="sm"
            clickAction={inputs.revealNames}
            tooltip="Asks for microphone access so this list can show real device names"
          />
        </HStack>
      ) : null}

      <MicTestReadout inputs={inputs} />
    </VStack>
  );
}

/**
 * What the test is hearing, or heard.
 *
 * Split from the picker so each surface can place it where it fits: stacked
 * under the control in the widget's popover, on its own full-width row under
 * the capture bar on the recording page. Squeezing a VU meter into a 220px
 * column next to a row of switches makes both harder to read.
 */
export function MicTestReadout({
  inputs,
  width = '100%',
}: {
  inputs: AudioInputs;
  width?: number | string;
}): React.ReactNode {
  const test = inputs.test;
  const isListening = test.state === 'listening' || test.state === 'starting';

  if (test.error) {
    return (
      <HStack gap={1} vAlign="center" wrap="wrap">
        <Icon icon={CircleAlert} size="sm" color="error" />
        <Text type="supporting" size="sm">
          {test.error}
        </Text>
      </HStack>
    );
  }

  if (isListening) {
    return (
      <VStack gap={1} width={width} maxWidth={520}>
        <ProgressBar
          label="Microphone test level"
          value={test.level}
          variant={test.heardSignal ? 'success' : 'neutral'}
        />
        <HStack gap={1} vAlign="center" wrap="wrap">
          {test.heardSignal ? <Icon icon={CircleCheck} size="sm" color="success" /> : null}
          <Text type="supporting" size="sm">
            {test.heardSignal
              ? 'Hearing you — this microphone works.'
              : 'Listening… say something to check the level.'}
          </Text>
        </HStack>
      </VStack>
    );
  }

  // The verdict outlives the test: the point of running one is to still know
  // the answer a moment later, when starting the recording.
  if (test.state === 'idle' && test.peak > 0) {
    return (
      <HStack gap={1} vAlign="center" wrap="wrap">
        <Icon
          icon={test.heardSignal ? CircleCheck : CircleAlert}
          size="sm"
          color={test.heardSignal ? 'success' : 'warning'}
        />
        <Text type="supporting" size="sm">
          {test.heardSignal
            ? 'Test passed — sound reached this microphone.'
            : 'Test heard nothing. Check the device, its mute switch, and its system volume.'}
        </Text>
      </HStack>
    );
  }

  return null;
}
