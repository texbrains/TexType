import { injectStylesheet, releaseStylesheet } from '../common/stylesheet';

import { parseLatex, Atom, Context } from '../core/core';

import { getCaretPoint } from '../editor-mathfield/utils';
import type { _Mathfield } from '../editor-mathfield/mathfield-private';

import { complete } from '../editor-mathfield/autocomplete';
import {
  getSharedElement,
  releaseSharedElement,
} from '../common/shared-element';
import { requestUpdate } from '../editor-mathfield/render';
import { kernelLayoutEngine, kernelUserLatex } from '../editor-mathfield/kernel-hooks';
import {
  kernelCandidateNumberMarkup,
  kernelCompletionInfo,
} from '../latex-commands/definitions-utils';

// TexType: one suggestion list for all math fields, owned by the field it
// was last shown for (`kernelMathfield`). Its look is css/suggestion-popover.css.
type SuggestionPanel = HTMLElement & { kernelMathfield?: _Mathfield };

function escapeHtmlAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function latexToMarkup(mf: _Mathfield, latex: string): string {
  const context = new Context({ from: mf.context });

  const root = new Atom({
    mode: 'math',
    type: 'root',
    body: parseLatex(latex, { context }),
  });

  return kernelLayoutEngine.renderAtoms(root.body ?? [], { display: true });
}

export function showSuggestionPopover(
  mf: _Mathfield,
  suggestions: string[]
): void {
  if (suggestions.length === 0) {
    hideSuggestionPopover(mf);
    return;
  }

  // One row per candidate: its number on the page, its command (and label) and a drawing of what accepting inserts
  // (in exam-zh's spelling \cong inserts ≌). An empty preview marks a command that draws nothing by itself.
  const noPreview = (globalThis.document?.documentElement.lang ?? '').startsWith('en') ? 'no preview' : '无预览';
  let template = '';
  for (const [i, suggestion] of suggestions.entries()) {
    const info = kernelCompletionInfo(mf, suggestion);
    const preview = info.preview
      ? latexToMarkup(mf, kernelUserLatex(info.preview))
      : `<span class="ML__popover__none">${noPreview}</span>`;
    template += `<li role="button" data-command="${escapeHtmlAttr(suggestion)}"${
      i === mf.suggestionIndex ? ' class="ML__popover__current"' : ''
    }>${kernelCandidateNumberMarkup(mf, i)}<span class="ML__popover__latex">${escapeHtmlAttr(info.command)}</span><span class="ML__popover__command">${preview}</span></li>`;
  }
  const panel = createSuggestionPopover(mf, `<ul>${template}</ul>`);
  if (isSuggestionPopoverVisible()) {
    panel
      .querySelector('.ML__popover__current')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  setTimeout(() => {
    if (panel?.isConnected && panel.kernelMathfield === mf && panel.getAttribute('aria-hidden') !== 'true' && !isSuggestionPopoverVisible()) {
      panel.classList.add('is-visible');
      updateSuggestionPopoverPosition(mf);
      panel
        .querySelector('.ML__popover__current')
        ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }, 32);
}

export function isSuggestionPopoverVisible(): boolean {
  const panel = document.getElementById('mathlive-suggestion-popover');
  if (!panel) return false;
  return panel.classList.contains('is-visible');
}

export function updateSuggestionPopoverPosition(
  mf: _Mathfield,
  options?: { deferred: boolean }
): void {
  // Check that the mathfield is still valid
  // (we're calling ourselves from requestAnimationFrame() and the mathfield
  // could have gotten destroyed
  if (!mf.element || mf.element.mathfield !== mf) return;

  if (!isSuggestionPopoverVisible() || (document.getElementById('mathlive-suggestion-popover') as SuggestionPanel | null)?.kernelMathfield !== mf) return;

  if (mf.model.at(mf.model.position)?.type !== 'latex') {
    hideSuggestionPopover(mf);
    return;
  }

  if (options?.deferred) {
    // Call ourselves again later, typically after the
    // rendering/layout of the DOM has been completed
    // (don't do it on next frame, it might be too soon)
    setTimeout(() => updateSuggestionPopoverPosition(mf), 32);
    return;
  }

  const position = getCaretPoint(mf);
  if (!position) return;

  // Get screen width & height (browser compatibility)
  const viewportHeight =
    window.innerHeight ||
    document.documentElement.clientHeight ||
    document.body.clientHeight;
  const viewportWidth =
    window.innerWidth ||
    document.documentElement.clientWidth ||
    document.body.clientWidth;

  // Get scrollbar size. This would be 0 in mobile device (also no needed).
  const scrollbarWidth =
    window.innerWidth - document.documentElement.clientWidth;
  const scrollbarHeight =
    window.innerHeight - document.documentElement.clientHeight;
  const panel = document.getElementById('mathlive-suggestion-popover')!;
  // TexType: keep the list inside the viewport, centred on the caret, and
  // give it the height the side it opens on has room for
  const viewportPadding = 8;
  const tipGap = 15;
  const viewportRight = viewportWidth - scrollbarWidth - viewportPadding;
  const viewportBottom =
    viewportHeight - scrollbarHeight - viewportPadding;
  const centeredLeft = position.x - panel.offsetWidth / 2;
  panel.style.left = `${Math.max(
    viewportPadding,
    Math.min(centeredLeft, viewportRight - panel.offsetWidth),
  )}px`;

  const spaceAbove = Math.max(
    0,
    position.y - position.height - viewportPadding - tipGap,
  );
  const spaceBelow = Math.max(0, viewportBottom - position.y - tipGap);
  const placeAbove = spaceAbove > spaceBelow;
  const availableHeight = Math.max(
    36,
    Math.min(320, placeAbove ? spaceAbove : spaceBelow),
  );
  panel.style.setProperty(
    '--kernel-suggestion-max-height',
    `${availableHeight}px`,
  );

  // And position the popover right below or above the caret
  if (placeAbove) {
    panel.classList.remove('top-tip');
    panel.classList.add('bottom-tip');
    panel.style.top = `${Math.max(
      viewportPadding,
      position.y - position.height - panel.offsetHeight - tipGap,
    )}px`;
  } else {
    panel.classList.add('top-tip');
    panel.classList.remove('bottom-tip');
    panel.style.top = `${Math.max(
      viewportPadding,
      Math.min(position.y + tipGap, viewportBottom - panel.offsetHeight),
    )}px`;
  }
}

export function hideSuggestionPopover(mf: _Mathfield): void {
  mf.suggestionIndex = 0;
  const panel = document.getElementById('mathlive-suggestion-popover') as SuggestionPanel | null;
  if (panel?.kernelMathfield === mf) { panel.classList.remove('is-visible'); panel.setAttribute('aria-hidden', 'true'); }
}

export function createSuggestionPopover(
  mf: _Mathfield,
  html: string
): SuggestionPanel {
  let panel = document.getElementById('mathlive-suggestion-popover') as SuggestionPanel | null;
  if (!panel) {
    injectStylesheet('suggestion-popover'); injectStylesheet('core');
    panel = getSharedElement('mathlive-suggestion-popover') as SuggestionPanel;
    panel.addEventListener('pointerdown', (ev) => ev.preventDefault());
    panel.addEventListener('click', (ev) => {
      // a click accepts the clicked candidate for the field that owns the list
      const item = (ev.target as HTMLElement).closest<HTMLElement>('li[data-command]');
      const owner = panel!.kernelMathfield;
      if (!item || !owner) return;
      const entries: string[] = owner.kernelCompletion?.suggestions || [];
      const insertionLatex =
        item.dataset.kernelInsertionLatex || item.dataset.command;
      const index = entries.indexOf(insertionLatex!);
      if (index < 0) return;
      owner.suggestionIndex = index;
      complete(owner, 'accept-all'); owner.dirty = true; owner.focus();
      requestUpdate(owner);
    });
  }
  panel.kernelMathfield = mf;
  panel.setAttribute('aria-hidden', 'false');
  panel.innerHTML = globalThis.MathfieldElement.createHTML(html);
  for (const item of panel.querySelectorAll<HTMLElement>('li[data-command]')) {
    const insertionLatex = item.dataset.command || '';
    const info = kernelCompletionInfo(mf, insertionLatex);
    item.dataset.kernelInsertionLatex = insertionLatex;
    item.dataset.command = info.command || insertionLatex;
  }

  return panel;
}

export function disposeSuggestionPopover(mf: _Mathfield): void {
  const panel = document.getElementById('mathlive-suggestion-popover') as SuggestionPanel | null;
  if (!panel || panel.kernelMathfield !== mf) return;
  releaseSharedElement('mathlive-suggestion-popover');
  releaseStylesheet('suggestion-popover');
  releaseStylesheet('core');
}
