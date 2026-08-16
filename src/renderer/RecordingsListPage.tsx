import { useMemo, useState } from 'react';
import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { Banner } from '@astryxdesign/core/Banner';
import { Badge } from '@astryxdesign/core/Badge';
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
import { AudioLines, Calendar, Mic, Search, Trash2, User, Users, Volume2 } from 'lucide-react';
import type { Recording } from './use-session';

interface RecordingsListPageProps {
  recordings: Recording[];
  loadedRecordingId: string | null;
  isBusy: boolean;
  onOpenRecording: (id: string) => void;
  onRefreshRecordings: () => void;
  onNewRecording: () => void;
  /** Delete for good. The caller confirms nothing — this page asks first. */
  onDeleteRecording: (id: string) => void;
  /** The outcome of the last library action, to report where it happened. */
  notice: { ok: boolean; text: string } | null;
  onDismissNotice: () => void;
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
  onDeleteRecording,
  notice,
  onDismissNotice,
}: RecordingsListPageProps): React.ReactNode {
  const [searchQuery, setSearchQuery] = useState('');
  // The recording the user has asked to delete, held until they confirm. Null
  // means no question is on screen.
  const [pendingDelete, setPendingDelete] = useState<Recording | null>(null);

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

      {notice && (
        <Banner
          status={notice.ok ? 'success' : 'error'}
          container="section"
          title={notice.ok ? 'Done' : 'That did not work'}
          description={notice.text}
          isDismissable
          onDismiss={onDismissNotice}
        />
      )}

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
                    label="Record in the Mini Widget"
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
                  padding={4}
                  variant={isSelected ? 'muted' : 'default'}
                  isDisabled={isBusy}
                  onClick={() => onOpenRecording(rec.id)}
                  style={{
                    border: isSelected
                      ? '2px solid var(--color-accent)'
                      : '1px solid var(--color-border)',
                    borderRadius: '8px',
                    backgroundColor: isSelected
                      ? 'var(--color-background-muted)'
                      : 'var(--color-background-card)',
                    boxShadow: 'var(--shadow-low)',
                    transition: 'all 0.2s ease-in-out',
                    marginBottom: '8px',
                  }}
                >
                  <HStack width="100%" vAlign="center" hAlign="between" gap={3}>
                    <HStack gap={3} vAlign="center" style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          width: '40px',
                          height: '40px',
                          borderRadius: '50%',
                          backgroundColor: isSelected ? 'var(--color-accent)' : 'var(--color-background-muted)',
                          color: isSelected ? '#ffffff' : 'var(--color-accent)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                        }}
                      >
                        <Icon icon={AudioLines} size="sm" color="accent" />
                      </div>

                      <VStack gap={1} style={{ flex: 1, minWidth: 0 }}>
                        <HStack gap={2} vAlign="center" wrap="wrap">
                          <Text
                            type="body"
                            weight="semibold"
                            style={{ fontSize: '17px', color: 'var(--color-text-primary)' }}
                          >
                            {fmtWhen(rec.startedAt)}
                          </Text>
                          {isSelected && (
                            <Badge variant="info" label="Active Session" />
                          )}
                        </HStack>

                        <HStack gap={2} vAlign="center" wrap="wrap">
                          <HStack gap={1} vAlign="center">
                            <Icon icon={Calendar} size="sm" color="secondary" />
                            <span
                              className="text-label-md"
                              style={{ color: 'var(--color-text-secondary)', fontVariantNumeric: 'tabular-nums' }}
                            >
                              {fmtExactDate(rec.startedAt)}
                            </span>
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
                    </HStack>

                    <HStack gap={2} vAlign="center">
                      <div
                        style={{
                          padding: '6px 12px',
                          borderRadius: '6px',
                          backgroundColor: 'var(--color-background-muted)',
                          border: '1px solid var(--color-border)',
                        }}
                      >
                        <span
                          className="text-label-md"
                          style={{
                            color: 'var(--color-text-accent)',
                            fontWeight: 600,
                            fontVariantNumeric: 'tabular-nums',
                          }}
                        >
                          {fmtDuration(rec.seconds)}
                        </span>
                      </div>

                      {/* Inside a card that opens the recording, so the click
                          must stop here — otherwise asking to delete would
                          open the thing you are deleting behind the question. */}
                      <span
                        onClick={(e) => {
                          e.stopPropagation();
                          setPendingDelete(rec);
                        }}
                        onKeyDown={(e) => e.stopPropagation()}
                        style={{ display: 'inline-flex' }}
                      >
                        <IconButton
                          label={`Delete recording from ${fmtWhen(rec.startedAt)}`}
                          icon={<Icon icon={Trash2} size="sm" />}
                          variant="destructive"
                          size="sm"
                          isDisabled={isBusy}
                          tooltip="Delete this recording and its audio"
                        />
                      </span>
                    </HStack>
                  </HStack>
                </ClickableCard>
              );
            })
          )}
        </VStack>
      </VStack>

      {/* Destructive and irreversible: the audio is the only copy, and no
          transcript survives the directory it lives in. */}
      <AlertDialog
        isOpen={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title="Delete this recording?"
        description={
          pendingDelete
            ? `The audio and transcript from ${fmtWhen(
                pendingDelete.startedAt,
              )} (${fmtDuration(pendingDelete.seconds)}) will be deleted from this device. This cannot be undone.`
            : ''
        }
        actionLabel="Delete Recording"
        actionVariant="destructive"
        onAction={() => {
          if (pendingDelete) onDeleteRecording(pendingDelete.id);
          setPendingDelete(null);
        }}
      />
    </VStack>
  );
}
