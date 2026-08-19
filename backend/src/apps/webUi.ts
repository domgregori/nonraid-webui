/**
 * Resolves a CA template's WebUI field (e.g. "http://[IP]:[PORT:8080]") against
 * a container's actual current port mappings. `[IP]` is deliberately left
 * unresolved for the frontend to fill in with the host it's actually talking
 * to (window.location.hostname) - the backend has no reliable way to know
 * which address the user reaches it on. Takes a minimal port shape (not the
 * full PlanPortBinding/ContainerPortMapping type) so both the install-plan
 * path and the already-installed/Docker-tab path can share this without
 * depending on each other's richer types.
 */
export function resolveWebUiTemplate(
  template: string | undefined,
  ports: { containerPort: number; hostPort: number }[],
): string | null {
  if (!template) return null;
  return template.replace(/\[PORT:(\d+)\]/g, (_match, containerPort: string) => {
    const bound = ports.find((p) => String(p.containerPort) === containerPort);
    return bound ? String(bound.hostPort) : containerPort;
  });
}
