import { attributeKey, attributeLabel, attributeName } from './attributeColumns';
import { addAttribute, type ColumnLayout } from './columnLayouts';
import type { ColumnInfo } from './columns';
import { COLUMN_PICKER_CLASS } from './queuePills';

export function createColumnPicker(doc: Document, current: () => ColumnLayout, save: (layout: ColumnLayout) => void): HTMLDetailsElement {
    const picker = doc.createElement('details');
    picker.className = COLUMN_PICKER_CLASS;
    const toggle = doc.createElement('summary');
    toggle.textContent = 'Columns';
    const panel = doc.createElement('div');
    panel.className = 'tuis-column-panel';
    const list = doc.createElement('div');
    list.className = 'tuis-column-list';
    const form = doc.createElement('form');
    form.className = 'tuis-attribute-form';
    const label = doc.createElement('label');
    label.textContent = 'Search Attribute';
    const field = doc.createElement('input');
    field.type = 'text';
    field.placeholder = 'e.g. transactionId';
    field.maxLength = 64;
    label.append(field);
    const add = doc.createElement('button');
    add.type = 'submit';
    add.textContent = 'Add';
    const feedback = doc.createElement('p');
    feedback.setAttribute('role', 'status');
    feedback.hidden = true;
    form.append(label, add, feedback);
    form.addEventListener('submit', (event) => {
        event.preventDefault();
        const updated = addAttribute(current(), field.value);
        feedback.hidden = Boolean(updated);
        if (!updated) {
            feedback.textContent = 'Enter a valid, unused attribute name. Up to 10 per layout.';
            return;
        }
        field.value = '';
        save(updated);
    });
    panel.append(list, form);
    picker.append(toggle, panel);
    picker.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            picker.open = false;
            toggle.focus();
        }
    });
    return picker;
}

export function syncColumnPicker(
    picker: HTMLDetailsElement,
    columns: readonly ColumnInfo[],
    layout: ColumnLayout,
    current: () => ColumnLayout,
    save: (layout: ColumnLayout) => void,
): void {
    const list = picker.querySelector<HTMLElement>('.tuis-column-list')!;
    const entries = new Map(columns.filter(({ origin }) => origin !== 'structural').map(({ key, label }) => [key, label]));
    for (const attribute of layout.attributes) entries.set(attributeKey(attribute), attributeLabel(attribute));
    const signature = JSON.stringify([...entries]);
    if (signature !== list.dataset.columns) {
        list.dataset.columns = signature;
        list.replaceChildren();
        for (const [key, name] of entries) {
            const item = list.ownerDocument.createElement('div');
            const label = list.ownerDocument.createElement('label');
            const checkbox = list.ownerDocument.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.dataset.column = key;
            checkbox.disabled = key === 'Workflow ID';
            checkbox.addEventListener('change', () => {
                const old = current();
                const hidden = old.hidden.filter((item) => item !== key);
                if (!checkbox.checked) hidden.push(key);
                save({ ...old, hidden });
            });
            label.append(checkbox, name);
            item.append(label);
            const attribute = attributeName(key);
            if (attribute) {
                const remove = list.ownerDocument.createElement('button');
                remove.type = 'button';
                remove.textContent = 'Remove';
                remove.setAttribute('aria-label', `Remove ${name} column`);
                remove.addEventListener('click', () => {
                    const old = current();
                    save({
                        order: old.order.filter((item) => item !== key),
                        hidden: old.hidden.filter((item) => item !== key),
                        attributes: old.attributes.filter((item) => item !== attribute),
                    });
                });
                item.append(remove);
            }
            list.append(item);
        }
    }
    for (const checkbox of list.querySelectorAll<HTMLInputElement>('input[data-column]')) {
        checkbox.checked = checkbox.disabled || !layout.hidden.includes(checkbox.dataset.column!);
    }
}
