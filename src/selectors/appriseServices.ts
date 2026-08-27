// Structured builders for the most common Apprise target URL formats (https://github.com/caronc/
// apprise/wiki) - covers what most people actually use; anything else still has the "Custom URL"
// entry, which is exactly the old raw-textarea behavior for a single target.

export interface AppriseField {
  key: string;
  label: string;
  placeholder?: string;
  password?: boolean;
  required?: boolean;
}

export interface AppriseService {
  id: string;
  label: string;
  /** Shown above the fields so the admin can see the shape of the URL being built. */
  pattern: string;
  fields: AppriseField[];
  /** Every URL scheme this service can produce - one entry for a fixed-scheme service (Discord,
   *  Pushover, ...), two for one with a secure/insecure pair. Used to match an already-configured
   *  target's scheme back to a friendly label (describeAppriseUrl below). */
  schemes: string[];
  /** Only set for services with a real secure/insecure scheme pair (self-hosted servers) - cloud
   *  APIs like Discord/Pushover/Telegram/Slack are HTTPS-only, so there's nothing to toggle. */
  secure?: { secureScheme: string; insecureScheme: string; default: boolean };
  buildUrl: (fields: Record<string, string>, secure: boolean) => string;
}

const t = (v: string | undefined) => v?.trim() ?? '';

export const CUSTOM_SERVICE_ID = 'custom';

export const APPRISE_SERVICES: AppriseService[] = [
  {
    id: 'ntfy',
    label: 'ntfy',
    pattern: 'ntfy(s)://[user[:pass]@]host[:port]/topic  (leave host blank to use ntfy.sh)',
    schemes: ['ntfy', 'ntfys'],
    secure: { secureScheme: 'ntfys', insecureScheme: 'ntfy', default: true },
    fields: [
      { key: 'user', label: 'Username (optional)' },
      { key: 'password', label: 'Password (optional)', password: true },
      { key: 'host', label: 'Server (blank = ntfy.sh)', placeholder: 'ntfy.example.com' },
      { key: 'port', label: 'Port (optional)', placeholder: '443' },
      { key: 'topic', label: 'Topic', placeholder: 'my-topic', required: true },
    ],
    buildUrl: (f, secure) => {
      const scheme = secure ? 'ntfys' : 'ntfy';
      const topic = t(f.topic);
      const host = t(f.host);
      if (!host) return `${scheme}://${topic}`;
      const auth = t(f.user) ? (t(f.password) ? `${t(f.user)}:${t(f.password)}@` : `${t(f.user)}@`) : '';
      const port = t(f.port) ? `:${t(f.port)}` : '';
      return `${scheme}://${auth}${host}${port}/${topic}`;
    },
  },
  {
    id: 'discord',
    label: 'Discord',
    pattern: 'discord://[botname@]webhook_id/webhook_token/',
    schemes: ['discord'],
    fields: [
      { key: 'botName', label: 'Bot name (optional)' },
      { key: 'webhookId', label: 'Webhook ID', required: true },
      { key: 'webhookToken', label: 'Webhook token', password: true, required: true },
    ],
    buildUrl: (f) => {
      const bot = t(f.botName) ? `${t(f.botName)}@` : '';
      return `discord://${bot}${t(f.webhookId)}/${t(f.webhookToken)}/`;
    },
  },
  {
    id: 'pushover',
    label: 'Pushover',
    pattern: 'pover://user_key@api_token[/device]',
    schemes: ['pover'],
    fields: [
      { key: 'userKey', label: 'User key', required: true },
      { key: 'apiToken', label: 'API token', password: true, required: true },
      { key: 'device', label: 'Device (optional)' },
    ],
    buildUrl: (f) => {
      const device = t(f.device) ? `/${t(f.device)}` : '';
      return `pover://${t(f.userKey)}@${t(f.apiToken)}${device}`;
    },
  },
  {
    id: 'telegram',
    label: 'Telegram',
    pattern: 'tgram://bot_token/chat_id/',
    schemes: ['tgram'],
    fields: [
      { key: 'botToken', label: 'Bot token', password: true, required: true },
      { key: 'chatId', label: 'Chat ID', required: true },
    ],
    buildUrl: (f) => `tgram://${t(f.botToken)}/${t(f.chatId)}/`,
  },
  {
    id: 'gotify',
    label: 'Gotify',
    pattern: 'gotify(s)://host[:port]/[path/]token',
    schemes: ['gotify', 'gotifys'],
    secure: { secureScheme: 'gotifys', insecureScheme: 'gotify', default: true },
    fields: [
      { key: 'host', label: 'Server', placeholder: 'gotify.example.com', required: true },
      { key: 'port', label: 'Port (optional)' },
      { key: 'path', label: 'Path prefix (optional)' },
      { key: 'token', label: 'App token', password: true, required: true },
    ],
    buildUrl: (f, secure) => {
      const scheme = secure ? 'gotifys' : 'gotify';
      const port = t(f.port) ? `:${t(f.port)}` : '';
      const path = t(f.path) ? `${t(f.path).replace(/^\/+|\/+$/g, '')}/` : '';
      return `${scheme}://${t(f.host)}${port}/${path}${t(f.token)}`;
    },
  },
  {
    id: 'slack',
    label: 'Slack (webhook)',
    pattern: 'slack://tokenA/tokenB/tokenC[/#channel]',
    schemes: ['slack'],
    fields: [
      { key: 'tokenA', label: 'Token A', required: true },
      { key: 'tokenB', label: 'Token B', required: true },
      { key: 'tokenC', label: 'Token C', password: true, required: true },
      { key: 'channel', label: 'Channel (optional)', placeholder: 'general' },
    ],
    buildUrl: (f) => {
      const channel = t(f.channel) ? `/#${t(f.channel).replace(/^#/, '')}` : '';
      return `slack://${t(f.tokenA)}/${t(f.tokenB)}/${t(f.tokenC)}${channel}`;
    },
  },
  {
    id: 'email',
    label: 'Email',
    pattern: 'mailto(s)://user[:pass]@domain[:port][/target]',
    schemes: ['mailto', 'mailts'],
    secure: { secureScheme: 'mailts', insecureScheme: 'mailto', default: true },
    fields: [
      { key: 'user', label: 'Username', required: true },
      { key: 'password', label: 'Password (optional)', password: true },
      { key: 'domain', label: 'Domain', placeholder: 'gmail.com', required: true },
      { key: 'port', label: 'Port (optional)' },
      { key: 'target', label: 'Send to (optional, if different)', placeholder: 'someone@example.com' },
    ],
    buildUrl: (f, secure) => {
      const scheme = secure ? 'mailts' : 'mailto';
      const auth = t(f.password) ? `${t(f.user)}:${t(f.password)}@` : `${t(f.user)}@`;
      const port = t(f.port) ? `:${t(f.port)}` : '';
      const target = t(f.target) ? `/${t(f.target)}` : '';
      return `${scheme}://${auth}${t(f.domain)}${port}${target}`;
    },
  },
  {
    id: CUSTOM_SERVICE_ID,
    label: 'Custom URL',
    pattern: 'any apprise service URL',
    schemes: [],
    fields: [{ key: 'url', label: 'URL', placeholder: 'scheme://...', required: true }],
    buildUrl: (f) => t(f.url),
  },
];

/** For rendering an already-configured target in the list - matches its scheme (secure or
 *  insecure variant) back to a friendly service label, falling back to the scheme itself. */
export function describeAppriseUrl(url: string): string {
  const scheme = url.split('://')[0]?.toLowerCase() ?? '';
  const match = APPRISE_SERVICES.find((svc) => svc.schemes.includes(scheme));
  return match?.label || scheme || 'Custom';
}

/** Masks credentials before display (user:pass@ -> user:•••@) - the list still shows enough to
 *  tell targets apart without echoing secrets back onto the screen. */
export function maskAppriseUrl(url: string): string {
  return url.replace(/:\/\/([^:/@]+):([^@/]+)@/, (_m, user) => `://${user}:••••@`);
}
