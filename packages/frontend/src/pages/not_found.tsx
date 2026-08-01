/**
 * Not Found Page
 *
 * Accessible 404 page for unknown routes.
 *
 * @module frontend/pages/not_found
 */

import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

/**
 * Not Found page component.
 * Renders when user navigates to an unknown route.
 */
export function NotFoundPage(): ReactNode {
  return (
    <main className="not-found-page" role="main" aria-labelledby="not-found-title">
      <div className="not-found-page__content">
        <h1 id="not-found-title" className="not-found-page__title">
          404 - 找不到頁面
        </h1>
        <p className="not-found-page__description">您所尋找的頁面不存在或已被移除。</p>
        <nav aria-label="導航選項">
          <Link to="/" className="not-found-page__link">
            返回指揮台首頁
          </Link>
        </nav>
      </div>
    </main>
  );
}
