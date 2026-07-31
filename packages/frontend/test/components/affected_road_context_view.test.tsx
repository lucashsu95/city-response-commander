/**
 * AffectedRoadContextView Component Tests (TASK-121)
 *
 * Verifies the canonical AffectedRoadContext fields are displayed verbatim and
 * that a null input renders the formal empty state.
 *
 * Fixtures instantiate canonical contract objects for testing only; they are
 * never used as runtime production data.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { displayAndContextOnlyAffectedRoadContext } from '@city-commander/shared-schemas';
import type { AffectedRoadContext } from '@city-commander/shared-schemas';
import { AffectedRoadContextView } from '../../src/components/decision/affected_road_context_view.js';

// Built through the canonical factory, so the HG-001 defaults are not
// hand-authored by the frontend.
const context: AffectedRoadContext = displayAndContextOnlyAffectedRoadContext('RD_TPE_004');

describe('AffectedRoadContextView', () => {
  it('displays the DISPLAY_AND_CONTEXT_ONLY role', () => {
    render(<AffectedRoadContextView context={context} />);
    expect(screen.getByText('角色')).toBeInTheDocument();
    expect(screen.getByText('DISPLAY_AND_CONTEXT_ONLY')).toBeInTheDocument();
  });

  it('displays mandatory_action = false', () => {
    render(<AffectedRoadContextView context={context} />);
    const term = screen.getByText('強制處置');
    expect(term).toBeInTheDocument();
    expect(term.parentElement?.textContent).toContain('否');
  });

  it('displays enters_ete_set = false', () => {
    render(<AffectedRoadContextView context={context} />);
    const term = screen.getByText('納入 ETE 集合');
    expect(term).toBeInTheDocument();
    expect(term.parentElement?.textContent).toContain('否');
  });

  it('displays triggers_article1_or_2 = false', () => {
    render(<AffectedRoadContextView context={context} />);
    const term = screen.getByText('觸發第一或第二條');
    expect(term).toBeInTheDocument();
    expect(term.parentElement?.textContent).toContain('否');
  });

  it('displays guidance_id = HG-001', () => {
    render(<AffectedRoadContextView context={context} />);
    expect(screen.getByText('指引依據')).toBeInTheDocument();
    expect(screen.getByText('HG-001')).toBeInTheDocument();
  });

  it('displays the affected road identifier', () => {
    render(<AffectedRoadContextView context={context} />);
    expect(screen.getByText('路段代號')).toBeInTheDocument();
    expect(screen.getByText('RD_TPE_004')).toBeInTheDocument();
  });

  it('renders a fallback label when affected_road is null', () => {
    const withoutRoad: AffectedRoadContext = displayAndContextOnlyAffectedRoadContext(null);
    render(<AffectedRoadContextView context={withoutRoad} />);
    expect(screen.getByText('路段代號').parentElement?.textContent).toContain('未提供');
  });

  it('renders the formal empty state for null input', () => {
    render(<AffectedRoadContextView context={null} />);
    expect(screen.getByText('尚無可顯示的受影響道路資訊')).toBeInTheDocument();
    expect(screen.queryByText('角色')).not.toBeInTheDocument();
  });
});
