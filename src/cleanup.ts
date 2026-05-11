import * as fs from "fs";
import * as common from "./common";
import * as cp from "child_process";
import * as path from "path";
import isDocker from "is-docker";
import { isARCRunner } from "./arc-runner";
import { isGithubHosted } from "./tls-inspect";
import { context } from "@actions/github";
import * as core from "@actions/core";
import { isPlatformSupported, isAgentInstalled } from "./utils";

(async () => {
  console.log("[harden-runner] post-step");

  const customProperties = context?.payload?.repository?.custom_properties || {};
  if (customProperties["skip-harden-runner"] === "true") {
    console.log("Skipping harden-runner: custom property 'skip-harden-runner' is set to 'true'");
    return;
  }

  if (!isPlatformSupported(process.platform)) {
    console.log(common.UNSUPPORTED_RUNNER_MESSAGE);
    return;
  }
  if (isGithubHosted() && isDocker()) {
    console.log(common.CONTAINER_MESSAGE);
    return;
  }

  if (isARCRunner()) {
    console.log(`[!] ${common.ARC_RUNNER_MESSAGE}`);
    return;
  }

  if (process.env.STATE_selfHosted === "true") {
    return;
  }

  if (process.env.STATE_customVMImage === "true") {
    return;
  }

  if (
    String(process.env.STATE_monitorStatusCode) ===
    common.STATUS_HARDEN_RUNNER_UNAVAILABLE
  ) {
    console.log(common.HARDEN_RUNNER_UNAVAILABLE_MESSAGE);
    return;
  }

  switch (process.platform) {
    case "linux":
      await handleLinuxCleanup();
      break;
    case "win32":
      await handleWindowsCleanup();
      break;
    case "darwin":
      await handleMacosCleanup();
      break;
  }

  try {
    await common.addSummary();
  } catch (exception) {
    console.log(exception);
  }
})();

async function handleLinuxCleanup() {
  if (process.env.STATE_isTLS === "false" && process.arch === "arm64") {
    return;
  }

  if (isGithubHosted() && fs.existsSync("/home/agent/post_event.json")) {
    console.log("Post step already executed, skipping");
    return;
  }

  fs.writeFileSync(
    "/home/agent/post_event.json",
    JSON.stringify({ event: "post" })
  );

  const doneFile = "/home/agent/done.json";
  let counter = 0;
  while (true) {
    if (!fs.existsSync(doneFile)) {
      counter++;
      if (counter > 10) {
        console.log("timed out");

        break;
      }
      await sleep(1000);
    } else {
      // The file *does* exist
      break;
    }
  }

  const log = "/home/agent/agent.log";
  if (fs.existsSync(log)) {
    core.startGroup("[StepSecurity] HardenRunner Agent Log");
    var content = fs.readFileSync(log, "utf-8");
    console.log(content);
    core.endGroup();
  }

  const daemonLog = "/home/agent/daemon.log";
  if (fs.existsSync(daemonLog)) {
    core.startGroup("[StepSecurity] HardenRunner Daemon Log");
    var content = fs.readFileSync(daemonLog, "utf-8");
    console.log(content);
    core.endGroup();
  }

  var disable_sudo = process.env.STATE_disableSudo;
  var disable_sudo_and_containers = process.env.STATE_disableSudoAndContainers;

  if (disable_sudo !== "true" && disable_sudo_and_containers !== "true") {
    try {
      var journalLog = cp.execSync(
        "sudo journalctl -u agent.service --lines=1000 2>&1",
        {
          encoding: "utf8",
          maxBuffer: 1024 * 1024 * 10, // 10MB buffer
        }
      );
      core.startGroup("[StepSecurity] HardenRunner Service Log");
      console.log(journalLog);
      core.endGroup();
    } catch (error) {
      console.log("Warning: Could not fetch service logs:", error.message);
    }
  }

  var status = "/home/agent/agent.status";
  if (fs.existsSync(status)) {
    core.startGroup("[StepSecurity] HardenRunner Agent Status");
    var content = fs.readFileSync(status, "utf-8");
    console.log(content);
    core.endGroup();
  }


}

async function handleMacosCleanup() {
  const post_event = "/opt/step-security/post_event.json";

  if (isGithubHosted() && fs.existsSync(post_event)) {
    console.log("Post step already executed, skipping");
    return;
  }

  fs.writeFileSync(post_event, JSON.stringify({ event: "post" }));

  // if agent is installed; wait for it to create done.json
  if (isAgentInstalled(process.platform)) {
    let macDone = "/opt/step-security/done.json";
    let counter = 0;
    while (true) {
      if (!fs.existsSync(macDone)) {
        counter++;
        if (counter > 10) {
          console.log("timed out");
          break;
        }
        await sleep(1000);
      } else {
        // The file *does* exist
        break;
      }
    }
  }

  let macAgentLog = "/opt/step-security/agent.log";
  if (fs.existsSync(macAgentLog)) {
    core.startGroup("[StepSecurity] HardenRunner Agent Log");
    var content = fs.readFileSync(macAgentLog, "utf-8");
    console.log(content);
    core.endGroup();
  } else {
    console.log("😭 macos agent.log file not found");
  }

  // Capture system log stream for harden-runner subsystem
  try {
    const logStreamOutput = cp.execSync(
      "log show --predicate 'subsystem == \"io.stepsecurity.harden-runner\"' --info --last 10m",
      {
        encoding: "utf8",
        maxBuffer: 1024 * 1024 * 10, // 10MB buffer
        timeout: 5000, // 5 seconds timeout
      }
    );
    core.startGroup("[StepSecurity] HardenRunner System Log");
    console.log(logStreamOutput);
    core.endGroup();
  } catch (error) {
    console.log("Warning: Could not fetch system log stream:", error.message);
  }
}

async function handleWindowsCleanup() {
  // windows cleanup
  const agentDir = process.env.STATE_agentDir || "C:\\agent";
  const postEventFile = path.join(agentDir, "post_event.json");

  if (isGithubHosted() && fs.existsSync(postEventFile)) {
    console.log("Windows post step already executed, skipping");
    return;
  }

  if (process.arch === "arm64") {
    console.log(common.ARM64_WINDOWS_RUNNER_MESSAGE);
    return;
  }

  const p = cp.spawn(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "query user; exit $LASTEXITCODE",
    ],
    { stdio: ["ignore", "pipe", "pipe"], shell: false, windowsHide: true }
  );
  p.unref();

  fs.writeFileSync(postEventFile, JSON.stringify({ event: "post" }));

  // if agent is installed; wait for it to create done.json
  if (isAgentInstalled(process.platform)) {
    const doneFile = path.join(agentDir, "done.json");
    let counter = 0;
    while (true) {
      if (!fs.existsSync(doneFile)) {
        counter++;
        if (counter > 10) {
          console.log("timed out");
          break;
        }
        await sleep(1000);
      } else {
        break;
      }
    }
  }

  console.log("stopping windows agent process...");
  const pidFile = path.join(agentDir, "agent.pid");

  try {
    if (!fs.existsSync(pidFile)) {
      console.log("PID file not found. Agent may not be running.");
      return;
    }

    const pid = parseInt(fs.readFileSync(pidFile, "utf8").trim());
    console.log(`agent PID from file: ${pid}`);

    try {
      process.kill(pid, 0); // signal 0 just checks if process exists
    } catch {
      console.log("agent process not running.");
      fs.unlinkSync(pidFile);
      return;
    }

    console.log(`stopping agent process (PID: ${pid})...`);
    process.kill(pid, "SIGINT");

    let gracefulShutdown = false;
    for (let i = 0; i < 10; i++) {
      await sleep(1000);

      try {
        process.kill(pid, 0); // check if still exists
      } catch {
        gracefulShutdown = true;
        console.log("agent process stopped gracefully");
        break;
      }
    }

    if (!gracefulShutdown) {
      console.log("graceful shutdown timeout (10s), forcing termination...");
      process.kill(pid, "SIGKILL");
      console.log("agent process terminated forcefully");
    }

    if (fs.existsSync(pidFile)) {
      fs.unlinkSync(pidFile);
      console.log("PID file cleaned up");
    }
  } catch (error) {
    console.log("warning: error stopping agent process:", error.message);
  }

  const log = path.join(agentDir, "agent.log");
  if (fs.existsSync(log)) {
    core.startGroup("[StepSecurity] HardenRunner Agent Log");
    const content = fs.readFileSync(log, "utf-8");
    console.log(content);
    core.endGroup();
  }
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
