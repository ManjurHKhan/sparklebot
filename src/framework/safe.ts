const ZWSP = '​';
export const MAX_FIELD_LEN = 256;
export const MAX_MESSAGE_LEN = 3000;

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
 * - length cap
 * - entity-escape & < >  (kills <@mentions>, <!here>, <!channel>, <!subteam^…>, links)
 * - neutralize mrkdwn pair chars * _ ~ ` with a trailing ZWSP
 */
export function escapeText(input: string, maxLen: number = MAX_FIELD_LEN): string {
  let s = input.normalize('NFKC');
  if (s.length > maxLen) s = `${s.slice(0, maxLen)}…`;
  s = s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  s = s.replace(/([*_~`])/g, `$1${ZWSP}`);
  return s;
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
