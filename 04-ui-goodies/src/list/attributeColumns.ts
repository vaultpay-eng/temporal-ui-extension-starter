import { parseTree, type Node } from 'jsonc-parser';

import type { PlacementLookup } from '../decoration';
import { idsFromRow } from '../render';
import type { WorkflowRow } from '../types';
import { EXTENSION_COLUMN_ATTR, SNAKE_WORKFLOW_TYPE_KEY, type ColumnInfo } from './columns';
import { buildComparisonClause, quoteField } from './query';

const ATTRIBUTE_PREFIX = 'attribute:';
export const ATTRIBUTE_CELL_CLASS = 'tuis-search-attribute';
export const HIDDEN_COLUMN_CLASS = 'tuis-hidden-column';

export function attributeKey(name: string): string {
    return ATTRIBUTE_PREFIX + name;
}

export function attributeName(key: string): string | null {
    return key.startsWith(ATTRIBUTE_PREFIX) ? key.slice(ATTRIBUTE_PREFIX.length) : null;
}

export function attributeLabel(name: string): string {
    const labels: Record<string, string> = { transactionId: 'Transaction ID', provider: 'Provider' };
    return Object.hasOwn(labels, name) ? labels[name]! : name;
}

type IndexedValue = { display: string; query: string | null };

function scalar(node: Node, text: string, name: string): IndexedValue | null {
    if (node.type === 'string' && typeof node.value === 'string') {
        return { display: node.value, query: buildComparisonClause(name, '=', node.value) };
    }
    if (node.type === 'number' || node.type === 'boolean') {
        // Keep the original JSON token. Parsing a 64-bit integer through
        // JavaScript Number changes the value used by an exact filter.
        const token = text.slice(node.offset, node.offset + node.length);
        return { display: token, query: `${quoteField(name)} = ${token}` };
    }
    return null;
}

export function indexedValue(row: WorkflowRow | undefined, name: string): IndexedValue | null {
    const indexedFields = row?.searchAttributes;
    if (!indexedFields || !Object.hasOwn(indexedFields, name)) return null;
    const value = indexedFields[name];
    if (!value || typeof value !== 'object' || !('data' in value) || typeof value.data !== 'string' || value.data.length > 8192) {
        return null;
    }
    try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(value.data), (byte) => byte.charCodeAt(0)));
        const errors: import('jsonc-parser').ParseError[] = [];
        const root = parseTree(text, errors, { disallowComments: true });
        if (!root || errors.length) return null;
        if (root.type !== 'array') return scalar(root, text, name);
        const entries = (root.children ?? []).flatMap((child) => scalar(child, text, name)?.display ?? []);
        return entries.length ? { display: entries.join(', '), query: null } : null;
    } catch {
        return null;
    }
}

function cellFor(row: HTMLTableRowElement, type: 'th' | 'td', key: string): HTMLElement {
    const existing = Array.from(row.children).find((cell) => cell.getAttribute(EXTENSION_COLUMN_ATTR) === key);
    if (existing) return existing as HTMLElement;
    const cell = row.ownerDocument.createElement(type);
    cell.setAttribute(EXTENSION_COLUMN_ATTR, key);
    cell.className = ATTRIBUTE_CELL_CLASS;
    row.append(cell);
    return cell;
}

function updateDisplay(cell: HTMLElement, value: IndexedValue | null, fieldLabel: string, filter: (query: string) => void): void {
    const label = value?.display || '—';
    const clause = value?.query ?? '';
    if (cell.dataset.clause === clause && cell.title === label) return;
    cell.title = label;
    cell.dataset.clause = clause;
    if (!clause) {
        cell.textContent = label;
        return;
    }
    const button = cell.ownerDocument.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.title = `Filter by ${fieldLabel}`;
    button.setAttribute('aria-label', `Filter by ${fieldLabel}: ${label}`);
    button.addEventListener('click', (event) => {
        event.stopPropagation();
        filter(clause);
    });
    cell.replaceChildren(button);
}

export function syncAttributeColumns(
    tbody: HTMLTableSectionElement,
    attributes: readonly string[],
    lookup: PlacementLookup,
    filter: (query: string) => void,
): void {
    const header = tbody.closest('table')?.tHead?.rows[0];
    if (!header) return;
    const columns = new Set(attributes);
    const rows = Array.from(tbody.rows);
    for (const row of [header, ...rows]) {
        for (const cell of Array.from(row.cells)) {
            const name = attributeName(cell.getAttribute(EXTENSION_COLUMN_ATTR) ?? '');
            if (name && !columns.has(name)) cell.remove();
        }
    }
    for (const name of columns) {
        const th = cellFor(header, 'th', attributeKey(name));
        if (!th.firstChild) th.append(attributeLabel(name));
        th.setAttribute('scope', 'col');
    }
    for (const row of rows) {
        const ids = idsFromRow(row);
        if (!ids) continue;
        const workflow = lookup(ids.workflowId, ids.runId)?.row;
        for (const name of columns) {
            updateDisplay(cellFor(row, 'td', attributeKey(name)), indexedValue(workflow, name), attributeLabel(name), filter);
        }
    }
}

function workflowTypeValue(workflowType: string | undefined): IndexedValue | null {
    if (!workflowType || workflowType === '(unknown)') return null;
    const display = workflowType
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .toLowerCase();
    return display ? { display, query: buildComparisonClause('WorkflowType', '=', workflowType) } : null;
}

export function syncWorkflowTypeColumn(
    tbody: HTMLTableSectionElement,
    lookup: PlacementLookup,
    filter: (query: string) => void,
): void {
    const header = tbody.closest('table')?.tHead?.rows[0];
    if (!header) return;
    const th = cellFor(header, 'th', SNAKE_WORKFLOW_TYPE_KEY);
    if (!th.firstChild) th.append('Snake case');
    th.setAttribute('scope', 'col');
    for (const row of Array.from(tbody.rows)) {
        const ids = idsFromRow(row);
        if (!ids) continue;
        const workflowType = lookup(ids.workflowId, ids.runId)?.row.workflowType;
        updateDisplay(cellFor(row, 'td', SNAKE_WORKFLOW_TYPE_KEY), workflowTypeValue(workflowType), 'workflow type', filter);
    }
}

export function syncColumnVisibility(tbody: HTMLTableSectionElement, columns: readonly ColumnInfo[], hidden: readonly string[]): void {
    const hiddenKeys = new Set(hidden.filter((key) => key !== 'Workflow ID'));
    for (const column of columns) column.th.classList.toggle(HIDDEN_COLUMN_CLASS, hiddenKeys.has(column.key));
    for (const row of Array.from(tbody.rows)) {
        const cells = Array.from(row.cells);
        cells.forEach((cell, index) => {
            cell.classList.toggle(HIDDEN_COLUMN_CLASS, cells.length === columns.length && hiddenKeys.has(columns[index]!.key));
        });
    }
}
