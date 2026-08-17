import { useCallback, useEffect, useState } from 'react';
import { Theme } from '@astryxdesign/core';
import { neutralTheme } from './theme/neutral';
import { AppLayout } from './AppLayout';
import { MiniWidget } from './MiniWidget';
import { RecordingPage } from './RecordingPage';
import { RecordingsListPage } from './RecordingsListPage';
import { SettingsPage, type ThemeMode } from './SettingsPage';
import { useAudioInputs } from './use-audio-inputs';
import { useSession } from './use-session';

export function App(): React.ReactNode {
  // Default launch state is mini widget
  const [viewMode, setViewMode] = useState<'main' | 'mini'>('mini');
  const [mainPage, setMainPage] = useState<'recordings' | 'recording' | 'settings'>('recordings');

  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('miniscribe.themeMode') : null;
    return saved === 'light' || saved === 'dark' ? saved : 'system';
  });

  const handleThemeModeChange = useCallback((mode: ThemeMode) => {
    setThemeMode(mode);
    try {
      localStorage.setItem('miniscribe.themeMode', mode);
    } catch {}
  }, []);

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
    isRecording,
    isPaused,
    isBusy,
    openTracks,
    levels,
    recordings,
    loadedRecording,
  } = session;

  // Null until the first answer comes back: "we don't know yet" is not the same
  // as "none installed", and the difference decides whether the transcript
  // panel offers to install one.
  const [hasModel, setHasModel] = useState<boolean | null>(null);

  const refreshModels = useCallback(async (): Promise<boolean> => {
    try {
      const list = await window.api.modelsList();
      const installed = list.some((m) => m.isInstalled);
      setHasModel(installed);
      return installed;
    } catch (err) {
      console.error('[models] list failed', err);
      return false;
    }
  }, []);

  useEffect(() => {
    window.api.onWindowModeChanged?.((mode) => {
      setViewMode(mode);
    });

    // No model means nothing can be transcribed, so the first run opens where
    // that is fixed rather than on a recording screen that cannot work.
    void refreshModels().then((installed) => {
      if (!installed) {
        setMainPage('settings');
        setViewMode('main');
        void window.api.windowSetMode('main');
      }
    });
  }, [refreshModels]);

  // The test outlives its own UI: the hook lives up here so a recording can
  // close it first, which also means switching the mic track off would leave it
  // running, holding the device, with nothing on screen to stop it.
  useEffect(() => {
    if (!mic) inputs.test.stop();
  }, [inputs.test, mic]);

  const switchWindowMode = useCallback((mode: 'main' | 'mini') => {
    setViewMode(mode);
    void window.api.windowSetMode(mode);
  }, []);

  const executeStartRecording = useCallback(() => {
    setMainPage('recording');
    inputs.test.stop();
    void session.start({ mic, system, micDeviceId: inputs.micConstraintId });
  }, [inputs.micConstraintId, inputs.test, mic, session, system]);

  const handleToggleRecord = useCallback(() => {
    if (hasModel === false) {
      setMainPage('settings');
      if (viewMode === 'mini') switchWindowMode('main');
      session.notify(false, 'Please download a Speech Recognition Model in Settings to start recording.');
      return;
    }

    if (isRecording) {
      // Stopping is the moment the transcript becomes the thing you want to
      // look at, so the app comes forward to show it — from the widget, that
      // means opening the main window on the session that just ended, rather
      // than leaving the result behind a second click.
      setMainPage('recording');
      if (viewMode === 'mini') switchWindowMode('main');
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
  }, [
    countdown,
    delayStartSeconds,
    diarize,
    executeStartRecording,
    hasModel,
    isRecording,
    numSpeakers,
    session,
    switchWindowMode,
    viewMode,
  ]);

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
    void session.openRecording(id, {
      diarize,
      numSpeakers,
      canTranscribe: hasModel !== false,
    });
  }, [diarize, hasModel, numSpeakers, session]);

  /**
   * Recording begins in one place: the widget.
   *
   * The main window used to carry its own setup — sources, mic test, a Start
   * button — which meant two ways to begin the same thing, each with its own
   * state to keep straight. "Record" here now clears the panel and hands over
   * to the widget, which is where the controls that matter during a meeting
   * already live.
   */
  const handleGoToWidget = useCallback(() => {
    if (hasModel === false) {
      setMainPage('settings');
      session.notify(false, 'Please download a speech model in Settings before opening the widget.');
      return;
    }
    if (!isRecording) session.newSession();
    switchWindowMode('mini');
  }, [hasModel, isRecording, session, switchWindowMode]);

  const handleDeleteRecording = useCallback(
    (id: string) => {
      // Leaving the page it was open on is part of the delete: staying would
      // show a transcript whose audio no longer exists.
      if (loadedRecording === id) setMainPage('recordings');
      void session.deleteRecording(id);
    },
    [loadedRecording, session],
  );

  const handleOpenSettings = useCallback(() => {
    setMainPage('settings');
    if (viewMode === 'mini') {
      switchWindowMode('main');
    }
  }, [switchWindowMode, viewMode]);

  return (
    <Theme theme={neutralTheme} mode={themeMode}>
      {viewMode === 'mini' ? (
        <MiniWidget
          isRecording={isRecording}
          isPaused={isPaused}
          onTogglePause={() => session.setPaused(!isPaused)}
          isBusy={isBusy}
          hasModel={hasModel}
          status={session.status}
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
          recordedSeconds={session.recordedSeconds}
          onToggleRecord={handleToggleRecord}
          onOpenRecordingsList={handleOpenRecordingsListFromMini}
          onExpandMainApp={() => switchWindowMode('main')}
          onOpenSettings={handleOpenSettings}
          isAlwaysOnTop={isAlwaysOnTop}
          onToggleAlwaysOnTop={handleToggleAlwaysOnTop}
          onCloseWindow={() => void window.api.windowClose()}
        />
      ) : (
        <AppLayout
          activePage={mainPage}
          isBusy={isBusy || isRecording}
          onGoToRecordings={() => setMainPage('recordings')}
          onGoToSettings={handleOpenSettings}
          onNewRecording={hasModel === false ? handleOpenSettings : handleGoToWidget}
          onSwitchToMiniMode={() => switchWindowMode('mini')}
          onMinimizeWindow={() => void window.api.windowMinimize()}
          onCloseWindow={() => void window.api.windowClose()}
        >
          {mainPage === 'recordings' ? (
            <RecordingsListPage
              recordings={recordings}
              loadedRecordingId={loadedRecording}
              isBusy={isBusy || isRecording}
              hasModel={hasModel}
              onOpenRecording={handleOpenRecording}
              onRefreshRecordings={() => void session.refreshRecordings()}
              onNewRecording={hasModel === false ? handleOpenSettings : handleGoToWidget}
              onGoToSettings={handleOpenSettings}
              onDeleteRecording={handleDeleteRecording}
              notice={session.notice}
              onDismissNotice={session.dismissNotice}
            />
          ) : mainPage === 'settings' ? (
            <SettingsPage
              mic={mic}
              setMic={setMic}
              system={system}
              setSystem={setSystem}
              diarize={diarize}
              setDiarize={setDiarize}
              inputs={inputs}
              themeMode={themeMode}
              onThemeModeChange={handleThemeModeChange}
              onModelsChanged={() => void refreshModels()}
              onGoToWidget={handleGoToWidget}
            />
          ) : (
            <RecordingPage
              session={session}
              diarize={diarize}
              setDiarize={setDiarize}
              numSpeakers={numSpeakers}
              setNumSpeakers={setNumSpeakers}
              hasModel={hasModel}
              onInstallModel={handleOpenSettings}
              onOpenWidget={handleGoToWidget}
              onDeleteRecording={handleDeleteRecording}
              onBackToRecordings={() => setMainPage('recordings')}
            />
          )}
        </AppLayout>
      )}
    </Theme>
  );
}
