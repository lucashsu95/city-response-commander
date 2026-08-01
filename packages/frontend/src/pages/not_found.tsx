/**
 * Not Found Page
 *
 * Accessible 404 page for unknown routes.
 *
 * @module frontend/pages/not_found
 */

import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../i18n/index.js';

/**
 * Not Found page component.
 * Renders when user navigates to an unknown route.
 */
export function NotFoundPage(): ReactNode {
  const { t } = useI18n();
  return (
    <main className="not-found-page" role="main" aria-labelledby="not-found-title">
      <div className="not-found-page__content">
        <h1 id="not-found-title" className="not-found-page__title">
          {t('notFound.title')}
        </h1>
        <p className="not-found-page__description">{t('notFound.description')}</p>
        <nav aria-label="導航選項">
          <Link to="/" className="not-found-page__link">
            {t('notFound.link')}
          </Link>
        </nav>
      </div>
    </main>
  );
}
