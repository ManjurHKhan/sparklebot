const ZWSP = '​';
export const MAX_FIELD_LEN = 256;
export const MAX_MESSAGE_LEN = 3000;
const UNSAFE_INVISIBLE_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g;
const SLACK_LINK_RE = /<\s*((?:(?:https?|ftp):\/\/|www\.)[^\s<>()`|]+|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}(?:\/[^\s<>()`|]+)?)(?:\|[^>]*)?\s*>/gi;
const LINK_RE = /\b((?:(?:https?|ftp):\/\/|www\.)[^\s<>()`|]+|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}(?:\/[^\s<>()`|]+)?)/gi;
const TRAILING_LINK_PUNCT_RE = /[.,!?;:]+$/;

function escapeSlackControls(s: string): string {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function escapeNonLinkText(s: string): string {
  return escapeSlackControls(s).replace(/([*_~`])/g, `$1${ZWSP}`);
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
 * - neutralize mrkdwn pair chars * _ ~ ` with a trailing ZWSP
 */
export function escapeText(input: string, maxLen: number = MAX_FIELD_LEN): string {
  let s = input.normalize('NFKC').replace(UNSAFE_INVISIBLE_RE, '');
  if (s.length > maxLen) s = `${s.slice(0, maxLen)}…`;
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
