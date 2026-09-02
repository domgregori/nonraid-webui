import { XMLParser } from 'fast-xml-parser';
import type { ParsedDockerContainer, UnraidImportWarning } from './types.js';

// parseTagValue/parseAttributeValue: false keeps every value a plain string (a port number like
// "6379" would otherwise get silently coerced to a real number by fast-xml-parser's own type
// inference) - this parser does its own numeric parsing explicitly below, where it can validate
// the result instead of trusting an auto-coercion.
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  trimValues: true,
  parseTagValue: false,
  parseAttributeValue: false,
});

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/** A leaf element parses to a plain string when it has no attributes (`<Name>x</Name>`), or an
 *  object with a `#text` key when it does (every `<Config>` entry, which always carries Target/
 *  Type/... attributes alongside its value) - this normalizes both shapes to a plain string,
 *  including the "attributes but no text" case (`<Config .../>`), which would otherwise stringify
 *  to the literal text "[object Object]" if handled naively. */
function textOf(node: unknown): string {
  if (node == null) return '';
  if (typeof node === 'object') {
    const text = (node as Record<string, unknown>)['#text'];
    return text == null ? '' : String(text);
  }
  return String(node);
}

function attrOf(node: unknown, name: string): string {
  if (node == null || typeof node !== 'object') return '';
  const value = (node as Record<string, unknown>)[`@_${name}`];
  return value == null ? '' : String(value);
}

/**
 * Parses one dockerMan container template XML (config/plugins/dockerMan/templates-user/*.xml) into
 * this app's own manual-container shape. Every `<Config>` entry is already a resolved value from
 * when the container was actually installed on Unraid (Target = the container-side name/path/port,
 * the element's own text = the host-side value the admin ended up with, Mode/Type describe how to
 * interpret it) - there's no CA Config *schema* left to solve, just a straight field mapping:
 *
 *   Type="Port"     Target=containerPort, text=hostPort, Mode=tcp|udp
 *   Type="Path"     Target=containerPath, text=hostPath, Mode=rw|ro
 *   Type="Variable" Target=env var name,  text=its value
 *   Type="Device"   Target=containerPath, text=hostPath
 *
 * Best-effort like the rest of this importer: a template that fails to parse, or is missing a name
 * or image, is skipped with a warning rather than failing the whole preview over one bad file.
 */
export function parseDockerTemplate(xmlText: string, sourceLabel: string, warnings: UnraidImportWarning[]): ParsedDockerContainer | null {
  let doc: unknown;
  try {
    doc = xmlParser.parse(xmlText);
  } catch (err) {
    warnings.push({ message: `Docker template "${sourceLabel}" isn't valid XML - skipped (${(err as Error).message}).` });
    return null;
  }

  const container = (doc as { Container?: unknown } | null)?.Container;
  if (!container || typeof container !== 'object') {
    warnings.push({ message: `Docker template "${sourceLabel}" has no <Container> root - skipped.` });
    return null;
  }
  const c = container as Record<string, unknown>;

  const name = textOf(c.Name).trim();
  const image = textOf(c.Repository).trim();
  if (!name || !image) {
    warnings.push({ message: `Docker template "${sourceLabel}" is missing a name or image - skipped.` });
    return null;
  }

  const network = textOf(c.Network).trim() || 'bridge';
  const privileged = textOf(c.Privileged).trim().toLowerCase() === 'true';
  const webUiUrl = textOf(c.WebUI).trim() || null;

  const ports: ParsedDockerContainer['ports'] = [];
  const binds: ParsedDockerContainer['binds'] = [];
  const env: ParsedDockerContainer['env'] = [];
  const devices: ParsedDockerContainer['devices'] = [];

  for (const entry of asArray(c.Config)) {
    const type = attrOf(entry, 'Type');
    const target = attrOf(entry, 'Target').trim();
    const value = textOf(entry).trim();
    if (!target) continue;

    if (type === 'Port') {
      const containerPort = Number(target);
      const hostPort = Number(value || target);
      if (Number.isInteger(containerPort) && containerPort > 0 && Number.isInteger(hostPort) && hostPort > 0) {
        ports.push({ containerPort, hostPort, protocol: attrOf(entry, 'Mode').toLowerCase() === 'udp' ? 'udp' : 'tcp' });
      }
    } else if (type === 'Path') {
      if (value) binds.push({ hostPath: value, containerPath: target, readOnly: attrOf(entry, 'Mode').toLowerCase() === 'ro' });
    } else if (type === 'Variable') {
      env.push({ name: target, value });
    } else if (type === 'Device') {
      if (value) devices.push({ hostPath: value, containerPath: target });
    }
    // Other Config types (Label, ...) are rare and have nothing in this app's container-creation
    // shape to map onto - silently skipped, same as an unrecognized top-level field below.
  }

  const unsupportedFields: string[] = [];
  if (textOf(c.ExtraParams).trim()) unsupportedFields.push('ExtraParams');
  if (textOf(c.CPUset).trim()) unsupportedFields.push('CPUset');
  // PostArgs overrides the container's default command (e.g. Kiwix-Server's `'*.zim'`, telling it
  // which files to serve) - this app's own container-creation has no command-override field at all
  // to carry it into, unlike ExtraParams/CPUset which just get dropped as nice-to-haves. Confirmed
  // live: a container whose image needs this to do anything useful (no default CMD covers it)
  // starts and immediately exits instead of actually failing to create, so this warning is the only
  // signal an admin gets before picking it in the review step.
  if (textOf(c.PostArgs).trim()) unsupportedFields.push('PostArgs (container command)');

  return { name, image, network, privileged, webUiUrl, ports, binds, env, devices, unsupportedFields };
}
