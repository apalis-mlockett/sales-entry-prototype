/**
 * Minimal jQuery type declarations for app use (delivery options, validation).
 * For full jQuery types, install @types/jquery.
 */

interface JQuery {
  length: number;
  addClass(className: string): this;
  removeClass(className: string): this;
  closest(selector: string): this;
  find(selector: string): this;
  append(content: string | this): this;
  empty(): this;
  val(): string | number | string[] | undefined;
  val(value: string | number | string[]): this;
  attr(name: string): string | undefined;
  attr(name: string, value: string): this;
  prop(property: string): boolean | string | undefined;
  prop(property: string, value: boolean | string): this;
  is(selector: string): boolean;
  trigger(eventType: string): this;
  on(events: string, handler: (this: HTMLElement, event: JQuery.TriggeredEvent) => void): this;
  one(events: string, handler: (this: HTMLElement, event: JQuery.TriggeredEvent) => void): this;
  focus(): this;
  scrollIntoView(options?: ScrollIntoViewOptions): void;
  [index: number]: HTMLElement;
}

interface JQueryStatic {
  (selector: string | HTMLElement | Document): JQuery;
  (html: string): JQuery;
}

declare const $: JQueryStatic;
declare const jQuery: JQueryStatic;

declare namespace JQuery {
  interface TriggeredEvent extends Event {
    // minimal for app handlers
  }
}
