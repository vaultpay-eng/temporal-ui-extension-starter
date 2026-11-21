// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FAMILY_HIDDEN_CLASS, FAMILY_TOGGLE_CLASS } from '../../src/decoration';
import { clearFamilyDisclosure, familyParents, syncFamilyDisclosure } from '../../src/family/disclosure';
import { findPlacement, indexPlacements, normalizeExecutions } from '../../src/family/rows';
import { buildTree } from '../../src/family/tree';
import { idsFromRow, removeAllDecoration, visibleRows } from '../../src/render';

const run = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`;
const execution = (workflowId: string, runId: string, parentExecution?: { workflowId: string; runId: string }) => ({
    execution: { workflowId, runId },
    parentExecution,
});

const rows = buildTree(normalizeExecutions([
    execution('parent', run(1)),
    execution('child', run(2), { workflowId: 'parent', runId: run(1) }),
    execution('grandchild', run(3), { workflowId: 'child', runId: run(2) }),
    execution('sibling', run(4), { workflowId: 'parent', runId: run(1) }),
    execution('parent', run(5)),
    execution('orphans-parent', run(6)),
    execution('orphan-in-table', run(7), { workflowId: 'orphans-parent', runId: run(6) }),
]));
const placements = indexPlacements(rows, (row, sequence) => ({
    row, sequence, depth: row.depth, segments: row.segments,
}));
const lookup = (workflowId: string, runId: string | null) => findPlacement(placements, workflowId, runId);
const parents = familyParents(rows);

describe('workflow family disclosure', () => {
    let body: HTMLTableSectionElement;
    let expanded: Set<string>;
    const key = (name: string, runId: string) => `${name}/${runId}`;

    beforeEach(() => {
        document.body.innerHTML = '<table><tbody></tbody></table>';
        body = document.querySelector('tbody')!;
        expanded = new Set();
        for (const { workflowId, runId } of rows) {
            if (runId === run(6)) continue;
            const tr = body.insertRow();
            tr.dataset.fixture = key(workflowId, runId);
            tr.insertCell().innerHTML = '<input type="checkbox">';
            const link = document.createElement('a');
            link.href = `/namespaces/default/workflows/${workflowId}/${runId}/history`;
            link.textContent = workflowId;
            tr.insertCell().append(link);
        }
    });

    function fixture(name: string, suffix: number): HTMLTableRowElement {
        return Array.from(body.rows).find((row) => row.dataset.fixture === key(name, run(suffix)))!;
    }
    function chevron(name: string, suffix: number): HTMLButtonElement | null {
        return fixture(name, suffix).querySelector(`.${FAMILY_TOGGLE_CLASS}`);
    }
    function isHidden(name: string, suffix: number): boolean {
        return fixture(name, suffix).classList.contains(FAMILY_HIDDEN_CLASS);
    }
    function paint(): void {
        syncFamilyDisclosure(body, { parents, idsFromRow, lookup, expanded, toggle });
    }
    function toggle(key: string): void {
        if (expanded.has(key)) expanded.delete(key);
        else expanded.add(key);
        paint();
    }

    it('shows roots initially and discloses nested rows inline for the exact parent run', () => {
        paint();
        expect(chevron('parent', 1)?.getAttribute('aria-expanded')).toBe('false');
        expect(chevron('parent', 5)).toBeNull();
        expect(isHidden('child', 2)).toBe(true);
        expect(isHidden('sibling', 4)).toBe(true);
        expect(isHidden('orphan-in-table', 7)).toBe(false);
        expect(visibleRows(body, lookup).map((row) => row.runId)).not.toContain(run(2));
        expect(chevron('parent', 1)?.nextElementSibling?.tagName).toBe('A');

        chevron('parent', 1)!.click();
        expect(chevron('parent', 1)?.getAttribute('aria-expanded')).toBe('true');
        expect(isHidden('child', 2)).toBe(false);
        expect(isHidden('sibling', 4)).toBe(false);
        expect(isHidden('grandchild', 3)).toBe(true);
        chevron('child', 2)!.click();
        expect(isHidden('grandchild', 3)).toBe(false);

        chevron('parent', 1)!.click();
        expect(isHidden('grandchild', 3)).toBe(true);
        chevron('parent', 1)!.click();
        expect(isHidden('grandchild', 3)).toBe(false);
    });

    it('keeps selected children visible for Temporal’s native bulk actions', () => {
        const checkbox = fixture('grandchild', 3).querySelector('input')!;
        checkbox.checked = true;
        paint();
        expect(chevron('parent', 1)?.getAttribute('aria-disabled')).toBe('true');
        expect(isHidden('grandchild', 3)).toBe(false);
        chevron('parent', 1)!.click();
        expect(isHidden('grandchild', 3)).toBe(false);
        checkbox.checked = false;
        paint();
        expect(isHidden('grandchild', 3)).toBe(true);
        expect(chevron('parent', 1)?.getAttribute('aria-disabled')).toBe('false');
    });

    it('reconciles on refresh without moving or recreating controls, and unhides on disable', () => {
        paint();
        const recorded = chevron('parent', 1);
        const watcher = new MutationObserver(vi.fn());
        watcher.observe(body, { childList: true, subtree: true });
        paint();
        expect(chevron('parent', 1)).toBe(recorded);
        expect(watcher.takeRecords()).toEqual([]);
        watcher.disconnect();
        clearFamilyDisclosure(body);
        expect(chevron('parent', 1)).toBeNull();
        expect(isHidden('child', 2)).toBe(false);
        paint();
        removeAllDecoration();
        expect(chevron('parent', 1)).toBeNull();
        expect(isHidden('child', 2)).toBe(false);
    });
});
