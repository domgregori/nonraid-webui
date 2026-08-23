import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RealLxcClient } from './realClient.js';

// The stop path under test shells out via private helpers; spy on them on the
// instance (they are ordinary prototype methods at runtime, only `private` to
// TypeScript) rather than reaching into child_process.
describe('RealLxcClient stop hardening', () => {
  let client: RealLxcClient;
  let run: ReturnType<typeof vi.fn>;
  let getPid: ReturnType<typeof vi.fn>;
  let pidAlive: ReturnType<typeof vi.fn>;
  let killSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    client = new RealLxcClient();
    run = vi.fn(async () => ({ stdout: '', stderr: '' }));
    getPid = vi.fn(async () => 12345);
    pidAlive = vi.fn(async () => false);
    killSpy = vi.spyOn(process, 'kill').mockReturnValue(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(client as any, 'run').mockImplementation(run);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(client as any, 'getPid').mockImplementation(getPid);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(client as any, 'pidAlive').mockImplementation(pidAlive);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // The escalation re-runs lxc-stop with --kill (2-arg form, default timeout).
  function killCalls(): string[][] {
    return run.mock.calls.map((c) => c[1] as string[]).filter((args) => args.includes('--kill'));
  }

  it('does not escalate when the init exits cleanly', async () => {
    pidAlive.mockResolvedValueOnce(false);
    const result = await client.stopContainer('alpiney');
    expect(result.ok).toBe(true);
    expect(killCalls()).toHaveLength(0);
    expect(killSpy).not.toHaveBeenCalled();
  });

  it('escalates to lxc-stop --kill when the init survives a graceful stop', async () => {
    pidAlive.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await client.stopContainer('alpiney');
    expect(killCalls()).toHaveLength(1);
    expect(killSpy).not.toHaveBeenCalled();
  });

  it('SIGKILLs the init directly when --kill also leaves it orphaned', async () => {
    pidAlive.mockResolvedValue(true);
    await client.stopContainer('alpiney');
    expect(killCalls()).toHaveLength(1);
    expect(killSpy).toHaveBeenCalledWith(12345, 'SIGKILL');
  });

  it('skips verification entirely when the container was not running', async () => {
    getPid.mockResolvedValueOnce(null);
    await client.stopContainer('alpiney');
    expect(pidAlive).not.toHaveBeenCalled();
    expect(killCalls()).toHaveLength(0);
    expect(killSpy).not.toHaveBeenCalled();
  });

  it('force stop still verifies and escalates', async () => {
    pidAlive.mockResolvedValue(true);
    await client.stopContainer('alpiney', { force: true });
    expect(killSpy).toHaveBeenCalledWith(12345, 'SIGKILL');
  });

  it('restartContainer uses the hardened stop before starting', async () => {
    pidAlive.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await client.restartContainer('alpiney');
    expect(killCalls()).toHaveLength(1);
    // The subsequent lxc-start still runs after the escalation.
    expect(run).toHaveBeenCalledWith('lxc-start', expect.arrayContaining(['-n', 'alpiney']));
  });
});
