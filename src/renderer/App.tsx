import { useCallback, useEffect, useState } from 'react';
import { AppLayout } from './AppLayout';
import { MiniWidget } from './MiniWidget';
import { ModelManagerModal } from './ModelManagerModal';
import { RecordingPage } from './RecordingPage';
import { RecordingsListPage } from './RecordingsListPage';
import { useAudioInputs } from './use-audio-inputs';
import { useSession } from './use-session';

export function App(): React.ReactNode {
  // Default launch state is mini widget
  const [viewMode, setViewMode] = useState<'main' | 'mini'>('mini');
  const [mainPage, setMainPage] = useState<'recordings' | 'recording'>('recordings');
  const [modelsModalOpen, setModelsModalOpen] = useState(false);

  const [mic, setMic] = useState(true);
  const [system, setSystem] = useState(true);
  const [diarize, setDiarize] = useState(false);
  const [numSpeakers, setNumSpeakers] = useState(0);

  const [delayStartSeconds, setDelayStartSeconds] = useState(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [isAlwaysOnTop, setIsAlwaysOnTop] = useState(true);

  const inputs = useAudioInputs();
  const session = useSession();
  const {
    status,
    isRecording,
    isBusy,
    openTracks,
    levels,
    recordings,
    loadedRecording,
  } = session;

  useEffect(() => {
    window.api.onWindowModeChanged?.((mode) => {
      setViewMode(mode);
    });

    // Check if any speech models are installed on launch
    void window.api.modelsList?.().then((list) => {
      const hasInstalled = list.some((m) => m.isInstalled);
      if (!hasInstalled) {
        setModelsModalOpen(true);
        setViewMode('main');
        void window.api.windowSetMode('main');
      }
    });
  }, []);

  // The test outlives its own UI: the hook lives up here so a recording can
  // close it first, which also means switching the mic track off would leave it
  // running, holding the device, with nothing on screen to stop it.
  useEffect(() => {
    if (!mic) inputs.test.stop();
  }, [inputs.test, mic]);

  const executeStartRecording = useCallback(() => {
    setMainPage('recording');
    // Before the recorder asks for the device, not after: a mic still open for
    // testing can refuse to open a second time, and that failure would land as
    // a lost take rather than an obvious mistake.
    inputs.test.stop();
    void session.start({ mic, system, micDeviceId: inputs.micConstraintId });
  }, [inputs.micConstraintId, inputs.test, mic, session, system]);

  const handleToggleRecord = useCallback(() => {
    if (isRecording) {
      void session.stop({ diarize, numSpeakers });
    } else if (countdown !== null) {
      setCountdown(null);
    } else if (delayStartSeconds > 0) {
      setCountdown(delayStartSeconds);
      let current = delayStartSeconds;
      const timer = setInterval(() => {
        current -= 1;
        if (current <= 0) {
          clearInterval(timer);
          setCountdown(null);
          executeStartRecording();
        } else {
          setCountdown(current);
        }
      }, 1000);
    } else {
      executeStartRecording();
    }
  }, [countdown, delayStartSeconds, diarize, executeStartRecording, isRecording, numSpeakers, session]);

  const switchWindowMode = useCallback((mode: 'main' | 'mini') => {
    setViewMode(mode);
    void window.api.windowSetMode(mode);
  }, []);

  const handleToggleAlwaysOnTop = useCallback(() => {
    const next = !isAlwaysOnTop;
    setIsAlwaysOnTop(next);
    void window.api.windowSetAlwaysOnTop(next);
  }, [isAlwaysOnTop]);

  const handleOpenRecordingsListFromMini = useCallback(() => {
    setMainPage('recordings');
    switchWindowMode('main');
  }, [switchWindowMode]);

  const handleOpenRecording = useCallback((id: string) => {
    setMainPage('recording');
    void session.openRecording(id, { diarize, numSpeakers });
  }, [diarize, numSpeakers, session]);

  // Opens the capture page ready to record — it does NOT start recording. The
  // sources, the microphone, and whether it is working are all choices worth
  // making before the take begins, not after it has already missed them.
  const handleNewRecording = useCallback(() => {
    setMainPage('recording');
    session.newSession();
  }, [session]);

  const handleOpenModelsModal = useCallback(() => {
    setModelsModalOpen(true);
    if (viewMode === 'mini') {
      switchWindowMode('main');
    }
  }, [switchWindowMode, viewMode]);

  return (
    <>
      {viewMode === 'mini' ? (
        <MiniWidget
          isRecording={isRecording}
          isBusy={isBusy}
          mic={mic}
          setMic={setMic}
          system={system}
          setSystem={setSystem}
          diarize={diarize}
          setDiarize={setDiarize}
          inputs={inputs}
          delayStartSeconds={delayStartSeconds}
          setDelayStartSeconds={setDelayStartSeconds}
          countdown={countdown}
          openTracks={openTracks}
          levels={levels}
          statusText={status.text}
          onToggleRecord={handleToggleRecord}
          onOpenRecordingsList={handleOpenRecordingsListFromMini}
          onExpandMainApp={() => switchWindowMode('main')}
          onOpenModelsModal={handleOpenModelsModal}
          isAlwaysOnTop={isAlwaysOnTop}
          onToggleAlwaysOnTop={handleToggleAlwaysOnTop}
          onCloseWindow={() => void window.api.windowClose()}
        />
      ) : (
        <AppLayout
          activePage={mainPage}
          isBusy={isBusy || isRecording}
          onGoToRecordings={() => setMainPage('recordings')}
          onNewRecording={handleNewRecording}
          onOpenModelsModal={handleOpenModelsModal}
          onSwitchToMiniMode={() => switchWindowMode('mini')}
          onMinimizeWindow={() => void window.api.windowMinimize()}
          onCloseWindow={() => void window.api.windowClose()}
        >
          {mainPage === 'recordings' ? (
            <RecordingsListPage
              recordings={recordings}
              loadedRecordingId={loadedRecording}
              isBusy={isBusy || isRecording}
              onOpenRecording={handleOpenRecording}
              onRefreshRecordings={() => void session.refreshRecordings()}
              onNewRecording={handleNewRecording}
            />
          ) : (
            <RecordingPage
              session={session}
              mic={mic}
              setMic={setMic}
              system={system}
              setSystem={setSystem}
              diarize={diarize}
              setDiarize={setDiarize}
              numSpeakers={numSpeakers}
              setNumSpeakers={setNumSpeakers}
              inputs={inputs}
              onBackToRecordings={() => setMainPage('recordings')}
            />
          )}
        </AppLayout>
      )}

      <ModelManagerModal
        isOpen={modelsModalOpen}
        onClose={() => setModelsModalOpen(false)}
      />
    </>
  );
}
