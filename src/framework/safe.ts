const ZWSP = '​';
export const MAX_FIELD_LEN = 256;
export const MAX_MESSAGE_LEN = 3000;
const UNSAFE_INVISIBLE_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]|\p{Bidi_Control}|\p{Default_Ignorable_Code_Point}/gu;
const USER_WHITESPACE_RE = /[\t\n\r]+/g;
const IDNA_DOT_RE = /[\u3002\uFF61]/g;
const DOMAIN_LABEL = String.raw`[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?`;
const DOMAIN_TLD = String.raw`(?:[\p{L}]{2,}|xn--[a-z0-9-]{2,})`;
const DOMAIN = String.raw`(?:${DOMAIN_LABEL}\.)+${DOMAIN_TLD}(?![\p{L}\p{N}-])`;
const URL_CHARS = String.raw`[^\s<>\x60|]+`;
const URL_SUFFIX = String.raw`(?:[/?#]${URL_CHARS})?`;
const EMAIL = String.raw`[a-z0-9._%+-]+@${DOMAIN}`;
const IPV4 = String.raw`(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?`;
const IPV6 = String.raw`\[[0-9a-f:.]+\](?::\d+)?`;
const SCHEME_LINK = String.raw`(?:[a-z][a-z0-9+.-]{1,31}://|(?:mailto|data|javascript):)${URL_CHARS}`;
const LINK_TARGET = String.raw`${SCHEME_LINK}|www\.${URL_CHARS}|${EMAIL}|${DOMAIN}(?::\d+)?${URL_SUFFIX}|${IPV4}${URL_SUFFIX}|${IPV6}${URL_SUFFIX}`;
const SLACK_LINK_RE = new RegExp(String.raw`<\s*(${LINK_TARGET})(?:\s*\|[^>]*)?\s*>`, 'giu');
const LINK_RE = new RegExp(String.raw`(?<![\p{L}\p{N}_])(${LINK_TARGET})`, 'giu');
const TRAILING_LINK_PUNCT_RE = /[.,!?;:]+$/;

function escapeSlackControls(s: string): string {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function escapeNonLinkText(s: string): string {
  return escapeSlackControls(s)
    .replace(/@(?=here\b|channel\b|everyone\b)/gi, `@${ZWSP}`)
    .replaceAll('`', '')
    .replace(/([*_~])/g, `$1${ZWSP}`);
}

function codeLink(raw: string): string {
  const trailing = raw.match(TRAILING_LINK_PUNCT_RE)?.[0] ?? '';
  const link = trailing ? raw.slice(0, -trailing.length) : raw;
  return `\`${escapeSlackControls(link)}\`${escapeNonLinkText(trailing)}`;
}

function renderLinksAsCode(s: string): string {
  let out = '';
  let last = 0;
  for (const match of s.matchAll(LINK_RE)) {
    const index = match.index ?? 0;
    out += escapeNonLinkText(s.slice(last, index));
    out += codeLink(match[0]);
    last = index + match[0].length;
  }
  out += escapeNonLinkText(s.slice(last));
  return out;
}

/**
 * Runtime-verified safe string. Only Context output methods accept it.
 * Private constructor + #private brand + module-private factory: cannot be
 * forged with an object literal or spread copy, and there is NO public
 * construction method on the class — the only constructors are
 * fmt/trusted/joinSafe in this module. (trusted() is for repo-authored
 * literals; calling it with user-derived text is the one misuse code review
 * must catch — see docs/extending.md hard rules.)
 */
let create: (text: string) => SafeText;

export class SafeText {
  readonly #brand = true;
  private constructor(readonly text: string) {}

  static {
    // ES2022 static init block: capture the private constructor into a
    // module-scoped factory without exposing any public construction API.
    create = (text) => new SafeText(text);
  }
}

export function isSafe(v: unknown): v is SafeText {
  return v instanceof SafeText;
}

/**
 * Escape user-derived text for Slack mrkdwn output.
 * - NFKC normalize (homograph collapse)
 * - strip control, zero-width, and bidi override chars from user input
 * - length cap
 * - entity-escape & < >  (kills <@mentions>, <!here>, <!channel>, <!subteam^…>, links)
 * - render URL-like text as inline code after Slack/Unicode normalization
 * - strip user backticks, then neutralize mrkdwn pair chars * _ ~ with a trailing ZWSP
 */
export function escapeText(input: string, maxLen: number = MAX_FIELD_LEN): string {
  let s = input.normalize('NFKC')
    .replace(UNSAFE_INVISIBLE_RE, '')
    .replace(IDNA_DOT_RE, '.')
    .replace(USER_WHITESPACE_RE, ' ');
  const limit = Math.min(maxLen, MAX_MESSAGE_LEN);
  if (s.length > limit) s = `${s.slice(0, limit)}…`;
  s = s.replace(SLACK_LINK_RE, '$1');
  return renderLinksAsCode(s);
}

/** Mark a framework-authored literal as safe. NEVER call with user-derived text. */
export function trusted(s: string): SafeText {
  return create(s);
}

/** Tagged template: literals trusted, interpolated strings escaped, SafeText passed through. */
export function fmt(
  strings: TemplateStringsArray,
  ...values: Array<string | number | SafeText>
): SafeText {
  let out = '';
  strings.forEach((part, i) => {
    out += part;
    if (i < values.length) {
      const v = values[i]!;
      if (typeof v === 'number') out += String(v);
      else if (isSafe(v)) out += v.text;
      else out += escapeText(v);
    }
  });
  if (out.length > MAX_MESSAGE_LEN) out = out.slice(0, MAX_MESSAGE_LEN);
  return create(out);
}

export function joinSafe(parts: SafeText[], sep: string): SafeText {
  return create(parts.map((p) => p.text).join(sep));
}
