import { useEffect, useState } from 'react';
import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { HStack } from '@astryxdesign/core/HStack';
import { Heading } from '@astryxdesign/core/Heading';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { ProgressBar } from '@astryxdesign/core/ProgressBar';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { Check, Cpu, Download, HardDrive, Trash2, X } from 'lucide-react';
import type { ModelSpec, ModelStatus } from './use-session';

interface ModelManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ModelManagerModal({
  isOpen,
  onClose,
}: ModelManagerModalProps): React.ReactNode {
  const [catalog, setCatalog] = useState<ModelSpec[]>([]);
  const [statuses, setStatuses] = useState<Record<string, ModelStatus>>({});
  const [progressMap, setProgressMap] = useState<
    Record<string, { pct: number; speed: number }>
  >({});
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

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
    if (isOpen) {
      void loadData();
    }
  }, [isOpen]);

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

  if (!isOpen) return null;

  const handleDownload = async (id: string) => {
    setErrorMsg(null);
    try {
      setProgressMap((prev) => ({ ...prev, [id]: { pct: 1, speed: 0 } }));
      const updated = await window.api.modelsDownload(id);
      const map: Record<string, ModelStatus> = {};
      for (const s of updated) map[s.id] = s;
      setStatuses(map);
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

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(12px)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
      }}
    >
      <Card
        padding={4}
        style={{
          width: '100%',
          maxWidth: '560px',
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: 'var(--color-surface-elevated, #1c1c1e)',
          border: '1px solid var(--color-border-subtle, rgba(255, 255, 255, 0.15))',
          borderRadius: '16px',
          boxShadow: '0 16px 48px rgba(0, 0, 0, 0.7)',
        }}
      >
        <VStack gap={3} width="100%">
          {/* Header */}
          <HStack width="100%" vAlign="center" hAlign="between">
            <HStack gap={1.5} vAlign="center">
              <Icon icon={Cpu} color="accent" size="md" />
              <Heading level={3}>Speech Recognition Models</Heading>
            </HStack>
            <IconButton
              label="Close"
              icon={<Icon icon={X} />}
              variant="ghost"
              size="sm"
              onClick={onClose}
            />
          </HStack>

          <Text type="supporting" color="secondary">
            Select or download local speech-to-text models. Models run 100% on-device.
          </Text>

          {errorMsg && (
            <Text type="supporting" style={{ color: '#ff453a' }}>
              {errorMsg}
            </Text>
          )}

          {/* Model Cards List */}
          <VStack isScrollable gap={2} style={{ maxHeight: '360px', paddingRight: '4px' }}>
            {catalog.map((spec) => {
              const st = statuses[spec.id];
              const isInstalled = st?.isInstalled ?? false;
              const isActive = st?.isActive ?? false;
              const progress = progressMap[spec.id];
              const isDownloading = progress && progress.pct < 100;

              return (
                <Card
                  key={spec.id}
                  padding={3}
                  style={{
                    backgroundColor: isActive
                      ? 'var(--color-surface-base, #27272a)'
                      : 'var(--color-surface-elevated, #18181b)',
                    borderColor: isActive
                      ? 'var(--color-brand-primary, #0a84ff)'
                      : 'var(--color-border-subtle, rgba(255, 255, 255, 0.1))',
                    borderRadius: '12px',
                  }}
                >
                  <VStack gap={2}>
                    <HStack width="100%" vAlign="center" hAlign="between">
                      <HStack gap={1.5} vAlign="center">
                        <Text type="label" weight="bold">
                          {spec.name}
                        </Text>
                        {isActive && (
                          <Badge variant="neutral" label="Active Model" />
                        )}
                      </HStack>
                      <HStack gap={1} vAlign="center">
                        <Icon icon={HardDrive} size="sm" color="secondary" />
                        <Text type="supporting" size="sm">
                          ~{spec.sizeMb} MB
                        </Text>
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
                          <Text type="supporting" size="sm" color="secondary">
                            {progress.speed} MB/s
                          </Text>
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
                              variant="secondary"
                              size="sm"
                              clickAction={() => handleSetActive(spec.id)}
                            />
                          )}
                          <IconButton
                            label="Delete model"
                            icon={<Icon icon={Trash2} color="secondary" />}
                            variant="ghost"
                            size="sm"
                            tooltip="Delete downloaded files to free space"
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
                          clickAction={() => handleDownload(spec.id)}
                        />
                      )}
                    </HStack>
                  </VStack>
                </Card>
              );
            })}
          </VStack>

          {/* Footer Action */}
          <HStack width="100%" hAlign="end" paddingBlock={2}>
            <Button label="Done" variant="secondary" clickAction={onClose} />
          </HStack>
        </VStack>
      </Card>
    </div>
  );
}
