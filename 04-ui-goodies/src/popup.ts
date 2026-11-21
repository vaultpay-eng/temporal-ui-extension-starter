// The toolbar popup: the settings UI, and an honest answer to "is it working?".
//
// The status line matters more than it looks. Every silent failure this
// extension can have — wrong page, a filter that returned children whose parents
// are absent, an API URL shape that changed — presents identically as "the tree
// does nothing". Showing rows-seen, rows-matched and families-found separates
// those three cases in one glance.

import { safeCodecEndpoint } from './payloads/codec';
import { loadSettings, saveSettings, type Settings } from './settings';

interface PageStats {
    onListPage: boolean;
    namespace: string | null;
    rowsSeen: number;
    rowsMatched: number;
    rowsIndented: number;
    rowsKnown: number;
    families: number;
    retryBadges: number;
    // How many runs the page has asked Temporal about since it loaded. The only
    // number in this extension that represents requests WE made rather than
    // requests we watched, which is exactly why it is on screen.
    runsAsked: number;
}

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

let settings: Settings;

async function main(): Promise<void> {
    $('version').textContent = `v${chrome.runtime.getManifest().version}`;

    settings = await loadSettings();
    bindToggle('enabled');
    bindToggle('treeEnabled');
    bindToggle('payloadsEnabled');
    bindToggle('lastEventEnabled');
    bindToggle('retryEnabled');
    bindToggle('notFilterEnabled');
    bindToggle('columnReorderEnabled');
    bindCodecEndpoint();
    void showStatus();
}

type BooleanSetting = {
    [K in keyof Settings]: Settings[K] extends boolean ? K : never;
}[keyof Settings];

function bindToggle(key: BooleanSetting): void {
    const input = $<HTMLInputElement>(key);
    input.checked = settings[key];
    input.addEventListener('change', () => {
        settings[key] = input.checked;
        void saveSettings({ [key]: input.checked });
        // EVERY toggle, not just the payload one. Two of these switches decide
        // whether a configured endpoint can send anything at all, so the verdict
        // below is only true if it is recomputed whenever any of them moves.
        showCodecVerdict();
    });
}

// ── The codec endpoint ──────────────────────────────────────────────────────
//
// The same two-layer arrangement as a deep-link template, for the same reason: the
// popup says immediately that a value will not be used, and the page world re-checks
// it before every request — because a setting can also be written by another build,
// by storage sync, or by hand, and none of those go through this file.
function bindCodecEndpoint(): void {
    const input = $<HTMLInputElement>('codecEndpoint');
    const form = $<HTMLFormElement>('codec-form');
    const save = $<HTMLButtonElement>('codec-save');
    input.value = settings.codecEndpoint;
    input.addEventListener('input', showCodecVerdict);
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const endpoint = safeCodecEndpoint(input.value);
        if (input.value.trim() && endpoint === null) {
            showCodecVerdict();
            input.focus();
            return;
        }
        const value = endpoint ?? '';
        save.disabled = true;
        try {
            await saveSettings({ codecEndpoint: value });
            settings.codecEndpoint = value;
            input.value = value;
            showCodecVerdict();
        } catch {
            $('codec-warning').textContent = 'Could not save the endpoint. Try again.';
        } finally {
            save.disabled = false;
        }
    });
    showCodecVerdict();
}

// The one piece of UI text in this repository that has to be exactly true.
//
// It answers "will anything leave this machine, and to where?", and the honest
// answer depends on three things, checked in the order that decides the outcome:
// whether the value is usable at all, whether it is empty, and whether the features
// that would use it are switched on. A verdict that names a host while the panel is
// switched off is a false statement about egress in the one place a reader has no
// other way to check.
function showCodecVerdict(): void {
    const input = $<HTMLInputElement>('codecEndpoint');
    const warning = $('codec-warning');
    const accepted = safeCodecEndpoint(input.value);
    const typed = input.value.trim() !== '';

    input.classList.toggle('invalid', typed && accepted === null);
    if (typed && accepted === null) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');

    if (typed && accepted === null) {
        warning.textContent = 'Enter an HTTPS codec base URL or an HTTP loopback URL.';
        return;
    }
    if ((accepted ?? '') !== settings.codecEndpoint) {
        warning.textContent = 'Click Save to apply this change.';
        return;
    }
    if (!accepted) {
        warning.textContent = 'No codec server is configured.';
        return;
    }
    if (!settings.enabled || !settings.payloadsEnabled) {
        warning.textContent = 'Saved. Enable the extension and payload controls to use this endpoint.';
        return;
    }
    warning.textContent = `Saved. On local Temporal, In and Out send encrypted payloads to ${new URL(accepted).host} for decoding.`;
}

async function showStatus(): Promise<void> {
    const status = $('status');
    const stats = await askActiveTab();

    if (!stats) {
        status.textContent = 'Open or reload a Workflows page in Temporal Cloud or at http://localhost:8233.';
        return;
    }
    if (!stats.onListPage) {
        status.textContent = `Content script is running${stats.namespace ? ` (namespace ${stats.namespace})` : ''}, but this page has no workflow table.`;
        return;
    }

    const lines = [
        `${stats.rowsSeen} rows in the table, ${stats.rowsMatched} matched to API data.`,
        `${stats.families} famil${stats.families === 1 ? 'y' : 'ies'} with children, ${stats.rowsIndented} indented rows.`,
        // Stated even when both are zero: "this extension asked Temporal about N
        // runs" is the one line here that describes traffic, and a cost that only
        // appears once it is non-zero is a cost nobody looks for.
        `${stats.runsAsked} run${stats.runsAsked === 1 ? '' : 's'} asked about (last event / retries), ${stats.retryBadges} retrying now.`,
    ];
    // Each of these is a different problem wearing the same face.
    if (stats.rowsKnown === 0) {
        lines.push('Nothing observed yet — reload the list page so the extension can see its API call.');
    } else if (stats.rowsSeen > 0 && stats.rowsMatched === 0) {
        lines.push('Rows are on screen but none matched. The API response shape may have changed; check the page console.');
    } else if (stats.families === 0) {
        lines.push('No parent/child pair on this page. Children whose parents are filtered out cannot be grouped.');
    }
    status.textContent = lines.join('\n');
}

// The popup cannot read the page directly — the extension holds no host
// permission — so it asks the content script.
//
// chrome.tabs.query without the "tabs" permission still returns the tab id (it
// withholds url and title, which we do not need). If a Chrome build declines to
// deliver the message without a host grant, this resolves to null and the status
// line says so; it does not ask for a permission to find out.
async function askActiveTab(): Promise<PageStats | null> {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) return null;
        const response = await chrome.tabs.sendMessage(tab.id, { type: 'tuis-stats' });
        return (response as PageStats | undefined) ?? null;
    } catch {
        return null;
    }
}

void main();
