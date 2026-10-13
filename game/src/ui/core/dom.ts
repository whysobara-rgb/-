/**
 * Minimal DOM building helpers (no framework).
 *
 *   h('div', { class: 'uh-card', onClick: fn, 'data-nav': '' }, 'text', child)
 *
 * Attribute rules:
 * - `class` / `className`: string (falsy parts filtered when given an array)
 * - `style`: string or partial CSSStyleDeclaration-like record (custom props allowed: '--x')
 * - `onXxx`: function -> addEventListener('xxx')
 * - boolean true -> empty attribute, false/null/undefined -> omitted
 * - everything else -> setAttribute(String(value))
 * Text children are always inserted as text nodes (never parsed as HTML).
 */

export type Child = Node | string | number | null | undefined | false | readonly Child[];
type AttrValue = string | number | boolean | null | undefined | EventListener | ((e: never) => void)
  | Readonly<Record<string, string | number | null | undefined>> | ReadonlyArray<string | false | null | undefined>;
export type Attrs = Readonly<Record<string, AttrValue>>;

const SVG_NS = 'http://www.w3.org/2000/svg';

function applyAttrs(el: Element, attrs: Attrs | null | undefined): void {
  if (!attrs) return;
  for (const name in attrs) {
    const v = attrs[name];
    if (v === undefined || v === null || v === false) continue;
    if (name === 'class' || name === 'className') {
      const cls = Array.isArray(v) ? (v as ReadonlyArray<string | false | null | undefined>).filter(Boolean).join(' ') : String(v);
      if (cls) el.setAttribute('class', cls);
    } else if (name === 'style') {
      if (typeof v === 'string') el.setAttribute('style', v);
      else if (typeof v === 'object') {
        const style = (el as HTMLElement).style;
        const rec = v as Readonly<Record<string, string | number | null | undefined>>;
        for (const k in rec) {
          const sv = rec[k];
          if (sv === null || sv === undefined) continue;
          if (k.startsWith('--')) style.setProperty(k, String(sv));
          else (style as unknown as Record<string, string>)[k] = String(sv);
        }
      }
    } else if (name.length > 2 && name.startsWith('on') && typeof v === 'function') {
      el.addEventListener(name.slice(2).toLowerCase(), v as EventListener);
    } else if (v === true) {
      el.setAttribute(name, '');
    } else {
      el.setAttribute(name, String(v));
    }
  }
}

function appendChildren(el: Node, children: readonly Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) appendChildren(el, c as readonly Child[]);
    else if (typeof c === 'string' || typeof c === 'number') el.appendChild(document.createTextNode(String(c)));
    else el.appendChild(c as Node);
  }
}

/** Create an HTML element. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Attrs | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  applyAttrs(el, attrs);
  appendChildren(el, children);
  return el;
}

/** Create an SVG element. */
export function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs?: Attrs | null,
  ...children: Child[]
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  applyAttrs(el, attrs);
  appendChildren(el, children);
  return el;
}

/**
 * Parse a trusted, static SVG markup string (icons authored in this module only — never
 * user/player text) into an element.
 */
export function svgFromMarkup(markup: string, className?: string): SVGSVGElement {
  const tpl = document.createElement('template');
  tpl.innerHTML = markup.trim();
  const svg = tpl.content.firstElementChild as SVGSVGElement;
  if (className) svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  return svg;
}

/** replaceChildren that skips null/false entries (handy for conditional children). */
export function setChildren(el: Element, ...kids: Child[]): void {
  const frag = document.createDocumentFragment();
  appendChildren(frag, kids);
  el.replaceChildren(frag);
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/** Set textContent only when it changed (cheap DOM-diff for per-frame updates). */
export function setText(el: Element, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

/** Toggle a class only when its state changes. */
export function setClass(el: Element, cls: string, on: boolean): void {
  if (el.classList.contains(cls) !== on) el.classList.toggle(cls, on);
}

export function isReducedMotion(): boolean {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('uh-reduced-motion');
}

/** Run a Web Animation unless reduced motion is on (no forced reflow, unlike class restarts). */
export function animateEl(
  el: Element,
  keyframes: Keyframe[] | PropertyIndexedKeyframes,
  options: number | KeyframeAnimationOptions,
): Animation | null {
  if (isReducedMotion() || typeof (el as HTMLElement).animate !== 'function') return null;
  return (el as HTMLElement).animate(keyframes, options);
}

let idCounter = 0;
export function uid(prefix = 'uh'): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}
