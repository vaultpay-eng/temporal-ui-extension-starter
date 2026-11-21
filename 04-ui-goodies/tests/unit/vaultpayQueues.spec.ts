// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { createColumnPicker } from '../../src/list/columnPicker';
import { layoutFor, layoutKey } from '../../src/list/columnLayouts';
import { listPage, listUrl, syncQueueBar } from '../../src/list/queuePills';
import { replaceQueueQuery, splitQueueQuery } from '../../src/list/queueQuery';

const transactions = 'vp-transactions-task-queue';
const backoffice = 'vp-backoffice-task-queue';
const webhooks = 'vp-webhooks-task-queue';
const defaults = 'vp-default-task-queue';
const filters = `(WorkflowType = "Transfer" OR WorkflowType = "Payment") AND StartTime BETWEEN "2026-11-01T00:00:00Z" AND "2026-11-30T23:59:59Z"`;

describe('VaultPay task queue filters', () => {
    it('keeps the status and dates while changing or clearing the queue selection', () => {
        let query = replaceQueueQuery(filters, [webhooks, transactions]);
        expect(splitQueueQuery(query).selected).toEqual([transactions, webhooks]);
        query = replaceQueueQuery(query, [defaults]);
        expect(splitQueueQuery(query).selected).toEqual([defaults]);
        expect(replaceQueueQuery(query, [])).toBe(filters);
        expect(replaceQueueQuery(query, [defaults])).toBe(query);
    });

    it('uses the plural queue and supports the Backoffice pill', () => {
        const query = replaceQueueQuery('', [backoffice, transactions]);
        expect(query).toBe('TaskQueue IN ("vp-transactions-task-queue", "vp-backoffice-task-queue")');
        expect(splitQueueQuery(query).selected).toEqual([transactions, backoffice]);
        expect(replaceQueueQuery('TaskQueue = "vp-transaction-task-queue"', [])).toBe('');
    });

    it('recognizes a native TaskQueue filter added alongside another filter', () => {
        expect(splitQueueQuery(`ExecutionStatus = 'Failed' AND TaskQueue = '${webhooks}'`).selected).toEqual([webhooks]);
    });

    it('preserves queue clauses that are part of an OR expression', () => {
        const query = `TaskQueue = '${webhooks}' OR WorkflowType = 'Transfer'`;
        expect(replaceQueueQuery(replaceQueueQuery(query, [defaults]), [])).toBe(query);
    });

    it('keeps the namespace and resets pagination when a queue filter changes', () => {
        const url = new URL('http://localhost:8233/namespaces/sandbox/workflows?query=old&page=2&pageSize=250');
        expect(listUrl(url, '')).toBe('http://localhost:8233/namespaces/sandbox/workflows?pageSize=250');
        expect(listPage(url.pathname + '/wf/run/history')).toBeNull();
    });

    it('adds the controls to an empty workflow list and updates the native query', () => {
        document.body.innerHTML = '<div style="display:flex"><div><button data-testid="add-filter-button">Add Filter</button></div></div>';
        let url = new URL('http://localhost:8233/namespaces/default/workflows');
        url.searchParams.set('query', 'ExecutionStatus = "Completed"');
        const navigate = vi.fn((href: string) => { url = new URL(href); });
        const options = {
            url: () => url,
            navigate,
            createColumnPicker: () => createColumnPicker(document, () => layoutFor({}, 'all'), vi.fn()),
        };
        expect(syncQueueBar(document, options)?.textContent).toContain('Columns');
        document.querySelector<HTMLButtonElement>(`button[data-queue="${webhooks}"]`)!.click();
        syncQueueBar(document, options);
        document.querySelector<HTMLButtonElement>(`button[data-queue="${transactions}"]`)!.click();
        syncQueueBar(document, options);
        expect(splitQueueQuery(url.searchParams.get('query')!).selected).toEqual([transactions, webhooks]);
        expect(document.querySelectorAll('button[aria-pressed="true"]')).toHaveLength(2);
        document.querySelector<HTMLButtonElement>('button[data-queue="all"]')!.click();
        expect(url.searchParams.get('query')).toBe('ExecutionStatus = "Completed"');
        expect(navigate).toHaveBeenCalledTimes(3);
    });

    it('offers queue selection on the Standalone Activities page without workflow columns', () => {
        document.body.innerHTML = '<div><button data-testid="toggle-manual-query"></button></div>';
        const options = {
            url: () => new URL('http://localhost:8233/namespaces/default/activities'),
            navigate: vi.fn(),
            createColumnPicker: vi.fn(),
        };
        expect(syncQueueBar(document, options)).toBeNull();
        expect(document.querySelector('button[data-queue="all"]')).toBeTruthy();
        expect(options.createColumnPicker).not.toHaveBeenCalled();
    });
});

describe('VaultPay column layouts', () => {
    it('gives each queue selection an independent layout key and default attributes', () => {
        const all = layoutFor({}, 'all');
        const sampled = { ...all, hidden: ['Run ID'] };
        const stored = { [layoutKey([transactions])]: sampled };
        expect(layoutFor(stored, layoutKey([transactions]))).toEqual(sampled);
        expect(layoutFor(stored, layoutKey([webhooks])).attributes).toEqual(['transactionId', 'provider']);
        expect(layoutKey([webhooks, defaults])).toBe(layoutKey([defaults, webhooks]));
    });
});
