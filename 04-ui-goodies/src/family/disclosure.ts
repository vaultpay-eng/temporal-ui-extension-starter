import {
    FAMILY_HIDDEN_CLASS,
    FAMILY_LEAF_CLASS,
    FAMILY_TOGGLE_CLASS,
    SEGMENT_WIDTH_PX,
    type PlacementLookup,
} from '../decoration';
import type { WorkflowRow } from '../types';
import { runKey } from './rows';

// Read the full page's tree, including rows the table may not be drawing.
// A child with a missing rendered parent must not get attached to a different run.
export function familyParents(orderedRows: readonly WorkflowRow[]): Map<string, string> {
    const parents = new Map<string, string>();
    const ancestors: string[] = [];
    for (const row of orderedRows) {
        ancestors.length = row.depth;
        const key = runKey(row.workflowId, row.runId);
        const parent = ancestors.at(-1);
        if (parent) parents.set(key, parent);
        ancestors.push(key);
    }
    return parents;
}

type RowIds = { workflowId: string; runId: string | null };
type FamilyDisclosureOptions = {
    parents: ReadonlyMap<string, string>;
    idsFromRow: (tr: HTMLTableRowElement) => RowIds | null;
    lookup: PlacementLookup;
    expanded: ReadonlySet<string>;
    toggle: (key: string) => void;
};

export function syncFamilyDisclosure(tbody: HTMLTableSectionElement, options: FamilyDisclosureOptions): void {
    const rows = Array.from(tbody.rows).map((tr) => {
        const ids = options.idsFromRow(tr);
        const workflow = ids && options.lookup(ids.workflowId, ids.runId)?.row;
        return { tr, workflow, key: workflow ? runKey(workflow.workflowId, workflow.runId) : null };
    });
    const renderedKeys = new Set(rows.flatMap(({ key }) => key ?? []));
    const renderedParents = new Map<string, string>();
    const branches = new Set<string>();
    for (const key of renderedKeys) {
        let parent = options.parents.get(key);
        while (parent && !renderedKeys.has(parent)) parent = options.parents.get(parent);
        if (!parent) continue;
        renderedParents.set(key, parent);
        branches.add(parent);
    }

    // Temporal's own select-all can select rows even when a branch is collapsed.
    // Keep those selections visible for the native bulk-action toolbar.
    const heldOpen = new Set<string>();
    for (const { key, tr } of rows) {
        if (!key || !tr.cells[0]?.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked) continue;
        for (let parent = renderedParents.get(key); parent && !heldOpen.has(parent); parent = renderedParents.get(parent)) {
            heldOpen.add(parent);
        }
    }

    const hidden = new Set<string>();
    for (const { tr, key, workflow } of rows) {
        const parent = key ? renderedParents.get(key) : undefined;
        const shouldHide = Boolean(parent && (hidden.has(parent) || !(options.expanded.has(parent) || heldOpen.has(parent))));
        if (key && shouldHide) hidden.add(key);
        tr.classList.toggle(FAMILY_HIDDEN_CLASS, shouldHide);

        const link = tr.querySelector<HTMLAnchorElement>('a[href*="/workflows/"]');
        const button = tr.querySelector<HTMLButtonElement>(`.${FAMILY_TOGGLE_CLASS}`);
        if (!key || !workflow || !link || !branches.has(key)) {
            link?.classList.toggle(FAMILY_LEAF_CLASS, Boolean(key && branches.size));
            button?.remove();
            continue;
        }
        link.classList.remove(FAMILY_LEAF_CLASS);
        const control = button ?? createToggle(tr, options);
        control.dataset.runKey = key;
        control.style.marginInlineStart = `${workflow.depth * SEGMENT_WIDTH_PX}px`;
        const open = options.expanded.has(key) || heldOpen.has(key);
        const locked = heldOpen.has(key);
        control.setAttribute('aria-expanded', String(open));
        control.setAttribute('aria-disabled', String(locked));
        control.setAttribute('aria-label', `${open ? 'Collapse' : 'Expand'} children of ${workflow.workflowId}`);
        control.title = locked ? 'Uncheck child workflows to collapse this branch' : open ? 'Collapse child workflows' : 'Expand child workflows';
        if (control.nextElementSibling !== link || control.parentElement !== link.parentElement) {
            link.before(control);
        }
    }
}

function createToggle(tr: HTMLTableRowElement, options: FamilyDisclosureOptions): HTMLButtonElement {
    const button = tr.ownerDocument.createElement('button');
    button.type = 'button';
    button.className = FAMILY_TOGGLE_CLASS;
    button.addEventListener('click', (event) => {
        event.stopPropagation();
        if (button.getAttribute('aria-disabled') === 'true') return;
        // The UI recycles DOM rows. Confirm the button still belongs to the
        // workflow the user clicked before applying its stored branch state.
        const ids = options.idsFromRow(tr);
        const workflow = ids && options.lookup(ids.workflowId, ids.runId)?.row;
        if (!workflow) return;
        const key = runKey(workflow.workflowId, workflow.runId);
        if (key === button.dataset.runKey) options.toggle(key);
    });
    return button;
}

export function clearFamilyDisclosure(tbody: HTMLTableSectionElement): void {
    tbody.querySelectorAll(`.${FAMILY_TOGGLE_CLASS}`).forEach((control) => control.remove());
    tbody.querySelectorAll(`.${FAMILY_HIDDEN_CLASS}, .${FAMILY_LEAF_CLASS}`).forEach((element) =>
        element.classList.remove(FAMILY_HIDDEN_CLASS, FAMILY_LEAF_CLASS),
    );
}
