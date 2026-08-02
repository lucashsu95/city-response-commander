/**
 * Configuration Error Display
 *
 * Renders accessible error screen when runtime configuration fails.
 * Application does not crash; displays clear error information.
 *
 * @module frontend/components/system/configuration_error
 */

import type { ReactNode } from 'react';
import type { RuntimeConfigError } from '../../config/runtime_config.js';

export interface ConfigurationErrorScreenProps {
  /** Configuration validation errors */
  readonly errors: readonly RuntimeConfigError[];
}

/**
 * Full-screen configuration error display.
 * Renders instead of application when config validation fails.
 */
export function ConfigurationErrorScreen({ errors }: ConfigurationErrorScreenProps): ReactNode {
  return (
    <main
      className="config-error-screen"
      role="alert"
      aria-live="assertive"
      aria-labelledby="config-error-title"
    >
      <div className="config-error-screen__content">
        <h1 id="config-error-title" className="config-error-screen__title">
          應用程式設定錯誤
        </h1>
        <p className="config-error-screen__description">
          無法啟動應用程式，因為缺少或無效的環境設定。請聯繫系統管理員。
        </p>

        <section aria-labelledby="error-list-title">
          <h2 id="error-list-title" className="config-error-screen__subtitle">
            設定問題
          </h2>
          <ul className="config-error-screen__error-list" role="list">
            {errors.map((error, index) => (
              <li key={index} className="config-error-screen__error-item">
                <span className="config-error-screen__error-code">{error.code}</span>
                <span className="config-error-screen__error-message">{error.message}</span>
              </li>
            ))}
          </ul>
        </section>

        <footer className="config-error-screen__footer">
          <p>
            環境變數需在建置時正確設定。請確認 <code>VITE_API_ENDPOINT</code>、
            <code>VITE_WS_ENDPOINT</code> 及 <code>VITE_APP_ENV</code> 皆已設定。
          </p>
        </footer>
      </div>
    </main>
  );
}
