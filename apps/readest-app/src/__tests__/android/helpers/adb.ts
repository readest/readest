import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// All commands honor ANDROID_SERIAL, so the lane works unchanged against a
// physical device or an emulator — set the env var to pick one when several
// devices are attached.
export const adb = async (args: string[], timeoutMs = 30_000): Promise<string> => {
  const { stdout } = await execFileAsync('adb', args, { timeout: timeoutMs });
  return stdout.toString();
};

export const adbShell = (cmd: string, timeoutMs = 30_000): Promise<string> =>
  adb(['shell', cmd], timeoutMs);

export const hasAdb = async (): Promise<boolean> => {
  try {
    await adb(['version']);
    return true;
  } catch {
    return false;
  }
};

export const listDeviceSerials = async (): Promise<string[]> => {
  const out = await adb(['devices']);
  return out
    .split('\n')
    .slice(1)
    .map((l) => l.trim())
    .filter((l) => l.endsWith('device'))
    .map((l) => l.split(/\s+/)[0]!)
    .filter(Boolean);
};

export const isPackageInstalled = async (pkg: string): Promise<boolean> => {
  const out = await adbShell(`pm list packages ${pkg}`);
  return out.includes(`package:${pkg}`);
};

export const screenSize = async (): Promise<{ width: number; height: number }> => {
  const out = await adbShell('wm size');
  const m = out.match(/(\d+)x(\d+)/);
  if (!m) throw new Error(`cannot parse screen size from: ${out}`);
  return { width: Number(m[1]), height: Number(m[2]) };
};

export const tap = (x: number, y: number): Promise<string> =>
  adbShell(`input tap ${Math.round(x)} ${Math.round(y)}`);

// `input swipe` with identical endpoints and a long duration is a long-press.
export const longPress = (x: number, y: number, ms = 700): Promise<string> =>
  adbShell(`input swipe ${Math.round(x)} ${Math.round(y)} ${Math.round(x)} ${Math.round(y)} ${ms}`);

export interface MotionStep {
  x: number;
  y: number;
  /** Seconds to wait AFTER this step before the next one. */
  pauseSec?: number;
}

// A raw touch gesture: DOWN at the first step, MOVE through the rest, UP at
// the last position. Unlike `input swipe` this supports long-press-then-drag
// and mid-gesture dwells (corner auto-turn).
export const motionGesture = async (steps: MotionStep[]): Promise<string> => {
  if (steps.length === 0) throw new Error('motionGesture needs at least one step');
  const parts: string[] = [];
  steps.forEach((s, i) => {
    const kind = i === 0 ? 'DOWN' : 'MOVE';
    parts.push(`input motionevent ${kind} ${Math.round(s.x)} ${Math.round(s.y)}`);
    if (s.pauseSec) parts.push(`sleep ${s.pauseSec}`);
  });
  const last = steps[steps.length - 1]!;
  parts.push(`input motionevent UP ${Math.round(last.x)} ${Math.round(last.y)}`);
  // One shell invocation so inter-event timing isn't at the mercy of adb
  // round-trips.
  return adbShell(parts.join(' && '), 120_000);
};

export const pushFile = (local: string, remote: string): Promise<string> =>
  adb(['push', local, remote]);

export const forwardTcpToLocalAbstract = async (port: number, socket: string): Promise<void> => {
  try {
    await adb(['forward', '--remove', `tcp:${port}`]);
  } catch {
    // not forwarded yet
  }
  await adb(['forward', `tcp:${port}`, `localabstract:${socket}`]);
};
