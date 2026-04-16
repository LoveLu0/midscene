import { PlaygroundSDK } from '@midscene/playground';
import type { FormValue } from '@midscene/visualizer';
import { UniversalPlayground } from '@midscene/visualizer';
import { useEnvConfig } from '@midscene/visualizer';
import { Input, Popover, Switch, Tooltip, message } from 'antd';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getExtensionVersion } from '../../utils/chrome';
import './index.less';

declare const __SDK_VERSION__: string;

const DEEP_THINKING_ENABLED_KEY = 'midscene-deep-thinking-enabled';
const DEEP_THINKING_API_URL_KEY = 'midscene-deep-thinking-api-url';

export interface PlaygroundProps {
  getAgent: (forceSameTabNavigation?: boolean) => any | null;
  showContextPreview?: boolean;
  dryMode?: boolean;
}

// Browser Extension Playground Component using Universal Playground
export function BrowserExtensionPlayground({
  getAgent,
  showContextPreview = true,
  dryMode = false,
}: PlaygroundProps) {
  const extensionVersion = getExtensionVersion();
  const { forceSameTabNavigation } = useEnvConfig((state) => ({
    forceSameTabNavigation: state.forceSameTabNavigation,
  }));

  // Check if run button should be enabled - but DON'T call getAgent yet
  const { config } = useEnvConfig();
  const runEnabled = !!getAgent && Object.keys(config || {}).length >= 1;

  // Deep thinking toggle state
  const [deepThinkingEnabled, setDeepThinkingEnabled] = useState(() => {
    return localStorage.getItem(DEEP_THINKING_ENABLED_KEY) === 'true';
  });
  const [deepThinkingLoading, setDeepThinkingLoading] = useState(false);
  const [deepThinkingApiUrl, setDeepThinkingApiUrl] = useState(() => {
    return localStorage.getItem(DEEP_THINKING_API_URL_KEY) || '';
  });
  const [showApiUrlInput, setShowApiUrlInput] = useState(false);

  // Persist deep thinking toggle state
  const handleDeepThinkingChange = useCallback((checked: boolean) => {
    setDeepThinkingEnabled(checked);
    localStorage.setItem(DEEP_THINKING_ENABLED_KEY, String(checked));
    if (checked && !localStorage.getItem(DEEP_THINKING_API_URL_KEY)) {
      setShowApiUrlInput(true);
    }
  }, []);

  // Save API URL
  const handleApiUrlSave = useCallback((url: string) => {
    setDeepThinkingApiUrl(url);
    localStorage.setItem(DEEP_THINKING_API_URL_KEY, url);
    setShowApiUrlInput(false);
  }, []);

  // Deep thinking pre-processing: sends user input to external service,
  // receives transformed input, and uses it for the actual execution.
  const onBeforeRun = useCallback(
    async (value: FormValue): Promise<FormValue> => {
      if (!deepThinkingEnabled) return value;

      const apiUrl = deepThinkingApiUrl;
      if (!apiUrl) {
        setShowApiUrlInput(true);
        throw new Error('Please configure the deep thinking API URL first');
      }

      const userInput = value.prompt || '';
      if (!userInput.trim()) return value;

      setDeepThinkingLoading(true);
      try {
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            input: userInput,
            type: value.type,
            params: value.params,
          }),
        });

        if (!response.ok) {
          throw new Error(
            `Deep thinking service returned ${response.status}: ${response.statusText}`,
          );
        }

        const data = await response.json();
        // The service returns a new prompt to replace the original user input
        const transformedPrompt = data.output || data.prompt || data.result;
        if (!transformedPrompt) {
          throw new Error('Deep thinking service returned empty result');
        }

        message.success('Deep thinking completed');
        return { ...value, prompt: transformedPrompt };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        message.error(`Deep thinking failed: ${errorMsg}`);
        throw error;
      } finally {
        setDeepThinkingLoading(false);
      }
    },
    [deepThinkingEnabled, deepThinkingApiUrl],
  );

  // Track active tab to trigger SDK recreation on tab change
  const [activeTabId, setActiveTabId] = useState<number | null>(null);
  useEffect(() => {
    const updateActiveTab = () => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        setActiveTabId(tabs[0]?.id ?? null);
      });
    };
    updateActiveTab();
    chrome.tabs.onActivated.addListener(updateActiveTab);
    return () => chrome.tabs.onActivated.removeListener(updateActiveTab);
  }, []);

  // Create SDK when needed - recreate on tab change
  const playgroundSDK = useMemo(() => {
    if (!runEnabled || activeTabId === null) {
      return null;
    }

    try {
      return new PlaygroundSDK({
        type: 'local-execution',
        agentFactory: () => getAgent(forceSameTabNavigation),
      });
    } catch (error) {
      console.error('Failed to initialize PlaygroundSDK:', error);
      return null;
    }
  }, [runEnabled, getAgent, forceSameTabNavigation, activeTabId]);

  // Progress callback handling is now managed in usePlaygroundExecution hook
  // No need to override onProgressUpdate here

  // Context provider - delay creation until actually needed
  const contextProvider = useMemo(() => {
    if (!showContextPreview) {
      return undefined;
    }

    // Return a lazy context provider that only creates agent when needed
    return {
      async getUIContext() {
        try {
          const agent = getAgent(forceSameTabNavigation);
          if (!agent) {
            throw new Error('Please configure AI settings first');
          }
          return agent.page.screenshot();
        } catch (error) {
          console.warn('Failed to get UI context:', error);
          // Return null context instead of throwing to allow UI to initialize
          return null;
        }
      },
      async refreshContext() {
        try {
          const agent = getAgent(forceSameTabNavigation);
          if (!agent) {
            throw new Error('Please configure AI settings first');
          }
          return agent.page.screenshot();
        } catch (error) {
          console.warn('Failed to refresh context:', error);
          // Return null context instead of throwing to allow UI to initialize
          return null;
        }
      },
    };
  }, [showContextPreview, getAgent, forceSameTabNavigation]);

  // API URL input ref for auto-focus
  const apiUrlInputRef = useRef<string>(deepThinkingApiUrl);

  // Deep thinking toggle + API URL popover rendered after the "more" dropdown
  const deepThinkingToolbar = useMemo(
    () => (
      <div className="deep-thinking-toolbar">
        <Popover
          content={
            <div className="deep-thinking-api-config">
              <div style={{ marginBottom: 8, fontSize: 12, color: '#666' }}>
                Deep Thinking API URL
              </div>
              <Input
                placeholder="https://your-service.com/api/think"
                defaultValue={deepThinkingApiUrl}
                onChange={(e) => {
                  apiUrlInputRef.current = e.target.value;
                }}
                onPressEnter={() => {
                  handleApiUrlSave(apiUrlInputRef.current);
                }}
                style={{ width: 280 }}
                size="small"
              />
              <div
                style={{
                  marginTop: 8,
                  display: 'flex',
                  justifyContent: 'flex-end',
                }}
              >
                <button
                  type="button"
                  onClick={() => {
                    handleApiUrlSave(apiUrlInputRef.current);
                  }}
                  style={{
                    padding: '2px 12px',
                    fontSize: 12,
                    cursor: 'pointer',
                    border: '1px solid #d9d9d9',
                    borderRadius: 4,
                    background: '#fff',
                  }}
                >
                  Save
                </button>
              </div>
            </div>
          }
          trigger="click"
          open={showApiUrlInput}
          onOpenChange={setShowApiUrlInput}
          placement="bottom"
        >
          <Tooltip
            title={
              deepThinkingEnabled
                ? `Deep Thinking ON${deepThinkingApiUrl ? ` (${deepThinkingApiUrl})` : ''}`
                : 'Deep Thinking OFF'
            }
          >
            <div className="deep-thinking-switch-wrapper">
              <Switch
                size="small"
                checked={deepThinkingEnabled}
                onChange={handleDeepThinkingChange}
                loading={deepThinkingLoading}
              />
              <span
                className={`deep-thinking-label ${deepThinkingEnabled ? 'active' : ''}`}
                onClick={() => {
                  if (deepThinkingEnabled) {
                    setShowApiUrlInput((prev) => !prev);
                  }
                }}
                onKeyDown={() => {}}
              >
                Deep Think
              </span>
            </div>
          </Tooltip>
        </Popover>
      </div>
    ),
    [
      deepThinkingEnabled,
      deepThinkingLoading,
      deepThinkingApiUrl,
      showApiUrlInput,
      handleDeepThinkingChange,
      handleApiUrlSave,
    ],
  );

  return (
    <UniversalPlayground
      playgroundSDK={playgroundSDK}
      contextProvider={contextProvider}
      config={{
        showContextPreview,
        layout: 'vertical',
        showVersionInfo: true,
        enableScrollToBottom: true,
        showEnvConfigReminder: true,
      }}
      branding={{
        title: 'Playground',
        version: `${extensionVersion}(SDK v${__SDK_VERSION__})`,
      }}
      className="chrome-extension-playground"
      dryMode={dryMode}
      extraToolbarContent={deepThinkingToolbar}
      onBeforeRun={onBeforeRun}
    />
  );
}

export default BrowserExtensionPlayground;
