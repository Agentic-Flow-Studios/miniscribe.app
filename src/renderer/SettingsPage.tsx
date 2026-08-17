import { useEffect, useState } from 'react';
import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Divider } from '@astryxdesign/core/Divider';
import { HStack } from '@astryxdesign/core/HStack';
import { Heading } from '@astryxdesign/core/Heading';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { ProgressBar } from '@astryxdesign/core/ProgressBar';
import { Section } from '@astryxdesign/core/Section';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Switch } from '@astryxdesign/core/Switch';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import {
  Check,
  Cpu,
  Download,
  HardDrive,
  Laptop,
  Mic,
  Moon,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Sun,
  Trash2,
  Users,
  Volume2,
} from 'lucide-react';
import { AudioInputPicker } from './AudioInputPicker';
import type { AudioInputs } from './use-audio-inputs';
import type { ModelSpec, ModelStatus } from './use-session';
import { useUpdater, type UpdateState } from './use-updater';

const SETTINGS_MAX_WIDTH = 960;

export type ThemeMode = 'light' | 'dark' | 'system';

interface SettingsPageProps {
  mic: boolean;
  setMic: (val: boolean) => void;
  system: boolean;
  setSystem: (val: boolean) => void;
  diarize: boolean;
  setDiarize: (val: boolean) => void;
  inputs: AudioInputs;
  themeMode: ThemeMode;
  onThemeModeChange: (mode: ThemeMode) => void;
  /** Installing or deleting a model changes what the rest of the app can do. */
  onModelsChanged?: () => void;
  onGoToWidget?: () => void;
}

/** The update panel's headline: a badge, and the sentence under it. */
function updateSummary(state: UpdateState): {
  variant: 'neutral' | 'info' | 'success' | 'warning' | 'error';
  label: string;
  detail: string;
} {
  switch (state.stage) {
    case 'checking':
      return { variant: 'info', label: 'Checking…', detail: 'Asking for the latest version.' };
    case 'up-to-date':
      return {
        variant: 'success',
        label: 'Up to date',
        detail: 'You are running the latest version.',
      };
    case 'available':
      return {
        variant: 'warning',
        label: 'Update available',
        detail: `Version ${state.newVersion} is ready to download.`,
      };
    case 'downloading':
      return {
        variant: 'info',
        label: 'Downloading',
        detail: `Fetching version ${state.newVersion}.`,
      };
    case 'downloaded':
      return {
        variant: 'success',
        label: 'Ready to install',
        detail: `Version ${state.newVersion} installs when you restart.`,
      };
    case 'error':
      return {
        variant: 'error',
        label: 'Check failed',
        detail: state.message ?? 'The update check did not complete.',
      };
    case 'unsupported':
      return {
        variant: 'neutral',
        label: 'Development build',
        detail: state.message ?? 'Update checks run in the installed app.',
      };
    default:
      return {
        variant: 'neutral',
        label: 'Not checked yet',
        detail: 'Check to see whether a newer version is available.',
      };
  }
}

function fmtChecked(at: string | null): string | null {
  if (!at) return null;
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return null;
  return `Last checked ${d.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

export function SettingsPage({
  mic,
  setMic,
  system,
  setSystem,
  diarize,
  setDiarize,
  inputs,
  themeMode,
  onThemeModeChange,
  onModelsChanged,
  onGoToWidget,
}: SettingsPageProps): React.ReactNode {
  const [catalog, setCatalog] = useState<ModelSpec[]>([]);
  const [statuses, setStatuses] = useState<Record<string, ModelStatus>>({});
  const [progressMap, setProgressMap] = useState<
    Record<string, { pct: number; speed: number }>
  >({});
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const updater = useUpdater();
  const update = updateSummary(updater.state);
  const checkedAt = fmtChecked(updater.state.lastCheckedAt);

  const loadData = async () => {
    try {
      const cat = await window.api.modelsCatalog();
      const list = await window.api.modelsList();
      setCatalog(cat);
      const map: Record<string, ModelStatus> = {};
      for (const s of list) map[s.id] = s;
      setStatuses(map);
    } catch (e) {
      console.error('[models] load error:', e);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  useEffect(() => {
    window.api.onModelProgress?.((p) => {
      setProgressMap((prev) => ({
        ...prev,
        [p.id]: { pct: p.progressPct, speed: p.downloadSpeedMb },
      }));
      if (p.progressPct >= 100) {
        void loadData();
      }
    });
  }, []);

  const handleDownload = async (id: string) => {
    setErrorMsg(null);
    try {
      setProgressMap((prev) => ({ ...prev, [id]: { pct: 1, speed: 0 } }));
      const updated = await window.api.modelsDownload(id);
      const map: Record<string, ModelStatus> = {};
      for (const s of updated) map[s.id] = s;
      setStatuses(map);
      onModelsChanged?.();
    } catch (e) {
      setErrorMsg(`Failed to download model: ${(e as Error).message}`);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const updated = await window.api.modelsDelete(id);
      const map: Record<string, ModelStatus> = {};
      for (const s of updated) map[s.id] = s;
      setStatuses(map);
      onModelsChanged?.();
    } catch (e) {
      console.error('[models] delete error:', e);
    }
  };

  const handleSetActive = async (id: string) => {
    try {
      const updated = await window.api.modelsSetActive(id);
      const map: Record<string, ModelStatus> = {};
      for (const s of updated) map[s.id] = s;
      setStatuses(map);
    } catch (e) {
      console.error('[models] set active error:', e);
    }
  };

  const hasInstalledModel = Object.values(statuses).some((s) => s.isInstalled);
  const activeModel =
    Object.values(statuses).find((s) => s.isActive) ||
    Object.values(statuses).find((s) => s.isInstalled);
  const micReady = inputs.hasLabels || inputs.permissionStatus === 'granted';

  return (
    <VStack height="100%" minHeight={0} gap={0}>
      {/* Page Header */}
      <Section variant="transparent" padding={5} paddingBlock={4}>
        <VStack maxWidth={SETTINGS_MAX_WIDTH} gap={1}>
          <Heading level={1}>Settings</Heading>
          <Text type="supporting" color="secondary">
            Configure appearance, speech recognition models, capture options, and local privacy.
          </Text>
        </VStack>
      </Section>

      {/* Main Content Area */}
      <VStack
        isScrollable
        minHeight={0}
        paddingInline={5}
        paddingBlock={1}
        gap={4}
        style={{ flex: 1 }}
      >
        <VStack maxWidth={SETTINGS_MAX_WIDTH} gap={4} paddingBlock={2}>
          {/* First-Time Setup Checklist / FTUX Guide */}
          <Card
            padding={4}
            style={{
              backgroundColor: 'var(--color-background-card)',
              border: hasInstalledModel && micReady
                ? '1px solid var(--color-border)'
                : '2px solid var(--color-accent)',
              borderRadius: '8px',
              boxShadow: 'var(--shadow-low)',
            }}
          >
            <VStack gap={3} width="100%">
              <HStack width="100%" vAlign="center" hAlign="between" wrap="wrap" gap={2}>
                <HStack gap={2} vAlign="center">
                  <HStack
                    vAlign="center"
                    hAlign="center"
                    width={36}
                    height={36}
                    style={{
                      borderRadius: '50%',
                      backgroundColor: 'var(--color-background-muted)',
                    }}
                  >
                    <Icon icon={Sparkles} size="sm" color="accent" />
                  </HStack>
                  <VStack gap={0.5}>
                    <HStack gap={1.5} vAlign="center">
                      <Text
                        type="body"
                        weight="semibold"
                        style={{ fontSize: '18px', color: 'var(--color-text-primary)' }}
                      >
                        Getting Started with Miniscribe
                      </Text>
                      <Badge
                        variant={hasInstalledModel && micReady ? 'success' : 'info'}
                        label={
                          hasInstalledModel && micReady
                            ? 'Ready to Record'
                            : `${(hasInstalledModel ? 1 : 0) + (micReady ? 1 : 0)} of 2 Steps Completed`
                        }
                      />
                    </HStack>
                    <Text type="supporting" size="sm" color="secondary">
                      Miniscribe runs 100% locally on your computer with zero cloud dependency.
                    </Text>
                  </VStack>
                </HStack>
              </HStack>

              <VStack gap={2} width="100%">
                {/* Step 1: Speech Model */}
                <Card
                  padding={3}
                  style={{
                    backgroundColor: hasInstalledModel
                      ? 'var(--color-background-muted)'
                      : 'var(--color-background-elevated)',
                    border: hasInstalledModel
                      ? '1px solid var(--color-border)'
                      : '1px solid var(--color-accent)',
                    borderRadius: '6px',
                  }}
                >
                  <VStack gap={2} width="100%">
                    <HStack width="100%" vAlign="center" hAlign="between" wrap="wrap" gap={2}>
                      <HStack gap={2} vAlign="center">
                        <HStack
                          vAlign="center"
                          hAlign="center"
                          width={28}
                          height={28}
                          style={{
                            borderRadius: '50%',
                            backgroundColor: hasInstalledModel
                              ? 'var(--color-success)'
                              : 'var(--color-accent)',
                            color: '#ffffff',
                            fontWeight: 'bold',
                            fontSize: '13px',
                          }}
                        >
                          {hasInstalledModel ? <Icon icon={Check} size="sm" color="inherit" /> : '1'}
                        </HStack>
                        <VStack gap={0.5}>
                          <Text type="body" weight="semibold">
                            Step 1: Speech Recognition Model {hasInstalledModel ? '(Ready)' : '(Required)'}
                          </Text>
                          <Text type="supporting" size="sm" color="secondary">
                            {hasInstalledModel
                              ? `Active model: ${activeModel?.id || 'Installed'}. Ready for offline meeting transcription.`
                              : 'Download the recommended offline speech model (~600 MB) for on-device speech-to-text.'}
                          </Text>
                        </VStack>
                      </HStack>

                      {!hasInstalledModel && (
                        <Button
                          label={
                            progressMap['parakeet-0.6b']
                              ? 'Downloading Model…'
                              : 'Download Recommended Model (Parakeet 0.6B)'
                          }
                          icon={<Icon icon={Download} />}
                          variant="primary"
                          size="sm"
                          isLoading={
                            !!progressMap['parakeet-0.6b'] &&
                            progressMap['parakeet-0.6b'].pct < 100
                          }
                          clickAction={() => handleDownload('parakeet-0.6b')}
                        />
                      )}
                    </HStack>

                    {progressMap['parakeet-0.6b'] && progressMap['parakeet-0.6b'].pct < 100 && (
                      <VStack gap={1} width="100%" paddingBlock={0.5}>
                        <ProgressBar
                          label="Downloading Parakeet TDT 0.6B"
                          value={progressMap['parakeet-0.6b'].pct}
                          variant="accent"
                        />
                        <HStack width="100%" vAlign="center" hAlign="between">
                          <Text type="supporting" size="sm" color="secondary">
                            {progressMap['parakeet-0.6b'].pct}% downloaded
                          </Text>
                          <Text type="supporting" size="sm" color="secondary">
                            {progressMap['parakeet-0.6b'].speed.toFixed(1)} MB/s
                          </Text>
                        </HStack>
                      </VStack>
                    )}
                  </VStack>
                </Card>

                {/* Step 2: Microphone Permission & Testing */}
                <Card
                  padding={3}
                  style={{
                    backgroundColor: micReady
                      ? 'var(--color-background-muted)'
                      : 'var(--color-background-elevated)',
                    border: micReady
                      ? '1px solid var(--color-border)'
                      : '1px solid var(--color-accent)',
                    borderRadius: '6px',
                  }}
                >
                  <VStack gap={2} width="100%">
                    <HStack width="100%" vAlign="center" hAlign="between" wrap="wrap" gap={2}>
                      <HStack gap={2} vAlign="center">
                        <HStack
                          vAlign="center"
                          hAlign="center"
                          width={28}
                          height={28}
                          style={{
                            borderRadius: '50%',
                            backgroundColor: micReady
                              ? 'var(--color-success)'
                              : inputs.permissionStatus === 'denied'
                              ? 'var(--color-error)'
                              : 'var(--color-accent)',
                            color: '#ffffff',
                            fontWeight: 'bold',
                            fontSize: '13px',
                          }}
                        >
                          {micReady ? <Icon icon={Check} size="sm" color="inherit" /> : '2'}
                        </HStack>
                        <VStack gap={0.5}>
                          <Text type="body" weight="semibold">
                            Step 2: Microphone Access & Testing {micReady ? '(Ready)' : '(Required)'}
                          </Text>
                          <Text type="supporting" size="sm" color="secondary">
                            {inputs.permissionStatus === 'denied'
                              ? 'Microphone access is blocked by Windows/system privacy settings.'
                              : micReady
                              ? 'Microphone permission granted. Select your device and verify live audio levels.'
                              : 'Grant microphone permissions and verify that your microphone is working.'}
                          </Text>
                        </VStack>
                      </HStack>
                    </HStack>

                    <AudioInputPicker inputs={inputs} />
                  </VStack>
                </Card>

                {/* Completion Action */}
                {hasInstalledModel && micReady && onGoToWidget && (
                  <HStack width="100%" vAlign="center" hAlign="between" wrap="wrap" gap={2} paddingBlock={0.5}>
                    <HStack gap={1.5} vAlign="center">
                      <Icon icon={Check} size="sm" color="success" />
                      <Text type="body" weight="semibold">
                        Setup is complete! You can start recording now.
                      </Text>
                    </HStack>
                    <Button
                      label="Open Mini Widget & Start Recording"
                      icon={<Icon icon={Mic} />}
                      variant="primary"
                      size="sm"
                      clickAction={onGoToWidget}
                    />
                  </HStack>
                )}
              </VStack>
            </VStack>
          </Card>

          {/* Section 1: Appearance & Theme Switcher */}
          <Card
            padding={4}
            style={{
              backgroundColor: 'var(--color-background-card)',
              border: '1px solid var(--color-border)',
              borderRadius: '8px',
              boxShadow: 'var(--shadow-low)',
            }}
          >
            <VStack gap={3} width="100%">
              <HStack width="100%" vAlign="center" hAlign="between" wrap="wrap" gap={2}>
                <HStack gap={2} vAlign="center">
                  <HStack
                    vAlign="center"
                    hAlign="center"
                    width={36}
                    height={36}
                    style={{
                      borderRadius: '50%',
                      backgroundColor: 'var(--color-background-muted)',
                    }}
                  >
                    <Icon icon={Sun} size="sm" color="accent" />
                  </HStack>
                  <VStack gap={0.5}>
                    <Text type="body" weight="semibold" style={{ fontSize: '18px', color: 'var(--color-text-primary)' }}>
                      Appearance & Theme
                    </Text>
                    <Text type="supporting" size="sm" color="secondary">
                      Choose your preferred color theme or match your system settings automatically.
                    </Text>
                  </VStack>
                </HStack>

                <SegmentedControl
                  label="Theme mode"
                  size="md"
                  value={themeMode}
                  onChange={(val) => onThemeModeChange(val as ThemeMode)}
                >
                  <SegmentedControlItem value="light" label="Light" icon={<Icon icon={Sun} />} />
                  <SegmentedControlItem value="dark" label="Dark" icon={<Icon icon={Moon} />} />
                  <SegmentedControlItem value="system" label="System" icon={<Icon icon={Laptop} />} />
                </SegmentedControl>
              </HStack>
            </VStack>
          </Card>

          {/* Section 2: Speech Recognition Models */}
          <Card
            padding={4}
            style={{
              backgroundColor: 'var(--color-background-card)',
              border: '1px solid var(--color-border)',
              borderRadius: '8px',
              boxShadow: 'var(--shadow-low)',
            }}
          >
            <VStack gap={3} width="100%">
              <HStack width="100%" vAlign="center" hAlign="between">
                <HStack gap={2} vAlign="center">
                  <div
                    style={{
                      width: '36px',
                      height: '36px',
                      borderRadius: '50%',
                      backgroundColor: 'var(--color-background-muted)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Icon icon={Cpu} size="sm" color="accent" />
                  </div>
                  <VStack gap={0.5}>
                    <Text type="body" weight="semibold" style={{ fontSize: '18px', color: 'var(--color-text-primary)' }}>
                      Speech Recognition Models
                    </Text>
                    <Text type="supporting" size="sm" color="secondary">
                      Models run 100% locally on your computer. Select an installed model or download new ones.
                    </Text>
                  </VStack>
                </HStack>
              </HStack>

              {errorMsg && (
                <Text type="supporting" style={{ color: 'var(--color-error)', fontWeight: 500 }}>
                  {errorMsg}
                </Text>
              )}

              {/* Models List */}
              <VStack gap={2} width="100%">
                {catalog.map((spec) => {
                  const st = statuses[spec.id];
                  const isInstalled = st?.isInstalled ?? false;
                  const isActive = st?.isActive ?? false;
                  const progress = progressMap[spec.id];
                  const isDownloading = progress && progress.pct < 100;

                  return (
                    <div
                      key={spec.id}
                      style={{
                        padding: '16px',
                        backgroundColor: isActive
                          ? 'var(--color-background-muted)'
                          : 'var(--color-background-card)',
                        border: isActive
                          ? '2px solid var(--color-accent)'
                          : '1px solid var(--color-border)',
                        borderRadius: '8px',
                        transition: 'all 0.2s ease',
                      }}
                    >
                      <VStack gap={2}>
                        <HStack width="100%" vAlign="center" hAlign="between">
                          <HStack gap={2} vAlign="center">
                            <Text type="label" weight="semibold" style={{ fontSize: '16px', color: 'var(--color-text-primary)' }}>
                              {spec.name}
                            </Text>
                            {isActive && (
                              <Badge variant="info" label="Active Model" />
                            )}
                          </HStack>
                          <HStack gap={1} vAlign="center">
                            <Icon icon={HardDrive} size="sm" color="secondary" />
                            <span
                              className="text-label-md"
                              style={{ color: 'var(--color-text-secondary)', fontVariantNumeric: 'tabular-nums' }}
                            >
                              ~{spec.sizeMb} MB
                            </span>
                          </HStack>
                        </HStack>

                        <Text type="supporting" size="sm" color="secondary">
                          {spec.description}
                        </Text>

                        {isDownloading && progress && (
                          <VStack gap={1} width="100%">
                            <HStack width="100%" hAlign="between">
                              <Text type="supporting" size="sm">
                                Downloading... {progress.pct}%
                              </Text>
                              <span className="text-label-md" style={{ color: 'var(--color-text-secondary)' }}>
                                {progress.speed} MB/s
                              </span>
                            </HStack>
                            <ProgressBar value={progress.pct} variant="accent" label="Download progress" />
                          </VStack>
                        )}

                        <HStack width="100%" hAlign="end" gap={2} paddingBlock={0.5}>
                          {isInstalled ? (
                            <>
                              {!isActive && (
                                <Button
                                  label="Use Model"
                                  icon={<Icon icon={Check} />}
                                  variant="primary"
                                  size="sm"
                                  style={{ borderRadius: '9999px', backgroundColor: 'var(--color-accent)' }}
                                  clickAction={() => handleSetActive(spec.id)}
                                />
                              )}
                              <IconButton
                                label="Delete model"
                                icon={<Icon icon={Trash2} color="secondary" />}
                                variant="ghost"
                                size="sm"
                                tooltip="Delete downloaded model files to free space"
                                onClick={() => handleDelete(spec.id)}
                              />
                            </>
                          ) : (
                            <Button
                              label={isDownloading ? 'Downloading...' : 'Download Model'}
                              icon={<Icon icon={Download} />}
                              variant="primary"
                              size="sm"
                              isDisabled={!!isDownloading}
                              style={{ borderRadius: '9999px', backgroundColor: 'var(--color-accent)' }}
                              clickAction={() => handleDownload(spec.id)}
                            />
                          )}
                        </HStack>
                      </VStack>
                    </div>
                  );
                })}
              </VStack>
            </VStack>
          </Card>

          {/* Section 3: Default Audio & Capture Defaults */}
          <Card
            padding={4}
            style={{
              backgroundColor: 'var(--color-background-card)',
              border: '1px solid var(--color-border)',
              borderRadius: '8px',
              boxShadow: 'var(--shadow-low)',
            }}
          >
            <VStack gap={3} width="100%">
              <HStack gap={2} vAlign="center">
                <HStack
                  vAlign="center"
                  hAlign="center"
                  width={36}
                  height={36}
                  style={{
                    borderRadius: '50%',
                    backgroundColor: 'var(--color-background-muted)',
                  }}
                >
                  <Icon icon={Mic} size="sm" color="accent" />
                </HStack>
                <VStack gap={0.5}>
                  <Text type="body" weight="semibold" style={{ fontSize: '18px', color: 'var(--color-text-primary)' }}>
                    Capture Defaults & Input Devices
                  </Text>
                  <Text type="supporting" size="sm" color="secondary">
                    Configure default input tracks, select active microphone, and test audio hardware.
                  </Text>
                </VStack>
              </HStack>

              <VStack gap={3} width="100%">
                <VStack gap={1} width="100%">
                  <Text type="label" size="sm" weight="semibold" color="secondary">
                    DEFAULT MICROPHONE DEVICE
                  </Text>
                  <AudioInputPicker inputs={inputs} />
                </VStack>

                <Divider />

                <HStack width="100%" vAlign="center" hAlign="between" paddingBlock={0.5}>
                  <HStack gap={1.5} vAlign="center">
                    <Icon icon={Mic} size="sm" color="secondary" />
                    <Text type="body" weight="medium">
                      Capture Microphone (You)
                    </Text>
                  </HStack>
                  <Switch label="Default Microphone" value={mic} onChange={setMic} size="sm" />
                </HStack>

                <Divider />

                <HStack width="100%" vAlign="center" hAlign="between" paddingBlock={0.5}>
                  <HStack gap={1.5} vAlign="center">
                    <Icon icon={Volume2} size="sm" color="secondary" />
                    <Text type="body" weight="medium">
                      Capture System Audio (Them)
                    </Text>
                  </HStack>
                  <Switch label="Default System Audio" value={system} onChange={setSystem} size="sm" />
                </HStack>

                <Divider />

                <HStack width="100%" vAlign="center" hAlign="between" paddingBlock={0.5}>
                  <HStack gap={1.5} vAlign="center">
                    <Icon icon={Users} size="sm" color="secondary" />
                    <Text type="body" weight="medium">
                      Separate Speakers (Speaker Diarization)
                    </Text>
                  </HStack>
                  <Switch label="Default Separate Speakers" value={diarize} onChange={setDiarize} size="sm" />
                </HStack>
              </VStack>
            </VStack>
          </Card>

          {/* Section 4: Privacy & Security */}
          <Card
            padding={4}
            style={{
              backgroundColor: 'var(--color-background-card)',
              border: '1px solid var(--color-border)',
              borderRadius: '8px',
              boxShadow: 'var(--shadow-low)',
            }}
          >
            <HStack gap={3} vAlign="center">
              <div
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '50%',
                  backgroundColor: 'var(--color-background-muted)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Icon icon={ShieldCheck} size="sm" color="accent" />
              </div>
              <VStack gap={0.5}>
                <Text type="body" weight="semibold" style={{ fontSize: '18px', color: 'var(--color-text-primary)' }}>
                  Local Privacy Assurance
                </Text>
                <Text type="supporting" size="sm" color="secondary">
                  Miniscribe operates strictly on your local device. Audio buffers, neural speech recognition, and transcripts are never sent to external servers or cloud services.
                </Text>
              </VStack>
            </HStack>
          </Card>

          {/* Section 5: Version & Updates. Checking is automatic once per
              launch; downloading never is — an update is a change to the app
              underneath someone who may be mid-meeting, so it waits to be
              asked for. */}
          <Card
            padding={4}
            style={{
              backgroundColor: 'var(--color-background-card)',
              border: '1px solid var(--color-border)',
              borderRadius: '8px',
              boxShadow: 'var(--shadow-low)',
            }}
          >
            <VStack gap={3} width="100%">
              <HStack width="100%" vAlign="center" hAlign="between" wrap="wrap" gap={3}>
                <HStack gap={2} vAlign="center">
                  <div
                    style={{
                      width: '36px',
                      height: '36px',
                      borderRadius: '50%',
                      backgroundColor: 'var(--color-background-muted)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Icon icon={RefreshCw} size="sm" color="accent" />
                  </div>
                  <VStack gap={0.5}>
                    <HStack gap={2} vAlign="center" wrap="wrap">
                      <Text type="body" weight="semibold" style={{ fontSize: '18px', color: 'var(--color-text-primary)' }}>
                        Version{updater.state.currentVersion ? ` ${updater.state.currentVersion}` : ''}
                      </Text>
                      <Badge variant={update.variant} label={update.label} />
                    </HStack>
                    <Text type="supporting" size="sm" color="secondary">
                      {update.detail}
                    </Text>
                    {checkedAt && (
                      <Text type="supporting" size="sm" color="disabled">
                        {checkedAt}
                      </Text>
                    )}
                  </VStack>
                </HStack>

                <HStack gap={2} vAlign="center" wrap="wrap">
                  <Button
                    label="Check for Updates"
                    icon={<Icon icon={RefreshCw} />}
                    variant="secondary"
                    size="sm"
                    isDisabled={
                      updater.state.stage === 'unsupported' ||
                      updater.state.stage === 'checking' ||
                      updater.state.stage === 'downloading'
                    }
                    isLoading={updater.state.stage === 'checking'}
                    style={{ borderRadius: '9999px' }}
                    clickAction={() => updater.check()}
                  />

                  {updater.state.stage === 'available' || updater.state.stage === 'downloading' ? (
                    <Button
                      label={
                        updater.state.stage === 'downloading'
                          ? `Downloading… ${updater.state.progressPct}%`
                          : `Download ${updater.state.newVersion ?? 'Update'}`
                      }
                      icon={<Icon icon={Download} />}
                      variant="primary"
                      size="sm"
                      isDisabled={updater.state.stage === 'downloading'}
                      isLoading={updater.state.stage === 'downloading'}
                      style={{ borderRadius: '9999px', backgroundColor: 'var(--color-accent)' }}
                      clickAction={() => updater.download()}
                    />
                  ) : null}

                  {updater.state.stage === 'downloaded' ? (
                    <Button
                      label="Restart & Install"
                      icon={<Icon icon={RotateCcw} />}
                      variant="primary"
                      size="sm"
                      tooltip="Closes Miniscribe and reopens it on the new version"
                      style={{ borderRadius: '9999px', backgroundColor: 'var(--color-accent)' }}
                      clickAction={() => updater.install()}
                    />
                  ) : null}
                </HStack>
              </HStack>

              {updater.state.stage === 'downloading' && (
                <VStack gap={1} width="100%">
                  <HStack width="100%" hAlign="between">
                    <Text type="supporting" size="sm">
                      Downloading version {updater.state.newVersion}… {updater.state.progressPct}%
                    </Text>
                    <span className="text-label-md" style={{ color: 'var(--color-text-secondary)' }}>
                      {updater.state.downloadSpeedMb} MB/s
                    </span>
                  </HStack>
                  <ProgressBar
                    value={updater.state.progressPct}
                    variant="accent"
                    label="Update download progress"
                  />
                </VStack>
              )}
            </VStack>
          </Card>
        </VStack>
      </VStack>
    </VStack>
  );
}
