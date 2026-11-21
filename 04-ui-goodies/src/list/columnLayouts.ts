import { currentQueueName, TASK_QUEUES, type TaskQueue } from './queueQuery';

export type ColumnLayout = {
    order: string[];
    hidden: string[];
    attributes: string[];
};

type Layouts = Record<string, ColumnLayout>;
const STORAGE_KEY = 'vaultPayColumnLayouts';
const MAX_ATTRIBUTES = 10;
const DEFAULT_ATTRIBUTES: Partial<Record<TaskQueue, string[]>> = {
    'vp-transactions-task-queue': ['transactionId'],
    'vp-webhooks-task-queue': ['transactionId', 'provider'],
};

export function isAttributeName(value: string): boolean {
    return /^[a-z][a-z0-9_]{0,63}$/i.test(value);
}

function strings(input: unknown): string[] {
    return Array.isArray(input)
        ? [...new Set(input.filter((item): item is string => typeof item === 'string' && item.length <= 128))].slice(0, 40)
        : [];
}

export function layoutKey(selected: readonly TaskQueue[]): string {
    return TASK_QUEUES.map(({ name }) => name).filter((name) => selected.includes(name)).join(',') || 'all';
}

export function layoutFor(layouts: Layouts, key: string): ColumnLayout {
    const stored = layouts[key];
    return stored ?? {
        order: [],
        hidden: [],
        attributes: DEFAULT_ATTRIBUTES[key as TaskQueue] ?? [],
    };
}

export async function loadColumnLayouts(): Promise<Layouts> {
    const all = await chrome.storage.local.get(STORAGE_KEY);
    const raw: unknown = all[STORAGE_KEY];
    if (!raw || typeof raw !== 'object') return Object.create(null);
    const layouts: Layouts = Object.create(null);
    for (const [key, value] of Object.entries(raw)) {
        if (!value || typeof value !== 'object') continue;
        const currentKey = key.split(',').map(currentQueueName).join(',');
        if (key !== currentKey && Object.hasOwn(raw, currentKey)) continue;
        layouts[currentKey] = {
            order: strings(value.order),
            hidden: strings(value.hidden),
            attributes: strings(value.attributes).filter(isAttributeName).slice(0, MAX_ATTRIBUTES),
        };
    }
    return layouts;
}

export function saveColumnLayouts(layouts: Layouts): Promise<void> {
    return chrome.storage.local.set({ [STORAGE_KEY]: layouts });
}

export function addAttribute(layout: ColumnLayout, raw: string): ColumnLayout | null {
    const name = raw.trim();
    if (!isAttributeName(name) || layout.attributes.includes(name) || layout.attributes.length >= MAX_ATTRIBUTES) {
        return null;
    }
    return { ...layout, attributes: [...layout.attributes, name] };
}
