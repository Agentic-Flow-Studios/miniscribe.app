import { EmptyState } from '@astryxdesign/core/EmptyState';
import { HStack } from '@astryxdesign/core/HStack';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Item } from '@astryxdesign/core/Item';
import { List } from '@astryxdesign/core/List';
import { Text } from '@astryxdesign/core/Text';
import { Toolbar } from '@astryxdesign/core/Toolbar';
import { VStack } from '@astryxdesign/core/VStack';
import type { Recording } from './use-session';

interface Props {
  recordings: Recording[];
  loaded: string | null;
  isBusy: boolean;
  onOpen: (id: string) => void;
  onRefresh: () => void;
}

function fmtDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m > 0 ? `${m}m ${s.toString().padStart(2, '0')}s` : `${s}s`;
}

// "Today 14:32" / "Yesterday 09:05" / "11 Aug 14:32". A bare ISO stamp is
// unreadable at a glance, and this list is scanned, not studied.
function fmtWhen(startedAt: string): string {
  const d = new Date(startedAt);
  if (Number.isNaN(d.getTime())) return startedAt;

  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const days = Math.floor((midnight.getTime() - d.getTime()) / 86_400_000) + 1;

  if (days <= 0) return `Today ${time}`;
  if (days === 1) return `Yesterday ${time}`;
  return `${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} ${time}`;
}

const TRACK_LABEL = { me: 'Me', them: 'Them' } as const;

export function Recordings({
  recordings,
  loaded,
  isBusy,
  onOpen,
  onRefresh,
}: Props): React.ReactNode {
  return (
    <VStack height="100%" gap={0}>
      <Toolbar
        label="Recordings"
        size="sm"
        startContent={
          <Text type="label" weight="semibold">
            Recordings
          </Text>
        }
        endContent={
          <IconButton
            label="Refresh recordings"
            icon={<Icon icon="arrowsUpDown" />}
            variant="ghost"
            size="sm"
            tooltip="Rescan the recordings folder"
            onClick={onRefresh}
          />
        }
      />

      {recordings.length === 0 ? (
        <EmptyState
          isCompact
          title="No recordings yet"
          description="Sessions you record are kept on disk and listed here."
        />
      ) : (
        <VStack isScrollable height="100%" paddingInline={1.5} paddingBlock={1} gap={0}>
          <List density="compact" hasDividers>
            {recordings.map((rec) => (
              <Item
                key={rec.id}
                as="li"
                data-testid={`recording-${rec.id}`}
                density="balanced"
                label={fmtWhen(rec.startedAt)}
                description={`${fmtDuration(rec.seconds)} · ${rec.tracks
                  .map((t) => TRACK_LABEL[t])
                  .join(' + ')}`}
                isSelected={loaded === rec.id}
                // Re-transcribing is seconds of CPU; a second click mid-run
                // would queue a duplicate pass behind the first.
                isDisabled={isBusy}
                onClick={() => onOpen(rec.id)}
              />
            ))}
          </List>
        </VStack>
      )}

      <HStack paddingInline={2} paddingBlock={1.5}>
        <Text type="supporting" color="secondary">
          Opening a recording re-runs transcription from its audio.
        </Text>
      </HStack>
    </VStack>
  );
}
