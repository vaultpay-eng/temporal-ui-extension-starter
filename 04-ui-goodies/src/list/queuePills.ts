import { replaceQueueQuery, splitQueueQuery, TASK_QUEUES, type TaskQueue } from './queueQuery';

export const QUEUE_PILLS_CLASS = 'tuis-queue-pills';
export const COLUMN_PICKER_CLASS = 'tuis-column-picker';

export function listPage(pathname: string): 'workflows' | 'activities' | null {
    if (/\/namespaces\/[^/]+\/workflows\/?$/.test(pathname)) return 'workflows';
    if (/\/namespaces\/[^/]+\/(?:standalone-activities|activities)\/?$/.test(pathname)) return 'activities';
    return null;
}

export function listUrl(url: URL, query: string): string {
    const next = new URL(url);
    if (query) next.searchParams.set('query', query);
    else next.searchParams.delete('query');
    for (const key of ['page', 'pageToken', 'nextPageToken']) next.searchParams.delete(key);
    return next.href;
}

interface QueueBarOptions {
    url: () => URL;
    navigate: (url: string) => void;
    createColumnPicker: () => HTMLDetailsElement;
}

const ADD_FILTER = '[data-testid="add-filter-button"]';
const MANUAL_QUERY = '[data-testid="toggle-manual-query"]';

export function syncQueueBar(doc: Document, options: QueueBarOptions): HTMLDetailsElement | null {
    const page = listPage(options.url().pathname);
    const bar = doc.querySelector<HTMLElement>(`.${QUEUE_PILLS_CLASS}`);
    const anchor = page ? doc.querySelector(ADD_FILTER) ?? doc.querySelector(MANUAL_QUERY) : null;
    if (!anchor) {
        bar?.remove();
        return null;
    }
    const parent = anchor.parentElement;
    if (!parent) return null;
    let group: Element = parent;
    let before = anchor;
    let child = anchor;
    for (let node: Element | null = parent; node && node !== doc.body; child = node, node = node.parentElement) {
        const style = doc.defaultView?.getComputedStyle(node);
        if (style && /^(flex|inline-flex)$/.test(style.display) && (style.flexDirection || 'row').startsWith('row')) {
            group = node;
            before = child;
            break;
        }
    }

    const controls = bar ?? doc.createElement('div');
    if (!bar) {
        controls.className = QUEUE_PILLS_CLASS;
        controls.setAttribute('role', 'group');
        controls.setAttribute('aria-label', 'Task queues');
        for (const { label, name } of [{ label: 'All', name: 'all' as const }, ...TASK_QUEUES]) {
            const button = doc.createElement('button');
            button.type = 'button';
            button.textContent = label;
            button.dataset.queue = name;
            button.addEventListener('click', () => {
                const url = options.url();
                const query = url.searchParams.get('query') ?? '';
                const current = splitQueueQuery(query).selected;
                const next: TaskQueue[] = name === 'all' ? []
                    : current.includes(name) ? current.filter((queue) => queue !== name) : [...current, name];
                const target = listUrl(url, replaceQueueQuery(query, next));
                if (target !== url.href) options.navigate(target);
            });
            controls.appendChild(button);
        }
    }
    let picker = controls.querySelector<HTMLDetailsElement>(`.${COLUMN_PICKER_CLASS}`);
    if (page === 'workflows' && !picker) {
        picker = options.createColumnPicker();
        controls.append(picker);
    } else if (page !== 'workflows' && picker) {
        picker.remove();
        picker = null;
    }
    const selection = splitQueueQuery(options.url().searchParams.get('query') ?? '').selected;
    for (const button of controls.querySelectorAll<HTMLButtonElement>('button[data-queue]')) {
        const name = button.dataset.queue;
        button.setAttribute('aria-pressed', String(name === 'all' ? !selection.length : selection.some((item) => item === name)));
    }
    // Insert next to the stock controls, and never move a settled node on
    // an observer-driven render.
    if (controls.parentElement !== group) group.insertBefore(controls, before);
    return picker;
}
