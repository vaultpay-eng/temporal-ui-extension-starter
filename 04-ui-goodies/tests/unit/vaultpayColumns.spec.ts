// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { normalizeExecutions } from '../../src/family/rows';
import { attributeKey, indexedValue, syncAttributeColumns, syncColumnVisibility, syncWorkflowTypeColumn } from '../../src/list/attributeColumns';
import { createColumnPicker, syncColumnPicker } from '../../src/list/columnPicker';
import { layoutFor } from '../../src/list/columnLayouts';
import { syncColumnOrder } from '../../src/list/columnReorder';
import { workflowColumnOrder } from '../../src/list/columnOrder';
import { readColumns, SNAKE_WORKFLOW_TYPE_KEY } from '../../src/list/columns';

const runId = '00000000-0000-4000-8000-000000000001';
const workflow = (payload: string) => normalizeExecutions([{
    execution: { workflowId: 'send-1', runId },
    searchAttributes: { indexedFields: { transactionId: { data: btoa(payload) } } },
}])[0]!;

describe('VaultPay Search Attribute columns', () => {
    it('uses the actual API envelope and preserves large integer filters exactly', () => {
        expect(indexedValue(workflow('12345678901234567890'), 'transactionId')).toEqual({
            display: '12345678901234567890',
            query: 'transactionId = 12345678901234567890',
        });
        expect(indexedValue(workflow('"txn-1"'), 'transactionId')?.query).toBe('transactionId = "txn-1"');
        expect(indexedValue(workflow('["x", "y"]'), 'transactionId')).toEqual({ display: 'x, y', query: null });
        expect(indexedValue(workflow('{"unexpected":true}'), 'transactionId')).toBeNull();
    });

    it('renders, reorders, hides and filters an indexed column on recycled Temporal rows', () => {
        document.body.innerHTML = `<table><thead><tr>
            <th data-testid="workflows-summary-table-header-cell-Workflow ID">Workflow ID</th>
            <th data-testid="workflows-summary-table-header-cell-Type">Type</th>
            <th data-testid="workflows-summary-table-header-cell-Run ID">Run ID</th>
        </tr></thead><tbody><tr>
            <td><a href="/namespaces/default/workflows/send-1/${runId}/history">send-1</a></td>
            <td>Transfer</td><td>${runId}</td>
        </tr></tbody></table>`;
        const body = document.querySelector<HTMLTableSectionElement>('tbody')!;
        const head = document.querySelector<HTMLTableRowElement>('thead tr')!;
        const row = workflow('"txn-1"');
        const lookup = () => ({ row, sequence: 0, depth: 0, segments: [] });
        const filter = vi.fn();
        syncAttributeColumns(body, ['transactionId'], lookup, filter);
        const type = readColumns(head).find((column) => column.label === 'Type')!;
        expect(type.index).toBe(1);
        syncColumnOrder(body, ['Workflow ID', 'Type', attributeKey('transactionId'), 'Run ID'], true);
        expect(head.cells[2]!.textContent).toBe('Transaction ID');
        body.rows[0]!.cells[2]!.querySelector('button')!.click();
        expect(filter).toHaveBeenCalledWith('transactionId = "txn-1"');
        syncColumnVisibility(body, readColumns(head), ['Run ID', 'Workflow ID']);
        expect(body.rows[0]!.cells[3]!.classList.contains('tuis-hidden-column')).toBe(true);
        expect(body.rows[0]!.cells[0]!.classList.contains('tuis-hidden-column')).toBe(false);
        const anchor = body.rows[0]!.querySelector('a')!;
        anchor.href = '/namespaces/default/workflows/send-2/00000000-0000-4000-8000-000000000002/history';
        syncAttributeColumns(body, ['transactionId'], () => undefined, filter);
        expect(body.rows[0]!.cells[2]!.textContent).toBe('—');
    });

    it('adds a field from the picker and keeps removed fields out of saved layouts', () => {
        let layout = layoutFor({}, 'all');
        const save = (next: typeof layout) => { layout = next; };
        const picker = createColumnPicker(document, () => layout, save);
        document.body.append(picker);
        const field = picker.querySelector<HTMLInputElement>('input[type=text]')!;
        field.value = 'transactionId';
        picker.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        expect(layout.attributes).toEqual(['transactionId']);
        syncColumnPicker(picker, [], layout, () => layout, save);
        const checkbox = picker.querySelector<HTMLInputElement>('input[type=checkbox]')!;
        checkbox.click();
        expect(layout.hidden).toEqual([attributeKey('transactionId')]);
        picker.querySelector<HTMLButtonElement>('button[aria-label="Remove Transaction ID column"]')!.click();
        expect(layout.hidden).toEqual([]);
        expect(layout.attributes).toEqual([]);
    });
});

describe('Snake case workflow type column', () => {
    it('places the column after duration and filters by the registered workflow type', () => {
        document.body.innerHTML = `<table><thead><tr>
            <th><input type="checkbox"></th>
            <th data-testid="workflows-summary-table-header-cell-Type">Type</th>
            <th data-testid="workflows-summary-table-header-cell-Run ID">Run ID</th>
            <th data-testid="workflows-summary-table-header-cell-Workflow ID">Workflow ID</th>
            <th data-testid="workflows-summary-table-header-cell-Status">Status</th>
            <th data-testid="workflows-summary-table-header-cell-Execution Duration">Execution Duration</th>
        </tr></thead><tbody><tr>
            <td><input type="checkbox"></td><td>GTPAccountInfoV2Workflow</td><td>${runId}</td>
            <td><a href="/namespaces/default/workflows/send-1/${runId}/history">send-1</a></td>
            <td>Completed</td><td>1s</td>
        </tr></tbody></table>`;
        const body = document.querySelector<HTMLTableSectionElement>('tbody')!;
        const head = document.querySelector<HTMLTableRowElement>('thead tr')!;
        const row = { ...workflow('"txn-1"'), workflowType: 'GTPAccountInfoV2Workflow' };
        const lookup = () => ({ row, sequence: 0, depth: 0, segments: [] });
        const filter = vi.fn();
        syncWorkflowTypeColumn(body, lookup, filter);
        syncAttributeColumns(body, ['transactionId'], lookup, filter);
        const attributes = [attributeKey('transactionId')];
        const order = workflowColumnOrder(readColumns(head), [], attributes);
        syncColumnOrder(body, order, true);

        expect(readColumns(head).map(({ label }) => label)).toEqual([
            '', 'Status', 'Workflow ID', 'Execution Duration', 'Snake case', 'Type', 'Transaction ID', 'Run ID',
        ]);
        expect(Array.from(body.rows[0]!.cells, ({ textContent }) => textContent)).toEqual([
            '', 'Completed', 'send-1', '1s', 'gtp_account_info_v2_workflow', row.workflowType, 'txn-1', runId,
        ]);
        body.rows[0]!.cells[4]!.querySelector('button')!.click();
        expect(filter).toHaveBeenCalledExactlyOnceWith('WorkflowType = "GTPAccountInfoV2Workflow"');

        const oldOrder = ['Run ID', 'Status', 'Workflow ID', 'Execution Duration', 'Type'];
        expect(workflowColumnOrder(readColumns(head), oldOrder, attributes)).toEqual([
            'Run ID', 'Status', 'Workflow ID', 'Execution Duration', SNAKE_WORKFLOW_TYPE_KEY, 'Type', ...attributes,
        ]);
        const customOrder = [SNAKE_WORKFLOW_TYPE_KEY, ...oldOrder];
        expect(workflowColumnOrder(readColumns(head), customOrder, [])).toEqual([...customOrder, ...attributes]);

        syncWorkflowTypeColumn(body, () => undefined, filter);
        expect(body.rows[0]!.cells[4]!.textContent).toBe('—');
        expect(body.rows[0]!.cells[4]!.querySelector('button')).toBeNull();
    });
});
