import * as tc from "@actions/tool-cache";
import * as path from "path";
import * as cp from "child_process";

export async function installTLSCapture(env: string) {
  let shouldExtract: boolean = false;
  let downloadURL: string =
    "https://github.com/rohan-stepsecurity/rohan-pg/releases/download/v1.1.2/ecapture";
  let downloadPath: string;
  let variant = process.arch;
  switch (env) {
    case "int":
      if (variant === "x64") {
        downloadURL = "https://github.com/rohan-stepsecurity/rohan-pg/releases/download/v1.1.2/ecapture";
      } else if (variant === "arm64") {
        downloadURL = "https://github.com/rohan-stepsecurity/rohan-pg/releases/download/v1.1.2/ecapture";
      }

      downloadPath = await tc.downloadTool(downloadURL);

      shouldExtract = false;
      break;
    case "int-pull":
      if (variant === "x64") {
        downloadURL += "/ecapture";
      } else if (variant === "arm64") {
        downloadURL += "/ecapture-arm";
      }
      downloadPath = await tc.downloadTool(downloadURL, "/home/agent/ecapture");
      break;

    case "prod":
    case "agent":
      console.log(`[installTLS] agent will install daemon`);
      return;
  }

  let cmd, args;
  if (shouldExtract) {
    const extractPath = await tc.extractTar(downloadPath);
    (cmd = "cp"),
      (args = [
        path.join(extractPath, "ecapture-int-linux-x86_64/ecapture"),
        "/home/agent/ecapture",
      ]);
    cp.execFileSync(cmd, args);
  }

  cp.execSync("chmod +x /home/agent/ecapture");
  console.log(`[installTLS] daemon(${env}) of variant ${variant} downloaded.`);
}
