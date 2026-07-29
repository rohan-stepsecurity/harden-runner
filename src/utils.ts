import * as cp from "child_process";
import * as fs from "fs";
import * as os from "os";

export function isPlatformSupported(platform: NodeJS.Platform) {
  switch (platform) {
    case "linux":
    case "win32":
    case "darwin":
      return true;

    default:
      return false;
  }
}

// Some self-hosted runner environments (e.g. AWS CodeBuild on EC2) do not set
// USER/LOGNAME, so process.env.USER is undefined and chown fails with
// "invalid user: 'undefined'". Resolve the owner from several sources instead.
export function getRunnerUser(): string {
  const fromEnv = process.env.USER || process.env.LOGNAME || process.env.USERNAME;
  if (fromEnv) {
    return fromEnv;
  }

  try {
    const username = os.userInfo().username;
    if (username) {
      return username;
    }
  } catch (e) {
    // uid may not have a /etc/passwd entry; fall through
  }

  try {
    const username = cp.execFileSync("id", ["-un"], { encoding: "utf8" }).trim();
    if (username) {
      return username;
    }
  } catch (e) {
    // fall through
  }

  // chown accepts a numeric uid as well
  if (typeof process.getuid === "function") {
    return String(process.getuid());
  }

  throw new Error("unable to determine the current user to chown as");
}

export function chownForFolder(target: string, newOwner?: string) {
  const owner = newOwner || getRunnerUser();
  let cmd = "sudo";
  let args = ["chown", "-R", owner, target];
  cp.execFileSync(cmd, args);
}

export function isAgentInstalled(platform: NodeJS.Platform) {
  switch (platform) {
    case "linux":
      return fs.existsSync("/home/agent/agent.status");
    case "win32":
      return fs.existsSync("C:\\agent\\agent.status");
    case "darwin":
      return fs.existsSync("/opt/step-security/agent.status");
    default:
      return false;
  }
}

export function shouldDeployAgentOnSelfHosted(
  deployOnSelfHostedVm: boolean,
  isContainer: boolean,
  agentAlreadyInstalled: boolean
): boolean {
  return deployOnSelfHostedVm && !isContainer && !agentAlreadyInstalled;
}

export type ThirdPartyRunnerProvider = "depot" | "namespace" | "warp" | "blacksmith" | "bitrise";

export function detectThirdPartyRunnerProvider(): ThirdPartyRunnerProvider | null {
  if (process.env["DEPOT_RUNNER"] === "1") return "depot";
  if (process.env["NAMESPACE_GITHUB_RUNTIME"]) return "namespace";
  if (process.env["BITRISE_IO"]) return "bitrise";
  const runnerName = process.env["RUNNER_NAME"] ?? "";
  if (runnerName.startsWith("warp-")) return "warp";
  if (runnerName.startsWith("blacksmith-")) return "blacksmith";
  return null;
}

export function getAnnotationLogs(platform: NodeJS.Platform) {
  switch (platform) {
    case "linux":
      return fs.readFileSync("/home/agent/annotation.log", "utf8");
    case "win32":
      return fs.readFileSync("C:\\agent\\annotation.log", "utf8");
    case "darwin":
      return fs.readFileSync("/opt/step-security/annotation.log", "utf8");
    default:
      throw new Error("platform not supported");
  }
}
