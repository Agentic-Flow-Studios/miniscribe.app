import { useMemo, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { ClickableCard } from '@astryxdesign/core/ClickableCard';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { HStack } from '@astryxdesign/core/HStack';
import { Heading } from '@astryxdesign/core/Heading';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Section } from '@astryxdesign/core/Section';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { AudioLines, Calendar, Mic, Search, User, Users, Volume2 } from 'lucide-react';
import type { Recording } from './use-session';

interface RecordingsListPageProps {
  recordings: Recording[];
  loadedRecordingId: string | null;
  isBusy: boolean;
  onOpenRecording: (id: string) => void;
  onRefreshRecordings: () => void;
  onNewRecording: () => void;
}

/** The reading width of the list. Rows past this get hard to scan end to end. */
const LIST_MAX_WIDTH = 960;

function fmtDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.round(sec % 60);
  if (h > 0) return `${h}h ${m.toString().padStart(2, '0')}m`;
  return m > 0 ? `${m}m ${s.toString().padStart(2, '0')}s` : `${s}s`;
}

function fmtWhen(startedAt: string): string {
  const d = new Date(startedAt);
  if (Number.isNaN(d.getTime())) return startedAt;

  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const days = Math.floor((midnight.getTime() - d.getTime()) / 86_400_000) + 1;

  if (days <= 0) return `Today at ${time}`;
  if (days === 1) return `Yesterday at ${time}`;
  if (days < 7) return `${d.toLocaleDateString(undefined, { weekday: 'long' })} at ${time}`;
  return `${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} at ${time}`;
}

/** The unambiguous stamp, for the row's second line. */
function fmtExactDate(startedAt: string): string {
  const d = new Date(startedAt);
  if (Number.isNaN(d.getTime())) return startedAt;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

const TRACK_LABEL = { me: 'Microphone (You)', them: 'System Audio (Them)' } as const;

function participants(tracks: Recording['tracks']): string {
  const hasMe = tracks.includes('me');
  const hasThem = tracks.includes('them');
  if (hasMe && hasThem) return 'You + Them';
  if (hasThem) return 'Them only';
  return 'Just you';
}

export function RecordingsListPage({
  recordings,
  loadedRecordingId,
  isBusy,
  onOpenRecording,
  onRefreshRecordings,
  onNewRecording,
}: RecordingsListPageProps): React.ReactNode {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredRecordings = useMemo(() => {
    if (!searchQuery.trim()) return recordings;
    const q = searchQuery.toLowerCase();
    return recordings.filter(
      (rec) =>
        rec.id.toLowerCase().includes(q) ||
        fmtWhen(rec.startedAt).toLowerCase().includes(q) ||
        fmtExactDate(rec.startedAt).toLowerCase().includes(q) ||
        rec.tracks.some((t) => TRACK_LABEL[t].toLowerCase().includes(q)),
    );
  }, [recordings, searchQuery]);

  return (
    <VStack height="100%" minHeight={0} gap={0}>
      {/* Page header + toolbar. Outside the scroll region so the search box and
          the count stay put while the list moves under them. */}
      <Section variant="transparent" padding={5} paddingBlock={4}>
        <VStack maxWidth={LIST_MAX_WIDTH} gap={4}>
          <VStack gap={1}>
            <Heading level={1}>Recordings</Heading>
            <Text type="supporting" color="secondary">
              {recordings.length} {recordings.length === 1 ? 'session' : 'sessions'} captured on
              this device
            </Text>
          </VStack>

          <HStack width="100%" vAlign="center" hAlign="between" wrap="wrap" gap={2}>
            <HStack
              gap={2}
              vAlign="center"
              paddingInline={2}
              paddingBlock={1}
              width="100%"
              maxWidth={360}
              style={{
                backgroundColor: 'var(--color-background-muted)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-element)',
              }}
            >
              <Icon icon={Search} size="sm" color="secondary" />
              <input
                type="text"
                placeholder="Search by date or track…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label="Search recordings"
                style={{
                  border: 'none',
                  outline: 'none',
                  background: 'transparent',
                  color: 'var(--color-text-primary)',
                  font: 'inherit',
                  fontSize: 'var(--font-size-base)',
                  width: '100%',
                }}
              />
            </HStack>

            {/* Starting a recording lives in the nav rail and the mini widget —
                one Record button per surface, always in the same place. */}
            <IconButton
              label="Refresh list"
              icon={<Icon icon="arrowsUpDown" />}
              variant="ghost"
              size="sm"
              tooltip="Refresh recordings list"
              onClick={onRefreshRecordings}
            />
          </HStack>
        </VStack>
      </Section>

      {/* Flex-sized, not height:100% — the latter is 100% of the page in
          ADDITION to the header above it, which pushes the last row past the
          bottom of the window. */}
      <VStack
        isScrollable
        minHeight={0}
        paddingInline={5}
        paddingBlock={1}
        gap={0}
        style={{ flex: 1 }}
      >
        <VStack maxWidth={LIST_MAX_WIDTH} gap={2} paddingBlock={2}>
          {filteredRecordings.length === 0 ? (
            <EmptyState
              title={searchQuery ? 'No matching recordings' : 'No recordings yet'}
              description={
                searchQuery
                  ? 'Try adjusting your search query.'
                  : 'Start a recording session to capture meeting transcripts locally.'
              }
              icon={<Icon icon={Volume2} size="lg" />}
              actions={
                !searchQuery ? (
                  <Button
                    label="Set Up Your First Recording"
                    icon={<Icon icon={Mic} />}
                    variant="primary"
                    clickAction={onNewRecording}
                  />
                ) : undefined
              }
            />
          ) : (
            filteredRecordings.map((rec) => {
              const isSelected = loadedRecordingId === rec.id;
              const isSolo = rec.tracks.length === 1;
              return (
                <ClickableCard
                  key={rec.id}
                  label={`Open recording from ${fmtWhen(rec.startedAt)}`}
                  padding={3}
                  variant={isSelected ? 'muted' : 'default'}
                  isDisabled={isBusy}
                  onClick={() => onOpenRecording(rec.id)}
                >
                  <VStack gap={1.5}>
                    <HStack width="100%" vAlign="center" hAlign="between" gap={2}>
                      <HStack gap={1.5} vAlign="center">
                        <Icon icon={AudioLines} size="sm" color="accent" />
                        <Text type="body" weight="semibold">
                          {fmtWhen(rec.startedAt)}
                        </Text>
                        {isSelected && (
                          <Text type="label" size="sm" color="accent" weight="semibold">
                            Active
                          </Text>
                        )}
                      </HStack>
                      <Text type="label" size="sm" color="secondary">
                        {fmtDuration(rec.seconds)}
                      </Text>
                    </HStack>

                    <HStack gap={2} vAlign="center" wrap="wrap">
                      <HStack gap={1} vAlign="center">
                        <Icon icon={Calendar} size="sm" color="secondary" />
                        <Text type="supporting" size="sm" color="secondary">
                          {fmtExactDate(rec.startedAt)}
                        </Text>
                      </HStack>
                      <Text type="supporting" size="sm" color="disabled">
                        •
                      </Text>
                      <HStack gap={1} vAlign="center">
                        <Icon icon={isSolo ? User : Users} size="sm" color="secondary" />
                        <Text type="supporting" size="sm" color="secondary">
                          {participants(rec.tracks)}
                        </Text>
                      </HStack>
                    </HStack>
                  </VStack>
                </ClickableCard>
              );
            })
          )}
        </VStack>
      </VStack>
    </VStack>
  );
}
