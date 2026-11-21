import { buildInClause, combineQuery } from './query';

export const TASK_QUEUES = [
    { label: 'Default', name: 'vp-default-task-queue' },
    { label: 'Dashboards', name: 'vp-dashboards-task-queue' },
    { label: 'Transactions', name: 'vp-transactions-task-queue' },
    { label: 'Profiles', name: 'vp-profiles-task-queue' },
    { label: 'Webhooks', name: 'vp-webhooks-task-queue' },
    { label: 'Backoffice', name: 'vp-backoffice-task-queue' },
] as const;

export type TaskQueue = (typeof TASK_QUEUES)[number]['name'];
export function currentQueueName(name: string): string {
    return name === 'vp-transaction-task-queue' ? 'vp-transactions-task-queue' : name;
}

const queueNames = new Set<string>(TASK_QUEUES.map(({ name }) => name));

function queueValues(expression: string): TaskQueue[] | null {
    const match = /^(?:TaskQueue|\`TaskQueue\`)\s*(?:IN\s*\(([\s\S]*)\)|=\s*(.+))$/i.exec(expression);
    if (!match) return null;
    const values = (match[1] ?? match[2] ?? '').split(',').map((value) => {
        return /^(['"])([\w-]+)\1$/.exec(value.trim())?.[2] ?? '';
    }).map(currentQueueName);
    if (!values.length || values.some((value) => !queueNames.has(value))) return null;
    return [...new Set(values)] as TaskQueue[];
}

function scan(expression: string): { wrapped: boolean; joins: number[]; hasOr: boolean } {
    let depth = 0;
    let quote = '';
    let between = false;
    let wrapped = expression.startsWith('(') && expression.endsWith(')');
    let hasOr = false;
    const joins: number[] = [];
    for (let index = 0; index < expression.length; index++) {
        const character = expression[index]!;
        if (quote) {
            if (character === '\\') index++;
            else if (character === quote && expression[index + 1] === quote) index++;
            else if (character === quote) quote = '';
            continue;
        }
        if (character === '"' || character === "'" || character === '\`') quote = character;
        else if (character === '(') depth++;
        else if (character === ')') {
            depth--;
            if (depth === 0 && index !== expression.length - 1) wrapped = false;
        } else if (depth === 0 && /[A-Za-z_]/.test(character)) {
            const word = /^[A-Za-z_][A-Za-z0-9_]*/.exec(expression.slice(index))![0];
            const keyword = word.toUpperCase();
            if (keyword === 'BETWEEN') between = true;
            else if (keyword === 'OR') hasOr = true;
            else if (keyword === 'AND') {
                if (!between) joins.push(index);
                between = false;
            }
            index += word.length - 1;
        }
    }
    return { wrapped: wrapped && depth === 0 && !quote, joins, hasOr };
}

// Only replace recognized, positive queue predicates. In particular, a queue
// clause inside an OR belongs to the user's expression and stays intact.
export function splitQueueQuery(rawQuery: string): { query: string; selected: TaskQueue[] } {
    const query = rawQuery.trim();
    if (!query) return { query, selected: [] };
    const syntax = scan(query);
    if (syntax.wrapped) {
        const inner = splitQueueQuery(query.slice(1, -1));
        return inner.selected.length ? inner : { query, selected: [] };
    }
    const selected = queueValues(query);
    if (selected) return { query: '', selected };
    if (syntax.hasOr || syntax.joins.length === 0) return { query, selected: [] };

    let start = 0;
    const segments = [...syntax.joins, query.length].map((end) => {
        const segment = splitQueueQuery(query.slice(start, end));
        start = end + 3;
        return segment;
    });
    const predicates = segments.filter((segment) => segment.selected.length);
    if (!predicates.length) return { query, selected: [] };
    const queues = predicates.reduce((current, segment) => {
        return current.filter((name) => segment.selected.includes(name));
    }, predicates[0]!.selected);
    return {
        query: segments.map((segment) => segment.query).filter(Boolean).join(' AND '),
        selected: queues,
    };
}

export function replaceQueueQuery(query: string, selected: readonly TaskQueue[]): string {
    let remaining = splitQueueQuery(query).query;
    while (scan(remaining).wrapped) remaining = remaining.slice(1, -1).trim();
    const queues = TASK_QUEUES.map(({ name }) => name).filter((name) => selected.includes(name));
    const clause = buildInClause('TaskQueue', queues);
    return clause ? combineQuery(remaining, clause, true) : remaining;
}
